import { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, open as openCb, fstat as fstatCb, read as readCb, close as closeCb } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chokidar, { FSWatcher } from 'chokidar'
import type { SessionActivity } from '../../../shared/types/ipc'

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects')
const TAIL_BYTES = 64 * 1024
const DEBOUNCE_MS = 400
const IDLE_AFTER_MS = 3 * 60 * 1000
const MAX_TEXT = 200

// O JSONL nasce em ~/.claude/projects/<cwd-encoded>/<ccSessionId>.jsonl. Em vez de
// reproduzir o encoding do cwd, varremos os subdirs procurando o arquivo pelo id.
function findTranscriptPath(ccSessionId: string): string | null {
  if (!existsSync(PROJECTS_ROOT)) return null
  const target = `${ccSessionId}.jsonl`
  let dirs: string[]
  try {
    dirs = readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return null
  }
  for (const dir of dirs) {
    const candidate = join(PROJECTS_ROOT, dir, target)
    if (existsSync(candidate)) return candidate
  }
  return null
}

// Lê só os últimos TAIL_BYTES do arquivo: durante uma sessão longa o JSONL chega a
// milhares de linhas e reparsear tudo a cada mudança seria custoso. A primeira linha
// do tail pode estar partida (cortada no meio) ou em escrita parcial — o parser ignora
// linhas que não desserializam.
function readTail(path: string): Promise<string> {
  return new Promise((resolve) => {
    openCb(path, 'r', (errOpen, fd) => {
      if (errOpen) return resolve('')
      fstatCb(fd, (errStat, stat) => {
        if (errStat) {
          closeCb(fd, () => {})
          return resolve('')
        }
        const size = stat.size
        const start = size > TAIL_BYTES ? size - TAIL_BYTES : 0
        const length = size - start
        if (length <= 0) {
          closeCb(fd, () => {})
          return resolve('')
        }
        const buf = Buffer.alloc(length)
        readCb(fd, buf, 0, length, start, (errRead, bytesRead) => {
          closeCb(fd, () => {})
          if (errRead) return resolve('')
          resolve(buf.toString('utf8', 0, bytesRead))
        })
      })
    })
  })
}

interface ContentItem {
  type?: string
  text?: string
}

interface TranscriptLine {
  type?: string
  aiTitle?: string
  timestamp?: string
  message?: {
    role?: string
    content?: ContentItem[]
    stop_reason?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

function deriveActivity(ccSessionId: string, tail: string): SessionActivity {
  const lines = tail.split('\n')
  const parsed: TranscriptLine[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      parsed.push(JSON.parse(trimmed) as TranscriptLine)
    } catch {
      // Linha partida (início do tail) ou escrita parcial — ignorar.
    }
  }

  let title: string | null = null
  let lastText: string | null = null
  let lastActivityAt: number | null = null
  let tokens: SessionActivity['tokens']

  // Últimas linhas de conteúdo user/assistant, usadas pela heurística de status.
  const contentLines = parsed.filter(
    (l) => l.type === 'user' || l.type === 'assistant',
  )
  const lastContent = contentLines[contentLines.length - 1]
  const lastAssistant = [...contentLines].reverse().find((l) => l.type === 'assistant')

  for (const l of parsed) {
    if (l.type === 'ai-title' && l.aiTitle) title = l.aiTitle
    if (l.timestamp) {
      const t = Date.parse(l.timestamp)
      if (!Number.isNaN(t)) lastActivityAt = t
    }
  }

  if (lastAssistant?.message?.content) {
    const textItem = [...lastAssistant.message.content]
      .reverse()
      .find((c) => c.type === 'text' && typeof c.text === 'string')
    if (textItem?.text) lastText = textItem.text.slice(0, MAX_TEXT)
    const usage = lastAssistant.message.usage
    if (usage) {
      tokens = {
        output: usage.output_tokens ?? 0,
        context: (usage.cache_read_input_tokens ?? 0) + (usage.input_tokens ?? 0),
      }
    }
  }

  let status: SessionActivity['status'] = 'waiting'
  if (parsed.length === 0) {
    status = 'starting'
  } else {
    const lastIsToolResult =
      lastContent?.type === 'user' &&
      lastContent.message?.content?.some((c) => c.type === 'tool_result')
    const assistantWantsTool = lastContent?.type === 'assistant' && lastContent.message?.stop_reason === 'tool_use'
    if (assistantWantsTool || lastIsToolResult) {
      status = 'working'
    } else if (lastContent?.type === 'assistant' && lastContent.message?.stop_reason === 'end_turn') {
      status = 'waiting'
    }
    if (status === 'waiting' && lastActivityAt && Date.now() - lastActivityAt > IDLE_AFTER_MS) {
      status = 'idle'
    }
  }

  return { ccSessionId, status, title, lastText, lastActivityAt, tokens }
}

interface WatchEntry {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
  path: string | null
}

class SessionActivityService extends EventEmitter {
  private watchers = new Map<string, WatchEntry>()

  watch(ccSessionId: string): void {
    if (this.watchers.has(ccSessionId)) return

    const initialPath = findTranscriptPath(ccSessionId)
    // Se o arquivo ainda não existe, observamos o diretório-raiz pra detectar o
    // nascimento do JSONL (a sessão acabou de iniciar, antes da 1ª interação).
    const watchTarget = initialPath ?? PROJECTS_ROOT
    const watcher = chokidar.watch(watchTarget, {
      ignoreInitial: false,
      depth: initialPath ? 0 : 2,
      awaitWriteFinish: false,
    })

    const entry: WatchEntry = { watcher, timer: null, path: initialPath }
    this.watchers.set(ccSessionId, entry)

    const schedule = () => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => void this.process(ccSessionId), DEBOUNCE_MS)
    }

    watcher.on('add', (p) => {
      if (p.endsWith(`${ccSessionId}.jsonl`)) {
        entry.path = p
        schedule()
      }
    })
    watcher.on('change', (p) => {
      if (entry.path && p === entry.path) schedule()
    })

    // Emite o estado inicial (starting se o arquivo ainda não nasceu).
    schedule()
  }

  unwatch(ccSessionId: string): void {
    const entry = this.watchers.get(ccSessionId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    void entry.watcher.close()
    this.watchers.delete(ccSessionId)
  }

  closeAll(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id)
  }

  private async process(ccSessionId: string): Promise<void> {
    const entry = this.watchers.get(ccSessionId)
    if (!entry) return
    if (!entry.path) entry.path = findTranscriptPath(ccSessionId)

    let activity: SessionActivity
    if (!entry.path) {
      activity = {
        ccSessionId,
        status: 'starting',
        title: null,
        lastText: null,
        lastActivityAt: null,
      }
    } else {
      const tail = await readTail(entry.path)
      activity = deriveActivity(ccSessionId, tail)
    }
    broadcast('session:activity', activity)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export const sessionActivityService = new SessionActivityService()
