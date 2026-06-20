import { create } from 'zustand'
import { dossiersApi } from '@/lib/ipc'
import type {
  CreateDossierApiInput,
  Dossier,
  DossierRun,
  EvidenceRecord,
  Source,
} from '../../shared/types/ipc'

// Dono único das assinaturas de broadcast (assinadas uma vez, StrictMode-safe —
// mesmo padrão do handoffsStore/objectivesStore).
let offUpdated: (() => void) | null = null
let offRunUpdated: (() => void) | null = null
let watchStarted = false

// Detalhe carregado sob demanda da run selecionada: evidência + fontes, indexadas
// por sourceId pra o apêndice de proveniência casar cada evidence à sua fonte.
export interface RunDetail {
  run: DossierRun
  evidence: EvidenceRecord[]
  sources: Source[]
}

interface DossiersState {
  dossiers: Dossier[]
  loading: boolean
  error: string | null

  // Seleção da UI: dossiê → suas runs → a run em detalhe.
  selectedDossierId: string | null
  runs: DossierRun[]
  selectedRunId: string | null
  runDetail: RunDetail | null
  busy: boolean

  load: () => Promise<void>
  create: (input: CreateDossierApiInput) => Promise<Dossier | null>
  archive: (id: string) => Promise<void>

  selectDossier: (id: string | null) => Promise<void>
  loadRuns: (dossierId: string) => Promise<void>
  selectRun: (runId: string | null) => Promise<void>
  loadRunDetail: (runId: string) => Promise<void>

  startRun: (dossierId: string) => Promise<void>
  approveGateA: (runId: string) => Promise<void>
  approveGateB: (runId: string, keepEvidenceIds?: string[]) => Promise<void>
  resumeRun: (runId: string) => Promise<void>

  startWatch: () => void
  stopWatch: () => void
}

export const useDossiersStore = create<DossiersState>((set, get) => {
  // Após uma mutação de run, recarrega as runs do dossiê selecionado e re-resolve
  // o detalhe da run mutada. Compartilhado pelas três aprovações + resume.
  async function refreshAfterRunMutation(runId: string): Promise<void> {
    const { selectedDossierId } = get()
    if (selectedDossierId) await get().loadRuns(selectedDossierId)
    await get().selectRun(runId)
  }

  return {
    dossiers: [],
    loading: false,
    error: null,
    selectedDossierId: null,
    runs: [],
    selectedRunId: null,
    runDetail: null,
    busy: false,

    load: async () => {
      set({ loading: true, error: null })
      try {
        const dossiers = await dossiersApi.list()
        set({ dossiers, loading: false })
      } catch (err) {
        set({ loading: false, error: err instanceof Error ? err.message : String(err) })
      }
    },

    create: async (input) => {
      set({ error: null })
      try {
        const dossier = await dossiersApi.create(input)
        await get().load()
        return dossier
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
        return null
      }
    },

    archive: async (id) => {
      try {
        await dossiersApi.archive(id)
        // Se o arquivado era o selecionado, limpa a seleção em cascata.
        if (get().selectedDossierId === id) {
          set({ selectedDossierId: null, runs: [], selectedRunId: null, runDetail: null })
        }
        await get().load()
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    },

    selectDossier: async (id) => {
      set({ selectedDossierId: id, runs: [], selectedRunId: null, runDetail: null })
      if (id) await get().loadRuns(id)
    },

    loadRuns: async (dossierId) => {
      try {
        const runs = await dossiersApi.listRuns(dossierId)
        set({ runs })
        // Re-resolve o detalhe da run selecionada se ela ainda existe (refresh ao vivo).
        const selected = get().selectedRunId
        if (selected && runs.some((r) => r.id === selected)) {
          await get().loadRunDetail(selected)
        }
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    },

    selectRun: async (runId) => {
      set({ selectedRunId: runId, runDetail: null })
      if (runId) await get().loadRunDetail(runId)
    },

    loadRunDetail: async (runId) => {
      try {
        const [run, evidence, sources] = await Promise.all([
          dossiersApi.getRun(runId),
          dossiersApi.listEvidence(runId),
          dossiersApi.listSources(runId),
        ])
        if (!run) {
          set({ runDetail: null })
          return
        }
        set({ runDetail: { run, evidence, sources } })
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    },

    startRun: async (dossierId) => {
      set({ busy: true, error: null })
      try {
        const run = await dossiersApi.startRun({ dossierId })
        await get().loadRuns(dossierId)
        await get().selectRun(run.id)
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      } finally {
        set({ busy: false })
      }
    },

    approveGateA: async (runId) => {
      set({ busy: true, error: null })
      try {
        await dossiersApi.approveGateA({ runId })
        await refreshAfterRunMutation(runId)
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      } finally {
        set({ busy: false })
      }
    },

    approveGateB: async (runId, keepEvidenceIds) => {
      set({ busy: true, error: null })
      try {
        await dossiersApi.approveGateB({ runId, keepEvidenceIds })
        await refreshAfterRunMutation(runId)
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      } finally {
        set({ busy: false })
      }
    },

    resumeRun: async (runId) => {
      set({ busy: true, error: null })
      try {
        await dossiersApi.resumeRun({ runId })
        await refreshAfterRunMutation(runId)
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      } finally {
        set({ busy: false })
      }
    },

    startWatch: () => {
      if (watchStarted) return
      watchStarted = true
      // dossier:updated → recarrega a lista. dossier:run-updated → se a run pertence
      // ao dossiê selecionado, recarrega runs + detalhe (refresh ao vivo).
      offUpdated = dossiersApi.onUpdated(() => {
        void get().load()
      })
      offRunUpdated = dossiersApi.onRunUpdated(() => {
        const dossierId = get().selectedDossierId
        if (dossierId) void get().loadRuns(dossierId)
      })
    },

    stopWatch: () => {
      if (offUpdated) {
        offUpdated()
        offUpdated = null
      }
      if (offRunUpdated) {
        offRunUpdated()
        offRunUpdated = null
      }
      watchStarted = false
    },
  }
})
