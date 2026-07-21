// Sonda Fase 2 — valida, com as FUNÇÕES DE PRODUÇÃO reais (buildSelectKeys,
// buildOtherKeys, buildReviewKeys, playKeys), dois fluxos ainda não cobertos
// por probe dedicado:
//   A) single-select com "Other" (texto livre) — buildOtherKeys end-to-end.
//   B) multi-pergunta (2 questions numa só chamada) — buildSelectKeys pra Q1,
//      buildOtherKeys pra Q2 (Other DENTRO de multi-pergunta), buildReviewKeys
//      pro submit final da tela de revisão.
// Fonte de verdade igual à sonda Fase 0: parser real (parseTuiMenu) sobre
// buffer real (@xterm/headless) de um `claude` real (node-pty, sem Electron).
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { parseTuiMenu } from '../../src/features/sessions/tui-menu-parser'
import { buildSelectKeys, buildOtherKeys, buildReviewKeys, playKeys } from '../../src/features/sessions/chat/respond-keys'

const { Terminal } = xtermHeadless as any

function tailText(term: any, n = 60): string {
  const buf = term.buffer.active
  let text = ''
  for (let y = Math.max(0, buf.length - n); y < buf.length; y++) {
    const line = buf.getLine(y)
    if (line) text += line.translateToString(true) + '\n'
  }
  return text
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitMenu(term: any, kindFilter?: string, tries = 300): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const m = parseTuiMenu(tailText(term))
    if (m && (!kindFilter || m.kind === kindFilter)) return m
    await sleep(500)
  }
  return null
}

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), 'probe-fase2-'))
  writeFileSync(join(cwd, 'README.md'), '# scratch\n')
  const term = new Terminal({ cols: 100, rows: 40, allowProposedApi: true })
  const proc = pty.spawn('claude', ['--session-id', randomUUID(), '--effort', 'low'], {
    name: 'xterm-256color',
    cols: 100,
    rows: 40,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  proc.onData((d) => term.write(d))
  const write = (s: string) => proc.write(s)

  await sleep(2500)
  proc.write('\r')
  await sleep(1500)

  // ── Cenário A: single-select com Other ──────────────────────────────────
  proc.write(
    'Use a tool AskUserQuestion com UMA pergunta "Qual sua linguagem favorita?" com opcoes "Go"/"Rust". Nao faca mais nada.',
  )
  await sleep(1000)
  proc.write('\r')
  console.log('[A] prompt enviado, aguardando pergunta...')
  const menuA = await waitMenu(term, 'question')
  console.log('[A] menu:', JSON.stringify({ question: menuA?.question, options: menuA?.options?.map((o: any) => ({ label: o.label, sentinel: o.sentinel })) }))
  const otherIdx = menuA?.options?.findIndex((o: any) => o.sentinel === 'other')
  console.log('[A] otherIdx:', otherIdx)
  if (menuA && otherIdx != null && otherIdx >= 0) {
    const keys = buildOtherKeys(otherIdx, 'Elixir')
    console.log('[A] buildOtherKeys ->', JSON.stringify(keys))
    await playKeys(keys, write)
    await sleep(1500)
    const after = parseTuiMenu(tailText(term))
    console.log('[A] apos buildOtherKeys, menu ainda presente?', after != null, after?.kind)
  } else {
    console.log('[A] SKIP — sentinela other nao encontrada no menu')
  }

  await sleep(1500)

  // ── Cenário B: multi-pergunta (Q1 normal, Q2 via Other) ─────────────────
  proc.write(
    'Use a tool AskUserQuestion com um array de EXATAMENTE 2 perguntas na mesma chamada: pergunta 1 "Qual sua cor favorita?" com opcoes "Vermelho"/"Azul"; pergunta 2 "Qual seu hobby favorito?" com opcoes "Leitura"/"Esportes". Nao faca mais nada.',
  )
  await sleep(1000)
  proc.write('\r')
  console.log('[B] prompt enviado, aguardando Q1...')
  const q1 = await waitMenu(term, 'question')
  console.log('[B] Q1:', JSON.stringify({ question: q1?.question, tabs: q1?.tabs, submitOnDigit: q1?.submitOnDigit }))
  if (q1) {
    const keys1 = buildSelectKeys(q1, 0) // opção 0 = "Vermelho"
    console.log('[B] buildSelectKeys(Q1, 0) ->', JSON.stringify(keys1))
    await playKeys(keys1, write)
    await sleep(1500)
    const q2 = parseTuiMenu(tailText(term))
    console.log('[B] apos Q1, menu:', JSON.stringify({ kind: q2?.kind, question: q2?.question, tabs: q2?.tabs }))
    const otherIdxQ2 = q2?.options?.findIndex((o: any) => o.sentinel === 'other')
    console.log('[B] Q2 otherIdx:', otherIdxQ2)
    if (q2 && q2.kind === 'question' && otherIdxQ2 != null && otherIdxQ2 >= 0) {
      const keysOther = buildOtherKeys(otherIdxQ2, 'Fotografia')
      console.log('[B] buildOtherKeys(Q2) ->', JSON.stringify(keysOther))
      await playKeys(keysOther, write)
      await sleep(1500)
      const review = parseTuiMenu(tailText(term))
      console.log('[B] apos Other na Q2, menu:', JSON.stringify({ kind: review?.kind, context: review?.context }))
      if (review && review.kind === 'question_review') {
        const keysSubmit = buildReviewKeys(review, 'submit')
        console.log('[B] buildReviewKeys(review, submit) ->', JSON.stringify(keysSubmit))
        await playKeys(keysSubmit, write)
        await sleep(1500)
        const finalMenu = parseTuiMenu(tailText(term))
        console.log('[B] apos submit final, menu ainda presente?', finalMenu != null, finalMenu?.kind)
        const raw = tailText(term)
        console.log('[B] RAW final tail:')
        console.log(raw.split('\n').filter((l) => l.trim() !== '').slice(-15).join('\n'))
      } else {
        console.log('[B] NAO chegou em question_review apos Other na Q2 — kind:', review?.kind)
      }
    } else {
      console.log('[B] SKIP Other na Q2 — nao encontrada sentinela ou kind inesperado')
    }
  }

  proc.kill()
}
main()
