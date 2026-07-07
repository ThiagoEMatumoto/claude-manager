import type Database from 'better-sqlite3'

export const version = 28
export const name = '028_scheduled_jobs'

// Scheduled Jobs (Fase 1). Molde de 012_tasks: persistência SQLite-only. Um job
// dispara periodicamente uma sessão Claude Code num repo-alvo e captura um
// relatório por execução.
//
// scheduled_jobs guarda o SNAPSHOT dos params de spawn (model/effort/
// permission_mode/advisor/prompt/system_prompt) — self-contained, imune a
// mudança de preset depois. `next_run_at` é a FONTE ÚNICA do claim atômico
// (UPDATE ... WHERE next_run_at<=now AND enabled=1). `permission_mode` default
// 'plan' = observe-only (read-only, sem write/commit) por padrão; modo autônomo
// exige opt-in explícito. `schedule` e `disallowed_tools` são JSON em TEXT.
//
// repo_id é TEXT nullable SEM FK (igual a sessions.repo_id): job apontando pra
// repo removido falha visível no spawn, não some silenciosamente. job_runs é o
// histórico por execução; job_id FK → scheduled_jobs ON DELETE CASCADE.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE scheduled_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_id TEXT,
      prompt TEXT NOT NULL,
      system_prompt TEXT,
      schedule TEXT NOT NULL,
      next_run_at INTEGER NOT NULL,
      last_run_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      catch_up INTEGER NOT NULL DEFAULT 0 CHECK (catch_up IN (0, 1)),
      model TEXT,
      effort TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'plan',
      advisor_model TEXT,
      disallowed_tools TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_scheduled_jobs_due ON scheduled_jobs(enabled, next_run_at);

    CREATE TABLE job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'running', 'success', 'failed', 'interrupted', 'missed')),
      started_at INTEGER,
      finished_at INTEGER,
      session_id TEXT,
      cc_session_id TEXT,
      report_text TEXT,
      capture_quality TEXT CHECK (capture_quality IN ('full', 'partial', 'none')),
      tokens INTEGER,
      model TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_job_runs_job ON job_runs(job_id, created_at DESC);
  `)
}
