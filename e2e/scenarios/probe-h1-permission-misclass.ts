// Probe dirigido pra testar H1 (investigação do Bug 2, ver mensagem do
// orquestrador): será que uma AskUserQuestion de 2 opções cuja PERGUNTA
// contém "Do you want" é misclassificada como kind:'permission' em vez de
// 'question' pelo parseTuiMenu real? Standalone, não afeta o probe da Fase 0.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { parseTuiMenu } from '../../src/features/sessions/tui-menu-parser'

const { Terminal } = xtermHeadless as unknown as { Terminal: typeof import('@xterm/headless').Terminal }

function tailText(term: InstanceType<typeof Terminal>, n = 40): string {
  const buf = term.buffer.active
  let text = ''
  for (let y = Math.max(0, buf.length - n); y < buf.length; y++) {
    const line = buf.getLine(y)
    if (line) text += line.translateToString(true) + '\n'
  }
  return text
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function resolveTrustPrompt(proc: pty.IPty, term: InstanceType<typeof Terminal>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (/trust this folder/i.test(tailText(term, 30))) {
      proc.write('\r')
      await sleep(1500)
      return
    }
    await sleep(300)
  }
}

async function runCase(name: string, prompt: string): Promise<void> {
  console.log(`\n=== ${name} ===`)
  const cwd = mkdtempSync(join(tmpdir(), 'probe-h1-'))
  writeFileSync(join(cwd, 'README.md'), '# scratch\n')
  const sessionId = randomUUID()
  const term = new Terminal({ cols: 100, rows: 40, allowProposedApi: true })
  const proc = pty.spawn('claude', ['--session-id', sessionId, '--effort', 'low'], {
    name: 'xterm-256color',
    cols: 100,
    rows: 40,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  proc.onData((d) => term.write(d))
  try {
    await sleep(2500)
    await resolveTrustPrompt(proc, term)
    proc.write(prompt)
    await sleep(1000)
    proc.write('\r')
    console.log('prompt enviado, aguardando menu...')
    const deadline = Date.now() + 150_000
    let found = false
    while (Date.now() < deadline) {
      const raw = tailText(term, 60)
      const menu = parseTuiMenu(raw)
      if (menu) {
        found = true
        console.log('RAW BUFFER:\n' + raw.split('\n').filter((l) => l.trim() !== '').join('\n'))
        console.log('PARSED:', JSON.stringify(menu, null, 2))
        break
      }
      await sleep(400)
    }
    if (!found) console.log('NENHUM MENU DETECTADO (timeout)')
  } finally {
    try {
      proc.kill()
    } catch {
      /* já morto */
    }
    await sleep(500)
  }
}

async function main(): Promise<void> {
  await runCase(
    'H1: pergunta com "Do you want" + 2 opções',
    'Use a tool AskUserQuestion (NÃO ExitPlanMode, NÃO peça permissão de arquivo) para me perguntar EXATAMENTE isto, palavra por palavra: "Do you want to enable the new caching layer?" com EXATAMENTE 2 opções curtas: "Sim" e "Não". multiSelect false. Não faça mais nada, apenas chame a tool.',
  )
}

await main()
