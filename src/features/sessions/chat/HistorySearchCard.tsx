import { History } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

interface Props {
  query: string
  noMatch: boolean
  // Só Esc tem evidência de aceite (cancela). Ciclar/aceitar um match (Enter
  // vs Tab) NÃO foi reproduzido ao vivo — GAP documentado no parser, não
  // oferecido aqui (fail-closed).
  onCancel?: () => void
  sent?: boolean
}

// Busca de histórico (Ctrl+R): inline no rodapé, não é uma caixa modal. Só
// reconhecemos abrir (com/sem match) e cancelar — aceitar um resultado exige
// ciclar (Tab?) e confirmar (Enter?), sem evidência de qual tecla faz o quê.
export function HistorySearchCard({ query, noMatch, onCancel, sent }: Props) {
  const clickable = onCancel != null && !sent
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/40 text-sm">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        <Icon as={History} size={14} className="shrink-0 text-[var(--color-text-dim)]" />
        <span className="font-medium text-[var(--color-text)]">Busca no histórico de prompts</span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="text-[var(--color-text)]">
          {noMatch ? (
            <>
              Nenhum prompt encontrado para <span className="font-mono">{query || '(vazio)'}</span>
            </>
          ) : query ? (
            <>
              Buscando por <span className="font-mono">{query}</span>…
            </>
          ) : (
            'Digite no terminal pra buscar no histórico de prompts enviados.'
          )}
        </div>
        <button
          type="button"
          disabled={!clickable}
          onClick={() => onCancel?.()}
          className="w-fit rounded border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium transition hover:border-[var(--color-danger)]/40 disabled:opacity-40"
        >
          Cancelar (Esc)
        </button>
        <div className="text-xs text-[var(--color-text-dim)]">
          {sent
            ? 'Cancelado…'
            : 'Aceitar/ciclar um resultado ainda não é suportado aqui — use o terminal.'}
        </div>
      </div>
    </div>
  )
}
