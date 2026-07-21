// Sonda empírica standalone (Fase 0 do plano tenho-mais-alguns-feedbacks-shiny-meteor):
// spawna `claude` real via node-pty (SEM Electron), alimenta um Terminal
// @xterm/headless com os bytes crus (mesma primitiva que Terminal.tsx usa em
// produção: term.buffer.active.getLine(y).translateToString) e testa
// experimentalmente qual sequência de teclas seleciona/submete cada layout do
// AskUserQuestion no claude 2.1.216. Roda o parser REAL (parseTuiMenu) contra
// o buffer capturado pra também flagrar drift de classificação.
//
// Uso: tsx e2e/scenarios/probe-tui-2116.ts [layout...]
// Sem args roda os 5 layouts. Não commita nada; escreve o doc de achados em
// docs/probe-2116-findings.md (fora do escopo desta invocação: NENHUM arquivo
// de fix é tocado).
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { parseTuiMenu, type TuiMenu } from '../../src/features/sessions/tui-menu-parser'

const { Terminal } = xtermHeadless as unknown as { Terminal: typeof import('@xterm/headless').Terminal }

const FINDINGS = join(import.meta.dirname, '..', '..', 'docs', 'probe-2116-findings.md')
const t0 = Date.now()
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
function log(...args: unknown[]): void {
  console.log(`[${elapsed()}]`, ...args)
}

// mesma leitura que Terminal.tsx (readTailText): últimas n linhas do buffer.
function tailText(term: Terminal, n = 40): string {
  const buf = term.buffer.active
  let text = ''
  for (let y = Math.max(0, buf.length - n); y < buf.length; y++) {
    const line = buf.getLine(y)
    if (line) text += line.translateToString(true) + '\n'
  }
  return text
}

function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

function transcriptPath(cwd: string, sessionId: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectDir(cwd), `${sessionId}.jsonl`)
}

function transcriptHasToolResult(cwd: string, sessionId: string): boolean {
  const p = transcriptPath(cwd, sessionId)
  if (!existsSync(p)) return false
  const raw = readFileSync(p, 'utf8')
  return raw.includes('"tool_result"') && raw.includes('AskUserQuestion')
}

interface Session {
  term: Terminal
  proc: pty.IPty
  cwd: string
  sessionId: string
  alive: boolean
}

function spawnClaude(cols: number, rows: number): Session {
  const cwd = mkdtempSync(join(tmpdir(), 'probe2116-'))
  writeFileSync(join(cwd, 'README.md'), '# scratch project pra sonda TUI\n')
  const sessionId = randomUUID()
  const term = new Terminal({ cols, rows, allowProposedApi: true })
  const proc = pty.spawn('claude', ['--session-id', sessionId, '--effort', 'low'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  const s: Session = { term, proc, cwd, sessionId, alive: true }
  proc.onData((d) => term.write(d))
  proc.onExit(() => {
    s.alive = false
  })
  return s
}

async function sendPrompt(s: Session, text: string): Promise<void> {
  s.proc.write(text)
  await sleep(1000) // deixa o composer renderizar antes do Enter (SessionStart hook pode atrasar)
  s.proc.write('\r')
}

// Dialog de "trust this folder" aparece sempre num diretório-scratch novo
// (mkdtempSync a cada sessão). Confirmado empiricamente: pointer já parte em
// "1. Yes, I trust this folder" e Enter sozinho confirma (sem precisar de
// dígito). Não confundir com o warning de --dangerously-skip-permissions
// (dialog DIFERENTE, não usado aqui — não passamos essa flag).
async function resolveTrustPrompt(s: Session, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const raw = tailText(s.term, 30)
    if (/trust this folder/i.test(raw)) {
      log('trust-folder prompt detectado, confirmando com Enter')
      s.proc.write('\r')
      await sleep(1500)
      return
    }
    await sleep(300)
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

// Poll até parseTuiMenu ver um menu 'question' (ou timeout). Retorna o menu +
// texto bruto capturado.
async function waitForQuestionMenu(
  s: Session,
  timeoutMs = 150_000,
): Promise<{ menu: TuiMenu; raw: string } | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const raw = tailText(s.term, 60)
    const menu = parseTuiMenu(raw)
    if (menu && menu.kind === 'question') return { menu, raw }
    await sleep(400)
  }
  return null
}

// Depois de uma tecla candidata: o menu mudou (sumiu, virou question_review,
// ou trocou de pergunta/opções)? Fingerprint simples por (kind+question+labels).
function fingerprint(m: TuiMenu | null): string {
  if (!m) return 'NULL'
  return [m.kind, m.question ?? '', ...m.options.map((o) => o.label)].join('|')
}

interface ProbeResult {
  layout: string
  rawExcerpt: string
  parsedSummary: string
  sequenceLog: string[]
  confirmedSequence: string
  notReproduced?: string
}

async function probeSelectAndSubmit(
  s: Session,
  menu: TuiMenu,
  rawBefore: string,
  candidates: { name: string; keys: string[] }[],
): Promise<{ confirmed: string; log: string[] }> {
  const before = fingerprint(menu)
  const seqLog: string[] = []
  for (const cand of candidates) {
    for (const k of cand.keys) {
      s.proc.write(k)
      await sleep(500)
    }
    await sleep(1200)
    const rawAfter = tailText(s.term, 60)
    const menuAfter = parseTuiMenu(rawAfter)
    const after = fingerprint(menuAfter)
    const resolved = after !== before && (menuAfter === null || menuAfter.kind !== 'question' || rawAfter !== rawBefore)
    const toolResultSeen = transcriptHasToolResult(s.cwd, s.sessionId)
    seqLog.push(
      `candidate="${cand.name}" keys=${JSON.stringify(cand.keys)} fingerprintChanged=${after !== before} menuKindAfter=${menuAfter?.kind ?? 'null'} toolResultInJsonl=${toolResultSeen}`,
    )
    log('candidate', cand.name, 'resolved=', resolved, 'toolResultInJsonl=', toolResultSeen)
    if (resolved || toolResultSeen) {
      return { confirmed: cand.name, log: seqLog }
    }
  }
  return { confirmed: 'NENHUM_CANDIDATO_RESOLVEU', log: seqLog }
}

function killSession(s: Session): void {
  try {
    s.proc.kill()
  } catch {
    /* já morto */
  }
}

async function runLayout(
  name: string,
  prompt: string,
  candidates: { name: string; keys: string[] }[],
  opts?: { cols?: number; rows?: number },
): Promise<ProbeResult> {
  log('=== LAYOUT', name, '===')
  const s = spawnClaude(opts?.cols ?? 100, opts?.rows ?? 40)
  try {
    await sleep(2500) // boot da CLI
    await resolveTrustPrompt(s)
    await sendPrompt(s, prompt)
    log('prompt enviado, aguardando menu...')
    const found = await waitForQuestionMenu(s)
    if (!found) {
      return {
        layout: name,
        rawExcerpt: '',
        parsedSummary: '',
        sequenceLog: [],
        confirmedSequence: '',
        notReproduced: 'menu AskUserQuestion não apareceu em 150s (timeout)',
      }
    }
    const { menu, raw } = found
    log('menu detectado:', JSON.stringify({ kind: menu.kind, multiSelect: menu.multiSelect, tabs: menu.tabs, submitOnDigit: menu.submitOnDigit, nOptions: menu.options.length }))
    const { confirmed, log: seqLog } = await probeSelectAndSubmit(s, menu, raw, candidates)
    return {
      layout: name,
      rawExcerpt: raw.split('\n').filter((l) => l.trim() !== '').slice(-25).join('\n'),
      parsedSummary: JSON.stringify(
        { kind: menu.kind, multiSelect: menu.multiSelect, tabs: menu.tabs, submitOnDigit: menu.submitOnDigit, options: menu.options.map((o) => ({ label: o.label, checked: o.checked, hasPreview: !!o.preview })) },
        null,
        2,
      ),
      sequenceLog: seqLog,
      confirmedSequence: confirmed,
    }
  } finally {
    killSession(s)
    await sleep(500)
  }
}

const LAYOUTS: Record<string, () => Promise<ProbeResult>> = {
  'a-single-2opt': () =>
    runLayout(
      'a) single-select, 2 opções, sem preview',
      'Use a tool AskUserQuestion (NÃO ExitPlanMode) para me perguntar "Você confirma?" com EXATAMENTE 2 opções curtas, sem description: "Sim" e "Não". multiSelect deve ser false. Não faça mais nada, apenas chame a tool.',
      [
        { name: 'digit-only(1)', keys: ['1'] },
        { name: 'digit+Enter(1+Enter)', keys: ['1', '\r'] },
        { name: 'Enter-alone', keys: ['\r'] },
      ],
    ),
  'b-single-3opt-preview': () =>
    runLayout(
      'b) single-select, 3 opções com description longa (preview)',
      'Use a tool AskUserQuestion para me perguntar "Qual abordagem você prefere para resolver o bug?" com EXATAMENTE 3 opções, cada uma com um campo description de pelo menos 2 frases explicando a abordagem em detalhe: "Abordagem A" (reescrever do zero), "Abordagem B" (patch incremental), "Abordagem C" (feature flag). multiSelect false. Não faça mais nada.',
      [
        { name: 'digit-only(2)', keys: ['2'] },
        { name: 'digit+Enter(2+Enter)', keys: ['2', '\r'] },
        { name: 'Enter-alone', keys: ['\r'] },
        { name: 'nav-right-to-submit+Enter', keys: ['\x1b[C', '\x1b[C', '\x1b[C', '\r'] },
      ],
    ),
  'c-multi-select': () =>
    runLayout(
      'c) multi-select (2+ opções marcáveis)',
      'Use a tool AskUserQuestion com multiSelect true para me perguntar "Quais linguagens você usa no dia a dia?" com EXATAMENTE 3 opções marcáveis: "TypeScript", "Python", "Rust". Permita selecionar mais de uma. Não faça mais nada.',
      [
        { name: 'digit-toggle(1)+digit-toggle(2)', keys: ['1', '2'] },
        { name: 'Enter-after-toggle', keys: ['\r'] },
        { name: 'nav-right-to-submit-tab+Enter', keys: ['\x1b[C', '\x1b[C', '\x1b[C', '\r'] },
        { name: 'Tab-key+Enter', keys: ['\t', '\r'] },
      ],
    ),
  'd-multi-question': () =>
    runLayout(
      'd) múltiplas perguntas numa só chamada (2 questions)',
      'Use a tool AskUserQuestion com um array de EXATAMENTE 2 perguntas na mesma chamada: pergunta 1 "Qual sua cor favorita?" com opções "Vermelho"/"Azul"; pergunta 2 "Qual seu animal favorito?" com opções "Cachorro"/"Gato". Não faça mais nada.',
      [
        { name: 'digit-only(1)', keys: ['1'] },
        { name: 'digit+Enter(1+Enter)', keys: ['1', '\r'] },
        { name: 'nav-right-to-next-tab+digit', keys: ['\x1b[C', '1'] },
        { name: 'nav-right-to-submit+Enter', keys: ['\x1b[C', '\x1b[C', '\x1b[C', '\r'] },
      ],
    ),
  'e-long-question-wrap': () =>
    runLayout(
      'e) pergunta longa (wrap em várias linhas visuais)',
      'Use a tool AskUserQuestion para me fazer UMA pergunta bem longa (pelo menos 220 caracteres, uma frase corrida sem quebras manuais, descrevendo em detalhe um cenário hipotético de arquitetura de microsserviços com múltiplas restrições de latência e consistência) com EXATAMENTE 2 opções curtas: "Opção 1" e "Opção 2". Não faça mais nada.',
      [
        { name: 'digit-only(1)', keys: ['1'] },
        { name: 'digit+Enter(1+Enter)', keys: ['1', '\r'] },
      ],
      { cols: 80, rows: 40 },
    ),
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const keys = args.length > 0 ? args : Object.keys(LAYOUTS)
  const results: ProbeResult[] = []
  for (const k of keys) {
    const fn = LAYOUTS[k]
    if (!fn) {
      log('layout desconhecido, pulando:', k)
      continue
    }
    try {
      const r = await fn()
      results.push(r)
    } catch (e) {
      results.push({
        layout: k,
        rawExcerpt: '',
        parsedSummary: '',
        sequenceLog: [],
        confirmedSequence: '',
        notReproduced: `erro: ${String(e)}`,
      })
    }
  }

  const doc: string[] = []
  doc.push('# Sonda empírica — AskUserQuestion no claude 2.1.216')
  doc.push('')
  doc.push(`Gerado em ${new Date().toISOString()} por \`e2e/scenarios/probe-tui-2116.ts\`.`)
  doc.push('Fase 0 do plano `tenho-mais-alguns-feedbacks-shiny-meteor.md`. Cada linha vem de uma')
  doc.push('observação real do script rodando (node-pty + @xterm/headless + parser real).')
  doc.push('')
  doc.push('## Tabela-verdade resumida')
  doc.push('')
  doc.push('| Layout | submitOnDigit (parser) | tabs? | multiSelect? | Sequência confirmada |')
  doc.push('|---|---|---|---|---|')
  for (const r of results) {
    if (r.notReproduced) {
      doc.push(`| ${r.layout} | — | — | — | NÃO REPRODUZIDO: ${r.notReproduced} |`)
      continue
    }
    let parsed: { submitOnDigit?: boolean; tabs?: unknown; multiSelect?: boolean } = {}
    try {
      parsed = JSON.parse(r.parsedSummary)
    } catch {
      /* ignore */
    }
    doc.push(
      `| ${r.layout} | ${parsed.submitOnDigit} | ${parsed.tabs ? 'sim' : 'não'} | ${parsed.multiSelect} | ${r.confirmedSequence} |`,
    )
  }
  doc.push('')
  doc.push('## Detalhe por layout')
  for (const r of results) {
    doc.push('')
    doc.push(`### ${r.layout}`)
    if (r.notReproduced) {
      doc.push('')
      doc.push(`NÃO REPRODUZIDO: ${r.notReproduced}`)
      continue
    }
    doc.push('')
    doc.push('Buffer capturado (últimas linhas não-vazias, tail):')
    doc.push('```')
    doc.push(r.rawExcerpt)
    doc.push('```')
    doc.push('')
    doc.push('Parse real (`parseTuiMenu`):')
    doc.push('```json')
    doc.push(r.parsedSummary)
    doc.push('```')
    doc.push('')
    doc.push('Log de tentativas (em ordem, até a que resolveu):')
    for (const l of r.sequenceLog) doc.push(`- ${l}`)
    doc.push('')
    doc.push(`**Sequência confirmada: ${r.confirmedSequence}**`)
  }
  doc.push('')
  writeFileSync(FINDINGS, doc.join('\n'))
  log('doc de achados escrito em', FINDINGS)
}

await main()
