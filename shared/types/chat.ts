// Tipos do Chat View (Fase 5). O backend (F5a) lê/parseia/observa o transcript
// JSONL da sessão e expõe estas formas por IPC; a UI (F5b) as consome.

// Uma mensagem renderizável do chat. A lista é ORDENADA na ordem do transcript
// (ordem das linhas + ordem dos blocos de content dentro de cada linha). Uma
// única linha assistant/user pode gerar várias mensagens (texto + tool_use, ou
// texto + tool_result).
export type ChatMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; forId: string; content: string; isError: boolean }

// Retorno do read inicial (chat:get-transcript). path/mtimeMs são null quando a
// sessão ainda não tem transcript no disco (recém-spawnada).
export interface ChatTranscript {
  // sessionId INTERNO (sessions.id) ecoado de volta, pra o renderer casar a
  // resposta com a sessão certa.
  sessionId: string
  ccSessionId: string | null
  path: string | null
  mtimeMs: number | null
  messages: ChatMessage[]
}

// Payload do broadcast chat:transcript-update. Emite a LISTA completa reparseada
// a cada mudança do JSONL — simples e robusto a reescritas do arquivo (o renderer
// só substitui o estado). transcriptExists distingue "JSONL ainda não nasceu"
// (sessão recém-spawnada, pré-flush) de "existe mas sem mensagens renderizáveis".
export interface ChatTranscriptUpdate {
  sessionId: string
  transcriptExists: boolean
  messages: ChatMessage[]
}
