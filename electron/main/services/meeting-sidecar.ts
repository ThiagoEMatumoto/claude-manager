import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeetingSidecarManager } from './meeting-sidecar-manager'
import { resolveSidecarScript } from './sidecar-path'
import {
  MEETING_SIDECAR_PYTHON_KEY,
  isMeetingSidecarConfigured as isConfiguredPure,
  resolveSidecar,
} from './meeting-sidecar-config'
import { getPref } from './prefs-store'
import * as meetingStore from './meeting-store'
import { broadcast } from './notify'

const moduleDir = dirname(fileURLToPath(import.meta.url))

const execFileAsync = promisify(execFile)

// O python3 vive tipicamente fora do PATH herdado pelo GUI do Electron (mesmo
// problema do claude em claude-cli.ts). Resolvemos o caminho absoluto uma vez via
// login shell e cacheamos. Usado SÓ como fallback (sidecar fake); o sidecar real
// usa o python do venv da pref `meeting_sidecar_python` (que já é absoluto).
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

// Resolve o caminho de um script do sidecar (real ou fake): em packaged via
// process.resourcesPath (extraResources, FORA do asar); em dev/build/e2e via
// __dirname do main compilado (`out/main` → `../../sidecar`).
function sidecarScript(name: string): string {
  return resolveSidecarScript(
    {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDir,
    },
    name,
  )
}

// Diretório durável p/ os WAVs temporários da captura do sidecar real.
function meetingsOutDir(): string {
  try {
    return join(app.getPath('userData'), 'meetings')
  } catch {
    return ''
  }
}

function configEnv() {
  return {
    pythonPref: getPref<string | null>(MEETING_SIDECAR_PYTHON_KEY, null),
    realScriptPath: sidecarScript('sidecar.py'),
    fakeScriptPath: sidecarScript('fake_sidecar.py'),
  }
}

// Sidecar REAL configurado? (pref `meeting_sidecar_python` preenchida + python
// existe + sidecar.py existe). A UI usa isto p/ o aviso de 1ª classe
// "sidecar não configurado" — sem configurar, o app cai no fake (dev).
export function isMeetingSidecarConfigured(): boolean {
  return isConfiguredPure(configEnv())
}

// Resolve command+args do spawn no momento do start. Configurado → sidecar REAL
// (python do venv + sidecar.py + --out-dir durável). Senão → FAKE (python3
// herdado + fake_sidecar.py). O swap é só de script/interpretador — o manager
// não muda.
async function resolveStart(meetingId: string): Promise<{ command: string; args: string[] }> {
  const resolution = resolveSidecar(configEnv(), await resolvePython3())

  if (resolution.mode === 'fake') {
    return { command: resolution.command, args: [resolution.script, '--meeting-id', meetingId] }
  }

  const args = [resolution.script, '--meeting-id', meetingId]
  const outDir = meetingsOutDir()
  if (outDir) args.push('--out-dir', outDir)
  return { command: resolution.command, args }
}

export const meetingSidecarManager = new MeetingSidecarManager({
  store: meetingStore,
  broadcast,
  resolveCommand: resolvePython3,
  resolveStart,
})
