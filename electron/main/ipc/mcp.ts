// IPC read-only do MCP server embutido: status pra Settings → Geral. O token
// só sai daqui dentro do addCommand (copiável pelo usuário) — a UI nunca
// persiste nada; a fonte de verdade é o runtime em memória.
import { ipcMain } from 'electron'
import { getMcpRuntime } from '../services/mcp/server'
import type { McpStatus } from '../../../shared/types/ipc'

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:status', (): McpStatus => {
    const runtime = getMcpRuntime()
    if (!runtime) {
      return { running: false, port: null, url: null, addCommand: null }
    }
    return {
      running: true,
      port: runtime.port,
      url: runtime.url,
      addCommand: `claude mcp add --transport http claude-manager ${runtime.url} --header "Authorization: Bearer ${runtime.token}"`,
    }
  })
}
