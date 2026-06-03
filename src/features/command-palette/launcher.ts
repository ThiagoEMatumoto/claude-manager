import { ccConfigsApi } from '@/lib/ipc'
import type { LauncherItem } from '../../../shared/types/ipc'

// Catálogo de itens lançáveis (skills + slash commands). Fetch fino sobre o IPC;
// a palette decide quando recarregar (ao abrir o modo launcher).
export async function loadLauncherItems(): Promise<LauncherItem[]> {
  try {
    return await ccConfigsApi.listLauncherItems()
  } catch {
    return []
  }
}

// O texto efetivamente injetado no REPL: '/'+name para slash command; o nome da
// skill (que o claude resolve por digitação) para skill.
export function launcherCommandText(item: LauncherItem): string {
  return item.kind === 'command' ? `/${item.name}` : item.name
}
