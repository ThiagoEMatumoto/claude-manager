// Whitelists e resolução das flags de spawn do claude — módulo PURO (sem electron,
// sem I/O). Fonte ÚNICA compartilhada entre o spawn interativo (ipc/sessions, via
// PTY) e o job-runner headless (`claude -p`). Extrair aqui garante que o denylist
// destrutivo (guard-rail de modo autônomo) NÃO drife entre os dois caminhos: um
// job autônomo rodando sem supervisão é blast radius pior que a sessão interativa.

// Whitelist do --model: o valor vem do renderer/preset, mas o main re-valida —
// nada fora desta lista chega à linha de comando. 'opusplan' é o alias híbrido
// nativo da CLI (Opus no plan mode, Sonnet na execução).
export const SPAWN_MODEL_WHITELIST = new Set(['opus', 'sonnet', 'haiku', 'opusplan'])

// Whitelist do --effort: espelha a defesa-em-profundidade do --model.
export const SPAWN_EFFORT_WHITELIST = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

// Whitelist do --advisor: feature experimental (só Anthropic API direta). Se o CLI
// rejeitar em runtime, a sessão/job falha visível — mesmo tratamento de outras flags.
export const SPAWN_ADVISOR_WHITELIST = new Set(['opus', 'sonnet', 'fable'])

// Whitelist do --permission-mode: TODOS os choices da CLI claude. O main é a
// autoridade — valor fora desta lista vira null (= sem flag = default do claude).
export const SPAWN_PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'dontAsk',
] as const
const SPAWN_PERMISSION_MODE_WHITELIST = new Set<string>(SPAWN_PERMISSION_MODES)

// Modos autônomos (editam/agem sem confirmar cada ação) que recebem o denylist
// destrutivo como guard-rail. plan é read-only e default pergunta tudo.
const AUTONOMOUS_PERMISSION_MODES = new Set<string>(['acceptEdits', 'auto', 'bypassPermissions'])

// Denylist destrutivo canônico (defense-in-depth) aplicado SEMPRE que a sessão/job
// sobe em modo autônomo. Bloqueia as ops irreversíveis das regras do usuário.
export const DESTRUCTIVE_DENYLIST = [
  'Bash(rm:*)',
  'Bash(git push:*)',
  'Bash(git reset --hard:*)',
  'Bash(git push --force:*)',
  'Bash(git push -f:*)',
  'Bash(git clean:*)',
]

// Valida o modo de permissão contra a whitelist. Retorna o modo se válido, senão
// null (= sem flag = default do claude).
export function resolvePermissionMode(value: string | null | undefined): string | null {
  return value && SPAWN_PERMISSION_MODE_WHITELIST.has(value) ? value : null
}

// Monta o denylist final do spawn. Mescla o denylist destrutivo canônico quando o
// modo é autônomo (o renderer/job não pode enfraquecê-lo); senão devolve só o
// denylist do renderer (ou null se vazio). Filtra specs não-string/vazios.
export function resolveDisallowedTools(
  permissionMode: string | null,
  rendererDeny: readonly unknown[] | null | undefined,
): string[] | null {
  const deny = (rendererDeny ?? []).filter(
    (t): t is string => typeof t === 'string' && t.length > 0,
  )
  if (permissionMode && AUTONOMOUS_PERMISSION_MODES.has(permissionMode)) {
    return Array.from(new Set([...deny, ...DESTRUCTIVE_DENYLIST]))
  }
  return deny.length > 0 ? deny : null
}

// Valida o --model contra a whitelist. Retorna o valor ou null (= sem flag).
export function resolveModel(value: string | null | undefined): string | null {
  return value && SPAWN_MODEL_WHITELIST.has(value) ? value : null
}

// Valida o --effort contra a whitelist. Retorna o valor ou null (= sem flag).
export function resolveEffort(value: string | null | undefined): string | null {
  return value && SPAWN_EFFORT_WHITELIST.has(value) ? value : null
}

// Valida o --advisor contra a whitelist. Retorna o valor ou null (= sem flag).
export function resolveAdvisor(value: string | null | undefined): string | null {
  return value && SPAWN_ADVISOR_WHITELIST.has(value) ? value : null
}
