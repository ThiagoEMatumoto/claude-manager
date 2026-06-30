import type { PermissionMode } from '../../../shared/types/ipc'

// Opções de modo de permissão da CLI (6 choices). Fonte ÚNICA compartilhada pelo
// SpawnSessionDialog (segmented control exato na criação da sessão) e pelo
// PermissionPill (seletor visível em runtime). 'default' = padrão da própria CLI
// (pergunta tudo), então é o selecionado inicial no spawn.
export const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Padrão' },
  { value: 'plan', label: 'Plano' },
  { value: 'acceptEdits', label: 'Aceitar edições' },
  { value: 'auto', label: 'Auto' },
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'dontAsk', label: 'Não perguntar' },
]
