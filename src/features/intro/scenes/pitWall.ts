import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { IntroScene, IntroSceneHandle, IntroSceneOptions } from './types'

/**
 * PIT WALL — a bancada de monitores dos boxes.
 *
 * Uma fileira de telas correndo pra profundidade, cada uma com seu traço de
 * telemetria se desenhando. No release, os traços convergem pro mesmo padrão;
 * depois as telas apagam da periferia pro centro e sobra o vazio onde o
 * wordmark entra.
 *
 * Orçamento de GPU: 16 monitores × 4 meshes = 64 draw calls de MeshBasicMaterial,
 * nenhuma textura, nenhuma alocação por frame. As linhas são ribbons indexados
 * cujo atributo de posição é reescrito in-place — geometria nasce e morre uma vez.
 */

const COLS = 8
const ROWS = 2
const COUNT = COLS * ROWS

const SCREEN_W = 0.92
const SCREEN_H = 0.6
const GAP_X = 0.14
const GAP_Y = 0.13

/** Segmentos do ribbon de telemetria. 56 é o ponto onde a curva já lê como suave. */
const SEG = 56
const TRACE_SPAN = SCREEN_W * 0.86
const TRACE_AMP = 0.155
const TRACE_HALF_W = 0.011

/** Inclinação da bancada: raking o bastante pra ler como fuga, não tanto que vire fio. */
const WALL_YAW = 1.15
const WALL_PITCH = 0.1

const CAM_FOV = 52
const CAM_Z = 5.6
const CAM_Y = 0.42
const PARALLAX = 0.052 // ±3°

const TAU = Math.PI * 2

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const smooth = (v: number) => {
  const x = clamp01(v)
  return x * x * (3 - 2 * x)
}
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3)
const easeInOut = (v: number) => {
  const x = clamp01(v)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Ruído determinístico: a mesma cena roda igual em todo boot. */
const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

type Wave = {
  f1: number
  f2: number
  f3: number
  p1: number
  p2: number
  p3: number
  brake: number
  speed: number
}

/** O padrão canônico: o desenho pro qual todos os traços convergem no ato 2. */
const CANON: Wave = { f1: 2.1, f2: 4.3, f3: 7.9, p1: 0.4, p2: 2.1, p3: 5.0, brake: 0.62, speed: 0.7 }

function waveAt(w: Wave, u: number, time: number): number {
  let s =
    0.52 * Math.sin(u * TAU * w.f1 + w.p1 + time * w.speed) +
    0.26 * Math.sin(u * TAU * w.f2 + w.p2 - time * w.speed * 0.8) +
    0.13 * Math.sin(u * TAU * w.f3 + w.p3 + time * w.speed * 1.6)
  // Frenagem: o mergulho que dá cara de gráfico de velocidade em vez de senoide.
  const d = (u - w.brake) * 9
  s -= 0.75 * Math.exp(-d * d)
  return s
}

type Monitor = {
  group: Group
  faceMat: MeshBasicMaterial
  baseMat: MeshBasicMaterial
  traceMat: MeshBasicMaterial
  headMat: MeshBasicMaterial
  head: Mesh
  geom: BufferGeometry
  pos: Float32Array
  attr: BufferAttribute
  local: Vector3
  wave: Wave
  gain: number
  delay: number
  /** 0 no miolo da grade, 1 na periferia. Define a ordem do apagão. */
  rank: number
}

/** Buffer de amostras reaproveitado entre monitores — zero alocação por frame. */
const samples = new Float32Array(SEG + 1)

function buildTraceGeometry(): { geom: BufferGeometry; pos: Float32Array; attr: BufferAttribute } {
  const verts = (SEG + 1) * 2
  const pos = new Float32Array(verts * 3)
  const attr = new BufferAttribute(pos, 3)
  attr.setUsage(DynamicDrawUsage)

  const index = new Uint16Array(SEG * 6)
  for (let i = 0; i < SEG; i++) {
    const a = i * 2
    const o = i * 6
    index[o] = a
    index[o + 1] = a + 1
    index[o + 2] = a + 2
    index[o + 3] = a + 1
    index[o + 4] = a + 3
    index[o + 5] = a + 2
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', attr)
  geom.setIndex(new BufferAttribute(index, 1))
  return { geom, pos, attr }
}

function toColor(css: string, fallback: number): Color {
  const c = new Color(fallback)
  // setStyle não lança em formato desconhecido: só avisa e mantém o fallback.
  c.set(css)
  return c
}

function mount(canvas: HTMLCanvasElement, opts: IntroSceneOptions): IntroSceneHandle {
  const accent = toColor(opts.accent, 0xff7a45)
  const bg = toColor(opts.bg, 0x0b0b0f)

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(opts.dpr)
  renderer.setClearColor(bg, 1)

  let width = Math.max(canvas.clientWidth, 1)
  let height = Math.max(canvas.clientHeight, 1)
  renderer.setSize(width, height, false)

  const scene = new Scene()
  const camera = new PerspectiveCamera(CAM_FOV, width / height, 0.1, 60)

  const wall = new Group()
  wall.rotation.set(WALL_PITCH, WALL_YAW, 0)
  wall.position.y = -0.55
  scene.add(wall)

  // Geometrias compartilhadas entre os 16 monitores; só as materials são por-tela
  // (a opacidade do apagão em cascata é individual).
  const faceGeom = new PlaneGeometry(SCREEN_W, SCREEN_H)
  const baseGeom = new PlaneGeometry(TRACE_SPAN, 0.004)
  const headGeom = new PlaneGeometry(0.05, 0.05)

  const faceColor = bg.clone().lerp(accent, 0.09)
  const geometries: BufferGeometry[] = [faceGeom, baseGeom, headGeom]
  const materials: MeshBasicMaterial[] = []
  const monitors: Monitor[] = []

  const pitchX = SCREEN_W + GAP_X
  const pitchY = SCREEN_H + GAP_Y

  for (let i = 0; i < COUNT; i++) {
    const col = i % COLS
    const row = (i / COLS) | 0
    const x = (col - (COLS - 1) / 2) * pitchX
    const y = (row - (ROWS - 1) / 2) * pitchY

    const group = new Group()
    group.position.set(x, y, 0)
    wall.add(group)

    const faceMat = new MeshBasicMaterial({ color: faceColor, transparent: true, depthWrite: false })
    const baseMat = new MeshBasicMaterial({
      color: accent,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const traceMat = new MeshBasicMaterial({
      color: accent,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const headMat = new MeshBasicMaterial({
      color: accent,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    materials.push(faceMat, baseMat, traceMat, headMat)

    const face = new Mesh(faceGeom, faceMat)
    const base = new Mesh(baseGeom, baseMat)
    base.position.z = 0.008
    const head = new Mesh(headGeom, headMat)
    head.position.z = 0.02

    const { geom, pos, attr } = buildTraceGeometry()
    geometries.push(geom)
    const trace = new Mesh(geom, traceMat)
    // As posições mudam todo frame: bounding sphere ficaria stale e o culling erraria.
    trace.frustumCulled = false

    group.add(face, base, trace, head)

    const h = (n: number) => hash(i * 7 + n)
    const nx = Math.abs(col - (COLS - 1) / 2) / ((COLS - 1) / 2)
    const ny = ROWS > 1 ? Math.abs(row - (ROWS - 1) / 2) / ((ROWS - 1) / 2) : 0

    monitors.push({
      group,
      faceMat,
      baseMat,
      traceMat,
      headMat,
      head,
      geom,
      pos,
      attr,
      local: new Vector3(x, y, 0),
      wave: {
        f1: 1.6 + h(1) * 1.7,
        f2: 3.4 + h(2) * 2.6,
        f3: 6.5 + h(3) * 4.0,
        p1: h(4) * TAU,
        p2: h(5) * TAU,
        p3: h(6) * TAU,
        brake: 0.32 + h(7) * 0.42,
        speed: 0.5 + h(8) * 0.6,
      },
      gain: 0.5 + h(9) * 0.5,
      delay: h(10) * 0.2,
      rank: clamp01(Math.max(nx, ny * 0.7)),
    })
  }

  const target = new Vector3()
  const world = new Vector3()

  let pointerX = 0
  let pointerY = 0
  let time = 0
  let releaseAt: number | null = null
  let releasePending = false
  let disposed = false

  /**
   * Reescreve o ribbon de um monitor in-place. Offset perpendicular à tangente
   * pra espessura não engordar nos trechos íngremes.
   */
  function updateTrace(m: Monitor, converge: number, reveal: number) {
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG
      const own = waveAt(m.wave, u, time)
      const canon = waveAt(CANON, u, time)
      let s = lerp(own, canon, converge)

      // Campo de força do cursor: bolha suave que empurra o traço na vertical,
      // mais um shear horizontal que inclina o gráfico inteiro.
      const nx = u * 2 - 1
      const d = (nx - pointerX * 0.9) * 1.6
      s += Math.exp(-d * d) * -pointerY * 0.55
      s += pointerX * 0.12 * nx

      samples[i] = s
    }

    const pos = m.pos
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG
      const x = (u - 0.5) * TRACE_SPAN
      const y = samples[i] * TRACE_AMP

      const i0 = i > 0 ? i - 1 : 0
      const i1 = i < SEG ? i + 1 : SEG
      const dx = ((i1 - i0) / SEG) * TRACE_SPAN
      const dy = (samples[i1] - samples[i0]) * TRACE_AMP
      const len = Math.hypot(dx, dy) || 1
      // Cauda afinada: dá direção ao traço sem precisar de alpha por vértice.
      const hw = TRACE_HALF_W * (0.4 + 0.6 * smooth(u * 3))
      const ox = (-dy / len) * hw
      const oy = (dx / len) * hw

      const a = i * 6
      pos[a] = x + ox
      pos[a + 1] = y + oy
      pos[a + 2] = 0.014
      pos[a + 3] = x - ox
      pos[a + 4] = y - oy
      pos[a + 5] = 0.014
    }
    m.attr.needsUpdate = true

    // O desenho da esquerda pra direita é drawRange, não geometria nova.
    const drawn = Math.round(reveal * SEG)
    m.geom.setDrawRange(0, drawn * 6)

    const hi = drawn < SEG ? drawn : SEG
    m.head.position.set((hi / SEG - 0.5) * TRACE_SPAN, samples[hi] * TRACE_AMP, 0.02)
  }

  function render({ t, dt, elapsed }: { t: number; dt: number; elapsed: number }) {
    if (disposed) return
    time += dt

    if (releasePending && releaseAt === null) releaseAt = elapsed
    const since = releaseAt === null ? 0 : Math.max(elapsed - releaseAt, 0) / 1000

    // Ato 2: tudo faz sentido ao mesmo tempo.
    const converge = releaseAt === null ? 0 : smooth(since / 0.22)
    // Ato 3: apagão em cascata. tKill é a rede de segurança caso o release atrase.
    const cascade = releaseAt === null ? 0 : clamp01((since - 0.14) / 0.34)
    const kill = Math.max(cascade, clamp01((t - 0.72) / 0.2))
    const approach = releaseAt === null ? 0 : easeOut(since / 0.6)

    // Câmera: truck lateral lento no ato 1, aproximação no ato 3, parallax do cursor.
    const slide = lerp(-0.55, 0.45, easeInOut(t))
    camera.position.set(slide, CAM_Y + approach * 0.06, CAM_Z - approach * 1.5)
    target.set(slide * 0.7, -0.05, 0)
    camera.lookAt(target)
    camera.rotation.y -= pointerX * PARALLAX
    camera.rotation.x += pointerY * PARALLAX * 0.5
    camera.updateMatrixWorld()
    wall.updateMatrixWorld(true)

    // Abre um buraco no miolo antes do wordmark entrar: nada brilhando atrás do texto.
    const clearing = smooth((t - 0.42) / 0.18)

    for (let i = 0; i < monitors.length; i++) {
      const m = monitors[i]

      // Periferia morre primeiro, miolo por último; em kill=1 não sobra ninguém.
      const deathStart = (1 - m.rank) * 0.75
      const dz = clamp01((kill - deathStart) / 0.25)
      const alive = 1 - dz
      // Estalo de CRT no instante em que a tela apaga.
      const flash = Math.sin(dz * Math.PI) * 0.5 * (1 - dz)

      let reveal = clamp01((t - m.delay) / 0.3)
      if (reveal < converge) reveal = converge

      world.copy(m.local).applyMatrix4(wall.matrixWorld)
      const dist = world.distanceTo(camera.position)
      world.project(camera)
      const ex = world.x / 0.55
      const ey = world.y / 0.3
      const hole = 1 - 0.85 * clearing * (1 - smooth(Math.hypot(ex, ey)))
      const depth = 1 - clamp01((dist - 4) / 7) * 0.4

      const level = alive * m.gain * hole * depth
      m.faceMat.opacity = level * (0.9 + flash)
      m.baseMat.opacity = level * 0.12
      m.traceMat.opacity = level * (0.85 + flash)
      m.headMat.opacity = level * Math.min(reveal * 8, 1) * (1 - reveal) * 1.2

      const visible = level > 0.002
      m.group.visible = visible
      if (visible) updateTrace(m, converge, reveal)
    }

    renderer.render(scene, camera)
  }

  return {
    render,
    setPointer(x: number, y: number) {
      pointerX = x
      pointerY = y
    },
    resize(w: number, h: number) {
      if (disposed || w <= 0 || h <= 0) return
      width = w
      height = h
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    },
    release() {
      releasePending = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const g of geometries) g.dispose()
      for (const mat of materials) mat.dispose()
      scene.clear()
      renderer.forceContextLoss()
      renderer.dispose()
    },
  }
}

export const pitWall: IntroScene = {
  id: 'pit-wall',
  label: 'Pit Wall',
  blurb: 'A bancada dos boxes: dezesseis traços de telemetria convergindo num só antes do apagão.',
  mount,
}
