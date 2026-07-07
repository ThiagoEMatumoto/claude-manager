import type { JobRun } from '../../../shared/types/ipc'

// Seam leaf (sem electron) para o "run now" do MCP. A implementação real dispara
// um run pelo mesmo caminho do scheduler (job-scheduler → job-runner → ipc/sessions
// → electron); importá-la estaticamente em tools.ts criaria o ciclo
// tools → job-scheduler → job-runner → ipc/sessions → mcp/server → tools e puxaria
// a cadeia electron pros testes de tools. Mesma motivação do mock de job-runner em
// job-scheduler.test. tools.ts importa SÓ este módulo; o boot registra a impl real.

type RunJobNowFn = (jobId: string) => JobRun

let impl: RunJobNowFn | null = null

// Chamado no load de job-scheduler.ts (composition root via index.ts).
export function setRunJobNow(fn: RunJobNowFn): void {
  impl = fn
}

// Dispara um run imediato do job. Lança se o scheduler ainda não registrou a impl
// (ex.: ambiente de teste que não carrega o scheduler) — falha explícita, não silenciosa.
export function runJobNow(jobId: string): JobRun {
  if (!impl) {
    throw new Error('runJobNow indisponível: o scheduler não foi inicializado')
  }
  return impl(jobId)
}
