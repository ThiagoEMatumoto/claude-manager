import type Database from 'better-sqlite3'

export const version = 12
export const name = '012_tasks'

// Tarefas (Fase 2). Persistência SQLite-only, mesmo padrão de objectives:
// tags é TEXT JSON; progresso de rollup é calculado em runtime. task_links é
// polimórfico (objective | key_result | feature) — sem FK real em parent_id;
// órfãos são limpos no delete do parent. position REAL p/ ordenação manual
// (inserções entre vizinhos sem renumerar).
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
      priority TEXT CHECK (priority IN ('low','medium','high')),
      due_date INTEGER,
      started_at INTEGER,
      completed_at INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      position REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_tasks_status ON tasks(status);

    CREATE TABLE task_links (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('objective','key_result','feature')),
      parent_id TEXT NOT NULL,
      PRIMARY KEY (task_id, parent_type, parent_id)
    );
    CREATE INDEX idx_task_links_parent ON task_links(parent_type, parent_id);
  `)
}
