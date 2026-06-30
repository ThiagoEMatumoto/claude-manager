import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Icon } from './Icon'

interface Props {
  text: string
  className?: string
  // Tamanho do ícone (12 em cards densos, 13-14 em blocos maiores).
  size?: number
  title?: string
}

// Botão de copiar reutilizável: escreve no clipboard e mostra um check por ~1.2s.
// `stopPropagation` evita que o clique propague pro header colapsável do card pai.
export function CopyButton({ text, className, size = 12, title = 'Copiar' }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch (err) {
      console.error('[copy] falha ao copiar pro clipboard:', err)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copiado!' : title}
      className={`flex items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)] ${className ?? ''}`}
    >
      <Icon as={copied ? Check : Copy} size={size} />
    </button>
  )
}
