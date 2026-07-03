// Opções dos segmented controls de spawn (modelo/esforço/advisor). Fonte ÚNICA
// compartilhada por SpawnSessionDialog (segmented controls no "Nova sessão") e
// SettingsDialog (defaults persistidos) — mesmo padrão que permission-modes.ts
// já usa pro modo de permissão. '' = Padrão/Desligado (sem a flag no spawn).

// 'opusplan' é o alias híbrido nativo da CLI: label "Opus Plan" é a MESMA string
// que o próprio CLI usa internamente (bom pra consistência de vocabulário).
export const MODEL_OPTIONS = [
  { value: '', label: 'Padrão' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'opusplan', label: 'Opus Plan' },
] as const

export const EFFORT_OPTIONS = [
  { value: '', label: 'Padrão' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
] as const

// Advisor tool (--advisor <model>): segunda opinião de um modelo mais forte em
// pontos-chave da sessão. Experimental — só Anthropic API direta.
export const ADVISOR_OPTIONS = [
  { value: '', label: 'Desligado' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'fable', label: 'Fable' },
] as const
