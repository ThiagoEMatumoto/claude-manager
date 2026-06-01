import { useEffect, useState, type CSSProperties } from 'react'
import { windowApi } from '@/lib/ipc'
import { UsageWidget } from './UsageWidget'

const drag = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void windowApi.isMaximized().then(setMaximized)
    return windowApi.onMaximizeChange(setMaximized)
  }, [])

  return (
    <header
      className="flex h-9 shrink-0 items-center justify-between border-b pl-3 pr-1 select-none"
      style={{
        ...drag,
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
      onDoubleClick={() => void windowApi.toggleMaximize()}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: 'var(--color-accent)' }}
        />
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-dim)' }}>
          Claude Manager
        </span>
      </div>

      <div className="flex items-center gap-2" style={noDrag}>
        <UsageWidget />
        <WindowControls maximized={maximized} />
      </div>
    </header>
  )
}

function WindowControls({ maximized }: { maximized: boolean }) {
  return (
    <div className="flex items-center" style={noDrag}>
      <ControlButton label="Minimizar" onClick={() => void windowApi.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
        </svg>
      </ControlButton>

      <ControlButton
        label={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={() => void windowApi.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="2.5" y="1" width="6.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="1" y="2.5" width="6.5" height="6.5" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </ControlButton>

      <ControlButton label="Fechar" danger onClick={() => void windowApi.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </ControlButton>
    </div>
  )
}

function ControlButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={noDrag}
      className={`flex h-9 w-11 items-center justify-center text-[var(--color-text-dim)] transition-colors ${
        danger
          ? 'hover:bg-[var(--color-danger)] hover:text-white'
          : 'hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
      }`}
    >
      {children}
    </button>
  )
}
