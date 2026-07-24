import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import type { IntroFrame, IntroScene, IntroSceneHandle, IntroSceneOptions } from './types'

/**
 * HARNESS — o cinto de cinco pontos.
 *
 * Cinco cintas de luz entram das cinco ancoragens de um arnês (dois ombros,
 * dois quadris, entrepernas), tensionam contra o ponteiro, travam no fecho
 * central com um estalo visual (flash seco + onda de choque) e recuam pras
 * bordas deixando o centro limpo pro wordmark.
 *
 * Convenções internas:
 * - O tempo vem só do gate. `t` é 0→1 do arco; `q` é 0→1 do rabo (pós-release).
 *   Ancorar o ato final em `q` — e não em `t` — é o que mantém o estalo com a
 *   mesma cadência tanto num boot de 1.6s quanto num de 3s.
 * - Nada de cor literal: tudo que brilha sai de `opts.accent`.
 */

const DEG = Math.PI / 180
/** Distância da câmera. Com fov 50 dá ~5.6 unidades de altura visível. */
const CAM_DIST = 6
/** Parallax de câmera pedido: ±3°. */
const CAM_TILT = 3 * DEG

/** Raio de onde a ponta da cinta parte — fora da tela até em 21:9. */
const R_START = 9.2
/** Onde a ponta espera, tensionando, antes de travar. */
const R_HOVER = 1.05
/** Ponta encaixada no fecho. */
const R_LOCK = 0.26
/** Pra onde a ponta recua no ato 3. */
const R_EXIT = 10.5
/** Comprimento da fita. Sobra proposital: a cauda dissolve antes da borda. */
const STRAP_LEN = 9.5

/** Quanto do arco o ato 1 ocupa: todas as cintas chegam por volta de t=0.55. */
const ARRIVE_SPAN = 0.42

/**
 * Rede de segurança: se o gate nunca chamar release() (teto estourado, skip
 * estranho), a cena trava sozinha pra não terminar com as cintas no ar.
 */
const AUTO_RELEASE_T = 0.86

type StrapSpec = {
  /** Direção da ancoragem em graus, 0° = direita, anti-horário. */
  angle: number
  delay: number
  width: number
  /** Profundidade da ancoragem: as cintas convergem em z conforme chegam. */
  z: number
  twist: number
  seed: number
}

/** As cinco ancoragens do arnês, na ordem em que entram. */
const STRAPS: StrapSpec[] = [
  { angle: 52, delay: 0.0, width: 0.44, z: 1.4, twist: -1.9, seed: 1.7 }, // ombro direito
  { angle: 128, delay: 0.04, width: 0.44, z: -1.6, twist: 2.2, seed: 0.0 }, // ombro esquerdo
  { angle: 196, delay: 0.1, width: 0.36, z: 1.0, twist: 1.6, seed: 3.1 }, // quadril esquerdo
  { angle: 344, delay: 0.14, width: 0.36, z: -1.1, twist: -2.4, seed: 4.6 }, // quadril direito
  { angle: 270, delay: 0.18, width: 0.3, z: 0.5, twist: 1.3, seed: 6.0 }, // entrepernas
]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, k: number) => a + (b - a) * k
const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3)
const easeOutExpo = (v: number) => (v >= 1 ? 1 : 1 - Math.pow(2, -10 * v))
const easeInOutCubic = (v: number) =>
  v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
/** smoothstep clássico — usado só pra fades, nunca pra posição. */
const smoothstep = (edge0: number, edge1: number, v: number) => {
  const x = clamp01((v - edge0) / (edge1 - edge0 || 1e-6))
  return x * x * (3 - 2 * x)
}
/** Pulso gaussiano centrado em `at`. */
const bump = (v: number, at: number, w: number) => Math.exp(-Math.pow((v - at) / w, 2))

/**
 * setStyle() não lança em string desconhecida — só avisa e deixa a cor como
 * estava. Por isso a instância já nasce com o fallback dentro.
 */
function parseColor(input: string, fallback: string): Color {
  const c = new Color()
  c.setStyle(fallback, SRGBColorSpace)
  if (input) c.setStyle(input, SRGBColorSpace)
  return c
}

const STRAP_VERT = /* glsl */ `
  uniform float uHead;
  uniform float uLen;
  uniform float uWidth;
  uniform float uTwist;
  uniform float uSeed;
  uniform float uTime;
  uniform float uSlack;
  uniform float uBend;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    float s = uv.y;        // 0 = ponta (fecho), 1 = ancoragem fora da tela
    float w = uv.x - 0.5;

    float along = uHead + s * uLen;
    float taper = mix(0.7, 1.0, smoothstep(0.0, 0.22, s));
    float ang = uTwist * s + uSeed + uTime * 0.35;

    vec3 pos;
    pos.y = along;
    pos.x = w * uWidth * taper * cos(ang);
    pos.z = w * uWidth * taper * sin(ang) * 0.9;

    // A fita tem peso: a ponta é o que prende, a cauda é o que balança.
    float weight = smoothstep(0.0, 0.45, s);
    pos.x += (sin(s * 5.2 - uTime * 2.1 + uSeed) * 0.17
            + sin(s * 11.0 + uTime * 1.3 + uSeed * 1.7) * 0.06) * uSlack * weight;
    pos.z += cos(s * 6.5 - uTime * 1.7 + uSeed) * 0.13 * uSlack * weight;

    // Tensão em direção ao ponteiro: arco que zera nas duas extremidades.
    pos.x += uBend * sin(3.141592 * clamp(s, 0.0, 1.0));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const STRAP_FRAG = /* glsl */ `
  uniform vec3 uAccent;
  uniform float uGlow;
  uniform float uFlash;
  varying vec2 vUv;

  void main() {
    float x = vUv.x;
    float s = vUv.y;

    // Trama: urdidura ao longo da largura x fios atravessados ao longo do comprimento.
    float warp = abs(fract(x * 7.0) - 0.5) * 2.0;
    float weft = abs(fract(s * 130.0) - 0.5) * 2.0;
    float weave = 0.5 + 0.3 * smoothstep(0.15, 0.95, warp) + 0.24 * smoothstep(0.1, 0.9, weft);

    float edge = smoothstep(0.0, 0.14, x) * smoothstep(0.0, 0.14, 1.0 - x);
    float core = exp(-pow((x - 0.5) * 3.4, 2.0));
    float tip = smoothstep(0.0, 0.025, s);
    float far = 1.0 - smoothstep(0.3, 0.86, s);

    float lum = edge * tip * far * (weave * 0.5 + core * 0.75) * uGlow;
    vec3 col = uAccent * (0.85 + core * 0.9 + uFlash * 2.4);

    gl_FragColor = vec4(col * lum, 1.0);
    #include <colorspace_fragment>
  }
`

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BUCKLE_FRAG = /* glsl */ `
  uniform vec3 uAccent;
  uniform float uGlow;
  uniform float uLock;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float a = atan(p.y, p.x);

    float core = exp(-r * r * 26.0);
    float ring = exp(-pow((r - mix(0.62, 0.42, uLock)) * 16.0, 2.0));
    // Cinco linguetas que fecham conforme trava.
    float petal = pow(max(cos(a * 5.0), 0.0), 8.0);
    float slot = petal * exp(-pow((r - mix(0.8, 0.5, uLock)) * 11.0, 2.0));

    float lum = (core * 1.5 + ring * 0.9 + slot * 0.8) * uGlow;
    gl_FragColor = vec4(uAccent * lum, 1.0);
    #include <colorspace_fragment>
  }
`

const SHOCK_FRAG = /* glsl */ `
  uniform vec3 uAccent;
  uniform float uRadius;
  uniform float uThickness;
  uniform float uAlpha;
  varying vec2 vUv;

  void main() {
    float r = length((vUv - 0.5) * 2.0);
    float ring = exp(-pow((r - uRadius) / uThickness, 2.0));
    float lum = ring * uAlpha;
    gl_FragColor = vec4(uAccent * lum, 1.0);
    #include <colorspace_fragment>
  }
`

function mountHarness(canvas: HTMLCanvasElement, opts: IntroSceneOptions): IntroSceneHandle {
  const accent = parseColor(opts.accent, '#ff7a45')
  const bg = parseColor(opts.bg, '#0b0b0f')

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(opts.dpr)
  renderer.setClearColor(bg, 1)

  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, CAM_DIST)

  // Uma geometria pra todas as cintas; só os uniforms diferem.
  const strapGeo = new PlaneGeometry(1, 1, 8, 120)
  const quadGeo = new PlaneGeometry(1, 1, 1, 1)

  const strapMats: ShaderMaterial[] = []
  const straps = STRAPS.map((spec) => {
    const material = new ShaderMaterial({
      vertexShader: STRAP_VERT,
      fragmentShader: STRAP_FRAG,
      uniforms: {
        uAccent: { value: accent },
        uHead: { value: R_START },
        uLen: { value: STRAP_LEN },
        uWidth: { value: spec.width },
        uTwist: { value: spec.twist },
        uSeed: { value: spec.seed },
        uTime: { value: 0 },
        uSlack: { value: 1 },
        uBend: { value: 0 },
        uGlow: { value: 0 },
        uFlash: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    strapMats.push(material)

    const mesh = new Mesh(strapGeo, material)
    // O +Y local vira a direção da ancoragem.
    mesh.rotation.z = spec.angle * DEG - Math.PI / 2
    mesh.position.z = spec.z
    mesh.frustumCulled = false
    scene.add(mesh)

    const rad = spec.angle * DEG
    return {
      spec,
      mesh,
      material,
      // Eixo lateral da cinta, pra projetar o ponteiro e curvar na direção dele.
      latX: -Math.sin(rad),
      latY: Math.cos(rad),
    }
  })

  const buckleMat = new ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: BUCKLE_FRAG,
    uniforms: {
      uAccent: { value: accent },
      uGlow: { value: 0 },
      uLock: { value: 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const buckle = new Mesh(quadGeo, buckleMat)
  buckle.scale.setScalar(1.7)
  buckle.frustumCulled = false
  scene.add(buckle)

  const shockMat = new ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: SHOCK_FRAG,
    uniforms: {
      uAccent: { value: accent },
      uRadius: { value: 0 },
      uThickness: { value: 0.05 },
      uAlpha: { value: 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const shock = new Mesh(quadGeo, shockMat)
  shock.scale.setScalar(9)
  shock.frustumCulled = false
  scene.add(shock)

  let pointerX = 0
  let pointerY = 0
  let released = false
  /** t no primeiro frame depois do release; -1 enquanto não travou. */
  let releaseT = -1
  let lastT = 0
  let disposed = false

  const resize = (width: number, height: number) => {
    if (disposed) return
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize(canvas.clientWidth, canvas.clientHeight)

  const release = () => {
    released = true
  }

  const render = ({ t, elapsed }: IntroFrame) => {
    if (disposed) return
    // A galeria roda em loop sem remontar a cena: t voltando pra trás é reinício.
    if (t < lastT - 0.2) {
      released = false
      releaseT = -1
    }
    lastT = t

    if (!released && t >= AUTO_RELEASE_T) released = true
    if (released && releaseT < 0) releaseT = t

    const time = elapsed / 1000
    const q = released ? clamp01((t - releaseT) / Math.max(1e-3, 1 - releaseT)) : 0

    // Ato 2/3, tudo ancorado no rabo de 600ms que o gate garante depois do release.
    const snap = released ? easeOutExpo(clamp01(q / 0.12)) : 0
    const post = Math.max(0, q - 0.12)
    const flash = released ? Math.exp(-post * 26) * snap : 0
    const recoil = released ? 0.09 * Math.exp(-post * 20) * Math.sin(post * 88) : 0
    const retreat = released ? easeInOutCubic(clamp01((q - 0.2) / 0.65)) : 0
    const darken = released ? smoothstep(0.22, 0.78, q) : 0
    // Fim de linha à prova de falha: nada aceso quando o arco fecha.
    const kill = 1 - smoothstep(0.94, 1, t)

    let arrivedAll = 0
    for (const strap of straps) {
      const { spec, material } = strap
      const u = material.uniforms
      const arrive = easeOutCubic(clamp01((t - spec.delay) / ARRIVE_SPAN))
      arrivedAll += arrive / straps.length

      const breath = Math.sin(time * 1.6 + spec.seed) * 0.06
      let head = mix(R_START, R_HOVER + breath, arrive)
      head = mix(head, R_LOCK, snap) + recoil * snap
      head = mix(head, R_EXIT, retreat)

      u.uHead.value = head
      u.uTime.value = time
      u.uSlack.value = (1 - 0.4 * arrive) * (1 - 0.85 * snap) + 0.55 * retreat
      u.uBend.value =
        (pointerX * strap.latX + pointerY * strap.latY) * 0.55 * arrive * (1 - snap)
      u.uGlow.value = (0.25 + 0.85 * arrive) * (1 - darken) * kill
      u.uFlash.value = flash

      strap.mesh.position.z = spec.z * (1 - arrive) + spec.z * retreat
    }

    // O fecho: brasa fraca enquanto as cintas miram, estalo ao travar, um pulso
    // e sai de cena antes do wordmark ocupar o centro.
    const pulse = released ? bump(q, 0.3, 0.055) : 0
    const buckleFade = released ? 1 - smoothstep(0.34, 0.54, q) : 1
    buckleMat.uniforms.uGlow.value =
      (0.08 * arrivedAll * (1 - snap) + 0.75 * snap + flash * 3 + pulse * 1.2) *
      buckleFade *
      kill
    buckleMat.uniforms.uLock.value = snap

    const sp = clamp01(post / 0.34)
    shockMat.uniforms.uRadius.value = 0.05 + easeOutCubic(sp) * 0.85
    shockMat.uniforms.uThickness.value = 0.028 + sp * 0.1
    shockMat.uniforms.uAlpha.value = released ? Math.pow(1 - sp, 2) * 1.3 * snap * kill : 0

    const yaw = pointerX * CAM_TILT
    const pitch = pointerY * CAM_TILT
    camera.position.set(
      Math.sin(yaw) * CAM_DIST,
      Math.sin(pitch) * CAM_DIST,
      Math.cos(yaw) * Math.cos(pitch) * CAM_DIST,
    )
    camera.lookAt(0, 0, 0)

    renderer.render(scene, camera)
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    scene.clear()
    strapGeo.dispose()
    quadGeo.dispose()
    for (const m of strapMats) m.dispose()
    buckleMat.dispose()
    shockMat.dispose()
    renderer.dispose()
    // dispose() sozinho não devolve o contexto: sem isso o navegador segura os
    // WebGL contexts e o próximo mount pode não conseguir nenhum.
    renderer.forceContextLoss()
  }

  return {
    render,
    setPointer: (x: number, y: number) => {
      pointerX = x
      // O gate manda y de tela (pra baixo positivo); aqui tudo vive em mundo.
      pointerY = -y
    },
    resize,
    release,
    dispose,
  }
}

export const harness: IntroScene = {
  id: 'harness',
  label: 'Harness',
  blurb: 'Cinco cintas de luz convergem e travam no fecho — harness every run.',
  mount: mountHarness,
}
