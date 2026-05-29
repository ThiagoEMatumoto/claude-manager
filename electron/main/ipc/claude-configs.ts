import { ipcMain } from 'electron'
import {
  readAgents,
  readMcps,
  readPlugins,
  readSkills,
} from '../services/claude-config-reader'
import type { ClaudeConfigs } from '../../../shared/types/ipc'

export function registerClaudeConfigsIpc(): void {
  ipcMain.handle('cc:read-configs', async (): Promise<ClaudeConfigs> => {
    const [plugins, agents, skills, mcps] = await Promise.all([
      readPlugins(),
      readAgents(),
      readSkills(),
      readMcps(),
    ])
    return { plugins, agents, skills, mcps }
  })
}
