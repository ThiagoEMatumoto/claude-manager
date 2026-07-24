import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { AvailablePlugin, PluginActionResult } from '../../../shared/types/ipc'
import { Badge, Card, CenterMessage } from './ui'

const RENDER_LIMIT = 80

interface Props {
  available: AvailablePlugin[]
  loading: boolean
  error: string | null
  runInstall: (name: string) => Promise<PluginActionResult>
}

export function MarketplaceTab({ available, loading, error, runInstall }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return available
    return available.filter((p) =>
      [p.name, p.marketplace, p.maintainer ?? '', p.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [available, query])

  const shown = filtered.slice(0, RENDER_LIMIT)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <Input
          placeholder="Buscar por nome, marketplace, maintainer ou descrição…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Body
        loading={loading}
        error={error}
        total={available.length}
        filtered={filtered.length}
        shown={shown}
        runInstall={runInstall}
      />
    </div>
  )
}

function Body({
  loading,
  error,
  total,
  filtered,
  shown,
  runInstall,
}: {
  loading: boolean
  error: string | null
  total: number
  filtered: number
  shown: AvailablePlugin[]
  runInstall: Props['runInstall']
}) {
  if (error) return <CenterMessage text={error} />
  if (loading && total === 0) return <CenterMessage text="Carregando marketplace…" />
  if (total === 0) return <CenterMessage text="Nenhum plugin disponível." />
  if (filtered === 0) return <CenterMessage text="Nenhum resultado para a busca." />

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mb-3 font-mono text-xs tabular-nums text-[var(--color-text-dim)]">
        Mostrando {shown.length} de {filtered}
        {filtered !== total && ` (${total} no total)`}
      </div>
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        {shown.map((p) => (
          <MarketplaceCard key={p.id} plugin={p} runInstall={runInstall} />
        ))}
      </div>
    </div>
  )
}

function MarketplaceCard({
  plugin,
  runInstall,
}: {
  plugin: AvailablePlugin
  runInstall: Props['runInstall']
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)

  async function install() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await runInstall(plugin.name)
      if (!result.ok) {
        setNotice({ text: result.message || 'Instalação falhou.', tone: 'err' })
      } else if (result.restartRequired) {
        setNotice({ text: 'Instalado. Reinicie o Claude Code para aplicar.', tone: 'ok' })
      } else {
        setNotice({ text: result.message || 'Instalado.', tone: 'ok' })
      }
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : String(err), tone: 'err' })
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--color-text)]">
            {plugin.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]">
            <Badge>{plugin.marketplace}</Badge>
            {plugin.maintainer && <span className="truncate">{plugin.maintainer}</span>}
          </div>
        </div>
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void install()}>
          Instalar
        </Button>
      </div>
      {plugin.description && (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--color-text-dim)]">
          {plugin.description}
        </p>
      )}
      {notice && (
        <div
          className={`mt-2 text-xs ${
            notice.tone === 'ok' ? 'text-[var(--color-accent)]' : 'text-[var(--color-danger)]'
          }`}
        >
          {notice.text}
        </div>
      )}
    </Card>
  )
}
