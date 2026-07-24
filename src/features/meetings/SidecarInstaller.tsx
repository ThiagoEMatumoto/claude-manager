import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/features/brand'
import { meetingsApi } from '@/lib/ipc'

// Botão "Instalar transcrição" + progresso ao vivo do setup-meeting-sidecar.sh.
// Streama o log linha-a-linha (meeting:install:log) e mostra sucesso/erro
// (meeting:install:done). Sem terminal. Em sucesso, chama onInstalled pra
// reavaliar `sidecarConfigured` (a auto-detecção pega o venv recém-criado).

type Phase = 'idle' | 'running' | 'success' | 'error'

const LOG_TAIL = 200

export function SidecarInstaller({ onInstalled }: { onInstalled: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  // Listeners ativos só enquanto a instalação roda — montados antes do invoke.
  useEffect(() => {
    if (phase !== 'running') return
    const offLog = meetingsApi.onInstallLog(({ line }) => {
      setLog((prev) => {
        const next = [...prev, line]
        return next.length > LOG_TAIL ? next.slice(next.length - LOG_TAIL) : next
      })
    })
    const offDone = meetingsApi.onInstallDone(({ ok, error: err }) => {
      if (ok) {
        setPhase('success')
        onInstalled()
      } else {
        setError(err ?? 'A instalação falhou. Veja o log acima.')
        setPhase('error')
      }
    })
    return () => {
      offLog()
      offDone()
    }
  }, [phase, onInstalled])

  // Auto-scroll do log conforme novas linhas chegam.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [log])

  function startInstall() {
    setLog([])
    setError(null)
    setPhase('running')
    void meetingsApi.installSidecar()
  }

  return (
    <div className="mt-2">
      {phase === 'idle' && (
        <Button variant="primary" size="sm" onClick={startInstall}>
          <Icon as={Download} size={13} />
          Instalar transcrição
        </Button>
      )}

      {phase === 'success' && (
        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text)]">
          <Icon as={CheckCircle2} size={14} className="text-[var(--color-accent)]" />
          Transcrição instalada. Pronto para capturar em pt-BR.
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-danger,#ef4444)]">
            <Icon as={XCircle} size={14} />
            {error}
          </div>
          <Button variant="secondary" size="sm" onClick={startInstall}>
            Tentar de novo
          </Button>
        </div>
      )}

      {phase === 'running' && (
        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]">
          <Icon as={Loader2} size={13} className="animate-spin" />
          Instalando transcrição… (pode levar alguns minutos)
        </div>
      )}

      {(phase === 'running' || phase === 'error') && log.length > 0 && (
        <pre className="mt-2 max-h-40 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)]/70 p-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-dim)]">
          {log.join('\n')}
          <div ref={logEndRef} />
        </pre>
      )}
    </div>
  )
}
