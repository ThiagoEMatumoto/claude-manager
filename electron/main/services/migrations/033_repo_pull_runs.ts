import type Database from 'better-sqlite3'

export const version = 33
export const name = '033_repo_pull_runs'

// Histórico de execuções do auto-pull (Fase 2 do fix de branch). Tabela
// DEDICADA — não reusa job_runs (preso por FK a scheduled_jobs, modela sessões
// Claude Code, não git pull). trigger distingue o cron opt-in ('auto') do
// disparo manual pela UI ('manual'). results_json = snapshot completo do
// PullRepoResult[] (branches por-repo incluso), pra auditar "por que esse repo
// não atualizou" sem reprocessar nada. Timestamps em epoch ms, mesmo padrão de
// job_runs/scheduled_jobs.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE repo_pull_runs (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL CHECK (trigger IN ('auto', 'manual')),
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      repos_total INTEGER NOT NULL,
      pulled INTEGER NOT NULL,
      skipped INTEGER NOT NULL,
      errored INTEGER NOT NULL,
      results_json TEXT NOT NULL
    );
    CREATE INDEX idx_repo_pull_runs_started ON repo_pull_runs(started_at DESC);
  `)
}
