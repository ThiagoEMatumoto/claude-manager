import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'
import type { IntroScene, IntroSceneHandle, IntroSceneOptions } from './types'

/** Vermelho de largada: semântica de corrida, não cor de tema. Nunca vem do accent. */
const START_RED = '#ff1d15'

const PANEL_COUNT = 5
const PANEL_W = 0.56
const PANEL_H = 1.15
const PANEL_GAP = 0.82
const LAMP_QUAD = 0.72
const LAMP_Y = 0.247
/** O rig fica acima do meio: o wordmark DOM ocupa o centro a partir de t≈0.55. */
const RIG_Y = 1.28

const CAM_FOV = 42
const CAM_Z = 6.2
const CAM_Z_LAUNCH = 2.45
const PARALLAX_RAD = (3 * Math.PI) / 180

const PARTICLES = 720
const Z_SPAN = 34

/** Beat de silêncio entre "todas acesas" e o apagão. */
const HOLD_MS = 170
/** Piso do ato 3: flash + arranque + desaceleração não cabem em menos que isso. */
const LAUNCH_MIN_MS = 380
const BOOST_MS = 520
const FLASH_MS = 130

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeOutExpo = (v: number) => (v >= 1 ? 1 : 1 - Math.pow(2, -10 * v))
const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3)

const PLATE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const PLATE_FRAG = /* glsl */ `
uniform vec3 uPlate;
uniform vec3 uEdge;
uniform vec3 uAccent;
uniform vec3 uLamp;
uniform float uAspect;
uniform float uLit;
uniform float uSpecX;
uniform float uSpecY;
uniform float uFade;
varying vec2 vUv;

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 bounds = vec2(0.5 * uAspect, 0.5) - 0.012;
  float d = sdBox(p, bounds, 0.055);
  float body = smoothstep(0.006, -0.006, d);
  float rim = smoothstep(0.030, 0.0, abs(d + 0.010));

  float lens = smoothstep(0.098, 0.080, min(
    length(p - vec2(0.0, 0.215)),
    length(p - vec2(0.0, -0.215))
  ));

  vec3 col = mix(uPlate, uPlate * 0.30, lens);
  col += uEdge * rim * 0.9;
  col += uLamp * uLit * (0.14 * rim + 0.045);

  float dx = p.x / uAspect * 2.0 - uSpecX;
  float dy = p.y * 2.0 - uSpecY;
  float spec = exp(-dx * dx * 0.30) * exp(-dy * dy * 0.49);
  col += mix(uAccent, vec3(1.0), 0.4) * spec * 0.10 * (1.0 - lens * 0.65);

  gl_FragColor = vec4(col, body * uFade);
}
`

const LAMP_VERT = PLATE_VERT

const LAMP_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOn;
uniform float uBurst;
uniform float uFade;
varying vec2 vUv;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  float core = smoothstep(0.30, 0.19, d);
  float bulb = smoothstep(0.38, 0.27, d);
  float halo = pow(max(0.0, 1.0 - d), 3.5);
  float a = (bulb * 0.85 + halo * (0.50 + 0.50 * uBurst)) * uOn * uFade;
  vec3 c = mix(uColor, vec3(1.0), core * 0.45 * uOn);
  gl_FragColor = vec4(c * (1.0 + uBurst * 0.7), a);
}
`

const FLASH_VERT = PLATE_VERT

const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
varying vec2 vUv;

void main() {
  // Mais quente na borda: o miolo precisa continuar legível atrás do wordmark.
  float r = length(vUv - 0.5) * 1.6;
  float shape = mix(0.55, 1.0, clamp(r, 0.0, 1.0));
  gl_FragColor = vec4(uColor, uAmount * shape);
}
`

function mount(canvas: HTMLCanvasElement, opts: IntroSceneOptions): IntroSceneHandle {
  const accent = new Color(opts.accent)
  const bg = new Color(opts.bg)
  const red = new Color(START_RED)
  const plate = bg.clone().lerp(new Color('#ffffff'), 0.055)
  const edge = bg.clone().lerp(accent, 0.16)
  const flashColor = accent.clone().lerp(new Color('#ffffff'), 0.55)

  const renderer = new WebGLRenderer({
    canvas,
    antialias: opts.dpr < 1.5,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(opts.dpr)
  renderer.setClearColor(bg, 1)

  const scene = new Scene()
  const camera = new PerspectiveCamera(CAM_FOV, 1, 0.1, 120)
  camera.position.set(0, 0, CAM_Z)
  scene.add(camera)

  const disposables: Array<{ dispose(): void }> = []

  // --- rig de largada ---------------------------------------------------
  const rig = new Group()
  rig.position.y = RIG_Y
  scene.add(rig)

  const plateGeo = new PlaneGeometry(PANEL_W, PANEL_H)
  const lampGeo = new PlaneGeometry(LAMP_QUAD, LAMP_QUAD)
  disposables.push(plateGeo, lampGeo)

  type Panel = {
    x: number
    plate: ShaderMaterial
    lamps: [ShaderMaterial, ShaderMaterial]
    /** Instante em t normalizado em que o painel acende. */
    onAt: number
    lit: number
  }

  const panels: Panel[] = []
  for (let i = 0; i < PANEL_COUNT; i++) {
    const x = (i - (PANEL_COUNT - 1) / 2) * PANEL_GAP
    const group = new Group()
    group.position.x = x

    const plateMat = new ShaderMaterial({
      vertexShader: PLATE_VERT,
      fragmentShader: PLATE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPlate: { value: plate },
        uEdge: { value: edge },
        uAccent: { value: accent },
        uLamp: { value: red },
        uAspect: { value: PANEL_W / PANEL_H },
        uLit: { value: 0 },
        uSpecX: { value: 0 },
        uSpecY: { value: 0 },
        uFade: { value: 1 },
      },
    })
    const plateMesh = new Mesh(plateGeo, plateMat)
    plateMesh.renderOrder = 2
    group.add(plateMesh)

    const lampMats: ShaderMaterial[] = []
    for (const sign of [1, -1]) {
      const lampMat = new ShaderMaterial({
        vertexShader: LAMP_VERT,
        fragmentShader: LAMP_FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uColor: { value: red },
          uOn: { value: 0 },
          uBurst: { value: 0 },
          uFade: { value: 1 },
        },
      })
      const lampMesh = new Mesh(lampGeo, lampMat)
      lampMesh.position.set(0, sign * LAMP_Y, 0.02)
      lampMesh.renderOrder = 3
      group.add(lampMesh)
      lampMats.push(lampMat)
      disposables.push(lampMat)
    }

    disposables.push(plateMat)
    rig.add(group)
    panels.push({
      x,
      plate: plateMat,
      lamps: [lampMats[0], lampMats[1]],
      onAt: 0,
      lit: 0,
    })
  }

  // --- campo de partículas / slipstream ---------------------------------
  const angle = new Float32Array(PARTICLES)
  const baseRadius = new Float32Array(PARTICLES)
  const zpos = new Float32Array(PARTICLES)
  const bright = new Float32Array(PARTICLES)
  const drag = new Float32Array(PARTICLES)
  for (let i = 0; i < PARTICLES; i++) {
    angle[i] = Math.random() * Math.PI * 2
    baseRadius[i] = 1.05 + Math.pow(Math.random(), 0.7) * 4.6
    zpos[i] = 3 - Math.random() * Z_SPAN
    bright[i] = 0.45 + Math.random() * 0.55
    drag[i] = 0.75 + Math.random() * 0.5
  }

  const positions = new Float32Array(PARTICLES * 6)
  const colors = new Float32Array(PARTICLES * 6)
  const streakGeo = new BufferGeometry()
  streakGeo.setAttribute('position', new BufferAttribute(positions, 3))
  streakGeo.setAttribute('color', new BufferAttribute(colors, 3))
  const streakMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
  })
  const streaks = new LineSegments(streakGeo, streakMat)
  streaks.renderOrder = 1
  streaks.frustumCulled = false
  scene.add(streaks)
  disposables.push(streakGeo, streakMat)

  // --- flash de tela cheia (filho da câmera: sempre cobre o frame) -------
  const flashGeo = new PlaneGeometry(1, 1)
  const flashMat = new ShaderMaterial({
    vertexShader: FLASH_VERT,
    fragmentShader: FLASH_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uColor: { value: flashColor },
      uAmount: { value: 0 },
    },
  })
  const flash = new Mesh(flashGeo, flashMat)
  flash.position.z = -1
  flash.renderOrder = 10
  flash.visible = false
  camera.add(flash)
  disposables.push(flashGeo, flashMat)

  // --- estado de animação ------------------------------------------------
  let pointerX = 0
  let pointerY = 0
  let width = Math.max(canvas.clientWidth, 1)
  let height = Math.max(canvas.clientHeight, 1)
  let disposed = false

  let plannedMs = 2400
  let plannedKnown = false
  let releasePending = false
  let releaseT = -1
  let blackoutT = -1
  let blackedOut = false
  let sinceBlackout = 0
  let camZ = CAM_Z
  let spread = 0
  let lastT = 0

  const schedule = () => {
    // ~220ms por painel, mas normalizado no arco: o gate varia a duração entre
    // 1.6s e 3.0s e a cadência de largada não pode estourar o release.
    const step = Math.min(0.095, Math.max(0.055, 220 / plannedMs))
    for (let i = 0; i < PANEL_COUNT; i++) panels[i].onAt = 0.09 + i * step
  }
  schedule()

  const resetCycle = () => {
    plannedKnown = false
    plannedMs = 2400
    releasePending = false
    releaseT = -1
    blackoutT = -1
    blackedOut = false
    sinceBlackout = 0
    camZ = CAM_Z
    spread = 0
    flashMat.uniforms.uAmount.value = 0
    flash.visible = false
    streakMat.opacity = 0
    for (const p of panels) p.lit = 0
    schedule()
  }

  const resizeFlash = () => {
    const h = 2 * Math.tan((CAM_FOV * Math.PI) / 360)
    flash.scale.set(h * camera.aspect * 1.1, h * 1.1, 1)
  }

  const applyViewport = () => {
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    // Em janela estreita o pórtico não pode vazar pela lateral.
    const halfW = Math.tan((CAM_FOV * Math.PI) / 360) * CAM_Z * camera.aspect
    const rigHalf = ((PANEL_COUNT - 1) / 2) * PANEL_GAP + PANEL_W / 2
    rig.scale.setScalar(Math.min(1, (halfW * 0.88) / rigHalf))
    resizeFlash()
  }
  applyViewport()

  const writeStreaks = (dt: number, boost: number, camNear: number) => {
    const len = 0.06 + boost * 2.6
    const speed = 0.5 + boost * 38
    const push = spread
    const inner = 0.9 + boost * 0.55
    const cr = accent.r
    const cg = accent.g
    const cb = accent.b

    for (let i = 0; i < PARTICLES; i++) {
      let z = zpos[i] + speed * drag[i] * dt
      if (z > camNear) z -= Z_SPAN
      zpos[i] = z

      const r = baseRadius[i] + push
      const a = angle[i]
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r

      const o = i * 6
      positions[o] = x
      positions[o + 1] = y
      positions[o + 2] = z
      positions[o + 3] = x
      positions[o + 4] = y
      positions[o + 5] = z - len * drag[i]

      // O miolo do frame precisa ficar limpo pro wordmark: apaga o que está perto do eixo.
      const mask = clamp01((r - inner) / 0.9)
      const head = bright[i] * mask
      colors[o] = cr * head
      colors[o + 1] = cg * head
      colors[o + 2] = cb * head
      const tail = head * 0.12
      colors[o + 3] = cr * tail
      colors[o + 4] = cg * tail
      colors[o + 5] = cb * tail
    }

    streakGeo.attributes.position.needsUpdate = true
    streakGeo.attributes.color.needsUpdate = true
  }

  const render = ({ t, dt, elapsed }: { t: number; dt: number; elapsed: number }) => {
    if (disposed) return
    if (t < lastT - 0.2) resetCycle()
    lastT = t

    // A duração do arco é planejada pelo gate e nunca informada; só dá pra inferir.
    if (!plannedKnown && t > 0.02) {
      plannedMs = Math.min(3200, Math.max(1400, elapsed / t))
      plannedKnown = true
      schedule()
    }

    if (releasePending) {
      releasePending = false
      releaseT = t
      // Arco curto: o release pode chegar com painéis apagados. Fecha o pórtico
      // num rajada rápida em vez de apagar lâmpada que nunca acendeu.
      let snap = 0
      for (const p of panels) {
        if (p.lit < 0.999 && p.onAt > t) {
          p.onAt = t + snap * 0.012
          snap++
        }
      }
      const lastOn = panels[PANEL_COUNT - 1].onAt
      const holdT = HOLD_MS / plannedMs
      const ceiling = 1 - LAUNCH_MIN_MS / plannedMs
      blackoutT = Math.min(ceiling, Math.max(t + holdT, lastOn + 0.035))
    }

    if (!blackedOut && blackoutT >= 0 && t >= blackoutT) {
      blackedOut = true
      sinceBlackout = 0
      flash.visible = true
      flashMat.uniforms.uAmount.value = 0.45
    }

    // --- lâmpadas ---
    if (blackedOut) {
      sinceBlackout += dt * 1000
      for (const p of panels) p.lit = 0
    } else {
      for (const p of panels) {
        const raw = clamp01((t - p.onAt) / 0.045)
        // Tensão do hold: as acesas respiram de leve enquanto ninguém larga.
        const swell = 1 + Math.sin(elapsed * 0.011 + p.x) * 0.045 * raw
        p.lit = easeOutExpo(raw) * swell
      }
    }

    const litAvg = panels.reduce((sum, p) => sum + p.lit, 0) / PANEL_COUNT

    // --- ato 3: arranque ---
    const launch = blackedOut ? sinceBlackout : 0
    const boost = blackedOut ? Math.pow(1 - clamp01(launch / BOOST_MS), 2.2) : 0
    const rigFade = blackedOut ? 1 - easeOutCubic(clamp01(launch / 300)) : 1

    if (blackedOut) {
      camZ = CAM_Z + (CAM_Z_LAUNCH - CAM_Z) * easeOutExpo(clamp01(launch / 430))
      spread = easeOutCubic(clamp01(launch / BOOST_MS)) * 1.35
      flashMat.uniforms.uAmount.value = 0.45 * Math.pow(1 - clamp01(launch / FLASH_MS), 2)
      if (launch > FLASH_MS) flash.visible = false
      streakMat.opacity = 0.2 + 0.8 * clamp01(launch / 90)
      rig.position.y = RIG_Y + (1 - rigFade) * 0.55
    } else {
      const tension = releaseT >= 0 ? clamp01((t - releaseT) / 0.25) : 0
      camZ = CAM_Z + Math.sin(elapsed * 0.0012) * 0.07 - tension * 0.28
      streakMat.opacity = 0.22
      rig.position.y = RIG_Y
    }

    for (const p of panels) {
      p.plate.uniforms.uLit.value = p.lit
      p.plate.uniforms.uFade.value = rigFade
      // Especular do ponteiro em unidades de meia-placa: o brilho varre o pórtico.
      p.plate.uniforms.uSpecX.value = (-pointerX * 2.6 - p.x * rig.scale.x) / (PANEL_W / 2)
      p.plate.uniforms.uSpecY.value = -pointerY * 1.6
      p.lamps[0].uniforms.uOn.value = p.lit
      p.lamps[1].uniforms.uOn.value = p.lit
      p.lamps[0].uniforms.uFade.value = rigFade
      p.lamps[1].uniforms.uFade.value = rigFade
      const burst = clamp01((p.lit - 0.55) / 0.45) * (1 - litAvg * 0.4)
      p.lamps[0].uniforms.uBurst.value = burst
      p.lamps[1].uniforms.uBurst.value = burst
    }

    // --- câmera: parallax ±3° em torno do alvo ---
    const yaw = pointerX * PARALLAX_RAD
    const pitch = -pointerY * PARALLAX_RAD
    const targetY = 0.34 + (blackedOut ? 0.22 * (1 - boost) : 0)
    camera.position.set(
      Math.sin(yaw) * camZ,
      targetY + Math.sin(pitch) * camZ,
      Math.cos(yaw) * Math.cos(pitch) * camZ,
    )
    camera.lookAt(0, targetY, 0)

    writeStreaks(dt, boost, camera.position.z + 1.0)
    renderer.render(scene, camera)
  }

  return {
    render,
    setPointer(x, y) {
      pointerX = x
      pointerY = y
    },
    resize(w, h) {
      if (w <= 0 || h <= 0) return
      width = w
      height = h
      applyViewport()
    },
    release() {
      if (releaseT >= 0) return
      releasePending = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      camera.remove(flash)
      scene.clear()
      rig.clear()
      for (const item of disposables) item.dispose()
      renderer.dispose()
    },
  }
}

export const lightsOut: IntroScene = {
  id: 'lights-out',
  label: 'Lights Out',
  blurb: 'Cinco painéis acendem em vermelho, apagam de uma vez e a câmera larga pro slipstream.',
  mount,
}
