import type Database from 'better-sqlite3'

export const version = 17
export const name = '017_repo_deps_canvas'

// Posição livre dos repos no canvas do grafo de arquitetura (nullable, sem
// default — repos sem posição são auto-layoutados pelo frontend).
//
// Rebuild de repo_dependencies: o schema original (001_init) tinha PK composta
// (from_repo_id, to_repo_id), o que limitava a UM kind por par. A nova forma
// ganha surrogate id + label + created_at e permite múltiplos kinds por par via
// UNIQUE(from,to,kind). Nenhuma outra tabela faz FK pra repo_dependencies
// (confirmado por grep), então o DROP+RENAME não precisa de disableForeignKeys.
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE repos ADD COLUMN canvas_x REAL;
    ALTER TABLE repos ADD COLUMN canvas_y REAL;

    CREATE TABLE repo_dependencies_new (
      id           TEXT PRIMARY KEY,
      from_repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      to_repo_id   TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL DEFAULT 'custom',
      label        TEXT,
      created_at   INTEGER NOT NULL,
      UNIQUE(from_repo_id, to_repo_id, kind)
    );
  `)

  // Migra as rows antigas, gerando id (randomblob) + created_at (Date.now do JS,
  // roda no main process). kind antigo nullable → COALESCE pro default 'custom'.
  db.prepare(
    `INSERT INTO repo_dependencies_new (id, from_repo_id, to_repo_id, kind, label, created_at)
     SELECT lower(hex(randomblob(16))), from_repo_id, to_repo_id, COALESCE(kind, 'custom'), NULL, ?
       FROM repo_dependencies`,
  ).run(Date.now())

  db.exec(`
    DROP TABLE repo_dependencies;
    ALTER TABLE repo_dependencies_new RENAME TO repo_dependencies;

    CREATE INDEX idx_repo_deps_from ON repo_dependencies(from_repo_id);
    CREATE INDEX idx_repo_deps_to ON repo_dependencies(to_repo_id);
  `)
}
