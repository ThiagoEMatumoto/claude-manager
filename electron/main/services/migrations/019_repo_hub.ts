import type Database from 'better-sqlite3'

export const version = 19
export const name = '019_repo_hub'

// Flag de repo "hub" na vista de arquitetura: um repo que coordena/conecta os
// demais (work-hub, monorepo, infra, etc). Boolean armazenado como INTEGER 0/1,
// default 0. Nenhuma FK envolvida → não precisa de disableForeignKeys.
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE repos ADD COLUMN is_hub INTEGER NOT NULL DEFAULT 0;
  `)
}
