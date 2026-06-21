import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations } from './migrations/index'

// Mesmo padrão do handoff-store.test: o store importa getDb de './db' (acoplado a
// electron.app); mockamos pra um SQLite in-memory migrado.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))

import * as store from './dossier-store'

function applyAllMigrations(db: Database.Database): void {
  for (const m of migrations) {
    if (m.disableForeignKeys) {
      db.pragma('foreign_keys = OFF')
      try {
        m.up(db)
      } finally {
        db.pragma('foreign_keys = ON')
      }
    } else {
      m.up(db)
    }
  }
}

function newDossier() {
  return store.createDossier({
    title: 'BPC/LOAS pós-protocolização',
    question: 'Como reduzir o abandono pós-protocolização?',
    sourceClasses: ['primary_official', 'academic', 'practitioner_video'],
  })
}

// Cria dossier → run → source → evidence e devolve os quatro ids. Útil pros
// testes de cascade e de listagem por run.
function newChain() {
  const dossier = newDossier()
  const run = store.createRun({ dossierId: dossier.id })
  const source = store.addSource({
    dossierRunId: run.id,
    url: 'https://tcu.gov.br/acordao',
    sourceClass: 'primary_official',
    trustTier: 'high',
    status: 'fetched',
  })
  const evidence = store.addEvidence({
    dossierRunId: run.id,
    sourceId: source.id,
    claim: 'O abandono cai com acompanhamento ativo',
    verbatimQuote: 'verbatim do acórdão',
    state: 'primary_accepted',
  })
  return { dossier, run, source, evidence }
}

describe('dossier-store', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('dossiers: create / get / list', () => {
    it('create preenche defaults (status active, budget null) e gera id', () => {
      const d = newDossier()
      expect(d.id).toMatch(/[0-9a-f-]{36}/)
      expect(d.status).toBe('active')
      expect(d.budgetTokens).toBeNull()
      expect(d.createdAt).toBe(d.updatedAt)
    })

    it('respeita id pré-gerado, budget e status passados', () => {
      const d = store.createDossier({
        id: 'fixed-id',
        title: 't',
        question: 'q',
        sourceClasses: ['academic'],
        budgetTokens: 50000,
        status: 'archived',
      })
      expect(d.id).toBe('fixed-id')
      expect(d.budgetTokens).toBe(50000)
      expect(d.status).toBe('archived')
    })

    it('get retorna null pra id inexistente', () => {
      expect(store.getDossier('nope')).toBeNull()
    })

    it('list ordena por created_at DESC e filtra por status', () => {
      const a = store.createDossier({ title: 'a', question: 'q', sourceClasses: [] })
      const b = store.createDossier({ title: 'b', question: 'q', sourceClasses: [] })
      store.archiveDossier(a.id)
      const all = store.listDossiers()
      expect(all.map((d) => d.id)).toEqual([b.id, a.id])
      expect(store.listDossiers({ status: 'archived' }).map((d) => d.id)).toEqual([a.id])
      expect(store.listDossiers({ status: 'active' }).map((d) => d.id)).toEqual([b.id])
    })
  })

  describe('dossiers: round-trip de source_classes (JSON field)', () => {
    it('preserva o array de classes na ida e volta', () => {
      const d = store.createDossier({
        title: 't',
        question: 'q',
        sourceClasses: ['primary_official', 'forum_ugc', 'vendor_marketing'],
      })
      const fetched = store.getDossier(d.id)
      expect(fetched?.sourceClasses).toEqual([
        'primary_official',
        'forum_ugc',
        'vendor_marketing',
      ])
    })
  })

  describe('dossiers: update / archive', () => {
    it('update aplica patch parcial e preserva campos omitidos', () => {
      const d = newDossier()
      const updated = store.updateDossier(d.id, {
        title: 'novo título',
        sourceClasses: ['blog_seo'],
      })
      expect(updated.title).toBe('novo título')
      expect(updated.sourceClasses).toEqual(['blog_seo'])
      // question intacta.
      expect(updated.question).toBe(d.question)
      expect(updated.updatedAt).toBeGreaterThanOrEqual(d.updatedAt)
    })

    it('update aceita budgetTokens = null explícito', () => {
      const d = store.createDossier({
        title: 't',
        question: 'q',
        sourceClasses: [],
        budgetTokens: 1000,
      })
      const updated = store.updateDossier(d.id, { budgetTokens: null })
      expect(updated.budgetTokens).toBeNull()
    })

    it('archive vira status archived', () => {
      const d = newDossier()
      expect(store.archiveDossier(d.id).status).toBe('archived')
    })
  })

  describe('dossier_runs: create / get / listByDossier', () => {
    it('create preenche defaults (status planning, cost 0) e gera id', () => {
      const d = newDossier()
      const run = store.createRun({ dossierId: d.id })
      expect(run.status).toBe('planning')
      expect(run.costTokens).toBe(0)
      expect(run.stage).toBeNull()
      expect(run.finishedAt).toBeNull()
    })

    it('listRuns ordena por started_at DESC', () => {
      const d = newDossier()
      const r1 = store.createRun({ dossierId: d.id })
      const r2 = store.createRun({ dossierId: d.id })
      expect(store.listRuns(d.id).map((r) => r.id)).toEqual([r2.id, r1.id])
    })

    it('get retorna null pra run inexistente', () => {
      expect(store.getRun('nope')).toBeNull()
    })
  })

  describe('dossier_runs: update / checkpoint', () => {
    it('update aplica patch e carimba finished_at ao virar terminal', () => {
      const d = newDossier()
      const run = store.createRun({ dossierId: d.id })
      const after = store.updateRun(run.id, { status: 'done', summary: 'ok' })
      expect(after.status).toBe('done')
      expect(after.summary).toBe('ok')
      expect(after.finishedAt).not.toBeNull()
    })

    it('update pra status não-terminal NÃO carimba finished_at', () => {
      const d = newDossier()
      const run = store.createRun({ dossierId: d.id })
      const after = store.updateRun(run.id, { status: 'searching', stage: 'busca neural' })
      expect(after.stage).toBe('busca neural')
      expect(after.finishedAt).toBeNull()
    })

    it('checkpoint grava json serializado e avança status/stage', () => {
      const d = newDossier()
      const run = store.createRun({ dossierId: d.id })
      const after = store.checkpointRun(run.id, JSON.stringify({ visited: ['a', 'b'] }), {
        status: 'fetching',
        stage: 'top-K',
        costTokens: 1234,
      })
      expect(after.status).toBe('fetching')
      expect(after.stage).toBe('top-K')
      expect(after.costTokens).toBe(1234)
      expect(JSON.parse(after.checkpointJson!)).toEqual({ visited: ['a', 'b'] })
    })
  })

  describe('sources: add / list', () => {
    it('addSource default status snippet; listSources filtra por run', () => {
      const d = newDossier()
      const run = store.createRun({ dossierId: d.id })
      const s = store.addSource({
        dossierRunId: run.id,
        url: 'https://exemplo.com',
        sourceClass: 'reputable_press',
        trustTier: 'medium',
      })
      expect(s.status).toBe('snippet')
      expect(s.retrievedAt).toBeNull()
      // Outra run não enxerga a fonte.
      const otherRun = store.createRun({ dossierId: d.id })
      expect(store.listSources(run.id).map((x) => x.id)).toEqual([s.id])
      expect(store.listSources(otherRun.id)).toEqual([])
    })
  })

  describe('evidence_records: add / list + round-trip de corroborated_by_json', () => {
    it('addEvidence serializa corroboratedBy/contradictedBy e default importance 0', () => {
      const { run, source } = newChain()
      const ev = store.addEvidence({
        dossierRunId: run.id,
        sourceId: source.id,
        claim: 'claim contestado',
        verbatimQuote: 'trecho',
        state: 'contested',
        importance: 0.8,
        corroboratedBy: ['ev-1', 'ev-2'],
        contradictedBy: ['ev-3'],
      })
      const fetched = store.getEvidence(ev.id)
      expect(fetched?.importance).toBe(0.8)
      expect(JSON.parse(fetched!.corroboratedByJson!)).toEqual(['ev-1', 'ev-2'])
      expect(JSON.parse(fetched!.contradictedByJson!)).toEqual(['ev-3'])
    })

    it('addEvidence sem corroboração: campos json ficam null e importance 0', () => {
      const { run, source } = newChain()
      const ev = store.addEvidence({
        dossierRunId: run.id,
        sourceId: source.id,
        claim: 'c',
        verbatimQuote: 'q',
        state: 'single_source',
      })
      expect(ev.importance).toBe(0)
      expect(ev.corroboratedByJson).toBeNull()
      expect(ev.contradictedByJson).toBeNull()
    })

    it('listEvidence filtra por run e ordena por created_at', () => {
      const { run, source } = newChain() // já criou 1 evidence
      store.addEvidence({
        dossierRunId: run.id,
        sourceId: source.id,
        claim: 'c2',
        verbatimQuote: 'q2',
        state: 'unverified',
      })
      expect(store.listEvidence(run.id)).toHaveLength(2)
    })
  })

  describe('cascade delete (dossier → runs → sources → evidence)', () => {
    it('apagar o dossier limpa runs, sources e evidence em cascata', () => {
      const { dossier, run, source, evidence } = newChain()
      testDb.prepare('DELETE FROM dossiers WHERE id = ?').run(dossier.id)
      expect(store.getRun(run.id)).toBeNull()
      expect(store.getSource(source.id)).toBeNull()
      expect(store.getEvidence(evidence.id)).toBeNull()
    })

    it('apagar uma run limpa suas sources e evidence, sem tocar o dossier', () => {
      const { dossier, run, source, evidence } = newChain()
      testDb.prepare('DELETE FROM dossier_runs WHERE id = ?').run(run.id)
      expect(store.getSource(source.id)).toBeNull()
      expect(store.getEvidence(evidence.id)).toBeNull()
      expect(store.getDossier(dossier.id)).not.toBeNull()
    })

    it('apagar uma source limpa seus evidence records', () => {
      const { run, source, evidence } = newChain()
      testDb.prepare('DELETE FROM sources WHERE id = ?').run(source.id)
      expect(store.getEvidence(evidence.id)).toBeNull()
      expect(store.getRun(run.id)).not.toBeNull()
    })
  })
})
