import { useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useArchitectureStore } from '@/store/architectureStore'
import type { RepoDependencyKind } from '../../../shared/types/ipc'

// Mapa kind → token de cor do design system (nunca cor hardcoded). Cada kind tem
// um token distinto onde possível pra leitura rápida no canvas.
export const KIND_COLOR_VAR: Record<RepoDependencyKind, string> = {
  'calls-api': 'var(--color-accent)',
  'shares-types': 'var(--color-info)',
  'depends-on': 'var(--color-warning)',
  'deploys-to': 'var(--color-success)',
  // Kinds da Wave A — tokens refinados na Wave B.
  'work-hub': 'var(--color-accent)', // hub: cor de destaque/coordenação
  infra: 'var(--color-danger)', // infra/provisiona: cor "pesada" (provisionamento)
  monorepo: 'var(--color-info)', // monorepo/contém: estrutural
  documents: 'var(--color-success)', // documenta: relação "boa"/de apoio
  custom: 'var(--color-text-dim)',
}

export const KIND_LABEL: Record<RepoDependencyKind, string> = {
  'calls-api': 'chama API',
  'shares-types': 'compartilha tipos',
  'depends-on': 'depende de',
  'deploys-to': 'faz deploy em',
  'work-hub': 'Hub de trabalho',
  infra: 'Infra/provisiona',
  monorepo: 'Monorepo/contém',
  documents: 'Documenta',
  custom: 'custom',
}

const KINDS: RepoDependencyKind[] = [
  'calls-api',
  'shares-types',
  'depends-on',
  'deploys-to',
  'work-hub',
  'infra',
  'monorepo',
  'documents',
  'custom',
]

export interface RepoEdgeData {
  kind: RepoDependencyKind
  label: string | null
  [key: string]: unknown
}

// Aresta tipada: cor por kind, label clicável que abre Menu pra trocar o kind
// (chama updateDep). Mostra o label custom opcional quando existir.
export function RepoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [labelDialogOpen, setLabelDialogOpen] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const updateDep = useArchitectureStore((s) => s.updateDep)
  const deleteDep = useArchitectureStore((s) => s.deleteDep)

  const edgeData = (data ?? { kind: 'custom', label: null }) as RepoEdgeData
  const kind = edgeData.kind
  const color = KIND_COLOR_VAR[kind] ?? KIND_COLOR_VAR.custom

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const items: MenuItem[] = [
    ...KINDS.map((k) => ({
      label: KIND_LABEL[k],
      active: k === kind,
      onClick: () => void updateDep({ id, kind: k }),
    })),
    {
      label: 'Editar rótulo…',
      onClick: () => {
        setLabelDraft(edgeData.label ?? '')
        setLabelDialogOpen(true)
      },
    },
    {
      label: 'Apagar conexão',
      danger: true,
      onClick: () => void deleteDep(id),
    },
  ]

  function saveLabel() {
    const trimmed = labelDraft.trim()
    void updateDep({ id, label: trimmed || null })
    setLabelDialogOpen(false)
  }

  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: color }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <Menu open={menuOpen} onClose={() => setMenuOpen(false)} items={items} portal>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
              style={{ borderColor: color }}
            >
              {edgeData.label ? `${KIND_LABEL[kind]} · ${edgeData.label}` : KIND_LABEL[kind]}
            </button>
          </Menu>
        </div>
      </EdgeLabelRenderer>
      <Dialog
        open={labelDialogOpen}
        onClose={() => setLabelDialogOpen(false)}
        title="Editar rótulo da conexão"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLabelDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveLabel}>Salvar</Button>
          </>
        }
      >
        <Input
          label="Rótulo (deixe vazio para remover)"
          autoFocus
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveLabel()
          }}
          placeholder="ex: webhook de pagamento"
        />
      </Dialog>
    </>
  )
}
