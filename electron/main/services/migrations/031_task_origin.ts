import type Database from 'better-sqlite3'

export const version = 31
export const name = '031_task_origin'

// origin distingue tasks criadas pelo usuário ('manual', IPC) das auto-criadas
// via MCP (tool task_create, chamada por uma sessão Claude Code) — mesmo
// padrão de 015_feature_origin. source_session_id é reservado pra quando o
// server MCP passar a identificar a sessão chamadora; hoje ele é stateless e
// compartilhado por todas as sessões (electron/main/services/mcp/server.ts),
// então fica NULL.
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE tasks ADD COLUMN source_session_id TEXT;
  `)
}
