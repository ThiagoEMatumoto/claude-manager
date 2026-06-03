import { type ElectronApplication, type Page } from 'playwright'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './launch'

const OUT_DIR = join(REPO_ROOT, '.cm-drive')
const SHOTS_DIR = join(OUT_DIR, 'screenshots')
const LOGS_DIR = join(OUT_DIR, 'logs')

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// Salva um PNG da janela do renderer. O nome é estável (sem timestamp) pra eu
// reler sempre o mesmo path — o caller numera os passos (01-..., 02-...).
export async function screenshot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS_DIR, { recursive: true })
  const file = join(SHOTS_DIR, `${name}.png`)
  await page.screenshot({ path: file })
  return file
}

export interface LogCapture {
  logFile: string
  stop: () => void
}

// Tee do console/erros do renderer + stdout/stderr do main pra um arquivo.
// Base do uso de diagnóstico (Fase 2): repro → ler o log.
export function captureLogs(app: ElectronApplication, page: Page): LogCapture {
  mkdirSync(LOGS_DIR, { recursive: true })
  const logFile = join(LOGS_DIR, `${stamp()}.log`)
  const stream = createWriteStream(logFile)
  const write = (tag: string, msg: string) =>
    stream.write(`[${new Date().toISOString()}] ${tag} ${msg}\n`)

  page.on('console', (m) => write(`console.${m.type()}`, m.text()))
  page.on('pageerror', (e) => write('pageerror', e.message))

  const proc = app.process()
  proc.stdout?.on('data', (d) => write('main.stdout', String(d).trimEnd()))
  proc.stderr?.on('data', (d) => write('main.stderr', String(d).trimEnd()))

  return { logFile, stop: () => stream.end() }
}
