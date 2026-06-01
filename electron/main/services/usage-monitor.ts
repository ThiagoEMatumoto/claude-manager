import { BrowserWindow, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageStatus, UsageWindow } from '../../../shared/types/ipc'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_INTERVAL_MS = 60_000
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

async function fetchUsage(): Promise<UsageStatus> {
  const fetchedAt = Date.now()
  const token = await getToken()
  if (!token) return { state: 'no-token', fetchedAt }

  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401 || res.status === 403) {
      return { state: 'unauthorized', fetchedAt }
    }
    if (!res.ok) return { state: 'error', fetchedAt }

    const body = (await res.json()) as { five_hour?: unknown; seven_day?: unknown }
    return {
      state: 'ok',
      fiveHour: mapWindow(body.five_hour),
      sevenDay: mapWindow(body.seven_day),
      fetchedAt,
    }
  } catch {
    return { state: 'error', fetchedAt }
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let lastStatus: UsageStatus | null = null

function broadcast(status: UsageStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('usage:status', status)
  }
}

async function tick(): Promise<void> {
  const status = await fetchUsage()
  lastStatus = status
  broadcast(status)
}

export function startUsageMonitor(): void {
  ipcMain.handle('usage:get', async () => {
    if (lastStatus) return lastStatus
    const status = await fetchUsage()
    lastStatus = status
    return status
  })

  ipcMain.handle('usage:refresh', async () => {
    const status = await fetchUsage()
    lastStatus = status
    broadcast(status)
    return status
  })

  void tick()
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
}

export function stopUsageMonitor(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
