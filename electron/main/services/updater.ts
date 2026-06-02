import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { appendFileSync, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import electronUpdater from 'electron-updater'
import type { GithubAsset, UpdateFormat, UpdateStatus } from '../../../shared/types/ipc'

const { autoUpdater } = electronUpdater
const execFileAsync = promisify(execFile)

const PKEXEC_PATH = '/usr/bin/pkexec'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const FOCUS_THROTTLE_MS = 60 * 1000
const RELEASE_API =
  'https://api.github.com/repos/ThiagoEMatumoto/claude-manager/releases/latest'
const RELEASE_PAGE =
  'https://github.com/ThiagoEMatumoto/claude-manager/releases/latest'

interface GithubRelease {
  tag_name: string
  assets: GithubAsset[]
}

type UpdateTarget = { format: UpdateFormat; mode: 'native' | 'assisted'; ext?: string }

// Deriva o alvo de atualização da plataforma corrente:
// - native  = electron-updater faz tudo (download in-place + quitAndInstall).
// - assisted = baixa o instalador e abre; o usuário conclui manualmente.
function resolveUpdateTarget(): UpdateTarget {
  if (process.platform === 'win32') return { format: 'nsis', mode: 'native' }
  if (process.platform === 'darwin') return { format: 'dmg', mode: 'assisted', ext: '.dmg' }
  if (process.env.APPIMAGE) return { format: 'appimage', mode: 'native' }
  return { format: 'deb', mode: 'assisted', ext: '.deb' }
}

const updateTarget = resolveUpdateTarget()
const currentFormat: UpdateFormat = updateTarget.format

let latestRelease: GithubRelease | null = null
let lastFocusCheck = 0
// Sinaliza que um .deb foi instalado in-place via pkexec e o 'updates:install'
// deve fazer relaunch+quit (em vez do quitAndInstall do electron-updater).
let debInstalled = false

function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status', status)
  }
}

// Append-only log persistente do fluxo de update. Sobrevive a reinícios e
// permite diagnosticar falhas do pkexec/apt-get depois do fato (o stderr do
// apt some quando o app fecha).
function updaterLog(event: string, detail?: string): void {
  try {
    const file = join(app.getPath('userData'), 'logs', 'updater.log')
    mkdirSync(dirname(file), { recursive: true })
    const line = `${new Date().toISOString()} [${event}]${detail ? ` ${detail}` : ''}\n`
    appendFileSync(file, line)
  } catch {
    // logging best-effort: nunca derrubar o update por falha de escrita do log.
  }
}

// Mantém só as últimas N linhas não-vazias de uma saída (stderr do apt costuma
// ser verboso); usado tanto pro log quanto pra mensagem amigável de erro.
function tailLines(text: string, n: number): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(' ')
}

// Compara X.Y.Z numericamente. Retorna true se `latest` > `current`.
function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const da = a[i] ?? 0
    const db = b[i] ?? 0
    if (da !== db) return da > db
  }
  return false
}

async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch(RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'claude-manager',
      },
    })
    if (!res.ok) return

    const release = (await res.json()) as GithubRelease
    const latestVersion = release.tag_name.replace(/^v/, '')

    if (!isNewer(latestVersion, app.getVersion())) return

    latestRelease = release
    // Só o broadcast: o UpdateToast já mostra "atualização vX disponível /
    // Atualizar". Disparar notify aqui criava um 2º toast empilhado pro MESMO
    // evento.
    broadcast({ state: 'available', version: latestVersion, format: currentFormat })
  } catch {
    // rede indisponível / API fora — silencioso, tentamos de novo no próximo ciclo.
  }
}

async function applyAssistedUpdate(ext: string): Promise<void> {
  const asset = latestRelease?.assets.find((a) => a.name.endsWith(ext))
  if (!asset) {
    broadcast({ state: 'error', message: 'Nenhum instalador encontrado na release.' })
    return
  }

  try {
    const res = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'claude-manager' },
    })
    if (!res.ok || !res.body) {
      broadcast({ state: 'error', message: 'Falha ao baixar o instalador.' })
      return
    }

    const total = Number(res.headers.get('content-length')) || 0
    const destPath = join(app.getPath('downloads'), asset.name)
    const out = createWriteStream(destPath)
    let received = 0

    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0) {
        broadcast({ state: 'downloading', percent: Math.round((received / total) * 100) })
      }
    })

    await new Promise<void>((resolve, reject) => {
      body.pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
      body.on('error', reject)
    })

    const version = latestRelease?.tag_name.replace(/^v/, '') ?? app.getVersion()

    if (currentFormat === 'deb' && existsSync(PKEXEC_PATH)) {
      await installDebWithPkexec(destPath, version)
      return
    }

    await shell.openPath(destPath)
    broadcast({ state: 'awaiting-install', version })
  } catch (err) {
    broadcast({ state: 'error', message: err instanceof Error ? err.message : 'Erro ao baixar.' })
  }
}

// Instala o .deb in-place via prompt gráfico de senha do polkit.
// `apt-get install <path>` resolve dependências e faz upgrade.
// - `env DEBIAN_FRONTEND=noninteractive`: pkexec roda /usr/bin/env, que então
//   exec'a o apt-get com a env setada — evita prompt de conffile (sem tty).
// - `-o DPkg::Lock::Timeout=120`: aguarda até 120s pelo lock do dpkg em vez de
//   falhar na hora (contenção comum com unattended-upgrades).
// Tratamento de saída:
// - exit 126/127 = pkexec (prompt cancelado / não autorizado) → NÃO é erro de
//   instalação: volta pro estado disponível, sem abrir a Central.
// - outro exit≠0 = erro do apt-get → estado de erro com as últimas linhas do
//   stderr (mensagem amigável se for lock). Nunca abre a Central (inútil aqui).
async function installDebWithPkexec(destPath: string, version: string): Promise<void> {
  broadcast({ state: 'installing', version })
  updaterLog('install:start', `version=${version} path=${destPath}`)
  try {
    await execFileAsync(
      PKEXEC_PATH,
      [
        'env',
        'DEBIAN_FRONTEND=noninteractive',
        'apt-get',
        '-o',
        'DPkg::Lock::Timeout=120',
        'install',
        '-y',
        destPath,
      ],
      { timeout: 5 * 60 * 1000 },
    )
    debInstalled = true
    updaterLog('install:success', `version=${version}`)
    broadcast({ state: 'installed', version })
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string }
    const stderr = e.stderr ?? ''
    const stdout = e.stdout ?? ''
    const code = e.code

    // pkexec: 126 = não autorizado / dismissed, 127 = autenticação cancelada.
    if (code === 126 || code === 127) {
      updaterLog('install:cancelled', `code=${code}`)
      broadcast({ state: 'available', version, format: currentFormat })
      return
    }

    const tail = tailLines(stderr || stdout, 4)
    updaterLog('install:error', `code=${code} stderr=${tail}`)

    const message = /could not get lock|dpkg.*lock|lock-frontend/i.test(stderr)
      ? 'Não foi possível instalar agora: o gerenciador de pacotes está ocupado (atualizações automáticas). Tente novamente em instantes.'
      : tail || 'Falha ao instalar o pacote.'

    broadcast({ state: 'error', message })
  }
}

export function initUpdater(): void {
  // Em dev não há artefato publicado nem APPIMAGE; o autoUpdater quebraria ao buscar feed.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true

  autoUpdater.on('download-progress', (progress) => {
    broadcast({ state: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    broadcast({ state: 'error', message: err.message })
  })

  // Roteia por modo: native (nsis/appimage) delega ao electron-updater (download +
  // quitAndInstall); assisted (deb/dmg) baixa manualmente e abre o instalador gráfico,
  // pois o electron-updater não suporta auto-install desses formatos.
  ipcMain.handle('updates:apply', async () => {
    if (updateTarget.mode === 'native') {
      void autoUpdater.checkForUpdates()
      return
    }
    await applyAssistedUpdate(updateTarget.ext ?? '')
  })

  ipcMain.handle('updates:install', () => {
    // deb já foi instalado in-place via pkexec: só relança o app na versão nova.
    if (debInstalled) {
      app.relaunch()
      app.quit()
      return
    }
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updates:open-release', () => shell.openExternal(RELEASE_PAGE))

  ipcMain.handle('updates:open-downloads', () => shell.openPath(app.getPath('downloads')))

  void checkForUpdate()
  setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)

  app.on('browser-window-focus', () => {
    const now = Date.now()
    if (now - lastFocusCheck < FOCUS_THROTTLE_MS) return
    lastFocusCheck = now
    void checkForUpdate()
  })
}
