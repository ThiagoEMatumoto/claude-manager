import { ArrowRight } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

interface Props {
  from: string
  to: string
}

// message.model muda dentro da MESMA sessão (troca no composer, ou o próprio
// CLI decidindo). Alias curto: só remove o prefixo 'claude-' — sem mapear pra
// MODEL_ALIASES (o valor cru já é legível e cobre ids futuros sem manutenção).
function shortModel(id: string): string {
  return id.replace(/^claude-/, '')
}

// Divisória discreta e centralizada, sem toggle (é só um marcador de ponto no
// tempo, não tem "mais" pra expandir).
export function ModelChangeChip({ from, to }: Props) {
  return (
    <div className="flex items-center justify-center gap-2 px-1 py-0.5 text-[11px] text-[var(--color-text-dim)]">
      <span className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="flex shrink-0 items-center gap-1">
        Modelo: {shortModel(from)}
        <Icon as={ArrowRight} size={10} className="shrink-0" />
        {shortModel(to)}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  )
}
