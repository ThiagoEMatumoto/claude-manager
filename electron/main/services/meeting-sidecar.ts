import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeetingSidecarManager } from './meeting-sidecar-manager'
import { resolveSidecarScript } from './sidecar-path'
import * as meetingStore from './meeting-store'
import { broadcast } from './notify'

const moduleDir = dirname(fileURLToPath(import.meta.url))

const execFileAsync = promisify(execFile)

// O python3 vive tipicamente fora do PATH herdado pelo GUI do Electron (mesmo
// problema do claude em claude-cli.ts). Resolvemos o caminho absoluto uma vez via
// login shell e cacheamos. Em packaged/win, caímos no nome simples.
let cachedPython: string | null = null

async function resolvePython3(): Promise<string> {
  if (cachedPython) return cachedPython
  if (process.platform === 'win32') {
    cachedPython = 'python'
    return cachedPython
  }
  const shell = process.env.SHELL || 'zsh'
  try {
    const { stdout } = await execFileAsync(shell, ['-lic', 'command -v python3'], {
      timeout: 10_000,
      encoding: 'utf8',
    })
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const found = [...lines].reverse().find((l) => l.startsWith('/') || l === 'python3')
    cachedPython = found || 'python3'
  } catch {
    cachedPython = 'python3'
  }
  return cachedPython
}

// Default desta fatia: o sidecar FAKE (stdlib puro). O script vive em
// `sidecar/fake_sidecar.py`, resolvido por resolveSidecarScript: em packaged via
// process.resourcesPath (extraResources, FORA do asar); em dev/build/e2e via
// __dirname do main compilado (`out/main` → `../../sidecar`). O swap para o
// sidecar real (faster-whisper + pw-record) troca este script — a estrutura do
// manager não.
function fakeSidecarArgs(meetingId: string): string[] {
  const script = resolveSidecarScript(
    {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDir,
    },
    'fake_sidecar.py',
  )
  return [script, '--meeting-id', meetingId]
}

export const meetingSidecarManager = new MeetingSidecarManager({
  store: meetingStore,
  broadcast,
  resolveCommand: resolvePython3,
  defaultArgs: fakeSidecarArgs,
})
