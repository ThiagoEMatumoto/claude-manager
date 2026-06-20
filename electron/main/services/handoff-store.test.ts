import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations } from './migrations/index'

// Mesmo padrão do repo-dependency-store.test: o store importa getDb de './db'
// (que depende de electron.app); mockamos pra um SQLite in-memory migrado.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))

import * as store from './handoff-store'

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

function seed(db: Database.Database): void {
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1','P1',?,?)`).run(
    Date.now(),
    Date.now(),
  )
  db.prepare(
    `INSERT INTO repos (id, project_id, label, path, position, created_at)
     VALUES ('r1','p1','Repo 1','/tmp/r1',0,?), ('r2','p1','Repo 2','/tmp/r2',1,?)`,
  ).run(Date.now(), Date.now())
}

function newHandoff(targetRepoId = 'r1') {
  return store.create({
    targetRepoId,
    task: 'do thing',
    composedPrompt: 'prompt',
  })
}

describe('handoff-store', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
    seed(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('create + mode', () => {
    it('default mode = interactive quando omitido', () => {
      const h = newHandoff()
      expect(h.mode).toBe('interactive')
      expect(h.currentStep).toBeNull()
      expect(h.stepUpdatedAt).toBeNull()
    })

    it('respeita o mode passado', () => {
      const h = store.create({
        targetRepoId: 'r1',
        task: 't',
        composedPrompt: 'p',
        mode: 'auto-edits',
      })
      expect(h.mode).toBe('auto-edits')
    })
  })

  describe('progress (não-terminal)', () => {
    it('grava current_step só quando running; NÃO vira done', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      const after = store.progress(h.id, 'rodando testes')
      expect(after.status).toBe('running')
      expect(after.currentStep).toBe('rodando testes')
      expect(after.stepUpdatedAt).not.toBeNull()
    })

    it('ignora progress quando NÃO está running (ex.: pending)', () => {
      const h = newHandoff() // pending
      const after = store.progress(h.id, 'cedo demais')
      expect(after.currentStep).toBeNull()
    })
  })

  describe('ask / resume (canal pergunta filha→mãe)', () => {
    it('ask: running → needs_input, grava pergunta + timestamp', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      const after = store.ask(h.id, 'qual versão do node?')
      expect(after.status).toBe('needs_input')
      expect(after.pendingQuestion).toBe('qual versão do node?')
      expect(after.questionAskedAt).not.toBeNull()
    })

    it('ask: NÃO transiciona fora de running (ex.: pending)', () => {
      const h = newHandoff() // pending
      const after = store.ask(h.id, 'cedo demais')
      expect(after.status).toBe('pending')
      expect(after.pendingQuestion).toBeNull()
    })

    it('resume: needs_input → running e limpa a pergunta', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      store.ask(h.id, 'pergunta')
      const after = store.resume(h.id)
      expect(after.status).toBe('running')
      expect(after.pendingQuestion).toBeNull()
      expect(after.questionAskedAt).toBeNull()
    })

    it('resume: idempotente fora de needs_input (running permanece running)', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      const after = store.resume(h.id)
      expect(after.status).toBe('running')
    })

    it('progress após ask: retoma (needs_input → running) e limpa a pergunta', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      store.ask(h.id, 'pergunta')
      const after = store.progress(h.id, 'retomei: rodando testes')
      expect(after.status).toBe('running')
      expect(after.currentStep).toBe('retomei: rodando testes')
      expect(after.pendingQuestion).toBeNull()
    })
  })

  describe('failIfRunning (reconciliação de morte da filha)', () => {
    it('running → failed e retorna o handoff', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      const res = store.failIfRunning(h.id, 'filha morreu')
      expect(res).not.toBeNull()
      expect(res?.status).toBe('failed')
      expect(res?.error).toBe('filha morreu')
    })

    it('NÃO sobrescreve done: retorna null e mantém done', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      store.report(h.id, 'concluído')
      const res = store.failIfRunning(h.id, 'morte tardia')
      expect(res).toBeNull()
      expect(store.get(h.id)?.status).toBe('done')
    })

    it('needs_input → failed (a filha que perguntou e morreu também falha)', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      store.ask(h.id, 'pergunta')
      const res = store.failIfRunning(h.id, 'PTY morreu durante a espera')
      expect(res?.status).toBe('failed')
    })
  })

  describe('getByChildSession', () => {
    it('acha o handoff pela sessão-filha', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child-xyz')
      expect(store.getByChildSession('s-child-xyz')?.id).toBe(h.id)
      expect(store.getByChildSession('inexistente')).toBeNull()
    })
  })

  // Helper: cria uma session-filha viva/morta na tabela sessions e atrela ao
  // handoff (markRunning). Espelha o que o fluxo real faz no spawn da filha.
  function spawnChild(handoffId: string, childSessionId: string, childStatus: string): void {
    testDb
      .prepare(
        `INSERT INTO sessions (id, repo_id, status, started_at) VALUES (?, 'r1', ?, ?)`,
      )
      .run(childSessionId, childStatus, Date.now())
    store.markRunning(handoffId, childSessionId)
  }

  describe('boot sweep (handoffs órfãos do boot anterior)', () => {
    // O sweep vive em db.ts (getDb), acoplado a electron.app; aqui exercemos o
    // MESMO SQL literal contra o testDb pra travar o contrato.
    function bootSweep(): void {
      testDb
        .prepare(
          "UPDATE handoffs SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('running','needs_input')",
        )
        .run('Sessão-filha órfã: app reiniciou sem reconciliar o handoff', Date.now())
    }

    it("running/needs_input → failed; done/rejected/failed permanecem intactos", () => {
      const running = newHandoff('r1')
      store.approve(running.id, {})
      store.markRunning(running.id, 's-run')

      // needs_input também é órfão no boot (a filha que perguntou morreu junto).
      const asking = newHandoff('r1')
      store.approve(asking.id, {})
      store.markRunning(asking.id, 's-ask')
      store.ask(asking.id, 'pergunta órfã')

      const done = newHandoff('r2')
      store.approve(done.id, {})
      store.markRunning(done.id, 's-done')
      store.report(done.id, 'ok')

      const rejected = newHandoff('r1')
      store.reject(rejected.id)

      const failed = newHandoff('r2')
      store.fail(failed.id, 'erro original')

      bootSweep()

      const swept = store.get(running.id)
      expect(swept?.status).toBe('failed')
      expect(swept?.error).toBe('Sessão-filha órfã: app reiniciou sem reconciliar o handoff')
      expect(store.get(asking.id)?.status).toBe('failed')
      expect(store.get(done.id)?.status).toBe('done')
      expect(store.get(rejected.id)?.status).toBe('rejected')
      // Não sobrescreve a mensagem de erro de um failed pré-existente.
      expect(store.get(failed.id)?.status).toBe('failed')
      expect(store.get(failed.id)?.error).toBe('erro original')
    })
  })

  describe('reconcileStuck (self-heal de filha morta em runtime)', () => {
    it('running com filha NÃO-running → failed', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      spawnChild(h.id, 's-dead', 'exited')

      const n = store.reconcileStuck()
      expect(n).toBe(1)
      const after = store.get(h.id)
      expect(after?.status).toBe('failed')
      expect(after?.error).toBe('Sessão-filha encerrada sem reportar conclusão')
    })

    it('running com filha viva (running) → PERMANECE running (guarda de segurança)', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      spawnChild(h.id, 's-alive', 'running')

      const n = store.reconcileStuck()
      expect(n).toBe(0)
      expect(store.get(h.id)?.status).toBe('running')
    })

    it('needs_input com filha VIVA (session running) → PERMANECE needs_input', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      spawnChild(h.id, 's-asking', 'running')
      store.ask(h.id, 'pergunta')

      const n = store.reconcileStuck()
      expect(n).toBe(0)
      expect(store.get(h.id)?.status).toBe('needs_input')
    })

    it('needs_input com filha MORTA (session exited) → failed', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      spawnChild(h.id, 's-dead-ask', 'running')
      store.ask(h.id, 'pergunta')
      // Filha morreu de fato: marca a session como exited.
      testDb.prepare("UPDATE sessions SET status = 'exited' WHERE id = 's-dead-ask'").run()

      const n = store.reconcileStuck()
      expect(n).toBe(1)
      expect(store.get(h.id)?.status).toBe('failed')
    })

    it('running sem filha atrelada (child_session_id NULL) → failed', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      // Sem markRunning: força running diretamente, child_session_id permanece null.
      testDb.prepare("UPDATE handoffs SET status = 'running' WHERE id = ?").run(h.id)

      const n = store.reconcileStuck()
      expect(n).toBe(1)
      expect(store.get(h.id)?.status).toBe('failed')
    })

    it('NÃO toca handoffs em estado terminal (done permanece done)', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      spawnChild(h.id, 's-done', 'exited')
      store.report(h.id, 'concluído')

      const n = store.reconcileStuck()
      expect(n).toBe(0)
      expect(store.get(h.id)?.status).toBe('done')
    })
  })

  describe('findActiveByTarget (dedup por alvo)', () => {
    it('acha handoff ativo pro mesmo repo-alvo', () => {
      const h = newHandoff('r1')
      expect(store.findActiveByTarget('r1')?.id).toBe(h.id)
      expect(store.findActiveByTarget('r2')).toBeNull()
    })

    it('ignora handoffs em estado terminal (done/rejected/failed)', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      store.markRunning(h.id, 's')
      store.report(h.id, 'ok')
      expect(store.findActiveByTarget('r1')).toBeNull()
    })
  })
})
