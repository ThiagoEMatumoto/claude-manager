import { app, BrowserWindow, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getDb, closeDb } from './services/db'
import { ptyManager } from './services/pty-manager'
import { meetingSidecarManager } from './services/meeting-sidecar'
import * as handoffStore from './services/handoff-store'
import { sessionActivityService } from './services/session-activity'
import { registerProjectIpc } from './ipc/projects'
import { registerSessionIpc, sweepOrphanImageTemps } from './ipc/sessions'
import { registerShellIpc } from './ipc/shell'
import { registerDialogIpc } from './ipc/dialog'
import { registerGitIpc, cloneMissingWithToasts } from './ipc/git'
import { backfillRepoRemotes } from './services/git-remote'
import { listMissingRepos } from './services/repo-clone'
import { getPref } from './services/prefs-store'
import { registerFsIpc } from './ipc/fs'
import { registerPrefsIpc } from './ipc/prefs'
import { registerClaudeConfigsIpc } from './ipc/claude-configs'
import { registerClaudePluginsIpc } from './ipc/claude-plugins'
import { registerMetricsIpc } from './ipc/metrics'
import { registerFeaturesIpc } from './ipc/features'
import { registerRepoDependenciesIpc } from './ipc/repo-dependencies'
import { registerHandoffsIpc } from './ipc/handoffs'
import { registerDossiersIpc } from './ipc/dossiers'
import { registerObjectivesIpc } from './ipc/objectives'
import { registerTasksIpc } from './ipc/tasks'
import { registerMeetingsIpc } from './ipc/meetings'
import { registerMcpIpc } from './ipc/mcp'
import { registerSyncIpc, syncOnBoot, syncCoordinator, notifySyncMutation } from './ipc/sync'
import { setSyncMutationHook, broadcast } from './services/notify'
import { startFeatureWatcher, stopFeatureWatcher } from './services/feature-store'
import { featureMemory } from './services/feature-memory'
import {
  registerWorkspaceIpc,
  markWorkspaceRunning,
  markWorkspaceCleanShutdown,
} from './ipc/workspace'
import { startMcpServer, stopMcpServer } from './services/mcp/server'
import { initUpdater } from './services/updater'
import { startUsageMonitor, stopUsageMonitor } from './services/usage-monitor'
import { calendarWatcher } from './services/calendar/calendar-watcher'
import { registerWindowIpc, wireWindowMaximizeBroadcast } from './ipc/window'
import { setMainWindow } from './services/notifications'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged

// No Linux, o compositing por GPU do Chromium falha em várias combinações de
// driver (ex: nVidia/Wayland) e pinta a janela inteira de preto, mesmo com o DOM
// renderizado normalmente. Desligar a aceleração de hardware evita isso; o custo
// é desprezível para um app focado em terminal. Precisa ser chamado antes do ready.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  setMainWindow(win)
  wireWindowMaximizeBroadcast(win)

  // Links externos sempre vão pro browser do sistema, nunca navegam a janela do
  // app. Só abre http(s) — sem isso um window.open() vazio mandava `about:blank`
  // pro openExternal e o Chrome abria em branco.
  const openExternalSafe = (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      openExternalSafe(url)
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Backfill idempotente das origins + (se a pref permitir) clone dos repos
// registrados que não estão no disco. Best-effort: qualquer falha é logada e o
// boot segue.
async function autoCloneMissingOnBoot(): Promise<void> {
  try {
    await backfillRepoRemotes()
    if (getPref('autoCloneMissing', true) && listMissingRepos().length > 0) {
      await cloneMissingWithToasts()
    }
  } catch (err) {
    console.error('[repo-sync] auto-clone no boot falhou:', err)
  }
}

app.whenReady().then(async () => {
  // Sem menu de aplicação: o menu default do Electron traz um item Edit→Paste com
  // acelerador Ctrl+V que dispara webContents.paste() ALÉM do paste nativo do
  // textarea do xterm — resultado é colar 2x. Campos de input normais continuam
  // colando via clipboard nativo do Chromium. Coerente com autoHideMenuBar.
  Menu.setApplicationMenu(null)
  getDb()
  // Boot reconcile de reuniões presas em estados "vivos" após um crash/quit sujo:
  // num processo fresco nenhum sidecar pode estar vivo, então qualquer reunião
  // nesses estados é órfã → failed. Idempotente; ended_at preserva o existente.
  getDb()
    .prepare(
      `UPDATE meetings SET status = 'failed', ended_at = COALESCE(ended_at, ?)
       WHERE status IN ('capturing', 'recording', 'transcribing', 'diarizing')`,
    )
    .run(Date.now())
  // MCP server local (writes externos via Claude Code). Async e fire-and-forget:
  // EADDRINUSE etc. são logados dentro do start — nunca derrubam o boot.
  void startMcpServer()
  // Captura o clean_shutdown do boot anterior e o zera; deve rodar antes da
  // janela para que o renderer leia o valor correto via workspace:get-boot-state.
  markWorkspaceRunning()
  registerProjectIpc()
  registerRepoDependenciesIpc()
  registerHandoffsIpc()
  registerDossiersIpc()
  registerSessionIpc()
  // Boot reconcile: apaga temporários de imagem órfãos (pasted/dropped no
  // composer) deixados por sessões de execuções anteriores.
  sweepOrphanImageTemps()
  registerShellIpc()
  registerDialogIpc()
  registerGitIpc()
  registerFsIpc()
  registerPrefsIpc()
  registerWorkspaceIpc()
  registerClaudeConfigsIpc()
  registerClaudePluginsIpc()
  registerMetricsIpc()
  registerFeaturesIpc()
  registerObjectivesIpc()
  registerTasksIpc()
  registerMeetingsIpc()
  registerMcpIpc()
  registerSyncIpc()
  // Wire o ponto único de mutação → coordinator (auto-sync on-idle). Cobre
  // objectives/tasks/features (via notify.broadcast) e projects/repos (via
  // pingSyncMutation), tanto pela camada IPC quanto pelo MCP server.
  setSyncMutationHook(notifySyncMutation)
  registerWindowIpc()

  // A janela é criada PRIMEIRO (sem await no sync) para não pintar tela preta
  // até 8s em rede lenta. O watcher inicia já — o syncOnBoot pausa/reinicia o
  // watcher via watcherHooks internamente quando importa.
  createMainWindow()
  initUpdater()
  startUsageMonitor()
  startFeatureWatcher()
  // Ativação assistida por Google Calendar: poll da URL secreta iCal (pref
  // meeting_calendar_ics_url). Inativo se a pref estiver vazia — sem erro nem
  // rede. Inicia DEPOIS da janela porque o clique da notificação a foca.
  calendarWatcher.start()

  // Self-heal periódico de handoffs presos em 'running' cuja filha já morreu em
  // runtime (PTY exit pode não ter disparado a reconciliação). Não bloqueia o
  // boot e é idempotente — a query só toca handoffs órfãos.
  handoffReconcileTimer = setInterval(
    () => handoffStore.reconcileStuck(),
    HANDOFF_RECONCILE_INTERVAL_MS,
  )

  // Pull-no-boot CONSERVADOR em BACKGROUND: importa só fast-forward limpo (sem
  // trabalho local não-empurrado), bounded por timeout e NÃO-fatal (offline/erro
  // → segue com dados locais). Roda sob o mutex de sync (não corre com o
  // coordinator). Se IMPORTOU (mudou dados), faz broadcast dos canais das
  // entidades sincronizadas para o renderer recarregar ao vivo — as stores de
  // features/objectives/tasks tratam um payload-sinal como "refresh()".
  void syncOnBoot()
    .then((imported) => {
      if (!imported) return
      broadcast('feature:updated', { backfill: true })
      broadcast('objective:updated', { reload: true })
      broadcast('task:updated', { reload: true })
    })
    // Auto-clone dos repos faltantes DEPOIS do import do boot (o sync pode ter
    // trazido registros novos de outra máquina). Best-effort e não-bloqueante.
    .finally(() => void autoCloneMissingOnBoot())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// Self-heal de handoffs órfãos a cada 5min (ver app.whenReady).
const HANDOFF_RECONCILE_INTERVAL_MS = 5 * 60 * 1000
let handoffReconcileTimer: ReturnType<typeof setInterval> | null = null

// Shutdown síncrono final: roda DEPOIS do flush de sync (que lê o DB), porque a
// última operação fecha o DB. Idempotente via flag `didShutdown`.
let didShutdown = false
function runFinalShutdown(): void {
  if (didShutdown) return
  didShutdown = true
  void stopMcpServer()
  stopUsageMonitor()
  stopFeatureWatcher()
  calendarWatcher.stop()
  if (handoffReconcileTimer) {
    clearInterval(handoffReconcileTimer)
    handoffReconcileTimer = null
  }
  syncCoordinator.stop()
  featureMemory.close()
  ptyManager.killAll()
  meetingSidecarManager.killAllSidecars()
  sessionActivityService.closeAll()
  getDb()
    .prepare("UPDATE sessions SET status = 'exited', ended_at = ? WHERE status = 'running'")
    .run(Date.now())
  markWorkspaceCleanShutdown()
  closeDb()
}

// Bounded ~6s + não-fatal: nunca trava o fechamento indefinidamente. Resolve
// quando o flush termina OU quando o timeout estoura, o que vier primeiro.
const QUIT_FLUSH_TIMEOUT_MS = 6000

let quitFlushStarted = false
app.on('before-quit', (event) => {
  if (didShutdown) return // shutdown já concluído → deixa o quit prosseguir
  if (quitFlushStarted) {
    // Flush em andamento: um 2º quit não pode escapar o shutdown limpo (sem o
    // preventDefault o Electron prosseguiria e fecharia o DB no meio do flush).
    event.preventDefault()
    return
  }
  quitFlushStarted = true

  // Adia o quit para empurrar a última edição (best-effort) ANTES de fechar o
  // DB — sem isso, trocar de máquina perderia a última mutação. O flush lê o DB,
  // então DEVE rodar antes do closeDb (em runFinalShutdown).
  event.preventDefault()

  const flushDone = syncCoordinator.flush().catch((err) => {
    console.warn('[sync] flush no quit falhou (não-fatal):', String((err as Error)?.message ?? err))
  })
  const bounded = Promise.race([
    flushDone,
    new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS)),
  ])

  void bounded.then(() => {
    runFinalShutdown()
    app.quit() // re-dispara o quit; didShutdown=true → before-quit é no-op agora
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
