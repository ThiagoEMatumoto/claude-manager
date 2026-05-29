import { spawn, IPty } from '@homebridge/node-pty-prebuilt-multiarch'
import { EventEmitter } from 'node:events'
import { existsSync, statSync } from 'node:fs'

export interface SpawnOptions {
  sessionId: string
  command: string
  args?: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  cols?: number
  rows?: number
}

export interface PtyDataEvent {
  sessionId: string
  data: string
}

export interface PtyExitEvent {
  sessionId: string
  exitCode: number
  signal: number | null
}

interface PtyEvents {
  data: (e: PtyDataEvent) => void
  exit: (e: PtyExitEvent) => void
}

class TypedEmitter extends EventEmitter {
  override on<K extends keyof PtyEvents>(event: K, listener: PtyEvents[K]): this {
    return super.on(event, listener)
  }
  override emit<K extends keyof PtyEvents>(event: K, ...args: Parameters<PtyEvents[K]>): boolean {
    return super.emit(event, ...args)
  }
  override off<K extends keyof PtyEvents>(event: K, listener: PtyEvents[K]): this {
    return super.off(event, listener)
  }
}

class PtyManager extends TypedEmitter {
  private ptys = new Map<string, IPty>()

  spawn(opts: SpawnOptions): void {
    if (this.ptys.has(opts.sessionId)) {
      throw new Error(`session ${opts.sessionId} already running`)
    }

    if (!existsSync(opts.cwd) || !statSync(opts.cwd).isDirectory()) {
      throw new Error(`cwd does not exist or is not a directory: ${opts.cwd}`)
    }

    const pty = spawn(opts.command, opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
        ...(opts.env ?? {}),
      },
    })

    this.ptys.set(opts.sessionId, pty)

    pty.onData((data) => {
      this.emit('data', { sessionId: opts.sessionId, data })
    })

    pty.onExit(({ exitCode, signal }) => {
      this.ptys.delete(opts.sessionId)
      this.emit('exit', { sessionId: opts.sessionId, exitCode, signal: signal ?? null })
    })
  }

  write(sessionId: string, data: string): void {
    const pty = this.ptys.get(sessionId)
    if (!pty) throw new Error(`session ${sessionId} not running`)
    pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const pty = this.ptys.get(sessionId)
    if (!pty) return
    pty.resize(cols, rows)
  }

  kill(sessionId: string): void {
    const pty = this.ptys.get(sessionId)
    if (!pty) return
    pty.kill()
  }

  killAll(): void {
    for (const pty of this.ptys.values()) pty.kill()
    this.ptys.clear()
  }

  isRunning(sessionId: string): boolean {
    return this.ptys.has(sessionId)
  }

  runningIds(): string[] {
    return Array.from(this.ptys.keys())
  }
}

export const ptyManager = new PtyManager()
