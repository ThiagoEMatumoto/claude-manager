import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Configuração machine-local da sincronização. NÃO vai pro repo (vive em
// <userData>/sync-config.json). machineId identifica esta máquina nos commits;
// gerado UMA vez e persistido (estável entre leituras).
export interface SyncConfig {
  repoUrl: string | null
  machineId: string
  lastPullAt: number | null
  lastPushAt: number | null
}

function defaultConfigPath(): string {
  return join(app.getPath('userData'), 'sync-config.json')
}

function freshConfig(): SyncConfig {
  return { repoUrl: null, machineId: randomUUID(), lastPullAt: null, lastPushAt: null }
}

// Lê a config (criando uma com machineId novo se ainda não existe). O machineId
// gerado na primeira leitura é persistido imediatamente para ser estável.
// `path` injetável p/ teste; default = <userData>/sync-config.json.
export function readSyncConfig(path: string = defaultConfigPath()): SyncConfig {
  if (!existsSync(path)) {
    const cfg = freshConfig()
    writeSyncConfig(cfg, path)
    return cfg
  }
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as Partial<SyncConfig>
  // Tolera arquivo parcial/antigo: campos ausentes ganham default, machineId
  // ausente é gerado e re-persistido (mantém estabilidade dali pra frente).
  const cfg: SyncConfig = {
    repoUrl: typeof parsed.repoUrl === 'string' ? parsed.repoUrl : null,
    machineId: typeof parsed.machineId === 'string' && parsed.machineId ? parsed.machineId : randomUUID(),
    lastPullAt: typeof parsed.lastPullAt === 'number' ? parsed.lastPullAt : null,
    lastPushAt: typeof parsed.lastPushAt === 'number' ? parsed.lastPushAt : null,
  }
  if (cfg.machineId !== parsed.machineId) writeSyncConfig(cfg, path)
  return cfg
}

export function writeSyncConfig(cfg: SyncConfig, path: string = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}

// Atualiza campos da config preservando os demais (lê → mescla → grava).
export function updateSyncConfig(
  patch: Partial<Omit<SyncConfig, 'machineId'>>,
  path: string = defaultConfigPath(),
): SyncConfig {
  const cfg = readSyncConfig(path)
  const next: SyncConfig = { ...cfg, ...patch }
  writeSyncConfig(next, path)
  return next
}
