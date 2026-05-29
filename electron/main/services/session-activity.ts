import { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  readdirSync,
  readFileSync,
  open as openCb,
  fstat as fstatCb,
  read as readCb,
  close as closeCb,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chokidar, { FSWatcher } from 'chokidar'
import type { SessionActivity } from '../../../shared/types/ipc'

const PROJECTS_ROOT = join(homedir(), '.claude', 'projects')
const SESSIONS_ROOT = join(homedir(), '.claude', 'sessions')
const TAIL_BYTES = 64 * 1024
const DEBOUNCE_MS = 250
const MAX_TEXT = 200

// Fonte primária de status/name/updatedAt: ~/.claude/sessions/<pid>.json (um por
// processo, atualizado ao vivo pelo Claude Code). É leve (~300B) e preciso.
interface CcSessionFile {
  pid?: number
  sessionId?: string
  cwd?: string
  status?: 'busy' | 'idle' | 'waiting' | 'shell' | null
  name?: string | null
  updatedAt?: number
}

export interface IndexEntry {
  pid: number
  status: CcSessionFile['status']
  name: string | null
  cwd: string | null
  updatedAt: number | null
}

// Lê todos os ~/.claude/sessions/<pid>.json e indexa por sessionId. Compartilhado
// entre o watcher ao vivo e o list-by-repo (ambos precisam do estado dos PIDs).
export function buildSessionsFileIndex(): Map<string, IndexEntry> {
  const next = new Map<string, IndexEntry>()
  let files: string[]
  try {
    files = readdirSync(SESSIONS_ROOT).filter((f) => f.endsWith('.json'))
  } catch {
    return next
  }
  for (const file of files) {
    let data: CcSessionFile
    try {
      data = JSON.parse(readFileSync(join(SESSIONS_ROOT, file), 'utf8')) as CcSessionFile
    } catch {
      continue // arquivo inválido ou em escrita parcial.
    }
    if (!data.sessionId || typeof data.pid !== 'number') continue
    next.set(data.sessionId, {
      pid: data.pid,
      status: data.status ?? null,
      name: data.name ?? null,
      cwd: data.cwd ?? null,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : null,
    })
  }
  return next
}

// kill(pid, 0) não envia sinal — só testa se o processo existe e é acessível.
// ESRCH = morto; EPERM = vivo mas sem permissão (raro aqui, mesmo usuário).
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function mapStatus(cc: CcSessionFile['status']): SessionActivity['status'] {
  switch (cc) {
    case 'busy':
    case 'shell':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
    default:
      // null ou ausente → sessão iniciando, ainda sem status reportado.
      return 'starting'
  }
}

// O JSONL nasce em ~/.claude/projects/<cwd-encoded>/<ccSessionId>.jsonl. Em vez de
// reproduzir o encoding do cwd, varremos os subdirs procurando o arquivo pelo id.
export function findTranscriptPath(ccSessionId: string): string | null {
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

// Título persistido no JSONL: custom-title (definido pelo usuário) tem prioridade
// sobre ai-title (gerado). Lê o arquivo inteiro porque esses eventos podem estar em
// qualquer posição; usado só no list-by-repo (poucas sessões por vez).
export function readTranscriptTitle(path: string): string | null {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  let aiTitle: string | null = null
  let customTitle: string | null = null
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as { type?: string; aiTitle?: string; customTitle?: string }
      if (obj.type === 'custom-title' && obj.customTitle) customTitle = obj.customTitle
      else if (obj.type === 'ai-title' && obj.aiTitle) aiTitle = obj.aiTitle
    } catch {
      // linha inválida — ignorar.
    }
  }
  return customTitle ?? aiTitle
}

interface ContentItem {
  type?: string
  text?: string
}

interface TranscriptLine {
  type?: string
  aiTitle?: string
  message?: {
    role?: string
    content?: ContentItem[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

interface TranscriptEnrichment {
  title: string | null
  lastText: string | null
  tokens: SessionActivity['tokens']
}

// Enriquecimento secundário: lastText, tokens e aiTitle (fallback do name).
// Status e updatedAt vêm da fonte primária (sessions/<pid>.json).
function deriveEnrichment(tail: string): TranscriptEnrichment {
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
  let tokens: SessionActivity['tokens']

  for (const l of parsed) {
    if (l.type === 'ai-title' && l.aiTitle) title = l.aiTitle
  }

  const lastAssistant = [...parsed].reverse().find((l) => l.type === 'assistant')
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

  return { title, lastText, tokens }
}

interface WatchEntry {
  transcriptPath: string | null
  enrichment: TranscriptEnrichment
}

class SessionActivityService extends EventEmitter {
  // ccSessionId -> sessões assinadas pelo renderer.
  private watched = new Map<string, WatchEntry>()
  // sessionId -> dados do sessions/<pid>.json (índice por PID, lido dos arquivos).
  private index = new Map<string, IndexEntry>()
  private dirWatcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  watch(ccSessionId: string): void {
    if (this.watched.has(ccSessionId)) return
    this.watched.set(ccSessionId, {
      transcriptPath: findTranscriptPath(ccSessionId),
      enrichment: { title: null, lastText: null, tokens: undefined },
    })
    this.ensureDirWatcher()
    // Estado inicial imediato (índice já pode estar populado).
    this.rebuildIndex()
    void this.emitFor(ccSessionId)
  }

  unwatch(ccSessionId: string): void {
    this.watched.delete(ccSessionId)
    if (this.watched.size === 0 && this.dirWatcher) {
      void this.dirWatcher.close()
      this.dirWatcher = null
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
    }
  }

  closeAll(): void {
    for (const id of [...this.watched.keys()]) this.unwatch(id)
  }

  private ensureDirWatcher(): void {
    if (this.dirWatcher) return
    this.dirWatcher = chokidar.watch(SESSIONS_ROOT, {
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: false,
    })
    const schedule = () => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.onIndexChanged(), DEBOUNCE_MS)
    }
    this.dirWatcher.on('add', schedule)
    this.dirWatcher.on('change', schedule)
    this.dirWatcher.on('unlink', schedule)
  }

  // Relê todos os sessions/<pid>.json e reconstrói o índice sessionId -> entry.
  private rebuildIndex(): void {
    this.index = buildSessionsFileIndex()
  }

  private onIndexChanged(): void {
    this.rebuildIndex()
    for (const id of this.watched.keys()) void this.emitFor(id)
  }

  private async emitFor(ccSessionId: string): Promise<void> {
    const entry = this.watched.get(ccSessionId)
    if (!entry) return
    const indexed = this.index.get(ccSessionId)

    let status: SessionActivity['status']
    let name: string | null = null
    let lastActivityAt: number | null = null

    if (!indexed) {
      // Sem arquivo: ou a sessão ainda não nasceu (starting) ou já encerrou.
      // Se já vimos o JSONL antes (transcriptPath), tratamos como encerrada.
      status = entry.transcriptPath ? 'ended' : 'starting'
    } else if (!isPidAlive(indexed.pid)) {
      status = 'ended'
      name = indexed.name
      lastActivityAt = indexed.updatedAt
    } else {
      status = mapStatus(indexed.status)
      name = indexed.name
      lastActivityAt = indexed.updatedAt
    }

    // Enriquecimento secundário do JSONL (lastText/tokens/title) sob demanda.
    if (!entry.transcriptPath) entry.transcriptPath = findTranscriptPath(ccSessionId)
    if (entry.transcriptPath) {
      const tail = await readTail(entry.transcriptPath)
      if (tail) entry.enrichment = deriveEnrichment(tail)
    }

    const activity: SessionActivity = {
      ccSessionId,
      status,
      name,
      title: entry.enrichment.title,
      lastText: entry.enrichment.lastText,
      lastActivityAt,
      tokens: entry.enrichment.tokens,
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
