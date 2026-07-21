import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { parseTuiMenu } from '../../src/features/sessions/tui-menu-parser'

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

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), 'probe2116d2-'))
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
  await sleep(2500)
  proc.write('\r')
  await sleep(1500)
  proc.write(
    'Use a tool AskUserQuestion com um array de EXATAMENTE 2 perguntas na mesma chamada: pergunta 1 "Qual sua cor favorita?" com opcoes "Vermelho"/"Azul"; pergunta 2 "Qual seu animal favorito?" com opcoes "Cachorro"/"Gato". Nao faca mais nada.',
  )
  await sleep(1000)
  proc.write('\r')
  console.log('prompt enviado, aguardando 1a pergunta...')
  let menu: any = null
  for (let i = 0; i < 300; i++) {
    const m = parseTuiMenu(tailText(term))
    if (m && m.kind === 'question') {
      menu = m
      break
    }
    await sleep(500)
  }
  console.log('Q1 detectada:', JSON.stringify({ question: menu?.question, tabs: menu?.tabs }))
  proc.write('1')
  await sleep(1500)
  const menu2 = parseTuiMenu(tailText(term))
  console.log('apos digit(1) na Q1 -> menu2:', JSON.stringify({ question: menu2?.question, tabs: menu2?.tabs, kind: menu2?.kind }))
  if (menu2 && menu2.kind === 'question' && /animal/i.test(menu2.question ?? '')) {
    console.log('AVANCOU para Q2 (nao submeteu o conjunto) - testando digit-only na Q2')
    proc.write('1')
    await sleep(1500)
    const menu3 = parseTuiMenu(tailText(term))
    console.log('apos digit(1) na Q2 -> menu3 kind:', menu3?.kind, 'question:', menu3?.question)
    if (menu3 && menu3.kind === 'question') {
      console.log('digit-only na Q2 NAO resolveu sozinho - testando nav-right-to-submit+Enter')
      proc.write('\x1b[C')
      await sleep(400)
      proc.write('\x1b[C')
      await sleep(400)
      proc.write('\r')
      await sleep(1500)
      const raw4 = tailText(term)
      const menu4 = parseTuiMenu(raw4)
      console.log('apos nav+Enter -> menu4 kind:', menu4?.kind, 'ainda question?', menu4?.kind === 'question')
      console.log('RAW4 tail:')
      console.log(raw4.split('\n').filter((l) => l.trim() !== '').slice(-15).join('\n'))
    } else if (menu3 && (menu3 as any).kind === 'question_review') {
      console.log('digit-only na Q2 levou pra question_review (NAO e submit final ainda) - testando Enter/digit(1) nessa tela')
      const rawReview = tailText(term)
      console.log('RAW question_review tail:')
      console.log(rawReview.split('\n').filter((l) => l.trim() !== '').slice(-20).join('\n'))
      proc.write('1')
      await sleep(400)
      proc.write('\r')
      await sleep(1500)
      const raw5 = tailText(term)
      const menu5 = parseTuiMenu(raw5)
      console.log('apos digit(1)+Enter na review -> menu5 kind:', menu5?.kind ?? 'null (resolvido)')
    } else {
      console.log('digit-only na Q2 RESOLVEU (menu sumiu/mudou) - kind final:', menu3?.kind ?? 'null')
    }
  } else {
    console.log('menu2 nao e a Q2 esperada - kind:', menu2?.kind ?? 'null', 'question:', menu2?.question)
  }
  proc.kill()
}
main()
