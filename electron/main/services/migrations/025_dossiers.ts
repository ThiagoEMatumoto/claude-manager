import type Database from 'better-sqlite3'

export const version = 22
export const name = '022_dossiers'

// Research Dossier: pesquisa profunda com proveniência em nível de trecho.
//
// Hierarquia: dossiers (a pergunta persistente) → dossier_runs (cada execução do
// funil) → sources (fontes ingeridas naquela run) → evidence_records (cada claim
// atômico amarrado a fonte + verbatim + anchor). Todas as FKs descem com CASCADE:
// apagar um dossier limpa runs→sources→evidence em cascata. Os campos *_json
// guardam estruturas serializadas (arrays/objetos) que o store faz parse/stringify
// na fronteira (source_classes, plan_json, checkpoint_json, corroborated_by_json,
// contradicted_by_json). Timestamps em ms (Date.now()), espelhando handoffs.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE dossiers (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      question      TEXT NOT NULL,
      source_classes TEXT NOT NULL,
      budget_tokens INTEGER,
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE dossier_runs (
      id              TEXT PRIMARY KEY,
      dossier_id      TEXT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      status          TEXT NOT NULL,
      stage           TEXT,
      plan_json       TEXT,
      checkpoint_json TEXT,
      cost_tokens     INTEGER NOT NULL DEFAULT 0,
      summary         TEXT,
      error           TEXT,
      started_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      finished_at     INTEGER
    );

    CREATE TABLE sources (
      id              TEXT PRIMARY KEY,
      dossier_run_id  TEXT NOT NULL REFERENCES dossier_runs(id) ON DELETE CASCADE,
      url             TEXT NOT NULL,
      title           TEXT,
      publisher       TEXT,
      source_class    TEXT NOT NULL,
      trust_tier      TEXT NOT NULL,
      retrieved_at    INTEGER,
      content_ref     TEXT,
      status          TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE evidence_records (
      id                  TEXT PRIMARY KEY,
      dossier_run_id      TEXT NOT NULL REFERENCES dossier_runs(id) ON DELETE CASCADE,
      source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      claim               TEXT NOT NULL,
      verbatim_quote      TEXT NOT NULL,
      anchor              TEXT,
      state               TEXT NOT NULL,
      importance          REAL NOT NULL DEFAULT 0,
      corroborated_by_json TEXT,
      contradicted_by_json TEXT,
      created_at          INTEGER NOT NULL
    );

    CREATE INDEX idx_dossier_runs_dossier ON dossier_runs(dossier_id);
    CREATE INDEX idx_sources_run ON sources(dossier_run_id);
    CREATE INDEX idx_evidence_run ON evidence_records(dossier_run_id);
    CREATE INDEX idx_evidence_source ON evidence_records(source_id);
  `)
}
