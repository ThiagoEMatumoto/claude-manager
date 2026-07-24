/**
 * Contrato das cenas de abertura.
 *
 * O gate (useIntroGate) é o dono do tempo: ele decide quando a cena começa,
 * quando entra no ato final e quando morre. A cena só desenha. Isso mantém as
 * variantes comparáveis entre si — todas duram o mesmo, pulam do mesmo jeito —
 * e concentra a lógica testável num arquivo só (jsdom não tem WebGL, então cena
 * nenhuma é testável em unit).
 */

export type IntroSceneId = 'lights-out' | 'pit-wall' | 'harness' | 'slipstream'

export type IntroSceneOptions = {
  /** Cor do tema ativo, lida de --color-accent. Nunca hardcodar. */
  accent: string
  /** Fundo do tema ativo, lido de --color-bg. */
  bg: string
  /** devicePixelRatio já capado — a cena não deve ler window.devicePixelRatio. */
  dpr: number
}

export type IntroFrame = {
  /** Progresso normalizado 0→1 do arco planejado pelo gate. */
  t: number
  /** Delta em segundos desde o frame anterior, capado (evita salto pós-tab-hidden). */
  dt: number
  /** Milissegundos desde o início da cena. */
  elapsed: number
}

export type IntroSceneHandle = {
  render(frame: IntroFrame): void
  /** Ponteiro normalizado em -1..1. O gate já entrega suavizado. */
  setPointer(x: number, y: number): void
  /** Viewport mudou de tamanho. */
  resize(width: number, height: number): void
  /**
   * O app ficou pronto (ou o teto estourou): a cena entra no ato final.
   * Chamado no máximo uma vez, sempre antes do fim do arco.
   */
  release(): void
  dispose(): void
}

export type IntroScene = {
  id: IntroSceneId
  label: string
  /** Uma linha, mostrada na galeria de comparação. */
  blurb: string
  /** Monta a cena. Não inicia o tempo — quem chama render() é o gate. */
  mount(canvas: HTMLCanvasElement, opts: IntroSceneOptions): IntroSceneHandle
}
