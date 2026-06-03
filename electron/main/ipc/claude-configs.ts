import { ipcMain } from 'electron'
import {
  readAgents,
  readCommands,
  readHooks,
  readMcps,
  readPlugins,
  readSkills,
} from '../services/claude-config-reader'
import type { ClaudeConfigs, LauncherItem } from '../../../shared/types/ipc'

export function registerClaudeConfigsIpc(): void {
  ipcMain.handle('cc:read-configs', async (): Promise<ClaudeConfigs> => {
    const [plugins, agents, skills, mcps, hooks] = await Promise.all([
      readPlugins(),
      readAgents(),
      readSkills(),
      readMcps(),
      readHooks(),
    ])
    return { plugins, agents, skills, mcps, hooks }
  })

  // Catálogo lançável pela palette: skills + slash commands, cada um com `kind`.
  ipcMain.handle('cc:list-launcher-items', async (): Promise<LauncherItem[]> => {
    const [skills, commands] = await Promise.all([readSkills(), readCommands()])
    const items: LauncherItem[] = [
      ...skills.map<LauncherItem>((s) => ({ ...s, kind: 'skill' })),
      ...commands.map<LauncherItem>((c) => ({ ...c, kind: 'command' })),
    ]
    items.sort((a, b) => a.name.localeCompare(b.name))
    return items
  })
}
