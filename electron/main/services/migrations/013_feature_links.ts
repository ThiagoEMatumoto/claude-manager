import type Database from 'better-sqlite3'

export const version = 13
export const name = '013_feature_links'

// Vínculo Feature → Objetivo/KR (Fase 3). Mesmo padrão polimórfico de
// task_links: FK real só em feature_id (CASCADE no delete da feature);
// target_id é polimórfico (objective | key_result) sem FK — órfãos são
// limpos pelo dono do target (ex.: deleteKeyResult em objective-store).
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE feature_links (
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('objective','key_result')),
      target_id TEXT NOT NULL,
      PRIMARY KEY (feature_id, target_type, target_id)
    );
    CREATE INDEX idx_feature_links_target ON feature_links(target_type, target_id);
  `)
}
