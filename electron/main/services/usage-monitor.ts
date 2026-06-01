import { BrowserWindow, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageStatus, UsageWindow } from '../../../shared/types/ipc'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_INTERVAL_MS = 60_000
// Intervalo mínimo entre requisições reais. usage:get/refresh e o caminho de
// foco da janela reusam o último status se a última chamada foi mais recente.
const MIN_INTERVAL_MS = 60_000
// Teto do backoff exponencial em resposta a 429 (api/oauth/usage é rate-limited
// por frequência, então recuamos progressivamente em vez de martelar o endpoint).
const BACKOFF_MAX_MS = 15 * 60_000
const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json')

// Re-lê o arquivo a cada chamada: o Claude Code renova o accessToken in-place,
// então cachear o token levaria a 401 silencioso quando ele rotaciona.
async function getToken(): Promise<string | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } }
    const token = parsed.claudeAiOauth?.accessToken
    return typeof token === 'string' && token.length > 0 ? token : null
  } catch {
    return null
  }
}

function mapWindow(raw: unknown): UsageWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const w = raw as { utilization?: unknown; resets_at?: unknown }
  if (typeof w.utilization !== 'number' || typeof w.resets_at !== 'string') return undefined
  return { utilization: w.utilization, resetsAt: w.resets_at }
}

let timer: ReturnType<typeof setTimeout> | null = null
let lastStatus: UsageStatus | null = null
let lastGoodStatus: UsageStatus | null = null
let lastFetchAt = 0
let backoffMs = 0
// Lê Retry-After (segundos) na resposta 429; null se ausente ou inválido.
let pendingRetryAfterMs: number | null = null

// Anexa os últimos fiveHour/sevenDay conhecidos a um status degradado, marcando
// stale. Sem dados prévios, o status fica como veio (sem valores).
function withLastGood(status: UsageStatus): UsageStatus {
  if (!lastGoodStatus) return status
  return {
    ...status,
    fiveHour: lastGoodStatus.fiveHour,
    sevenDay: lastGoodStatus.sevenDay,
    stale: true,
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds * 1000
}

async function fetchUsage(): Promise<UsageStatus> {
  const fetchedAt = Date.now()
  pendingRetryAfterMs = null
  const token = await getToken()
  if (!token) return { state: 'no-token', fetchedAt }

  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401 || res.status === 403) {
      return { state: 'unauthorized', fetchedAt }
    }
    if (res.status === 429) {
      pendingRetryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
      return withLastGood({ state: 'rate-limited', fetchedAt })
    }
    if (!res.ok) return withLastGood({ state: 'error', fetchedAt })

    const body = (await res.json()) as { five_hour?: unknown; seven_day?: unknown }
    return {
      state: 'ok',
      fiveHour: mapWindow(body.five_hour),
      sevenDay: mapWindow(body.seven_day),
      fetchedAt,
    }
  } catch {
    return withLastGood({ state: 'error', fetchedAt })
  }
}

function broadcast(status: UsageStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('usage:status', status)
  }
}

function scheduleNext(): void {
  let delay = POLL_INTERVAL_MS
  if (pendingRetryAfterMs !== null) {
    delay = pendingRetryAfterMs
  } else if (backoffMs > 0) {
    delay = backoffMs
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void tick(), delay)
}

async function tick(): Promise<void> {
  lastFetchAt = Date.now()
  const status = await fetchUsage()
  lastStatus = status

  if (status.state === 'ok') {
    lastGoodStatus = status
    backoffMs = 0
  } else if (status.state === 'rate-limited') {
    // Sem Retry-After, dobra o backoff a partir de 2min até o teto.
    if (pendingRetryAfterMs === null) {
      backoffMs = backoffMs === 0 ? 2 * 60_000 : Math.min(backoffMs * 2, BACKOFF_MAX_MS)
    }
  }

  broadcast(status)
  scheduleNext()
}

// Reusa lastStatus se a última requisição real foi recente; só dispara fetch
// novo quando passou MIN_INTERVAL (force ignora o throttle, mas não é usado no
// caminho de foco da janela).
async function maybeFetch(force = false): Promise<UsageStatus> {
  const recent = Date.now() - lastFetchAt < MIN_INTERVAL_MS
  if (!force && recent && lastStatus) return lastStatus
  await tick()
  return lastStatus as UsageStatus
}

export function startUsageMonitor(): void {
  ipcMain.handle('usage:get', async () => {
    if (lastStatus) return lastStatus
    return maybeFetch()
  })

  ipcMain.handle('usage:refresh', async () => {
    return maybeFetch()
  })

  void tick()
}

export function stopUsageMonitor(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
