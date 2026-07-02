import type Database from 'better-sqlite3'

export const version = 27
export const name = '027_repo_remote'

// Origin do git de cada repo: URL do remote (fetch) e branch default. Pré-requisito
// do auto-clone/pull-all — sem a URL não há de onde clonar numa segunda máquina.
// Ambas TEXT nullable (repos blank/local-only ficam null). A URL é
// machine-independent → sincroniza verbatim (NÃO passa pela portabilização
// <CM_ROOT>, que continua só pro `path`). Nenhuma FK envolvida.
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE repos ADD COLUMN remote_url TEXT;
    ALTER TABLE repos ADD COLUMN default_branch TEXT;
  `)
}
