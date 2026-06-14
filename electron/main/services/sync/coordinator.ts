import type Database from 'better-sqlite3'
import { pushBundle, type GitSyncOpts, type PushResult } from './git-sync'

// Estado do coordinator, espelhado em sync:status (sobrevive a reabrir o dialog).
//  - idle        — sem repo configurado / nada a fazer.
//  - syncing     — push em andamento.
//  - in-sync     — último push concluído sem mudança a empurrar.
//  - conflict    — push recusado por non-fast-forward (NÃO forçamos).
//  - stale       — erro não-fatal (offline). Tenta de novo no próximo idle.
export type SyncCoordinatorState = 'idle' | 'syncing' | 'in-sync' | 'conflict' | 'stale'

export interface SyncCoordinatorDeps {
  // workdir do clone (default <userData>/sync na produção).
  workdir: () => string
  // Conexão única do DB. Lida no momento do push (não no construtor).
  getDb: () => Database.Database
  // true só quando há repoUrl + .git no workdir (não dispara antes da config).
  isConfigured: () => boolean
  // Opções de auth/export repassadas ao pushBundle.
  authOpts: () => GitSyncOpts
  // Mensagem de commit (inclui machineId + timestamp).
  commitMessage: () => string
  // Callback de transição de estado (atualiza lastSyncState do IPC + lastPushAt).
  onState: (state: SyncCoordinatorState, info?: { error?: string; pushedAt?: number }) => void
  // Debounce de quiescência em ms (default 30s; injetável p/ teste).
  debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 30_000

// Coordena o auto-sync on-idle: recebe pings de mutação, faz debounce de
// quiescência e então exporta+empurra o bundle. Mutex de um push por vez;
// flush no quit força o push pendente imediatamente (bounded pelo caller).
export class SyncCoordinator {
  private readonly deps: SyncCoordinatorDeps
  private readonly debounceMs: number
  private timer: NodeJS.Timeout | null = null
  // Há mutação não-empurrada aguardando (ping recebido desde o último push).
  private dirty = false
  // Mutex: um push de cada vez. Pings durante o push re-armam o debounce depois.
  private pushing = false

  constructor(deps: SyncCoordinatorDeps) {
    this.deps = deps
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  // Ping de mutação de uma entidade sincronizada. Re-arma o debounce; o push só
  // dispara após `debounceMs` sem novos pings (quiescência). No-op se não houver
  // repo configurado (nada a sincronizar).
  notifyMutation(): void {
    if (!this.deps.isConfigured()) return
    this.dirty = true
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flushInternal()
    }, this.debounceMs)
  }

  // Flush best-effort: empurra o estado pendente AGORA (cancela o debounce).
  // Usado pelo before-quit. Resolve mesmo em erro (não-fatal). Se já há um push
  // em andamento, aguarda-o e empurra o que ainda estiver pendente.
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flushInternal()
  }

  // Núcleo: respeita o mutex; só empurra se dirty + configurado. Não-fatal.
  private async flushInternal(): Promise<void> {
    if (this.pushing) return // mutex: o push em curso reavalia dirty ao final
    if (!this.dirty) return
    if (!this.deps.isConfigured()) {
      this.dirty = false
      return
    }

    this.pushing = true
    // Captura o flag e zera ANTES do await: pings concorrentes re-marcam dirty
    // e re-disparam o debounce após o push (não se perdem).
    this.dirty = false
    this.deps.onState('syncing')

    let result: PushResult | null = null
    let error: string | null = null
    try {
      result = await pushBundle(
        this.deps.workdir(),
        this.deps.getDb(),
        this.deps.commitMessage(),
        this.deps.authOpts(),
      )
    } catch (err) {
      error = String((err as Error)?.message ?? err)
    } finally {
      this.pushing = false
    }

    if (error) {
      // Offline / erro de transporte → stale; o ping ficou marcado de novo se
      // algo chegou durante o push, senão re-marcamos para tentar no próximo idle.
      this.dirty = true
      this.deps.onState('stale', { error })
      return
    }

    if (result?.rejected) {
      // non-fast-forward: NÃO forçamos. Estado conflito até o usuário resolver na UI.
      this.deps.onState('conflict')
      return
    }

    this.deps.onState('in-sync', { pushedAt: result?.pushed ? Date.now() : undefined })

    // Se chegaram pings durante o push, re-agenda (não força imediato).
    if (this.dirty) this.schedule()
  }

  // Para o timer (no shutdown, após o flush). Não dispara push.
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
