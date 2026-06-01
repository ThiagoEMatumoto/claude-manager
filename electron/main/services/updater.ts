import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import electronUpdater from 'electron-updater'
import type { GithubAsset, UpdateFormat, UpdateStatus } from '../../../shared/types/ipc'
import { notify } from './notifications'

const { autoUpdater } = electronUpdater

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

const isAppImage = !!process.env.APPIMAGE
const currentFormat: UpdateFormat = isAppImage ? 'appimage' : 'deb'

let latestRelease: GithubRelease | null = null
let lastFocusCheck = 0

function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status', status)
  }
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
    broadcast({ state: 'available', version: latestVersion, format: currentFormat })
    notify({
      title: `Atualização v${latestVersion} disponível`,
      body: 'Clique para atualizar.',
    })
  } catch {
    // rede indisponível / API fora — silencioso, tentamos de novo no próximo ciclo.
  }
}

async function applyDebUpdate(): Promise<void> {
  const asset = latestRelease?.assets.find((a) => a.name.endsWith('.deb'))
  if (!asset) {
    broadcast({ state: 'error', message: 'Nenhum instalador .deb encontrado na release.' })
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
    await shell.openPath(destPath)
    broadcast({ state: 'awaiting-install', version })
  } catch (err) {
    broadcast({ state: 'error', message: err instanceof Error ? err.message : 'Erro ao baixar.' })
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

  // Roteia por formato: AppImage delega ao electron-updater (download + quitAndInstall);
  // .deb (ou outro) baixa manualmente e abre o instalador gráfico, pois o electron-updater
  // não suporta auto-install de .deb.
  ipcMain.handle('updates:apply', async () => {
    if (isAppImage) {
      void autoUpdater.checkForUpdates()
      return
    }
    await applyDebUpdate()
  })

  ipcMain.handle('updates:install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updates:open-release', () => shell.openExternal(RELEASE_PAGE))

  void checkForUpdate()
  setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)

  app.on('browser-window-focus', () => {
    const now = Date.now()
    if (now - lastFocusCheck < FOCUS_THROTTLE_MS) return
    lastFocusCheck = now
    void checkForUpdate()
  })
}
