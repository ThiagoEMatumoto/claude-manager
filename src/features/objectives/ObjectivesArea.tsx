import { useMemo, useState } from 'react'
import { useObjectivesStore } from '@/store/objectivesStore'
import type { KeyResult, Objective } from '../../../shared/types/ipc'
import { ObjectivesSidebar, type KindFilter, type StatusFilter } from './ObjectivesSidebar'
import { ObjectiveList } from './ObjectiveList'
import { ObjectiveDetail } from './ObjectiveDetail'
import { ObjectiveDialog } from './ObjectiveDialog'
import { KeyResultDialog } from './KeyResultDialog'
import { useObjectives } from './useObjectives'

export function ObjectivesArea() {
  useObjectives()
  const objectives = useObjectivesStore((s) => s.objectives)
  const selectedId = useObjectivesStore((s) => s.selectedId)
  const selectedDetail = useObjectivesStore((s) => s.selectedDetail)
  const filter = useObjectivesStore((s) => s.filter)
  const loading = useObjectivesStore((s) => s.loading)
  const detailLoading = useObjectivesStore((s) => s.detailLoading)
  const select = useObjectivesStore((s) => s.select)
  const setFilter = useObjectivesStore((s) => s.setFilter)
  const refresh = useObjectivesStore((s) => s.refresh)
  const createObjective = useObjectivesStore((s) => s.createObjective)
  const updateObjective = useObjectivesStore((s) => s.updateObjective)
  const archiveObjective = useObjectivesStore((s) => s.archiveObjective)
  const createKr = useObjectivesStore((s) => s.createKr)
  const updateKr = useObjectivesStore((s) => s.updateKr)
  const deleteKr = useObjectivesStore((s) => s.deleteKr)

  // query/tags filtram em memória; kind/status vão pro filtro do store (o main
  // exclui arquivados por default — só voltam com status='archived' explícito).
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [objDialogOpen, setObjDialogOpen] = useState(false)
  const [editingObjective, setEditingObjective] = useState<Objective | null>(null)
  const [krDialogOpen, setKrDialogOpen] = useState(false)
  const [editingKr, setEditingKr] = useState<KeyResult | null>(null)

  const kindFilter: KindFilter = filter.kind ?? 'all'
  const statusFilter: StatusFilter = filter.status ?? 'all'

  const q = query.trim().toLowerCase()
  const listed = useMemo(() => {
    return objectives.filter((o) => {
      if (q && !o.title.toLowerCase().includes(q)) return false
      if (selectedTags.length > 0 && !selectedTags.every((t) => o.tags.includes(t))) return false
      return true
    })
  }, [objectives, q, selectedTags])

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  function openCreate() {
    setEditingObjective(null)
    setObjDialogOpen(true)
  }

  function openEdit() {
    if (!selectedDetail) return
    setEditingObjective(selectedDetail)
    setObjDialogOpen(true)
  }

  function openNewKr() {
    setEditingKr(null)
    setKrDialogOpen(true)
  }

  function openEditKr(kr: KeyResult) {
    setEditingKr(kr)
    setKrDialogOpen(true)
  }

  async function handleArchive() {
    if (!selectedDetail) return
    if (!window.confirm(`Arquivar "${selectedDetail.title}"?`)) return
    await archiveObjective(selectedDetail.id)
  }

  async function handleDeleteKr(id: string) {
    if (!window.confirm('Excluir este key result?')) return
    await deleteKr(id)
  }

  return (
    <>
      <ObjectivesSidebar
        objectives={objectives}
        selectedId={selectedId}
        loading={loading}
        query={query}
        kindFilter={kindFilter}
        statusFilter={statusFilter}
        selectedTags={selectedTags}
        onQuery={setQuery}
        onKindFilter={(k) => void setFilter({ ...filter, kind: k === 'all' ? undefined : k })}
        onStatusFilter={(s) => void setFilter({ ...filter, status: s === 'all' ? undefined : s })}
        onToggleTag={toggleTag}
        onSelect={(id) => void select(id)}
        onReload={() => void refresh()}
        onNew={openCreate}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {selectedId ? (
          <ObjectiveDetail
            detail={selectedDetail}
            loading={detailLoading}
            onBack={() => void select(null)}
            onEdit={openEdit}
            onArchive={() => void handleArchive()}
            onNewKr={openNewKr}
            onEditKr={openEditKr}
            onDeleteKr={(id) => void handleDeleteKr(id)}
            onManualProgress={(value) =>
              void updateObjective({ id: selectedDetail?.id ?? '', progressManual: value })
            }
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <ObjectiveList
              objectives={listed}
              selectedId={selectedId}
              onSelect={(id) => void select(id)}
            />
          </div>
        )}
      </main>

      <ObjectiveDialog
        open={objDialogOpen}
        onClose={() => setObjDialogOpen(false)}
        objective={editingObjective}
        onCreate={async (input) => {
          const created = await createObjective(input)
          void select(created.id)
        }}
        onUpdate={async (input) => {
          await updateObjective(input)
        }}
      />

      {selectedDetail && (
        <KeyResultDialog
          open={krDialogOpen}
          onClose={() => setKrDialogOpen(false)}
          objectiveId={selectedDetail.id}
          kr={editingKr}
          onCreate={async (input) => {
            await createKr(input)
          }}
          onUpdate={async (input) => {
            await updateKr(input)
          }}
        />
      )}
    </>
  )
}
