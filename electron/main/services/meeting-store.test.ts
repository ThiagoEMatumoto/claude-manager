import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations } from './migrations/index'

// Mesmo padrão de handoff-store.test: o store importa getDb de './db' (que
// depende de electron.app); mockamos pra um SQLite in-memory migrado.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))

import * as store from './meeting-store'

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

describe('meeting-store', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('create + get', () => {
    it('cria com defaults Granola (status idle, lang pt, started_at vazio)', () => {
      const m = store.create({ title: '  Daily  ' })
      expect(m.title).toBe('Daily')
      // Nasce em rascunho (só notas); a captura é que dispara o início.
      expect(m.status).toBe('idle')
      expect(m.lang).toBe('pt')
      expect(m.startedAt).toBeNull()
      expect(m.endedAt).toBeNull()
      expect(store.get(m.id)?.id).toBe(m.id)
    })

    it('status capturing/recording carimba started_at no create', () => {
      const m = store.create({ title: 'Live', status: 'capturing' })
      expect(m.status).toBe('capturing')
      expect(m.startedAt).not.toBeNull()
    })

    it('respeita status e lang passados', () => {
      const m = store.create({ title: 'X', status: 'ready', lang: 'en', rawNotes: 'oi' })
      expect(m.status).toBe('ready')
      expect(m.lang).toBe('en')
      expect(m.rawNotes).toBe('oi')
      // status não-ativo (nem capturing/recording) não carimba started_at.
      expect(m.startedAt).toBeNull()
    })

    it('get inexistente retorna null', () => {
      expect(store.get('nope')).toBeNull()
    })
  })

  describe('list', () => {
    it('ordena por created_at desc e filtra por status/search', () => {
      const a = store.create({ title: 'Planning', status: 'ready' })
      const b = store.create({ title: 'Retro', rawNotes: 'falamos de bugs' })
      const all = store.list()
      expect(all.map((m) => m.id)).toContain(a.id)
      expect(all.map((m) => m.id)).toContain(b.id)

      expect(store.list({ status: 'ready' }).map((m) => m.id)).toEqual([a.id])
      expect(store.list({ search: 'retro' }).map((m) => m.id)).toEqual([b.id])
      expect(store.list({ search: 'bugs' }).map((m) => m.id)).toEqual([b.id])
    })
  })

  describe('update', () => {
    it('atualiza campos; undefined mantém, null limpa', () => {
      const m = store.create({ title: 'X', rawNotes: 'nota' })
      const u = store.update({ id: m.id, title: 'Y', summary: 'resumo' })
      expect(u.title).toBe('Y')
      expect(u.summary).toBe('resumo')
      // rawNotes omitido = mantém.
      expect(u.rawNotes).toBe('nota')
      const cleared = store.update({ id: m.id, rawNotes: null })
      expect(cleared.rawNotes).toBeNull()
    })

    it('status terminal carimba ended_at', () => {
      const m = store.create({ title: 'X' })
      expect(m.endedAt).toBeNull()
      const done = store.update({ id: m.id, status: 'extracted' })
      expect(done.status).toBe('extracted')
      expect(done.endedAt).not.toBeNull()
    })

    it('lança se a reunião não existe', () => {
      expect(() => store.update({ id: 'nope', title: 'X' })).toThrow(/not found/)
    })
  })

  describe('remove (cascade)', () => {
    it('apaga a reunião e os filhos (segments/speakers/extractions)', () => {
      const m = store.create({ title: 'X' })
      store.appendSegment({ meetingId: m.id, text: 'oi' })
      store.setSpeakerName(m.id, 'SPEAKER_00', 'Thiago')
      store.addExtraction({ meetingId: m.id, type: 'action_item', text: 'fazer Y' })

      store.remove(m.id)
      expect(store.get(m.id)).toBeNull()
      expect(store.listSegments(m.id)).toEqual([])
      expect(store.listSpeakers(m.id)).toEqual([])
      expect(store.listExtractions(m.id)).toEqual([])
    })
  })

  describe('appendSegment + listSegments', () => {
    it('idx auto-incrementa por reunião e ordena por idx', () => {
      const m = store.create({ title: 'X' })
      const s0 = store.appendSegment({ meetingId: m.id, text: 'um', startMs: 0 })
      const s1 = store.appendSegment({ meetingId: m.id, text: 'dois', startMs: 1000, isPartial: true })
      expect(s0.idx).toBe(0)
      expect(s1.idx).toBe(1)
      expect(s1.isPartial).toBe(true)
      const listed = store.listSegments(m.id)
      expect(listed.map((s) => s.text)).toEqual(['um', 'dois'])
    })
  })

  describe('speakers', () => {
    it('setSpeakerName cria e depois faz upsert do display_name', () => {
      const m = store.create({ title: 'X' })
      const first = store.setSpeakerName(m.id, 'SPEAKER_00', 'Thiago')
      expect(first.displayName).toBe('Thiago')
      const second = store.setSpeakerName(m.id, 'SPEAKER_00', 'Thiago E.')
      expect(second.displayName).toBe('Thiago E.')
      expect(store.listSpeakers(m.id)).toHaveLength(1)
    })

    it('registerSpeaker grava is_local_user e é idempotente por label', () => {
      const m = store.create({ title: 'X' })
      const local = store.registerSpeaker(m.id, 'SPEAKER_00', true)
      const other = store.registerSpeaker(m.id, 'SPEAKER_01', false)
      expect(local.isLocalUser).toBe(true)
      expect(other.isLocalUser).toBe(false)
      // Re-emitir o mesmo label só atualiza o flag (sem duplicar a linha).
      const flipped = store.registerSpeaker(m.id, 'SPEAKER_00', false)
      expect(flipped.isLocalUser).toBe(false)
      expect(store.listSpeakers(m.id)).toHaveLength(2)
    })

    it('registerSpeaker e setSpeakerName não pisam um no outro (flag vs nome)', () => {
      const m = store.create({ title: 'X' })
      // diarização registra o flag; rename posterior não zera is_local_user.
      store.registerSpeaker(m.id, 'SPEAKER_00', true)
      const named = store.setSpeakerName(m.id, 'SPEAKER_00', 'Você')
      expect(named.displayName).toBe('Você')
      expect(named.isLocalUser).toBe(true)
      // re-registrar o flag não apaga o display_name.
      const reregistered = store.registerSpeaker(m.id, 'SPEAKER_00', true)
      expect(reregistered.displayName).toBe('Você')
      expect(reregistered.isLocalUser).toBe(true)
    })
  })

  describe('extractions', () => {
    it('addExtraction + listExtractions + markExtractionMaterialized', () => {
      const m = store.create({ title: 'X' })
      const e = store.addExtraction({
        meetingId: m.id,
        type: 'action_item',
        text: 'mandar email',
        quote: 'eu mando o email',
        grounded: true,
      })
      expect(e.grounded).toBe(true)
      expect(e.materializedTaskId).toBeNull()
      expect(store.listExtractions(m.id).map((x) => x.id)).toEqual([e.id])

      const marked = store.markExtractionMaterialized(e.id, 'task-123')
      expect(marked?.materializedTaskId).toBe('task-123')
    })

    it('getExtraction retorna por id (e null se não existe)', () => {
      const m = store.create({ title: 'X' })
      const e = store.addExtraction({ meetingId: m.id, type: 'decision', text: 'migrar' })
      expect(store.getExtraction(e.id)?.id).toBe(e.id)
      expect(store.getExtraction('nope')).toBeNull()
    })

    it('deleteExtractions remove só as NÃO-materializadas (preserva as que viraram task)', () => {
      const m = store.create({ title: 'X' })
      const fresh = store.addExtraction({ meetingId: m.id, type: 'action_item', text: 'pendente' })
      const done = store.addExtraction({ meetingId: m.id, type: 'action_item', text: 'virou task' })
      store.markExtractionMaterialized(done.id, 'task-9')

      store.deleteExtractions(m.id)

      const remaining = store.listExtractions(m.id)
      expect(remaining.map((x) => x.id)).toEqual([done.id])
      expect(store.getExtraction(fresh.id)).toBeNull()
    })

    it('runInTransaction commita as escritas atomicamente', () => {
      const m = store.create({ title: 'X' })
      store.runInTransaction(() => {
        store.addExtraction({ meetingId: m.id, type: 'risk', text: 'risco A' })
        store.addExtraction({ meetingId: m.id, type: 'risk', text: 'risco B' })
      })
      expect(store.listExtractions(m.id)).toHaveLength(2)
    })
  })

  // Espelha o UPDATE idempotente do boot reconcile (index.ts whenReady): num
  // processo fresco nenhum sidecar está vivo, então reuniões em estados "vivos"
  // são órfãs → failed. Testa a SEMÂNTICA da query (o index.ts em si puxa electron
  // e não é unit-testável aqui).
  describe('boot reconcile (estados vivos → failed)', () => {
    const LIVE_RECLAIM_SQL = `UPDATE meetings SET status = 'failed', ended_at = COALESCE(ended_at, ?)
       WHERE status IN ('capturing', 'recording', 'transcribing', 'diarizing')`

    it('marca reuniões presas em estados vivos como failed e carimba ended_at', () => {
      const capturing = store.create({ title: 'Capturando', status: 'capturing' })
      const transcribing = store.create({ title: 'Transcrevendo' })
      store.update({ id: transcribing.id, status: 'transcribing' })
      const idle = store.create({ title: 'Rascunho' })
      const ready = store.create({ title: 'Pronta', status: 'ready' })

      const now = Date.now()
      testDb.prepare(LIVE_RECLAIM_SQL).run(now)

      expect(store.get(capturing.id)?.status).toBe('failed')
      expect(store.get(capturing.id)?.endedAt).not.toBeNull()
      expect(store.get(transcribing.id)?.status).toBe('failed')
      // idle e ready não são tocadas.
      expect(store.get(idle.id)?.status).toBe('idle')
      expect(store.get(ready.id)?.status).toBe('ready')
    })

    it('é idempotente: rodar de novo não muda nada', () => {
      const m = store.create({ title: 'X', status: 'capturing' })
      testDb.prepare(LIVE_RECLAIM_SQL).run(Date.now())
      const first = store.get(m.id)
      testDb.prepare(LIVE_RECLAIM_SQL).run(Date.now())
      const second = store.get(m.id)
      expect(second?.status).toBe('failed')
      expect(second?.endedAt).toBe(first?.endedAt)
    })
  })
})
