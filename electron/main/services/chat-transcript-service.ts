import { BrowserWindow } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import chokidar, { FSWatcher } from 'chokidar'
import { findTranscriptPath } from './session-activity'
import { parseChatMessages } from './chat-transcript'
import { readSubagentInfos } from './subagent-turns'
import type { ChatMessage, ChatTranscriptUpdate } from '../../../shared/types/chat'

const POLL_MS = 1000 // espera o JSONL nascer (sessão recém-spawnada)
const DEBOUNCE_MS = 150 // coalesce de bursts de append durante o streaming

interface WatchEntry {
  ccSessionId: string
  path: string | null
  watcher: FSWatcher | null
  poll: NodeJS.Timeout | null
  debounce: NodeJS.Timeout | null
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export interface ChatTranscriptRead {
  ccSessionId: string | null
  path: string | null
  mtimeMs: number | null
  messages: ChatMessage[]
}

// Lê/observa o transcript JSONL de uma sessão pra alimentar o Chat View. O parser
// é puro (chat-transcript.ts); aqui mora só o I/O e o lifecycle do watcher.
//
// Watcher: chokidar num ÚNICO arquivo. NÃO usamos awaitWriteFinish — ele aguarda o
// arquivo PARAR de mudar, o que atrasaria updates durante o streaming (append
// contínuo). Em vez disso: debounce curto + re-leitura do arquivo INTEIRO; o parser
// tolera a última linha parcial (try/catch por linha). Re-emite a LISTA completa a
// cada mudança — simples e robusto a reescritas do JSONL (o renderer só substitui).
class ChatTranscriptService {
  // chave = sessionId INTERNO (sessions.id); pty:exit também usa essa chave.
  private watches = new Map<string, WatchEntry>()

  // Leitura pontual (chat:get-transcript). Lê o arquivo INTEIRO — o chat precisa do
  // histórico completo, ao contrário do tail de 64KB do session-activity.
  async read(ccSessionId: string | null): Promise<ChatTranscriptRead> {
    if (!ccSessionId) return { ccSessionId, path: null, mtimeMs: null, messages: [] }
    const path = findTranscriptPath(ccSessionId)
    if (!path) return { ccSessionId, path: null, mtimeMs: null, messages: [] }
    return this.readPath(ccSessionId, path)
  }

  private async readPath(ccSessionId: string, path: string): Promise<ChatTranscriptRead> {
    try {
      const [content, st] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      // Subagentes vivem em <projectDir>/<ccSessionId>/subagents/ (irmão do JSONL
      // principal em <projectDir>/<ccSessionId>.jsonl) — leitura síncrona barata.
      const subagents = readSubagentInfos(dirname(path), ccSessionId)
      return {
        ccSessionId,
        path,
        mtimeMs: st.mtimeMs,
        messages: parseChatMessages(content, subagents),
      }
    } catch {
      // arquivo sumiu / corrida — devolve vazio em vez de derrubar o handler.
      return { ccSessionId, path, mtimeMs: null, messages: [] }
    }
  }

  watch(sessionId: string, ccSessionId: string | null): void {
    if (this.watches.has(sessionId)) return
    if (!ccSessionId) return // sem cc id não há transcript a observar.
    const entry: WatchEntry = {
      ccSessionId,
      path: null,
      watcher: null,
      poll: null,
      debounce: null,
    }
    this.watches.set(sessionId, entry)
    const path = findTranscriptPath(ccSessionId)
    if (path) this.attach(sessionId, entry, path)
    else this.startPoll(sessionId, entry)
  }

  unwatch(sessionId: string): void {
    const entry = this.watches.get(sessionId)
    if (!entry) return
    if (entry.poll) clearInterval(entry.poll)
    if (entry.debounce) clearTimeout(entry.debounce)
    if (entry.watcher) void entry.watcher.close()
    this.watches.delete(sessionId)
  }

  closeAll(): void {
    for (const id of [...this.watches.keys()]) this.unwatch(id)
  }

  // Transcript ainda inexistente (sessão recém-spawnada): poll barato até o JSONL
  // aparecer, então passa pro file-watcher. findTranscriptPath é um readdir dos
  // subdirs de projects — leve o bastante pra 1s. Emite uma lista vazia de cara pra
  // o renderer não ficar pendurado esperando o primeiro evento.
  private startPoll(sessionId: string, entry: WatchEntry): void {
    broadcast('chat:transcript-update', {
      sessionId,
      transcriptExists: false,
      messages: [],
    } satisfies ChatTranscriptUpdate)
    entry.poll = setInterval(() => {
      const path = findTranscriptPath(entry.ccSessionId)
      if (!path) return
      if (entry.poll) {
        clearInterval(entry.poll)
        entry.poll = null
      }
      this.attach(sessionId, entry, path)
    }, POLL_MS)
  }

  private attach(sessionId: string, entry: WatchEntry, path: string): void {
    entry.path = path
    void this.emit(sessionId, entry, path) // estado inicial imediato.
    entry.watcher = chokidar.watch(path, { ignoreInitial: true })
    const schedule = () => {
      if (entry.debounce) clearTimeout(entry.debounce)
      entry.debounce = setTimeout(() => void this.emit(sessionId, entry, path), DEBOUNCE_MS)
    }
    entry.watcher.on('change', schedule)
    entry.watcher.on('add', schedule)
  }

  private async emit(sessionId: string, entry: WatchEntry, path: string): Promise<void> {
    if (!this.watches.has(sessionId)) return // corrida com unwatch durante o debounce.
    const { messages } = await this.readPath(entry.ccSessionId, path)
    if (!this.watches.has(sessionId)) return
    // emit() só dispara depois do attach() (path encontrado) → o arquivo existe.
    broadcast('chat:transcript-update', {
      sessionId,
      transcriptExists: true,
      messages,
    } satisfies ChatTranscriptUpdate)
  }
}

export const chatTranscriptService = new ChatTranscriptService()
