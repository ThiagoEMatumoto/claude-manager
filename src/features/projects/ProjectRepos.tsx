import { useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  FolderInput,
  GripVertical,
  Link2,
  MoreHorizontal,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
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
import { useRepos } from './useProjects'
import { AddRepoDialog } from './AddRepoDialog'
import { EditRepoDialog } from './EditRepoDialog'
import { UntrackedFolders } from './UntrackedFolders'
import { Menu } from '@/components/ui/Menu'
import { Icon } from '@/components/ui/Icon'
import { SessionsModal } from '@/features/sessions/SessionsModal'
import { useAppStore } from '@/store/appStore'
import type { LinkKind, Project, Repo, UpdateRepoInput } from '../../../shared/types/ipc'

interface Props {
  project: Project
}

const LINK_BADGE: Record<LinkKind, { icon: ComponentType<LucideProps>; title: string }> = {
  inside: { icon: FolderInput, title: 'Dentro do vault' },
  symlink: { icon: Link2, title: 'Symlink para fora do vault' },
  external: { icon: ArrowUpRight, title: 'Referência externa' },
}

export function ProjectRepos({ project }: Props) {
  const { repos, untracked, create, adopt, update, remove, restoreMissing, reorder } = useRepos(
    project.id,
  )
  const [adding, setAdding] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      void reorder(String(active.id), String(over.id))
    }
  }

  return (
    <div className="border-l border-[var(--color-border)]/50 bg-[var(--color-bg)]/40 pl-4">
      {repos.length === 0 ? (
        <div className="px-4 py-3 text-xs text-[var(--color-text-dim)]">
          <div className="mb-2">Nenhum repo neste projeto.</div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-text)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            + Adicionar repo
          </button>
        </div>
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={repos.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-px py-1">
                {repos.map((r) => (
                  <RepoRow
                    key={r.id}
                    repo={r}
                    project={project}
                    onUpdate={update}
                    onRemove={remove}
                    onRestore={restoreMissing}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="block w-full px-4 py-1.5 text-left text-xs text-[var(--color-text-dim)] transition hover:text-[var(--color-accent)]"
          >
            + repo
          </button>
        </>
      )}

      <UntrackedFolders folders={untracked} onAdopt={adopt} />

      <AddRepoDialog
        open={adding}
        onClose={() => setAdding(false)}
        project={project}
        onCreate={create}
      />
    </div>
  )
}

interface RepoRowProps {
  repo: Repo
  project: Project
  onUpdate: (input: UpdateRepoInput) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
}

// Só dá pra clonar de volta um repo ausente se conhecemos um remote: URL capturada
// na exportação, ou origem `git-clone:<url>`.
function hasRecoverableRemote(repo: Repo): boolean {
  return !!repo.remoteUrl || !!repo.source?.startsWith('git-clone:')
}

function RepoRow({ repo, project, onUpdate, onRemove, onRestore }: RepoRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const openSession = useAppStore((s) => s.openSession)

  const canRestore = hasRecoverableRemote(repo)

  async function handleRestore() {
    setRestoreError(null)
    setRestoring(true)
    try {
      await onRestore(repo.id)
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoring(false)
    }
  }
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: repo.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <li ref={setNodeRef} style={style} className="text-xs">
      <div className="group flex items-center justify-between gap-1 px-1 py-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Arrastar para reordenar"
          className="shrink-0 cursor-grab touch-none rounded text-[var(--color-text-dim)] opacity-0 transition hover:text-[var(--color-text)] group-hover:opacity-100 active:cursor-grabbing"
        >
          <Icon as={GripVertical} size={12} />
        </button>

        <button
          type="button"
          onClick={() => void openSession(repo, project.name, project.icon, project.color)}
          disabled={!repo.existsOnDisk}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[var(--color-text-dim)] transition hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[var(--color-text-dim)]"
          title={
            repo.existsOnDisk
              ? `Nova sessão · ${repo.path}`
              : `Faltando no disco · ${repo.path}`
          }
        >
          <span className="shrink-0" title={LINK_BADGE[repo.linkKind].title}>
            <Icon as={LINK_BADGE[repo.linkKind].icon} size={14} />
          </span>
          <span className="truncate">{repo.label}</span>
          {!repo.existsOnDisk && (
            <span
              className="flex shrink-0 items-center gap-0.5 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-1 text-[10px] font-medium text-[var(--color-danger)]"
              title="Diretório do repo não existe no disco"
            >
              <Icon as={AlertCircle} size={11} />
              {restoring ? 'restaurando…' : 'faltando no disco'}
            </span>
          )}
        </button>

        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              label: 'Nova sessão',
              onClick: () => void openSession(repo, project.name, project.icon, project.color),
            },
            { label: 'Ver sessões…', onClick: () => setSessionsOpen(true) },
            ...(!repo.existsOnDisk
              ? [
                  canRestore
                    ? {
                        label: restoring ? 'Restaurando…' : 'Restaurar repo (clonar)',
                        disabled: restoring,
                        onClick: () => void handleRestore(),
                      }
                    : {
                        label: 'Restaurar repo (clonar)',
                        disabled: true,
                        title: 'Sem remote conhecido — restaure o diretório manualmente',
                        onClick: () => {},
                      },
                ]
              : []),
            { label: 'Editar', onClick: () => setEditOpen(true) },
            {
              label: 'Remover repo',
              danger: true,
              onClick: () => {
                if (confirm(`Apagar repo "${repo.label}"?`)) void onRemove(repo.id)
              },
            },
          ]}
        >
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="shrink-0 rounded px-1 leading-none text-[var(--color-text-dim)] opacity-0 transition hover:text-[var(--color-text)] group-hover:opacity-100"
            title="Ações do repo"
          >
            <Icon as={MoreHorizontal} size={14} />
          </button>
        </Menu>
      </div>

      {restoreError && (
        <div className="mb-1 ml-6 mr-1 break-words rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-2 py-1 text-[10px] text-[var(--color-danger)]">
          Falha ao restaurar: {restoreError}
        </div>
      )}

      <SessionsModal
        repo={repo}
        projectName={project.name}
        projectIcon={project.icon}
        projectColor={project.color}
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
      />

      {editOpen && (
        <EditRepoDialog
          open
          repo={repo}
          onClose={() => setEditOpen(false)}
          onSave={async (input) => {
            await onUpdate(input)
            setEditOpen(false)
          }}
        />
      )}
    </li>
  )
}
