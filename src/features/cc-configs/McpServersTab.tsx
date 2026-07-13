import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { mcpApi, projectsApi } from '@/lib/ipc'
import type { McpAddInput, McpServerEntry, Repo } from '../../../shared/types/ipc'
import { Badge, Card, CenterMessage } from './ui'

// Gestão dos MCP servers do CLI claude (user + projeto). Mutações fazem
// shell-out validado a `claude mcp add/remove` no main. Habilitar/desabilitar
// não existe no CLI (`claude mcp` só tem add/remove) — por isso não há toggle.

const inputClass =
  'rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]'

function ServerRow({
  server,
  onRemoved,
}: {
  server: McpServerEntry
  onRemoved: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    // Remoção é destrutiva: exige um 2º clique (mesmo padrão do bypass no spawn).
    if (!confirming) {
      setConfirming(true)
      return
    }
    setRemoving(true)
    try {
      const result = await mcpApi.removeServer({
        name: server.name,
        scope: server.scope,
        repoId: server.repoId,
      })
      if (result.ok) onRemoved()
      else setError(result.message)
    } finally {
      setRemoving(false)
      setConfirming(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--color-text)]">
              {server.name}
            </span>
            <Badge tone={server.scope === 'user' ? 'neutral' : 'on'}>{server.scope}</Badge>
            <Badge>{server.transport}</Badge>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-[var(--color-text-dim)]" title={server.target}>
            {server.target}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--color-text-dim)]">{server.source}</div>
          {error && <div className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</div>}
        </div>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={removing}
          className={`shrink-0 text-xs transition disabled:opacity-50 ${
            confirming
              ? 'text-[var(--color-danger)]'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-danger)]'
          }`}
        >
          {removing ? 'Removendo…' : confirming ? 'Confirmar remoção' : 'Remover'}
        </button>
      </div>
    </Card>
  )
}

function AddServerForm({ repos, onAdded }: { repos: Repo[]; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpAddInput['transport']>('http')
  const [target, setTarget] = useState('')
  const [args, setArgs] = useState('')
  const [scope, setScope] = useState<McpAddInput['scope']>('user')
  const [repoId, setRepoId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const canSubmit =
    name.trim() !== '' && target.trim() !== '' && (scope === 'user' || repoId !== '')

  async function submit() {
    setBusy(true)
    setMessage(null)
    try {
      const input: McpAddInput = {
        name: name.trim(),
        transport,
        target: target.trim(),
        scope,
      }
      if (scope === 'project') input.repoId = repoId
      if (transport === 'stdio' && args.trim()) {
        // Split simples por espaço — args com espaços internos não são suportados
        // pelo formulário (use o CLI direto pra casos exóticos).
        input.args = args.trim().split(/\s+/)
      }
      const result = await mcpApi.addServer(input)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) {
        setName('')
        setTarget('')
        setArgs('')
        onAdded()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 text-sm font-semibold text-[var(--color-text)]">Adicionar server</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-dim)]">Nome</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex.: sentry"
            className={`${inputClass} w-40`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-dim)]">Transporte</span>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as McpAddInput['transport'])}
            className={inputClass}
          >
            <option value="http">http</option>
            <option value="sse">sse</option>
            <option value="stdio">stdio</option>
          </select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1">
          <span className="text-xs text-[var(--color-text-dim)]">
            {transport === 'stdio' ? 'Comando' : 'URL'}
          </span>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={transport === 'stdio' ? 'ex.: npx' : 'https://…/mcp'}
            className={`${inputClass} w-full font-mono text-xs`}
          />
        </label>
        {transport === 'stdio' && (
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--color-text-dim)]">Args (separados por espaço)</span>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="ex.: my-mcp-server --flag"
              className={`${inputClass} w-full font-mono text-xs`}
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-dim)]">Escopo</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as McpAddInput['scope'])}
            className={inputClass}
          >
            <option value="user">user (global)</option>
            <option value="project">project (repo)</option>
          </select>
        </label>
        {scope === 'project' && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--color-text-dim)]">Repo</span>
            <select value={repoId} onChange={(e) => setRepoId(e.target.value)} className={inputClass}>
              <option value="">— escolha —</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button onClick={() => void submit()} disabled={!canSubmit || busy}>
          {busy ? 'Adicionando…' : 'Adicionar'}
        </Button>
      </div>
      {message && (
        <div
          className={`mt-2 text-xs ${message.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}

export function McpServersTab() {
  const [servers, setServers] = useState<McpServerEntry[] | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])

  async function reload() {
    setServers(await mcpApi.listServers())
  }

  useEffect(() => {
    void reload()
    void projectsApi.listAllRepos().then(setRepos)
  }, [])

  if (servers === null) return <CenterMessage text="Carregando…" />

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="text-xs text-[var(--color-text-dim)]">
          MCP servers configurados no CLI claude — user (~/.claude.json, ~/.claude/.mcp.json) e
          projeto (.mcp.json dos repos registrados). Servers de plugins aparecem na aba MCPs.
        </div>

        <AddServerForm repos={repos} onAdded={() => void reload()} />

        {servers.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-dim)]">
            Nenhum MCP server configurado.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {servers.map((s) => (
              <ServerRow
                key={`${s.scope}:${s.repoId ?? 'user'}:${s.name}`}
                server={s}
                onRemoved={() => void reload()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
