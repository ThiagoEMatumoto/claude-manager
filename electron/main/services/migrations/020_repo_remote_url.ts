import type Database from 'better-sqlite3'

export const version = 20
export const name = '020_repo_remote_url'

// URL do remote `origin` do repo, capturada na exportação (quando o diretório
// existe no disco). Persistir na própria linha faz o dump SELECT * do sync
// carregar a URL entre máquinas, permitindo restaurar (clonar) o diretório no
// path exato quando ele some pós-migração/sync. Nullable, sem default: repos sem
// origin conhecido ficam NULL. Nenhuma FK envolvida → sem disableForeignKeys.
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE repos ADD COLUMN remote_url TEXT;
  `)
}
