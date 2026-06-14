import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// NOTA sobre timers: o coordinator usa setTimeout só p/ o debounce próprio, mas
// o pushBundle (dentro do flush) chama simple-git, que TAMBÉM usa setTimeout
// internamente (delay/timeout plugin). Fake timers globais travariam o I/O do
// git → timeout. Por isso usamos timers REAIS com um debounce curto (DEBOUNCE_MS)
// e esperas reais; o comportamento observável (1 push após idle, conflict sem
// force, flush imediato, mutex) é validado de forma determinística.
const DEBOUNCE_MS = 60

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// git-sync → exporter importa electron só como fallback; mockamos minimamente.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { ensureRepo, pushBundle, type GitSyncOpts } from './git-sync'
import { SyncCoordinator, type SyncCoordinatorState } from './coordinator'
import { migrations } from '../migrations/index'

// ---- DB helpers (reuso do padrão da Fase 1/2) ----

function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`)
  const insert = db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)')
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
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
    insert.run(m.version, m.name, Date.now())
  }
}

function newDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function seed(db: Database.Database, marker: string): void {
  const t = 1_700_000_000_000
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at, position) VALUES (?,?,?,?,?)`).run(
    `proj-${marker}`,
    `Projeto ${marker}`,
    t,
    t,
    0,
  )
}

// ---- tmpdir bookkeeping ----

let dirs: string[] = []
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

function makeBareRemote(): string {
  const dir = tmp('cm-coord-bare-')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', dir])
  return `file://${dir}`
}

function exportOpts(featRoot: string): GitSyncOpts {
  return { exportOpts: { featuresRoot: featRoot, exportedAt: 1, appVersion: 'x', machineId: 'test' } }
}

// Recorder dos estados emitidos pelo coordinator + contador de pushes reais.
function recorder() {
  const states: Array<{ state: SyncCoordinatorState; pushedAt?: number; error?: string }> = []
  const onState: ConstructorParameters<typeof SyncCoordinator>[0]['onState'] = (state, info) => {
    states.push({ state, pushedAt: info?.pushedAt, error: info?.error })
  }
  return {
    states,
    onState,
    last: () => states[states.length - 1],
    has: (s: SyncCoordinatorState) => states.some((x) => x.state === s),
  }
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
  vi.restoreAllMocks()
})

describe('SyncCoordinator', () => {
  it('1. N pings em janela < debounce → 1 push só após idle', async () => {
    const url = makeBareRemote()
    const wk = tmp('cm-coord-wk-')
    await ensureRepo(wk, url)
    const db = newDb()
    seed(db, 'A')
    const featRoot = tmp('cm-coord-feat-')
    const rec = recorder()

    const coord = new SyncCoordinator({
      workdir: () => wk,
      getDb: () => db,
      isConfigured: () => true,
      syncOpts: () => exportOpts(featRoot),
      commitMessage: () => 'auto-sync',
      onState: rec.onState,
      debounceMs: DEBOUNCE_MS,
    })

    // 3 pings dentro da janela de debounce (cada um re-arma o timer).
    coord.notifyMutation()
    await sleep(DEBOUNCE_MS / 3)
    coord.notifyMutation()
    await sleep(DEBOUNCE_MS / 3)
    coord.notifyMutation()
    // Ainda não passou o debounce completo desde o último ping → nenhum push.
    expect(rec.has('syncing')).toBe(false)

    // Espera além do debounce a partir do último ping + tempo p/ o push I/O.
    await sleep(DEBOUNCE_MS * 2)
    await vi.waitFor(() => expect(rec.last()?.state).toBe('in-sync'))
    expect(rec.states.filter((s) => s.state === 'syncing')).toHaveLength(1)

    // O bare recebeu UM commit (verificável por clone fresco).
    const verify = tmp('cm-coord-verify-')
    execFileSync('git', ['clone', url, verify])
    const log = execFileSync('git', ['-C', verify, 'log', '--oneline']).toString().trim().split('\n')
    // commit inicial (seed do ensureRepo) + 1 do coordinator.
    expect(log.some((l) => l.includes('auto-sync'))).toBe(true)
    db.close()
  })

  it('2. push rejected → estado vira conflict, sem --force', async () => {
    const url = makeBareRemote()

    // Seed base no remoto.
    const wkSeed = tmp('cm-coord-seed-')
    await ensureRepo(wkSeed, url)
    const dbSeed = newDb()
    seed(dbSeed, 'BASE')
    await pushBundle(wkSeed, dbSeed, 'base', exportOpts(tmp('cm-coord-fs-')))
    dbSeed.close()

    // A e B clonam do MESMO ponto base ANTES de qualquer avanço.
    const wkA = tmp('cm-coord-a-')
    await ensureRepo(wkA, url)
    const wkB = tmp('cm-coord-b-')
    await ensureRepo(wkB, url)

    // A avança e empurra (remote fica à frente de B). A parte do MESMO base
    // (proj-BASE) e só renomeia → conteúdo divergente na mesma row.
    const dbA = newDb()
    seed(dbA, 'BASE')
    dbA.prepare('UPDATE projects SET name = ? WHERE id = ?').run('A-WINS', 'proj-BASE')
    await pushBundle(wkA, dbA, 'A advances', exportOpts(tmp('cm-coord-fa-')))
    dbA.close()

    // B (atrás) tenta auto-push via coordinator → deve ser rejeitado.
    const dbB = newDb()
    seed(dbB, 'BASE')
    dbB.prepare('UPDATE projects SET name = ? WHERE id = ?').run('B-LOSES', 'proj-BASE')
    const rec = recorder()

    const coord = new SyncCoordinator({
      workdir: () => wkB,
      getDb: () => dbB,
      isConfigured: () => true,
      syncOpts: () => exportOpts(tmp('cm-coord-fb-')),
      commitMessage: () => 'B advances',
      onState: rec.onState,
      debounceMs: DEBOUNCE_MS,
    })

    coord.notifyMutation()
    await coord.flush()

    expect(rec.last()?.state).toBe('conflict')

    // O bare manteve a versão de A (B não forçou).
    const verify = tmp('cm-coord-verify-')
    execFileSync('git', ['clone', url, verify])
    const projects = execFileSync('git', [
      '-C',
      verify,
      'show',
      'HEAD:sync-bundle/tables/projects.ndjson',
    ]).toString()
    expect(projects).toContain('A-WINS')
    expect(projects).not.toContain('B-LOSES')
    dbB.close()
  })

  it('3. flush força push imediato pendente (cancela o debounce)', async () => {
    const url = makeBareRemote()
    const wk = tmp('cm-coord-wk-')
    await ensureRepo(wk, url)
    const db = newDb()
    seed(db, 'A')
    const rec = recorder()

    const coord = new SyncCoordinator({
      workdir: () => wk,
      getDb: () => db,
      isConfigured: () => true,
      syncOpts: () => exportOpts(tmp('cm-coord-feat-')),
      commitMessage: () => 'flush-push',
      onState: rec.onState,
      debounceMs: 30_000, // longo de propósito: o flush não espera o debounce.
    })

    coord.notifyMutation()
    // SEM esperar o debounce: flush deve empurrar imediatamente.
    await coord.flush()

    expect(rec.has('syncing')).toBe(true)
    expect(rec.last()?.state).toBe('in-sync')

    const verify = tmp('cm-coord-verify-')
    execFileSync('git', ['clone', url, verify])
    const log = execFileSync('git', ['-C', verify, 'log', '--oneline']).toString()
    expect(log).toContain('flush-push')
    db.close()
  })

  it('4. mutex: não dispara push concorrente (segundo flush espera)', async () => {
    const url = makeBareRemote()
    const wk = tmp('cm-coord-wk-')
    await ensureRepo(wk, url)
    const db = newDb()
    seed(db, 'A')
    const rec = recorder()

    const coord = new SyncCoordinator({
      workdir: () => wk,
      getDb: () => db,
      isConfigured: () => true,
      syncOpts: () => exportOpts(tmp('cm-coord-feat-')),
      commitMessage: () => 'concurrent',
      onState: rec.onState,
      debounceMs: 30_000,
    })

    coord.notifyMutation()
    // Dispara dois flushes "simultâneos": o segundo deve ser no-op pelo mutex
    // (pushing=true) e não gerar um segundo 'syncing'.
    const f1 = coord.flush()
    const f2 = coord.flush()
    await Promise.all([f1, f2])

    expect(rec.states.filter((s) => s.state === 'syncing')).toHaveLength(1)
    expect(rec.last()?.state).toBe('in-sync')
    db.close()
  })

  it('5. notifyMutation no-op quando não configurado', async () => {
    const db = newDb()
    const rec = recorder()
    const coord = new SyncCoordinator({
      workdir: () => tmp('cm-coord-wk-'),
      getDb: () => db,
      isConfigured: () => false,
      syncOpts: () => ({}),
      commitMessage: () => 'noop',
      onState: rec.onState,
      debounceMs: DEBOUNCE_MS,
    })

    coord.notifyMutation()
    await sleep(DEBOUNCE_MS * 2)
    await coord.flush()
    expect(rec.states).toHaveLength(0)
    db.close()
  })
})
