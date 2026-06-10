import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../services/db'
import { ptyManager } from '../services/pty-manager'
import { get as getFeature } from '../services/feature-store'
import { featureMemory } from '../services/feature-memory'
import { buildFeatureContextContent } from './feature-context'
import {
  sessionActivityService,
  findTranscriptPath,
  buildSessionsFileIndex,
  readTranscriptTitle,
  readTail,
  deriveEnrichment,
  isPidAlive,
  mapStatus,
} from '../services/session-activity'
import { getMcpRuntime } from '../services/mcp/server'
import { mcpClientConfigPath } from '../services/mcp/config'
import { mapLiveSessionRepo, type LiveSessionJoinRow } from './live-session-mapping'
import type {
  Session,
  SpawnSessionInput,
  ResumeSessionInput,
  SessionSummary,
  LiveSessionInfo,
} from '../../../shared/types/ipc'

interface SessionRow {
  id: string
  repo_id: string | null
  cc_session_id: string | null
  title: string | null
  pane_id: string | null
  status: 'running' | 'exited' | 'crashed' | 'closed_by_user'
  started_at: number
  ended_at: number | null
}

interface RepoPathRow {
  path: string
  label: string
}

// O name é input do usuário e entra na linha de `zsh -c '<innerCmd>'`.
// Aspas simples POSIX impedem qualquer interpretação pelo shell; o único caractere
// perigoso dentro de '...' é a própria aspa simples, fechada com '\'' e reaberta.
function shquote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  repoId: row.repo_id,
  ccSessionId: row.cc_session_id,
  title: row.title,
  paneId: row.pane_id,
  status: row.status,
  startedAt: row.started_at,
  endedAt: row.ended_at,
})

const CLAUDE_COMMAND_KEY = 'claude_command'

function resolveClaudeCommand(): string {
  const row = getDb()
    .prepare('SELECT value FROM app_prefs WHERE key = ?')
    .get(CLAUDE_COMMAND_KEY) as { value: string } | undefined
  return row?.value?.trim() || 'claude'
}

const SCRATCH_DIR_KEY = 'scratch_dir'
const QUICK_SESSION_NAME = 'Sessão rápida'

// Sessão avulsa (sem repo) roda numa pasta scratch dedicada — configurável via
// app_prefs (mesmo padrão de claude_command), default ~/ClaudeManager/scratch.
// Garante a existência antes do spawn (PTY com cwd inexistente falha).
function resolveScratchDir(): string {
  const row = getDb()
    .prepare('SELECT value FROM app_prefs WHERE key = ?')
    .get(SCRATCH_DIR_KEY) as { value: string } | undefined
  const dir = row?.value?.trim() || join(homedir(), 'ClaudeManager', 'scratch')
  mkdirSync(dir, { recursive: true })
  return dir
}

// B4: conecta a sessão ao MCP server do claude-manager via --mcp-config (config
// gerado no boot em <userData>/mcp-client-config.json). Sem --strict-mcp-config:
// os servers de user/projeto do claude continuam valendo. Se o server não subiu
// (EADDRINUSE → getMcpRuntime() null), não injeta nada — sessão sobe normal.
function mcpConfigArg(): string {
  if (!getMcpRuntime()) return ''
  return ` --mcp-config ${shquote(mcpClientConfigPath())}`
}

// O claude vive em ~/.local/bin e o env do Electron GUI não herda o PATH do rc.
// Subimos o shell de login+interativo (-l -i carrega .zprofile/.zshrc) e damos
// `exec claude` para que o PTY encerre quando o claude sair.
function loginShellSpawn(innerCmd: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoLogo', '-Command', innerCmd] }
  }
  const shell = process.env.SHELL || '/usr/bin/zsh'
  return { command: shell, args: ['-l', '-i', '-c', `exec ${innerCmd}`] }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

// Escreve um arquivo temporário com o contexto da feature pra injeção via
// --append-system-prompt-file. Retorna o path, ou null se a feature não existe.
// Conteúdo (header + bloco tracking + seções-chave) vem do builder puro em
// feature-context.ts.
function writeFeatureContextFile(featureId: string): string | null {
  const feature = getFeature(featureId)
  if (!feature) return null
  const content = buildFeatureContextContent(feature)

  const tmpDir = join(app.getPath('userData'), 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  const tmpPath = join(tmpDir, `feat-${feature.id}-${Date.now()}.md`)
  writeFileSync(tmpPath, content, 'utf8')
  return tmpPath
}

// Injeta um comando inicial no REPL do claude assim que o TUI sobe. Como não há
// sinal explícito de "pronto", esperamos o PRIMEIRO `data` do PTY daquela sessão
// (o banner inicial) e, após um debounce curto, escrevemos `cmd + '\r'`. One-shot:
// remove o listener antes de escrever, então nunca dispara duas vezes.
function injectInitialCommandOnFirstData(sessionId: string, command: string): void {
  const cmd = command.trim()
  if (!cmd) return
  let timer: ReturnType<typeof setTimeout> | null = null

  const onData = (e: { sessionId: string }) => {
    if (e.sessionId !== sessionId) return
    if (timer) return // já agendado pelo primeiro data
    timer = setTimeout(() => {
      // Remove AMBOS os listeners: a sessão segue viva após injetar, e deixar
      // o `exit` pendurado acumularia listeners no emitter singleton a cada
      // lançamento (MaxListenersExceededWarning após ~10 sessões vivas).
      ptyManager.off('data', onData)
      ptyManager.off('exit', onExit)
      try {
        ptyManager.write(sessionId, cmd + '\r')
      } catch {
        // PTY já encerrou antes do debounce — nada a fazer.
      }
    }, 400)
  }

  // Se a PTY sair antes de injetar, descarta o listener pendente.
  const onExit = (e: { sessionId: string }) => {
    if (e.sessionId !== sessionId) return
    if (timer) clearTimeout(timer)
    ptyManager.off('data', onData)
    ptyManager.off('exit', onExit)
  }

  ptyManager.on('data', onData)
  ptyManager.on('exit', onExit)
}

// Cria o registro em `sessions`, dispara o PTY com o innerCmd dado e devolve o Session.
// Spawn novo e resume diferem só no innerCmd (--session-id <novo> vs --resume <existente>).
function startSession(opts: {
  ccSessionId: string
  repoId: string | null
  cwd: string
  innerCmd: string
  featureId?: string | null
  initialCommand?: string
  cols?: number
  rows?: number
}): Session {
  const db = getDb()
  const id = randomUUID()
  const row: SessionRow = {
    id,
    repo_id: opts.repoId,
    cc_session_id: opts.ccSessionId,
    title: null,
    pane_id: null,
    status: 'running',
    started_at: Date.now(),
    ended_at: null,
  }
  db.prepare(
    `INSERT INTO sessions
     (id, repo_id, cc_session_id, title, pane_id, status, started_at, ended_at, feature_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.repo_id,
    row.cc_session_id,
    row.title,
    row.pane_id,
    row.status,
    row.started_at,
    row.ended_at,
    opts.featureId ?? null,
  )

  try {
    const { command, args } = loginShellSpawn(opts.innerCmd)
    ptyManager.spawn({
      sessionId: row.id,
      command,
      args,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
    })
  } catch (err) {
    db.prepare("UPDATE sessions SET status = 'crashed', ended_at = ? WHERE id = ?").run(
      Date.now(),
      row.id,
    )
    throw err
  }

  if (opts.initialCommand) {
    injectInitialCommandOnFirstData(row.id, opts.initialCommand)
  }

  return toSession(row)
}

let listenersAttached = false

export function registerSessionIpc(): void {
  if (!listenersAttached) {
    ptyManager.on('data', (e) => broadcast('pty:data', e))
    ptyManager.on('exit', (e) => {
      const db = getDb()
      db.prepare(
        "UPDATE sessions SET status = ?, ended_at = ? WHERE id = ? AND status = 'running'",
      ).run(e.exitCode === 0 ? 'exited' : 'crashed', Date.now(), e.sessionId)
      broadcast('pty:exit', e)

      // Fase 8: sempre dispara o serviço de memória no exit. Ele resolve a feature
      // (manual > por-branch > fuzzy > auto-cria), persiste sessions.feature_id e
      // sintetiza — com guarda de atividade própria. featureId null => auto-resolver.
      try {
        const link = db
          .prepare('SELECT feature_id, cc_session_id, repo_id FROM sessions WHERE id = ?')
          .get(e.sessionId) as
          | { feature_id: string | null; cc_session_id: string | null; repo_id: string | null }
          | undefined
        // Sessão avulsa (repo_id null) fica fora da síntese de features — a
        // assinatura de onSessionExit exige repoId string (resolve por repo/branch).
        if (link && link.repo_id) {
          featureMemory.onSessionExit({
            sessionId: e.sessionId,
            ccSessionId: link.cc_session_id,
            repoId: link.repo_id,
            featureId: link.feature_id,
          })
        }
      } catch (err) {
        console.error('[sessions] feature synth trigger failed:', err)
      }
    })
    listenersAttached = true
  }

  ipcMain.handle('sessions:spawn', (_e, input: SpawnSessionInput) => {
    const db = getDb()
    const repoId = input.repoId ?? null

    // Sessão avulsa (repoId null): roda no scratch dir, sem vínculo com repo.
    let cwd: string
    let defaultName: string
    if (repoId) {
      const repo = db
        .prepare('SELECT path, label FROM repos WHERE id = ?')
        .get(repoId) as RepoPathRow | undefined
      if (!repo) throw new Error(`repo not found: ${repoId}`)
      cwd = repo.path
      defaultName = repo.label
    } else {
      cwd = resolveScratchDir()
      defaultName = QUICK_SESSION_NAME
    }

    const sessionId = randomUUID()
    const name = input.name?.trim() || defaultName

    if (!UUID_RE.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`)
    const claudeCmd = resolveClaudeCommand()
    let innerCmd = `${claudeCmd} --session-id ${sessionId} -n ${shquote(name)}${mcpConfigArg()}`

    // Fase 6: se a sessão é vinculada a uma feature, escreve um arquivo temporário
    // com o contexto (frontmatter-derivado + seções-chave do doc) e anexa via
    // --append-system-prompt-file. NÃO bloqueia o spawn se algo falhar.
    if (input.featureId) {
      try {
        const promptPath = writeFeatureContextFile(input.featureId)
        if (promptPath) {
          innerCmd += ` --append-system-prompt-file ${shquote(promptPath)}`
        }
      } catch (err) {
        console.error('[sessions] feature context injection failed:', err)
      }
    }

    return startSession({
      ccSessionId: sessionId,
      repoId,
      cwd,
      innerCmd,
      featureId: input.featureId,
      initialCommand: input.initialCommand,
      cols: input.cols,
      rows: input.rows,
    })
  })

  ipcMain.handle('sessions:resume', (_e, input: ResumeSessionInput) => {
    const db = getDb()
    const repoId = input.repoId ?? null

    let cwd: string
    let defaultName: string
    if (repoId) {
      const repo = db
        .prepare('SELECT path, label FROM repos WHERE id = ?')
        .get(repoId) as RepoPathRow | undefined
      if (!repo) throw new Error(`repo not found: ${repoId}`)
      cwd = repo.path
      defaultName = repo.label
    } else {
      cwd = resolveScratchDir()
      defaultName = QUICK_SESSION_NAME
    }
    if (!UUID_RE.test(input.ccSessionId)) {
      throw new Error(`invalid cc session id: ${input.ccSessionId}`)
    }

    // Nome preferido: o já gravado no JSONL (custom/ai-title), senão o default.
    const transcript = findTranscriptPath(input.ccSessionId)
    const name = (transcript ? readTranscriptTitle(transcript) : null) || defaultName

    const claudeCmd = resolveClaudeCommand()
    const innerCmd = `${claudeCmd} --resume ${input.ccSessionId} -n ${shquote(name)}${mcpConfigArg()}`

    return startSession({
      ccSessionId: input.ccSessionId,
      repoId,
      cwd,
      innerCmd,
      cols: input.cols,
      rows: input.rows,
    })
  })

  ipcMain.handle('sessions:is-resumable', (_e, ccSessionId: string): boolean => {
    return findTranscriptPath(ccSessionId) !== null
  })

  ipcMain.handle('sessions:list-by-repo', (_e, repoId: string): SessionSummary[] => {
    const db = getDb()
    const rows = db
      .prepare(
        'SELECT DISTINCT cc_session_id, title FROM sessions WHERE repo_id = ? AND cc_session_id IS NOT NULL',
      )
      .all(repoId) as { cc_session_id: string; title: string | null }[]

    const liveIndex = buildSessionsFileIndex()
    const summaries: SessionSummary[] = []

    for (const row of rows) {
      const ccSessionId = row.cc_session_id
      const transcript = findTranscriptPath(ccSessionId)
      if (!transcript) continue // sem transcript real — spawn vazio, descarta.

      const indexed = liveIndex.get(ccSessionId)
      const isLive = !!indexed && isPidAlive(indexed.pid)

      let name: string | null
      let lastActivityAt: number | null
      let status: SessionSummary['status']

      if (isLive) {
        name = indexed.name ?? readTranscriptTitle(transcript) ?? row.title
        lastActivityAt = indexed.updatedAt
        const mapped = mapStatus(indexed.status)
        status = mapped === 'starting' || mapped === 'ended' ? 'idle' : mapped
      } else {
        name = readTranscriptTitle(transcript) ?? row.title
        try {
          lastActivityAt = statSync(transcript).mtimeMs
        } catch {
          lastActivityAt = null
        }
        status = 'ended'
      }

      summaries.push({ ccSessionId, name, status, lastActivityAt, isLive })
    }

    summaries.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
    return summaries
  })

  ipcMain.handle('sessions:list-live-global', async (): Promise<LiveSessionInfo[]> => {
    const db = getDb()
    const liveIndex = buildSessionsFileIndex()
    const out: LiveSessionInfo[] = []

    // runningIds() = sessions.id (UUID) das PTYs vivas neste app. Para cada uma,
    // LEFT JOIN sessions→repos→projects — sessão avulsa (repo_id null) vem com
    // as colunas do repo/projeto nulas e vira repo: null no LiveSessionInfo.
    for (const sessionId of ptyManager.runningIds()) {
      const row = db
        .prepare(
          `SELECT
             s.cc_session_id AS cc_session_id,
             s.title AS session_title,
             r.id AS repo_id, r.project_id AS repo_project_id, r.label AS repo_label,
             r.path AS repo_path, r.role AS repo_role, r.link_kind AS repo_link_kind,
             r.source AS repo_source, r.position AS repo_position, r.created_at AS repo_created_at,
             p.name AS project_name, p.icon AS project_icon, p.color AS project_color
           FROM sessions s
           LEFT JOIN repos r ON r.id = s.repo_id
           LEFT JOIN projects p ON p.id = r.project_id
           WHERE s.id = ? AND s.cc_session_id IS NOT NULL`,
        )
        .get(sessionId) as LiveSessionJoinRow | undefined

      if (!row) continue
      const ccSessionId = row.cc_session_id

      const { repo, projectName, projectIcon, projectColor } = mapLiveSessionRepo(row)

      const transcript = findTranscriptPath(ccSessionId)
      const indexed = liveIndex.get(ccSessionId)
      const isLive = !!indexed && isPidAlive(indexed.pid)

      let status: LiveSessionInfo['status']
      let name: string | null
      let lastActivityAt: number | null
      if (isLive) {
        status = mapStatus(indexed!.status)
        name = indexed!.name ?? (transcript ? readTranscriptTitle(transcript) : null) ?? row.session_title
        lastActivityAt = indexed!.updatedAt
      } else {
        status = 'ended'
        name = (transcript ? readTranscriptTitle(transcript) : null) ?? row.session_title
        lastActivityAt = null
      }

      let title: string | null = null
      let lastText: string | null = null
      let tokens: LiveSessionInfo['tokens']
      if (transcript) {
        const tail = await readTail(transcript)
        if (tail) {
          const enrichment = deriveEnrichment(tail)
          title = enrichment.title
          lastText = enrichment.lastText
          tokens = enrichment.tokens
        }
      }

      out.push({
        id: sessionId,
        ccSessionId,
        name,
        title,
        status,
        repo,
        projectName,
        projectIcon,
        projectColor,
        lastActivityAt,
        lastText,
        tokens,
        isResumable: transcript !== null,
      })
    }

    out.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
    return out
  })

  ipcMain.handle('sessions:get-backlog', (_e, sessionId: string) => {
    return ptyManager.getBacklog(sessionId)
  })

  ipcMain.handle('sessions:write', (_e, sessionId: string, data: string) => {
    ptyManager.write(sessionId, data)
  })

  ipcMain.handle('sessions:resize', (_e, sessionId: string, cols: number, rows: number) => {
    ptyManager.resize(sessionId, cols, rows)
  })

  ipcMain.handle('sessions:kill', (_e, sessionId: string) => {
    ptyManager.kill(sessionId)
    getDb()
      .prepare(
        "UPDATE sessions SET status = 'closed_by_user', ended_at = ? WHERE id = ? AND status = 'running'",
      )
      .run(Date.now(), sessionId)
  })

  ipcMain.handle('sessions:rename', (_e, sessionId: string, title: string) => {
    const trimmed = title.trim()
    getDb()
      .prepare('UPDATE sessions SET title = ? WHERE id = ?')
      .run(trimmed.length > 0 ? trimmed : null, sessionId)
  })

  ipcMain.handle('sessions:list', () => {
    const rows = getDb()
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC')
      .all() as SessionRow[]
    return rows.map(toSession)
  })

  ipcMain.handle('session:activity:watch', (_e, ccSessionId: string) => {
    sessionActivityService.watch(ccSessionId)
  })

  ipcMain.handle('session:activity:unwatch', (_e, ccSessionId: string) => {
    sessionActivityService.unwatch(ccSessionId)
  })

  ipcMain.handle('session:activity:watch-global', () => {
    sessionActivityService.watchGlobal()
  })

  ipcMain.handle('session:activity:unwatch-global', () => {
    sessionActivityService.unwatchGlobal()
  })
}
