import { useState } from 'react'
import { FolderOpen, GripVertical, MoreHorizontal, PanelLeftClose, Zap } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useProjects } from './useProjects'
import { NewProjectDialog } from './NewProjectDialog'
import { EditProjectDialog } from './EditProjectDialog'
import { ProjectRepos } from './ProjectRepos'
import { Menu } from '@/components/ui/Menu'
import { Icon } from '@/components/ui/Icon'
import { renderProjectIcon } from '@/components/ui/projectIcon'
import { useAppStore } from '@/store/appStore'
import type { Project, UpdateProjectInput } from '../../../shared/types/ipc'

export function ProjectsSidebar() {
  const { projects, create, update, remove, reorder } = useProjects()
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const openQuickSession = useAppStore((s) => s.openQuickSession)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  // Expansão independente por projeto (vários abertos ao mesmo tempo). O header
  // só faz toggle; setActiveProject segue como "último usado"/hint, sem gatear
  // a visibilidade dos repos.
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set())

  // Limiar de 4px pra distinguir clique de arraste — mesmo com handle dedicado,
  // evita que um clique trêmulo no grip dispare um drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function toggleExpanded(id: string) {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      void reorder(String(active.id), String(over.id))
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSidebar}
            title="Recolher barra lateral"
            className="-ml-1 rounded p-0.5 text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
          >
            <Icon as={PanelLeftClose} size={16} />
          </button>
          <div className="text-sm font-semibold tracking-tight">Projetos</div>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-black transition hover:opacity-90"
        >
          + Novo
        </button>
      </div>

      {/* Sessão avulsa: spawn sem repo, cwd = scratch dir (pref scratch_dir). */}
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <button
          type="button"
          onClick={() => void openQuickSession()}
          title="Abrir uma sessão Claude avulsa (sem projeto)"
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs font-medium text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)]"
        >
          <Icon as={Zap} size={13} />
          Sessão rápida
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <Icon as={FolderOpen} size={28} className="text-[var(--color-text-dim)] opacity-60" />
            <div className="text-sm font-medium text-[var(--color-text)]">Nenhum projeto ainda</div>
            <div className="text-xs text-[var(--color-text-dim)]">
              Crie um projeto pra agrupar seus repositórios e sessões.
            </div>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="mt-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black transition hover:opacity-90"
            >
              Criar projeto
            </button>
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-px py-2">
              {projects.map((p) => (
                <SortableProjectItem
                  key={p.id}
                  project={p}
                  active={p.id === activeProjectId}
                  expanded={expandedProjectIds.has(p.id)}
                  onToggle={() => {
                    setActiveProject(p.id)
                    toggleExpanded(p.id)
                  }}
                  onEdit={() => setEditing(p)}
                  onRemove={() => {
                    if (confirm(`Apagar projeto "${p.name}"?`)) void remove(p.id)
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={async (input) => {
          await create(input)
          setDialogOpen(false)
        }}
      />

      {editing && (
        <EditProjectDialog
          open
          project={editing}
          onClose={() => setEditing(null)}
          onSave={async (input: UpdateProjectInput) => {
            await update(input)
            setEditing(null)
          }}
        />
      )}
    </aside>
  )
}

interface SortableProjectItemProps {
  project: Project
  active: boolean
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
}

function SortableProjectItem({
  project,
  active,
  expanded,
  onToggle,
  onEdit,
  onRemove,
}: SortableProjectItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <li ref={setNodeRef} style={style}>
      <div
        className={`group flex items-center justify-between border-l-2 px-2 py-2 text-sm transition ${
          active || expanded
            ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
            : 'border-transparent text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
        }`}
        style={
          active || expanded ? { borderLeftColor: project.color ?? 'var(--color-accent)' } : undefined
        }
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Arrastar para reordenar"
          className="shrink-0 cursor-grab touch-none rounded text-[var(--color-text-dim)] opacity-0 transition hover:text-[var(--color-text)] group-hover:opacity-100 active:cursor-grabbing"
        >
          <Icon as={GripVertical} size={14} />
        </button>

        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: project.color ?? 'var(--color-text-dim)' }}
          />
          <span className="shrink-0">{renderProjectIcon(project.icon)}</span>
          <span className="truncate">{project.name}</span>
          {!project.vaultPath && (
            <span
              className="shrink-0 text-[10px] text-[var(--color-text-dim)] opacity-60"
              title="Este projeto não tem um vault definido"
            >
              sem vault
            </span>
          )}
        </button>

        <ProjectMenu project={project} onEdit={onEdit} onRemove={onRemove} />
      </div>

      {expanded && <ProjectRepos project={project} />}
    </li>
  )
}

function ProjectMenu({
  project,
  onEdit,
  onRemove,
}: {
  project: Project
  onEdit: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      items={[
        { label: 'Editar', onClick: onEdit },
        { label: 'Remover', danger: true, onClick: onRemove },
      ]}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="shrink-0 rounded px-1 leading-none text-[var(--color-text-dim)] opacity-0 transition hover:text-[var(--color-text)] group-hover:opacity-100"
        title={`Ações de "${project.name}"`}
      >
        <Icon as={MoreHorizontal} />
      </button>
    </Menu>
  )
}
