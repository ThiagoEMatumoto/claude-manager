import { getPref } from './prefs-store'

// Variáveis de ambiente customizadas do usuário (Configurações → Variáveis de
// ambiente). Mescladas nos spawns que rodam processos externos (sidecar de
// transcrição, claude -p) para que tokens/hosts/flags do usuário cheguem aos
// subprocessos sem precisar exportá-los no shell que abriu o app GUI.

export const CUSTOM_ENV_VARS_KEY = 'custom_env_vars'

export type CustomEnvVars = Record<string, string>

// Sanitiza o valor lido da pref para um mapa string→string. Tolera JSON
// inválido/shape errado (a pref é editada pela UI, mas defensivo na fronteira):
// ignora chaves vazias e valores não-string.
export function sanitizeCustomEnv(raw: unknown): CustomEnvVars {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CustomEnvVars = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim()
    if (!k || typeof value !== 'string') continue
    out[k] = value
  }
  return out
}

// Lê + sanitiza a pref `custom_env_vars` no momento do spawn (a pref pode mudar
// entre spawns; não cacheamos).
export function readCustomEnv(): CustomEnvVars {
  return sanitizeCustomEnv(getPref<unknown>(CUSTOM_ENV_VARS_KEY, null))
}

// Mescla as vars customizadas DEPOIS da base (process.env): o override do
// usuário tem precedência intencional. Retorna um objeto novo (imutável).
export function mergeCustomEnv(
  base: NodeJS.ProcessEnv,
  custom: CustomEnvVars,
): NodeJS.ProcessEnv {
  return { ...base, ...custom }
}

// Leitura pontual de UMA var por código que roda dentro do main (não spawna
// processo): a pref do usuário tem precedência, com fallback pro ambiente do
// processo. Valor vazio conta como ausente.
export function getEnvVar(key: string): string | undefined {
  return readCustomEnv()[key] || process.env[key] || undefined
}

// Atalho usado nos spawns: base process.env + pref custom (lida agora).
export function spawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return mergeCustomEnv(base, readCustomEnv())
}

export const DISABLE_AUTOCOMPACT_KEY = 'session.disableAutoCompact'

// A CLI só olha a presença da var: setar '0' desabilitaria o auto-compact do
// mesmo jeito, então quando a pref está desligada a chave é omitida.
export function withAutoCompactDisabled(
  base: NodeJS.ProcessEnv,
  disabled: boolean,
): NodeJS.ProcessEnv {
  return disabled ? { ...base, DISABLE_AUTOCOMPACT: '1' } : { ...base }
}

// Env dos spawns de sessão (PTY do `claude`). O custom env do usuário entra por
// último e pode sobrescrever a var.
export function sessionSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const withFlag = withAutoCompactDisabled(base, getPref<boolean>(DISABLE_AUTOCOMPACT_KEY, false))
  return mergeCustomEnv(withFlag, readCustomEnv())
}
