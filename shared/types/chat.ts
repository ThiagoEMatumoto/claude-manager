// Tipos do Chat View (Fase 5). O backend (F5a) lê/parseia/observa o transcript
// JSONL da sessão e expõe estas formas por IPC; a UI (F5b) as consome.

// Uma pergunta de AskUserQuestion. Espelha input.questions[] do transcript:
// header curto + a pergunta + opções (label em destaque, description abaixo).
export interface ChatQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

// Uma mensagem renderizável do chat. A lista é ORDENADA na ordem do transcript
// (ordem das linhas + ordem dos blocos de content dentro de cada linha). Uma
// única linha assistant/user pode gerar várias mensagens (texto + tool_use, ou
// texto + tool_result).
//
// Os momentos interativos do claude (AskUserQuestion / ExitPlanMode) ganham kinds
// próprios em vez de cair como tool_use/tool_result genéricos. A pergunta/plano
// vem do tool_use (assistant); a resposta/decisão vem do tool_result seguinte
// (user), linkada por forId == id. A UI funde os dois (mostra a opção escolhida /
// o estado de aprovação no mesmo card) e detecta pendência (tool_use sem result).
export type ChatMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  // Bloco de raciocínio (extended thinking). text vazio é descartado no parser;
  // redacted_thinking (criptografado) vira um placeholder. Render colapsável.
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; forId: string; content: string; isError: boolean }
  // Subagente disparado via Task/Agent. Substitui o tool_use genérico quando há
  // dados do subagente (lidos de <dir>/<sessionId>/subagents/agent-*). id = o
  // toolUseId da invocação; turns = resumos de cada turno (assistant) pra expandir.
  | {
      kind: 'subagent'
      id: string
      name: string
      description: string
      turnCount: number
      turns: string[]
    }
  // Linha type:'system' do transcript, CURADA: só subtypes úteis (compactação,
  // erro de API, comando local, info) viram um chip discreto colapsado. O ruído
  // de alto volume (stop_hook_summary, turn_duration, …) é descartado no parser.
  | { kind: 'system'; label: string; detail: string; level: 'info' | 'warning' | 'error' }
  // Resultado de um subagente (tool_result do Task/Agent). Não renderiza sozinho:
  // a UI funde o status (sucesso/erro) no SubagentCard por forId == id.
  | { kind: 'subagent_result'; forId: string; isError: boolean }
  | { kind: 'ask_user_question'; id: string; questions: ChatQuestion[] }
  | { kind: 'ask_user_question_answered'; forId: string; answers: Record<string, string> }
  | { kind: 'exit_plan_mode'; id: string; plan: string; allowedPrompts: string[] | null }
  | { kind: 'plan_decision'; forId: string; approved: boolean }

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
