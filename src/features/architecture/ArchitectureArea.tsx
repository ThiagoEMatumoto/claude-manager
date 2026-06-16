import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronDown, Globe } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { useAppStore } from '@/store/appStore'
import { useArchitectureStore } from '@/store/architectureStore'
import { useHandoffsStore } from '@/store/handoffsStore'
import { useProjects } from '@/features/projects/useProjects'
import type { Handoff, HandoffStatus, Repo, RepoDependency } from '../../../shared/types/ipc'
import { RepoNode, type RepoNodeData } from './RepoNode'
import { RepoEdge, type RepoEdgeData } from './RepoEdge'
import { useArchitecture } from './useArchitecture'

const nodeTypes = { repo: RepoNode }
const edgeTypes = { repo: RepoEdge }

// Layout automático em grade quando o repo não tem posição salva.
const GRID_COLS = 3
const GRID_DX = 260
const GRID_DY = 140
// Largura de cada faixa por projeto na vista global (auto-layout).
const GLOBAL_PROJECT_DX = 320

interface HandoffTrail {
  count: number
  latestStatus: HandoffStatus
}

// Agrega handoffs por repo-alvo: contagem + status do mais recente (por updatedAt).
function handoffTrailByRepo(handoffs: Handoff[]): Map<string, HandoffTrail> {
  const map = new Map<string, HandoffTrail>()
  for (const h of handoffs) {
    const prev = map.get(h.targetRepoId)
    if (!prev) {
      map.set(h.targetRepoId, { count: 1, latestStatus: h.status })
    } else {
      map.set(h.targetRepoId, { count: prev.count + 1, latestStatus: prev.latestStatus })
    }
  }
  // Resolve o status do mais recente num segundo passe (precisa do max updatedAt).
  const latest = new Map<string, number>()
  for (const h of handoffs) {
    const cur = latest.get(h.targetRepoId)
    if (cur === undefined || h.updatedAt > cur) {
      latest.set(h.targetRepoId, h.updatedAt)
      const trail = map.get(h.targetRepoId)
      if (trail) trail.latestStatus = h.status
    }
  }
  return map
}

interface ProjectMeta {
  name: string
  color: string | null
}

function reposToNodes(
  repos: Repo[],
  trails: Map<string, HandoffTrail>,
  projectMeta: Map<string, ProjectMeta>,
  isGlobal: boolean,
): Node[] {
  // Em global, auto-layout agrupa por projeto: cada projeto numa coluna/faixa,
  // empilhando seus repos verticalmente. Mantém posições salvas quando existirem.
  const columnByProject = new Map<string, number>()
  const rowInProject = new Map<string, number>()

  return repos.map((repo, i) => {
    let autoX: number
    let autoY: number
    if (isGlobal) {
      if (!columnByProject.has(repo.projectId)) {
        columnByProject.set(repo.projectId, columnByProject.size)
      }
      const col = columnByProject.get(repo.projectId) ?? 0
      const row = rowInProject.get(repo.projectId) ?? 0
      rowInProject.set(repo.projectId, row + 1)
      autoX = col * GLOBAL_PROJECT_DX
      autoY = row * GRID_DY
    } else {
      autoX = (i % GRID_COLS) * GRID_DX
      autoY = Math.floor(i / GRID_COLS) * GRID_DY
    }
    const x = repo.canvasX ?? autoX
    const y = repo.canvasY ?? autoY
    const trail = trails.get(repo.id)
    const meta = isGlobal ? projectMeta.get(repo.projectId) : undefined
    const data: RepoNodeData = {
      id: repo.id,
      label: repo.label,
      role: repo.role,
      isHub: repo.isHub,
      projectName: meta?.name,
      projectColor: meta?.color,
      handoffCount: trail?.count,
      handoffLatestStatus: trail?.latestStatus,
    }
    return { id: repo.id, type: 'repo', position: { x, y }, data }
  })
}

function depsToEdges(deps: RepoDependency[]): Edge[] {
  // Filtra self-deps (from==to): não fazem sentido e o react-flow desenha um
  // "loop" (curl) espúrio perto dos handles. Defesa contra dados legados.
  return deps
    .filter((dep) => dep.fromRepoId !== dep.toRepoId)
    .map((dep) => {
      const data: RepoEdgeData = { kind: dep.kind, label: dep.label }
      return {
        id: dep.id,
        source: dep.fromRepoId,
        target: dep.toRepoId,
        type: 'repo',
        data,
      }
    })
}

export function ArchitectureArea() {
  useArchitecture()
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const repos = useArchitectureStore((s) => s.repos)
  const deps = useArchitectureStore((s) => s.deps)
  const viewMode = useArchitectureStore((s) => s.viewMode)
  const setViewMode = useArchitectureStore((s) => s.setViewMode)
  const createDep = useArchitectureStore((s) => s.createDep)
  const deleteDep = useArchitectureStore((s) => s.deleteDep)
  const setRepoPosition = useArchitectureStore((s) => s.setRepoPosition)
  const { projects } = useProjects()
  // Trilha de handoff: lê a lista completa (já carregada/observada pelo
  // useHandoffs no AppShell; load() aqui garante dados se a aba abrir antes).
  const handoffs = useHandoffsStore((s) => s.handoffs)
  const loadHandoffs = useHandoffsStore((s) => s.load)
  const [selectorOpen, setSelectorOpen] = useState(false)

  useEffect(() => {
    void loadHandoffs()
  }, [loadHandoffs])

  const isGlobal = viewMode === 'global'

  const projectMeta = useMemo(() => {
    const m = new Map<string, ProjectMeta>()
    for (const p of projects) m.set(p.id, { name: p.name, color: p.color })
    return m
  }, [projects])

  const trails = useMemo(() => handoffTrailByRepo(handoffs), [handoffs])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Sincroniza os nós/arestas locais (react-flow) quando o store muda.
  useEffect(() => {
    setNodes(reposToNodes(repos, trails, projectMeta, isGlobal))
  }, [repos, trails, projectMeta, isGlobal, setNodes])

  useEffect(() => {
    setEdges(depsToEdges(deps))
  }, [deps, setEdges])

  // Debounce da persistência de posição (drag dispara muitos changes).
  const dragTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    const timers = dragTimers.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes)
    },
    [onNodesChange],
  )

  const handleNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node) => {
      const timers = dragTimers.current
      const existing = timers.get(node.id)
      if (existing) clearTimeout(existing)
      timers.set(
        node.id,
        setTimeout(() => {
          void setRepoPosition({ repoId: node.id, x: node.position.x, y: node.position.y })
          timers.delete(node.id)
        }, 300),
      )
    },
    [setRepoPosition],
  )

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      if (conn.source === conn.target) return // sem self-connection
      void createDep({ fromRepoId: conn.source, toRepoId: conn.target, kind: 'custom' })
    },
    [createDep],
  )

  // Bloqueia a conexão self já no arraste (impede o react-flow de mostrar o
  // preview/loop de auto-referência).
  const isValidConnection = useCallback(
    (conn: Connection | Edge) => conn.source !== conn.target,
    [],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes)
    },
    [onEdgesChange],
  )

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) void deleteDep(edge.id)
    },
    [deleteDep],
  )

  const minimapNodeColor = useMemo(() => () => 'var(--color-surface-2)', [])

  // Selecionar "Global" só muda a vista (não mexe no projeto ativo). Selecionar
  // um projeto real muda vista E projeto ativo (mantém o resto do app coerente).
  const selectorItems: MenuItem[] = useMemo(() => {
    const items: MenuItem[] = [
      {
        label: 'Global (todos os projetos)',
        active: isGlobal,
        onClick: () => setViewMode('global'),
      },
    ]
    for (const p of projects) {
      items.push({
        label: p.name,
        active: viewMode === p.id,
        onClick: () => {
          setViewMode(p.id)
          setActiveProject(p.id)
        },
      })
    }
    return items
  }, [projects, viewMode, isGlobal, setViewMode, setActiveProject])

  const currentLabel = isGlobal
    ? 'Global'
    : (projectMeta.get(viewMode ?? '')?.name ?? 'Selecione um projeto')

  const topBar = (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <Menu
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        items={selectorItems}
      >
        <button
          type="button"
          onClick={() => setSelectorOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)]"
        >
          {isGlobal && (
            <span className="text-[var(--color-accent)]">
              <Icon as={Globe} />
            </span>
          )}
          <span className="max-w-[14rem] truncate">{currentLabel}</span>
          <span className="text-[var(--color-text-dim)]">
            <Icon as={ChevronDown} />
          </span>
        </button>
      </Menu>
    </div>
  )

  let body: ReactNode
  if (!viewMode) {
    body = (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-text-dim)]">
        Selecione um projeto ou a vista Global para mapear a arquitetura.
      </div>
    )
  } else if (repos.length === 0) {
    body = (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-text-dim)]">
        {isGlobal
          ? 'Nenhum repo cadastrado em nenhum projeto ainda.'
          : 'Adicione repos ao projeto para mapear a arquitetura.'}
      </div>
    )
  } else {
    body = (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={handleNodeDragStop}
        onEdgesDelete={handleEdgesDelete}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-border)" gap={20} />
        <Controls
          className="!border-[var(--color-border)] !bg-[var(--color-surface)] [&_button]:!border-[var(--color-border)] [&_button]:!bg-[var(--color-surface)] [&_button]:!fill-[var(--color-text-dim)] [&_button:hover]:!bg-[var(--color-surface-2)]"
          showInteractive={false}
        />
        <MiniMap
          className="!border !border-[var(--color-border)] !bg-[var(--color-surface)]"
          nodeColor={minimapNodeColor}
          maskColor="var(--color-bg)"
          pannable
          zoomable
        />
      </ReactFlow>
    )
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
      {topBar}
      {body}
    </main>
  )
}
