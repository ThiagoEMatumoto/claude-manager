import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Extractor,
  FetchedDocument,
  SearchOpts,
  Snippet,
  SourceProvider,
  Synthesizer,
  Verifier,
} from './dossier-pipeline-types'
import { migrations } from './migrations/index'

// Mesmo padrão do dossier-store.test: o store importa getDb de './db' (acoplado a
// electron.app); mockamos pra um SQLite in-memory migrado.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))

import { DossierPipeline } from './dossier-pipeline'
import {
  StubExtractor,
  StubSourceProvider,
  StubSynthesizer,
  StubVerifier,
} from './dossier-pipeline-stubs'
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
    sourceClasses: ['primary_official', 'vendor_marketing', 'reputable_press'],
  })
}

function makePipeline(provider?: SourceProvider, extra?: { concurrency?: number; fetchTopK?: number }) {
  return new DossierPipeline(store, {
    sourceProvider: provider ?? new StubSourceProvider(),
    extractor: new StubExtractor(),
    verifier: new StubVerifier(),
    synthesizer: new StubSynthesizer(),
    concurrency: extra?.concurrency,
    fetchTopK: extra?.fetchTopK,
  })
}

describe('dossier-pipeline', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  it('happy path: start → gateA → gateB → done com evidence e 5 seções', async () => {
    const dossier = newDossier()
    const pipeline = makePipeline()

    const started = await pipeline.startRun(dossier.id)
    const afterA = await pipeline.approveGateA(started.id)
    expect(afterA.status).toBe('awaiting_gate_b')

    const done = await pipeline.approveGateB(started.id)
    expect(done.status).toBe('done')
    expect(done.finishedAt).not.toBeNull()

    const evidence = store.listEvidence(started.id)
    expect(evidence.length).toBeGreaterThan(0)

    expect(done.summary).toContain('✅ Confirmado')
    expect(done.summary).toContain('⚖️ Contestado')
    expect(done.summary).toContain('• Fonte-única')
    expect(done.summary).toContain('📣 Sinal de mercado')
    expect(done.summary).toContain('🕳️ Lacunas')
  })

  it('gates pausam: awaiting_gate_a com zero sources; depois awaiting_gate_b', async () => {
    const dossier = newDossier()
    const pipeline = makePipeline()

    const started = await pipeline.startRun(dossier.id)
    expect(started.status).toBe('awaiting_gate_a')
    expect(store.listSources(started.id)).toHaveLength(0)
    expect(started.planJson).not.toBeNull()

    const afterA = await pipeline.approveGateA(started.id)
    expect(afterA.status).toBe('awaiting_gate_b')
    expect(store.listSources(started.id).length).toBeGreaterThan(0)
    expect(store.listEvidence(started.id).length).toBeGreaterThan(0)
  })

  it('checkpoint/resume: fetch quebra no meio; resume completa sem re-buscar', async () => {
    const dossier = newDossier()
    // Falha no 1º fetch (simula throttle). search já terá rodado e commitado.
    const provider = new StubSourceProvider({ failOnFetchCall: 1 })
    const pipeline = makePipeline(provider)

    const started = await pipeline.startRun(dossier.id)
    await expect(pipeline.approveGateA(started.id)).rejects.toThrow(/throttled/)

    // search rodou exatamente uma vez antes da quebra.
    expect(provider.searchCalls).toBe(1)
    // checkpoint registrou 'searching' (concluído) mas não 'fetching'.
    const broken = store.getRun(started.id)!
    expect(broken.checkpointJson).toContain('searching')
    expect(broken.checkpointJson).not.toContain('fetching')

    // Resume completa o resto sem re-chamar search.
    const resumed = await pipeline.resumeRun(started.id)
    expect(provider.searchCalls).toBe(1)
    expect(resumed.status).toBe('awaiting_gate_b')
    expect(store.listEvidence(started.id).length).toBeGreaterThan(0)
  })

  it('cap de concorrência: pico de fetch simultâneos ≤ 6', async () => {
    const dossier = store.createDossier({
      title: 't',
      question: 'q',
      sourceClasses: ['primary_official', 'reputable_press', 'forum_ugc', 'vendor_marketing'],
    })

    let inFlight = 0
    let peak = 0
    // Provedor que rastreia chamadas simultâneas de fetch.
    const provider: SourceProvider = {
      async search(query: string, _opts?: SearchOpts): Promise<Snippet[]> {
        // 20 snippets por query → muitos candidatos a fetch.
        return Array.from({ length: 20 }, (_, i) => ({
          url: `https://example.com/${encodeURIComponent(query)}/${i}`,
          sourceClass: 'reputable_press' as const,
          snippet: `s${i}`,
        }))
      },
      async fetch(url: string): Promise<FetchedDocument> {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        const text = 'Alpha statement here. Beta statement here.'
        return {
          url,
          text,
          segments: [
            { anchor: 'char:0', text: 'Alpha statement here.' },
            { anchor: 'char:22', text: 'Beta statement here.' },
          ],
        }
      },
    }

    // fetchTopK alto pra forçar muitos fetches concorrentes; cap default = 6.
    const pipeline = makePipeline(provider, { fetchTopK: 18 })
    const started = await pipeline.startRun(dossier.id)
    await pipeline.approveGateA(started.id)

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(6)
  })

  it('roteamento do verifier: primary → primary_accepted; vendor isolado → single_source', async () => {
    const verifier = new StubVerifier()
    const verdicts = await verifier.verify([
      { id: 'a', claim: 'x', verbatimQuote: 'q', sourceId: 's1', trustTier: 'high' },
      { id: 'b', claim: 'y', verbatimQuote: 'q', sourceId: 's2', trustTier: 'biased' },
      { id: 'c', claim: 'z', verbatimQuote: 'q', sourceId: 's3', trustTier: 'low' },
    ])
    expect(verdicts.get('a')?.state).toBe('primary_accepted')
    expect(verdicts.get('b')?.state).toBe('single_source')
    expect(verdicts.get('c')?.state).toBe('single_source')
  })

  it('verifier em lote: fontes distintas com o mesmo claim → corroborated; negação → contested', async () => {
    const verifier = new StubVerifier()
    const verdicts = await verifier.verify([
      { id: 'a', claim: 'o abandono caiu', verbatimQuote: 'q', sourceId: 's1', trustTier: 'medium' },
      { id: 'b', claim: 'O abandono caiu', verbatimQuote: 'q', sourceId: 's2', trustTier: 'medium' },
      { id: 'c', claim: 'não o abandono caiu', verbatimQuote: 'q', sourceId: 's3', trustTier: 'low' },
      // mesma fonte de 'a': não corrobora nem contradiz.
      { id: 'd', claim: 'o abandono caiu', verbatimQuote: 'q', sourceId: 's1', trustTier: 'medium' },
    ])

    expect(verdicts.get('b')).toEqual({
      state: 'contested',
      corroboratedBy: ['a', 'd'],
      contradictedBy: ['c'],
    })
    expect(verdicts.get('c')?.state).toBe('contested')
    expect(verdicts.get('c')?.contradictedBy).toEqual(['a', 'b', 'd'])
    expect(verdicts.get('a')?.corroboratedBy).not.toContain('d')
  })

  it('persiste corroboração/contradição em evidence_records no Gate B', async () => {
    const dossier = newDossier()
    const pipeline = makePipeline()
    const started = await pipeline.startRun(dossier.id)
    await pipeline.approveGateA(started.id)
    await pipeline.approveGateB(started.id)

    const evidence = store.listEvidence(started.id)
    expect(evidence.length).toBeGreaterThan(0)
    // Sem relação encontrada as colunas ficam nulas — o que importa é que o
    // veredito passou pelo setter e o state saiu de 'unverified'.
    expect(evidence.every((e) => e.state !== 'unverified')).toBe(true)
  })

  // Falha silenciosa: quando um estágio real (claude -p) quebra (rate limit,
  // crédito esgotado, etc.), a run não pode ficar travada pra sempre no status
  // intermediário sem sinal nenhum pro usuário.
  describe('falha de estágio: run termina em failed com error populado', () => {
    it('extractor lança → run failed, error populado, checkpoint sem "extracting"', async () => {
      const dossier = newDossier()
      const throwingExtractor: Extractor = {
        extract: () => Promise.reject(new Error('claude -p exited with code 1 (extractor)')),
      }
      const pipeline = new DossierPipeline(store, {
        sourceProvider: new StubSourceProvider(),
        extractor: throwingExtractor,
        verifier: new StubVerifier(),
        synthesizer: new StubSynthesizer(),
      })

      const started = await pipeline.startRun(dossier.id)
      await expect(pipeline.approveGateA(started.id)).rejects.toThrow(/extractor/)

      const failed = store.getRun(started.id)!
      expect(failed.status).toBe('failed')
      expect(failed.error).toContain('claude -p exited with code 1 (extractor)')
      expect(failed.checkpointJson ?? '').not.toContain('extracting')
    })

    it('verifier lança → run failed, error populado', async () => {
      const dossier = newDossier()
      const throwingVerifier: Verifier = {
        verify: () => Promise.reject(new Error('claude -p rate limited (verifier)')),
      }
      const pipeline = new DossierPipeline(store, {
        sourceProvider: new StubSourceProvider(),
        extractor: new StubExtractor(),
        verifier: throwingVerifier,
        synthesizer: new StubSynthesizer(),
      })

      const started = await pipeline.startRun(dossier.id)
      await pipeline.approveGateA(started.id)
      await expect(pipeline.approveGateB(started.id)).rejects.toThrow(/rate limited/)

      const failed = store.getRun(started.id)!
      expect(failed.status).toBe('failed')
      expect(failed.error).toContain('claude -p rate limited (verifier)')
    })

    it('synthesizer lança → run failed, error populado', async () => {
      const dossier = newDossier()
      const throwingSynthesizer: Synthesizer = {
        synthesize: () => Promise.reject(new Error('claude -p sem crédito (synthesizer)')),
      }
      const pipeline = new DossierPipeline(store, {
        sourceProvider: new StubSourceProvider(),
        extractor: new StubExtractor(),
        verifier: new StubVerifier(),
        synthesizer: throwingSynthesizer,
      })

      const started = await pipeline.startRun(dossier.id)
      await pipeline.approveGateA(started.id)
      await expect(pipeline.approveGateB(started.id)).rejects.toThrow(/sem crédito/)

      const failed = store.getRun(started.id)!
      expect(failed.status).toBe('failed')
      expect(failed.error).toContain('claude -p sem crédito (synthesizer)')
      // summary nunca foi setado — a run não deve parecer 'done'.
      expect(failed.summary).toBeNull()
    })
  })
})
