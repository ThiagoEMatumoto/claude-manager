import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { getDb } from '../services/db'
import { ptyManager } from '../services/pty-manager'
import type { Session, SpawnSessionInput } from '../../../shared/types/ipc'

interface SessionRow {
  id: string
  repo_id: string
  cc_session_id: string | null
  title: string | null
  pane_id: string | null
  status: 'running' | 'exited' | 'crashed' | 'closed_by_user'
  started_at: number
  ended_at: number | null
}

interface RepoPathRow {
  path: string
}

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

// O claude vive em ~/.local/bin e o env do Electron GUI não herda o PATH do rc.
// Subimos o shell de login+interativo (-l -i carrega .zprofile/.zshrc) e damos
// `exec claude` para que o PTY encerre quando o claude sair.
function loginShellSpawn(claudeCmd: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoLogo', '-Command', claudeCmd] }
  }
  const shell = process.env.SHELL || '/usr/bin/zsh'
  return { command: shell, args: ['-l', '-i', '-c', `exec ${claudeCmd}`] }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

let listenersAttached = false

export function registerSessionIpc(): void {
  if (!listenersAttached) {
    ptyManager.on('data', (e) => broadcast('pty:data', e))
    ptyManager.on('exit', (e) => {
      getDb()
        .prepare(
          "UPDATE sessions SET status = ?, ended_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(e.exitCode === 0 ? 'exited' : 'crashed', Date.now(), e.sessionId)
      broadcast('pty:exit', e)
    })
    listenersAttached = true
  }

  ipcMain.handle('sessions:spawn', (_e, input: SpawnSessionInput) => {
    const db = getDb()
    const repo = db
      .prepare('SELECT path FROM repos WHERE id = ?')
      .get(input.repoId) as RepoPathRow | undefined
    if (!repo) throw new Error(`repo not found: ${input.repoId}`)

    const row: SessionRow = {
      id: randomUUID(),
      repo_id: input.repoId,
      cc_session_id: null,
      title: null,
      pane_id: null,
      status: 'running',
      started_at: Date.now(),
      ended_at: null,
    }
    db.prepare(
      `INSERT INTO sessions
       (id, repo_id, cc_session_id, title, pane_id, status, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.repo_id,
      row.cc_session_id,
      row.title,
      row.pane_id,
      row.status,
      row.started_at,
      row.ended_at,
    )

    try {
      const { command, args } = loginShellSpawn(resolveClaudeCommand())
      ptyManager.spawn({
        sessionId: row.id,
        command,
        args,
        cwd: repo.path,
        cols: input.cols,
        rows: input.rows,
      })
    } catch (err) {
      db.prepare("UPDATE sessions SET status = 'crashed', ended_at = ? WHERE id = ?").run(
        Date.now(),
        row.id,
      )
      throw err
    }

    return toSession(row)
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
}
