import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { notificationsApi } from '@/lib/ipc'
import { Icon } from '@/components/ui/Icon'
import { useToastStore, type LocalToast } from './toast-store'
import type { NotificationEvent } from '../../../shared/types/ipc'

const AUTO_DISMISS_MS = 6000

export function NotificationToast() {
  const [event, setEvent] = useState<NotificationEvent | null>(null)
  const toasts = useToastStore((s) => s.toasts)

  useEffect(() => {
    return notificationsApi.onEvent((e) => setEvent(e))
  }, [])

  useEffect(() => {
    if (!event) return
    const timer = setTimeout(() => setEvent(null), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [event])

  return (
    <>
      {toasts.map((toast) => (
        <LocalToastCard key={toast.id} toast={toast} />
      ))}
      {event && (
        <ToastFrame onDismiss={() => setEvent(null)}>
          <div className="font-medium">{event.title}</div>
          <div className="text-[var(--color-text-dim)]">{event.body}</div>
        </ToastFrame>
      )}
    </>
  )
}

function LocalToastCard({ toast }: { toast: LocalToast }) {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs)
    return () => clearTimeout(timer)
  }, [toast.id, toast.durationMs, dismiss])

  return (
    <ToastFrame onDismiss={() => dismiss(toast.id)}>
      <div className="font-medium">{toast.title}</div>
      {toast.body && <div className="text-[var(--color-text-dim)]">{toast.body}</div>}
      {toast.actionLabel && (
        <button
          type="button"
          onClick={() => {
            toast.onAction?.()
            dismiss(toast.id)
          }}
          className="mt-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-accent)] transition hover:bg-[var(--color-surface-2)]"
        >
          {toast.actionLabel}
        </button>
      )}
    </ToastFrame>
  )
}

function ToastFrame({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div
      className="pointer-events-auto flex max-w-xs items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg-elevated, var(--color-surface))',
        color: 'var(--color-text)',
      }}
    >
      <Icon as={Bell} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
      <div className="flex-1">{children}</div>
      <button
        onClick={onDismiss}
        aria-label="Dispensar"
        className="flex shrink-0 items-center px-1"
        style={{ color: 'var(--color-text-dim)' }}
      >
        <Icon as={X} size={14} />
      </button>
    </div>
  )
}
