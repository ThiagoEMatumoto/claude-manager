import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { ccPluginsApi } from '@/lib/ipc'
import type {
  ManagedPluginInfo,
  PluginActionResult,
  PluginComponents,
  PluginDetails,
} from '../../../shared/types/ipc'
import { COMPONENT_TAB_BY_KIND, type FocusedItem } from './navigation'
import { Badge, Card, CenterMessage } from './ui'

interface Props {
  installed: ManagedPluginInfo[]
  loading: boolean
  error: string | null
  runAction: (
    action: 'enable' | 'disable' | 'uninstall' | 'update',
    name: string,
  ) => Promise<PluginActionResult>
  onNavigate: (target: FocusedItem) => void
}

type StatusFilter = 'all' | 'enabled' | 'disabled'
const ALL = '__all__'

export function PluginsTab({ installed, loading, error, runAction, onNavigate }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [category, setCategory] = useState<string>(ALL)
  const [marketplace, setMarketplace] = useState<string>(ALL)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (selected && !installed.some((p) => p.name === selected)) {
      setSelected(null)
    }
  }, [installed, selected])

  const categories = useMemo(
    () =>
      [...new Set(installed.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [installed],
  )
  const marketplaces = useMemo(
    () =>
      [...new Set(installed.map((p) => p.marketplace).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [installed],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return installed.filter((p) => {
      if (status === 'enabled' && !p.enabled) return false
      if (status === 'disabled' && p.enabled) return false
      if (category !== ALL && p.category !== category) return false
      if (marketplace !== ALL && p.marketplace !== marketplace) return false
      if (q) {
        const hay = [p.name, p.description ?? '', p.maintainer ?? '', p.author ?? '']
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [installed, status, category, marketplace, query])

  if (error) return <CenterMessage text={error} />
  if (loading && installed.length === 0) return <CenterMessage text="Carregando plugins…" />
  if (installed.length === 0) return <CenterMessage text="Nenhum plugin instalado." />

  const selectedPlugin = installed.find((p) => p.name === selected) ?? null

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-[180px] flex-1">
            <Input
              placeholder="Buscar por nome, descrição ou autor…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <FilterSelect
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'enabled', label: 'Enabled' },
              { value: 'disabled', label: 'Disabled' },
            ]}
          />
          <FilterSelect
            value={category}
            onChange={setCategory}
            options={[
              { value: ALL, label: 'Categoria' },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
          />
          <FilterSelect
            value={marketplace}
            onChange={setMarketplace}
            options={[
              { value: ALL, label: 'Marketplace' },
              ...marketplaces.map((m) => ({ value: m, label: m })),
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-3 text-xs text-[var(--color-text-dim)]">
            {filtered.length} de {installed.length}
          </div>
          {filtered.length === 0 ? (
            <CenterMessage text="Nenhum plugin para os filtros." />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
              {filtered.map((p) => (
                <PluginCard
                  key={p.id}
                  plugin={p}
                  active={p.name === selected}
                  onSelect={() => setSelected(p.name)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedPlugin && (
        <PluginDrawer
          key={selectedPlugin.name}
          plugin={selectedPlugin}
          onClose={() => setSelected(null)}
          runAction={runAction}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function PluginCard({
  plugin,
  active,
  onSelect,
}: {
  plugin: ManagedPluginInfo
  active: boolean
  onSelect: () => void
}) {
  return (
    <Card active={active} onClick={onSelect}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--color-text)]">
            {plugin.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-[var(--color-text-dim)]">
            {plugin.maintainer || plugin.marketplace}
          </div>
        </div>
        <Badge tone={plugin.enabled ? 'on' : 'off'}>
          {plugin.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--color-text-dim)]">
        {plugin.version && <span>v{plugin.version}</span>}
        {plugin.marketplace && plugin.maintainer && (
          <>
            <span>·</span>
            <span className="truncate">{plugin.marketplace}</span>
          </>
        )}
        {plugin.scope && (
          <>
            <span>·</span>
            <span>{plugin.scope}</span>
          </>
        )}
      </div>
    </Card>
  )
}

function PluginDrawer({
  plugin,
  onClose,
  runAction,
  onNavigate,
}: {
  plugin: ManagedPluginInfo
  onClose: () => void
  runAction: Props['runAction']
  onNavigate: Props['onNavigate']
}) {
  const [details, setDetails] = useState<PluginDetails | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [busy, setBusy] = useState<'enable' | 'disable' | 'update' | 'uninstall' | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingDetails(true)
    setDetailsError(null)
    ccPluginsApi
      .details(plugin.name)
      .then((d) => {
        if (!cancelled) setDetails(d)
      })
      .catch((err) => {
        if (!cancelled) setDetailsError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false)
      })
    return () => {
      cancelled = true
    }
  }, [plugin.name])

  const doAction = useCallback(
    async (action: 'enable' | 'disable' | 'update' | 'uninstall') => {
      setBusy(action)
      setNotice(null)
      try {
        const result = await runAction(action, plugin.name)
        if (!result.ok) {
          setNotice({ text: result.message || 'Ação falhou.', tone: 'err' })
        } else if (result.restartRequired) {
          setNotice({
            text: 'Reinicie o Claude Code para aplicar a mudança.',
            tone: 'ok',
          })
        } else if (result.message) {
          setNotice({ text: result.message, tone: 'ok' })
        }
      } catch (err) {
        setNotice({ text: err instanceof Error ? err.message : String(err), tone: 'err' })
      } finally {
        setBusy(null)
        setConfirmUninstall(false)
      }
    },
    [plugin.name, runAction],
  )

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{plugin.name}</div>
          <div className="truncate text-xs text-[var(--color-text-dim)]">
            {plugin.maintainer || plugin.marketplace}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          Fechar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loadingDetails && <div className="text-sm text-[var(--color-text-dim)]">Carregando…</div>}
        {detailsError && (
          <div className="text-sm text-[var(--color-danger)]">
            Falha ao carregar detalhes: {detailsError}
          </div>
        )}
        {details && (
          <div className="flex flex-col gap-4">
            {details.description && (
              <p className="text-sm leading-relaxed text-[var(--color-text)]">
                {details.description}
              </p>
            )}

            {details.componentRefs ? (
              <ComponentRefs
                refs={details.componentRefs}
                pluginId={plugin.id}
                onNavigate={onNavigate}
              />
            ) : (
              <Components components={details.components} />
            )}

            {typeof details.alwaysOnTokens === 'number' && (
              <div className="flex items-center justify-between rounded-md bg-[var(--color-surface-2)]/60 px-3 py-2 text-xs">
                <span className="text-[var(--color-text-dim)]">Custo always-on</span>
                <span className="font-medium text-[var(--color-text)]">
                  {details.alwaysOnTokens.toLocaleString()} tokens
                </span>
              </div>
            )}

            {details.source && (
              <div className="text-xs text-[var(--color-text-dim)]">
                Origem: <span className="text-[var(--color-text)]">{details.source}</span>
              </div>
            )}

            {!details.description &&
              details.components.skills +
                details.components.agents +
                details.components.hooks +
                details.components.mcpServers +
                details.components.lspServers ===
                0 &&
              details.raw && (
                <pre className="overflow-x-auto rounded-md bg-[var(--color-bg)] p-3 text-[11px] text-[var(--color-text-dim)]">
                  {details.raw}
                </pre>
              )}
          </div>
        )}
      </div>

      {notice && (
        <div
          className={`mx-4 mb-2 rounded-md px-3 py-2 text-xs ${
            notice.tone === 'ok'
              ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
              : 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-4 py-3">
        {plugin.enabled ? (
          <Button
            variant="ghost"
            loading={busy === 'disable'}
            disabled={busy != null}
            onClick={() => void doAction('disable')}
          >
            Desabilitar
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={busy === 'enable'}
            disabled={busy != null}
            onClick={() => void doAction('enable')}
          >
            Habilitar
          </Button>
        )}
        <Button
          variant="ghost"
          loading={busy === 'update'}
          disabled={busy != null}
          onClick={() => void doAction('update')}
        >
          Atualizar
        </Button>
        <Button
          variant="danger"
          disabled={busy != null}
          onClick={() => setConfirmUninstall(true)}
        >
          Desinstalar
        </Button>
      </div>

      <Dialog
        open={confirmUninstall}
        onClose={() => (busy ? undefined : setConfirmUninstall(false))}
        title="Desinstalar plugin"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy === 'uninstall'}
              onClick={() => setConfirmUninstall(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={busy === 'uninstall'}
              onClick={() => void doAction('uninstall')}
            >
              Desinstalar
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-dim)]">
          Remover <span className="font-medium text-[var(--color-text)]">{plugin.name}</span>? Esta
          ação não pode ser desfeita.
        </p>
      </Dialog>
    </aside>
  )
}

const REF_SECTIONS: { key: keyof PluginComponents; label: string }[] = [
  { key: 'skills', label: 'Skills' },
  { key: 'agents', label: 'Agents' },
  { key: 'commands', label: 'Commands' },
  { key: 'hooks', label: 'Hooks' },
  { key: 'mcps', label: 'MCPs' },
]

function ComponentRefs({
  refs,
  pluginId,
  onNavigate,
}: {
  refs: PluginComponents
  pluginId: string
  onNavigate: Props['onNavigate']
}) {
  const sections = REF_SECTIONS.filter(({ key }) => refs[key].length > 0)
  if (sections.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {sections.map(({ key, label }) => {
        const targetTab = COMPONENT_TAB_BY_KIND[key]
        return (
          <div key={key}>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-dim)]">
              <span>{label}</span>
              <span>{refs[key].length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {refs[key].map((ref) => {
                const clickable = targetTab != null
                return (
                  <button
                    key={ref.name}
                    type="button"
                    disabled={!clickable}
                    onClick={
                      targetTab
                        ? () =>
                            onNavigate({ tab: targetTab, name: ref.name, origin: pluginId })
                        : undefined
                    }
                    className={`rounded-md px-2.5 py-1.5 text-left transition ${
                      clickable
                        ? 'cursor-pointer bg-[var(--color-surface-2)]/60 hover:bg-[var(--color-surface-2)]'
                        : 'bg-[var(--color-surface-2)]/30'
                    }`}
                  >
                    <div className="truncate text-xs font-medium text-[var(--color-text)]">
                      {ref.name}
                    </div>
                    {ref.description && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
                        {ref.description}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Components({ components }: { components: PluginDetails['components'] }) {
  const entries: [string, number][] = [
    ['Skills', components.skills],
    ['Agents', components.agents],
    ['Hooks', components.hooks],
    ['MCP', components.mcpServers],
    ['LSP', components.lspServers],
  ]
  const present = entries.filter(([, n]) => n > 0)
  if (present.length === 0) return null
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-[var(--color-text-dim)]">Componentes</div>
      <div className="flex flex-wrap gap-2">
        {present.map(([label, n]) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-text)]"
          >
            {label}
            <span className="text-[var(--color-text-dim)]">{n}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
