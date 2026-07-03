import type { PermissionMode } from '../../../shared/types/ipc'

// Opções de modo de permissão da CLI (6 choices). Fonte ÚNICA compartilhada pelo
// SpawnSessionDialog (segmented control exato na criação da sessão) e pelo
// PermissionPill (seletor visível em runtime). 'default' = padrão da própria CLI
// (pergunta tudo), então é o selecionado inicial no spawn.
// Ordem de EXIBIÇÃO espelhando a progressão lógica do ciclo nativo (Shift+Tab):
// default → acceptEdits → plan → auto → bypass → (dontAsk é spawn-only, nunca no
// ciclo). Só display — o jump-loop não depende desta ordem (observa o modo parseado).
export const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Padrão' },
  { value: 'acceptEdits', label: 'Aceitar edições' },
  { value: 'plan', label: 'Plano' },
  { value: 'auto', label: 'Auto' },
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'dontAsk', label: 'Não perguntar' },
]

// Labels curtos pro modo compacto do PermissionPill (painel estreito): mantém o
// valor sempre glanceable (nunca escondido atrás de um menu), só encurtando o
// texto dos modos mais longos ("Aceitar edições", "Não perguntar").
export const PERMISSION_SHORT_LABELS: Record<PermissionMode, string> = {
  default: 'Padrão',
  acceptEdits: 'Edições',
  plan: 'Plano',
  auto: 'Auto',
  bypassPermissions: 'Bypass',
  dontAsk: 'S/ pergunta',
}
