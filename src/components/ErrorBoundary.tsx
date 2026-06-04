import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Rede de segurança: uma exceção de render não deve apagar o app inteiro (tela
// preta). Mostra um fallback com o erro e um botão de recarregar.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-sm font-medium text-[var(--color-text)]">
          Algo quebrou na interface.
        </div>
        <pre className="max-w-xl overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left text-xs text-[var(--color-text-dim)]">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:opacity-90"
        >
          Recarregar
        </button>
      </div>
    )
  }
}
