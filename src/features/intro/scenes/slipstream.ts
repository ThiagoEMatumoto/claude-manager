import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
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

/**
 * SLIPSTREAM — câmera na linha ideal, dentro do vácuo.
 *
 * O túnel não existe como geometria: existem N riscos vivendo num espaço local
 * onde a câmera está parada na origem olhando pra -Z. O que se move é o campo
 * (z cresce em direção à câmera) e o que curva é o próprio espaço — cada risco
 * ganha um deslocamento lateral quadrático no depth (`bend`). Isso dá a curva
 * longa sem precisar de spline, sem precisar mover a câmera pelo mundo, e com
 * reciclagem trivial: quem passa pela câmera volta pro fundo.
 *
 * O borrão é geométrico, não post-processing: o comprimento de cada risco é
 * proporcional à velocidade. Acelerou, esticou.
 */

const COUNT_HI = 1600
const COUNT_LO = 1150
/** Profundidade do campo; riscos nascem em -DEPTH e morrem em RECYCLE_Z. */
const DEPTH = 130
const RECYCLE_Z = 3
const TUBE_MIN = 1.25
const TUBE_MAX = 9.5
/** Deslocamento lateral do fundo do túnel no apex — o "raio" da curva. */
const CURVE_REACH = 27
const CURVE_K = CURVE_REACH / (DEPTH * DEPTH)
/** Máx. ±6% do raio da curva: dirigir dentro da curva sem enjoar. */
const LINE_MAX = CURVE_REACH * 0.06
/** ~11°: banking real, longe do limiar de enjoo. */
const MAX_ROLL = 0.19
/** Rabo do arco, igual ao INTRO_TAIL_MS do gate. */
const TAIL_S = 0.6
const GLOW_Z = -72

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function smoothstep(edge0: number, edge1: number, x: number): number {
  const v = clamp01((x - edge0) / (edge1 - edge0))
  return v * v * (3 - 2 * v)
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}

/** Compressão do apex: ataque curto, decaimento longo. */
function apexPulse(s: number): number {
  if (s < 0) return 0
  if (s < 0.11) return easeOutCubic(s / 0.11)
  return 1 - smoothstep(0, 0.42, s - 0.11)
}

/**
 * O tema pode ser laranja, azul, verde ou lilás — e pode ser escuro. Normaliza
 * o canal mais alto pra 1 pra que o risco tenha o mesmo punch em qualquer
 * accent, sem trocar o matiz e sem hardcodar cor nenhuma.
 */
function readColor(value: string, fallback: string): Color {
  const c = new Color()
  try {
    c.set(value)
  } catch {
    c.set(fallback)
  }
  return c
}

function normalized(base: Color): Color {
  const c = base.clone()
  const peak = Math.max(c.r, c.g, c.b)
  if (peak > 0.001) c.multiplyScalar(1 / peak)
  return c
}

const GLOW_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const GLOW_FRAG = `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float g = smoothstep(1.0, 0.0, d);
  g = pow(g, 2.6);
  gl_FragColor = vec4(uColor * g * uIntensity, 1.0);
}
`

function mount(canvas: HTMLCanvasElement, opts: IntroSceneOptions): IntroSceneHandle {
  const accent = normalized(readColor(opts.accent, '#ff7a45'))
  const bg = readColor(opts.bg, '#0b0b0f')
  // Núcleo quente: o mesmo accent puxado pro branco, como um farol visto de perto.
  const hot = accent.clone().lerp(new Color(1, 1, 1), 0.4)

  const width = Math.max(1, canvas.clientWidth || canvas.width || 1)
  const height = Math.max(1, canvas.clientHeight || canvas.height || 1)

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(opts.dpr)
  renderer.setSize(width, height, false)
  renderer.setClearColor(bg, 1)

  const scene = new Scene()
  const camera = new PerspectiveCamera(74, width / height, 0.1, DEPTH + 40)
  camera.rotation.order = 'YXZ'

  // Menos riscos em tela densa: o custo por frame é CPU (2 vértices por risco),
  // e num painel 2× o preenchimento já é suficiente com menos deles.
  const count = opts.dpr > 1.5 ? COUNT_LO : COUNT_HI

  const zs = new Float32Array(count)
  const radii = new Float32Array(count)
  const angles = new Float32Array(count)
  const speeds = new Float32Array(count)
  const lengths = new Float32Array(count)
  const brights = new Float32Array(count)

  const seed = (i: number, spawnFar: boolean) => {
    radii[i] = TUBE_MIN + (TUBE_MAX - TUBE_MIN) * Math.pow(Math.random(), 0.55)
    angles[i] = Math.random() * Math.PI * 2
    speeds[i] = 0.72 + Math.random() * 0.62
    lengths[i] = 0.55 + Math.random() * 1.1
    brights[i] = 0.3 + Math.random() * 0.85
    zs[i] = spawnFar ? -DEPTH - Math.random() * 24 : -Math.random() * DEPTH
  }
  for (let i = 0; i < count; i++) seed(i, false)

  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 6)

  const posAttr = new BufferAttribute(positions, 3)
  posAttr.setUsage(DynamicDrawUsage)
  const colAttr = new BufferAttribute(colors, 3)
  colAttr.setUsage(DynamicDrawUsage)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('color', colAttr)

  const material = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })

  const streaks = new LineSegments(geometry, material)
  // A geometria muda todo frame; deixar o culling ligado arrisca a cena sumir.
  streaks.frustumCulled = false
  scene.add(streaks)

  const glowGeometry = new PlaneGeometry(1, 1)
  const glowMaterial = new ShaderMaterial({
    uniforms: {
      uColor: { value: accent.clone() },
      uIntensity: { value: 0 },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  })
  const glow = new Mesh(glowGeometry, glowMaterial)
  glow.frustumCulled = false
  scene.add(glow)

  let pointerX = 0
  let pointerY = 0
  let released = false
  let sinceRelease = 0
  let disposed = false

  const bendX = (z: number, curve: number) => -curve * CURVE_K * z * z
  const bendY = (z: number, curve: number) => curve * CURVE_K * 0.2 * z * z

  const handle: IntroSceneHandle = {
    render(frame) {
      if (disposed) return
      const dt = Math.min(Math.max(frame.dt, 0), 0.05)
      const t = clamp01(frame.t)

      if (released) sinceRelease += dt
      const rel = clamp01(sinceRelease / TAIL_S)
      // O ato 3 só começa a desfazer a curva depois do apex respirar.
      const unwind = easeInOutCubic(clamp01((rel - 0.12) / 0.88))
      const outro = easeOutCubic(rel)
      const pulse = released ? apexPulse(sinceRelease) : 0

      // Entrada de curva → apex → saída pra reta.
      const curve = smoothstep(0.03, 0.5, t) * (1 - unwind)

      const speed = (44 + 48 * smoothstep(0, 0.55, t)) * (1 + 0.52 * pulse) * (1 - 0.68 * outro)
      // Apex comprime o campo; a saída o abre e limpa o miolo pro wordmark.
      const spread = (1 - 0.17 * pulse) * (1 + 1.95 * outro)
      const lenScale = (1 + 0.3 * pulse) * (1 - 0.66 * outro)
      const globalFade = smoothstep(0, 0.1, t) * (1 - 0.8 * outro)

      const fov = 74 - 9 * pulse + 17 * outro
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }

      camera.position.set(pointerX * LINE_MAX, pointerY * LINE_MAX * 0.45, 0)
      camera.rotation.set(
        -pointerY * 0.03,
        -pointerX * 0.05 - curve * 0.05,
        MAX_ROLL * curve + pointerX * 0.015,
      )

      const advance = speed * dt
      for (let i = 0; i < count; i++) {
        let z = zs[i] + advance * speeds[i]
        if (z > RECYCLE_Z) {
          seed(i, true)
          z = zs[i]
        } else {
          zs[i] = z
        }

        const len = Math.min(lengths[i] * speed * 0.085 * lenScale + 0.4, 46)
        const zf = z - len
        const r = radii[i] * spread
        const cos = Math.cos(angles[i])
        const sin = Math.sin(angles[i])

        const o = i * 6
        positions[o] = cos * r + bendX(z, curve)
        positions[o + 1] = sin * r + bendY(z, curve)
        positions[o + 2] = z
        positions[o + 3] = cos * r + bendX(zf, curve)
        positions[o + 4] = sin * r + bendY(zf, curve)
        positions[o + 5] = zf

        // Some no fundo (profundidade) e some ao cruzar a câmera (sem pop).
        const depthFade = clamp01((z + DEPTH) / (DEPTH * 0.55))
        const exitFade = clamp01((RECYCLE_Z - z) / 12)
        // Na saída de curva o miolo esvazia: o centro é do wordmark.
        const centerMask = 1 - outro * (1 - smoothstep(1.6, 4.8, r))
        const a = globalFade * brights[i] * depthFade * exitFade * centerMask

        colors[o] = hot.r * a
        colors[o + 1] = hot.g * a
        colors[o + 2] = hot.b * a
        const tail = a * 0.16
        colors[o + 3] = accent.r * tail
        colors[o + 4] = accent.g * tail
        colors[o + 5] = accent.b * tail
      }
      posAttr.needsUpdate = true
      colAttr.needsUpdate = true

      // O glow mora no ponto de fuga: sai do centro na curva, volta na saída.
      glow.position.set(bendX(GLOW_Z, curve), bendY(GLOW_Z, curve), GLOW_Z)
      glow.scale.setScalar(38 * (1 - 0.12 * pulse) * (1 + 1.5 * outro))
      glowMaterial.uniforms.uIntensity.value =
        smoothstep(0, 0.12, t) * (0.26 + 0.45 * pulse + 0.7 * outro)

      renderer.render(scene, camera)
    },

    setPointer(x, y) {
      pointerX = Math.max(-1, Math.min(1, x))
      pointerY = Math.max(-1, Math.min(1, y))
    },

    resize(w, h) {
      if (disposed) return
      const nw = Math.max(1, w)
      const nh = Math.max(1, h)
      renderer.setSize(nw, nh, false)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
    },

    release() {
      if (released) return
      released = true
      sinceRelease = 0
    },

    dispose() {
      if (disposed) return
      disposed = true
      scene.remove(streaks)
      scene.remove(glow)
      geometry.dispose()
      material.dispose()
      glowGeometry.dispose()
      glowMaterial.dispose()
      scene.clear()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }

  return handle
}

export const slipstream: IntroScene = {
  id: 'slipstream',
  label: 'Slipstream',
  blurb: 'Primeira pessoa no vácuo: curva longa com banking, apex comprimido e saída pra reta.',
  mount,
}
