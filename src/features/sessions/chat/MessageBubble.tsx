import { MarkdownViewer } from '@/components/ui/MarkdownViewer'

interface Props {
  role: 'user' | 'assistant'
  text: string
  // Eco otimista ainda não reconciliado com o disco — renderiza esmaecido.
  pending?: boolean
}

export function MessageBubble({ role, text, pending }: Props) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-[var(--color-accent)]/15 text-[var(--color-text)]'
            : 'bg-[var(--color-surface-2)]/60 text-[var(--color-text)]'
        } ${pending ? 'opacity-60' : ''}`}
      >
        <MarkdownViewer content={text} />
      </div>
    </div>
  )
}
