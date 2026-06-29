import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { featuresApi } from '@/lib/ipc'
import { suggestFeatures } from '@/features/features/fuzzy'
import { STATUS_META } from '@/features/features/status'
import { useSessionPrefsStore } from '@/lib/session-prefs-store'
import type { EffortLevel, Feature, Repo } from '../../../shared/types/ipc'

// Opções do segmented control de modelo. '' = Padrão (sem --model no spawn).
const MODEL_OPTIONS = [
  { value: '', label: 'Padrão' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
] as const

// Opções do segmented control de effort. '' = Padrão (sem --effort no spawn).
const EFFORT_OPTIONS = [
  { value: '', label: 'Padrão' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
] as const

interface Props {
  open: boolean
  onClose: () => void
  repo: Repo
  // Feature já existente neste projeto (filtradas por projeto do repo).
  // Confirmar dispara o spawn com o name, featureId, model e effort resolvidos.
  onConfirm: (
    name: string | undefined,
    featureId: string | undefined,
    model: string | undefined,
    effort: EffortLevel | undefined,
  ) => void
}

export function SpawnSessionDialog({ open, onClose, repo, onConfirm }: Props) {
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [features, setFeatures] = useState<Feature[]>([])
  // Vínculo explícito (a): selecionado no dropdown. '' = nenhum.
  const [selectedFeature, setSelectedFeature] = useState<string>('')
  // Modelo inicial. '' = default do claude (não passa --model).
  const [model, setModel] = useState<string>('')
  // Effort inicial. '' = default do claude (não passa --effort).
  const [effort, setEffort] = useState<'' | EffortLevel>('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setObjective('')
    setSelectedFeature('')
    // Pré-preenche modelo + effort com os defaults persistidos (Settings → Sessão/Chat).
    void useSessionPrefsStore
      .getState()
      .load()
      .then(() => {
        const { defaultModel, defaultEffort } = useSessionPrefsStore.getState()
        setModel(defaultModel)
        setEffort(defaultEffort)
      })
    // Features ligadas a este repo (linkagem (a) filtrada por repo).
    void featuresApi.list().then((all) => {
      setFeatures(all.filter((f) => f.repos.some((l) => l.repoId === repo.id)))
    })
    setTimeout(() => nameRef.current?.focus(), 0)
  }, [open, repo.id])

  // Fuzzy-match (b): sugestões a partir do objetivo livre, client-side.
  const suggestions = useMemo(() => {
    if (!objective.trim()) return []
    return suggestFeatures(objective, features)
  }, [objective, features])

  // Vínculo efetivo: o explícito vence; senão a melhor sugestão se o usuário
  // aceitou (clicar numa sugestão seta selectedFeature).
  const featureId = selectedFeature || undefined

  function confirm() {
    onConfirm(name.trim() || undefined, featureId, model || undefined, effort || undefined)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Nova sessão · ${repo.label}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm}>Abrir</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          ref={nameRef}
          label="Nome da sessão"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="opcional"
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm()
          }}
        />

        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Modelo</label>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setModel(opt.value)}
                  className={`px-3 py-1.5 text-xs transition ${
                    model === opt.value
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Esforço</label>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
              {EFFORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEffort(opt.value)}
                  className={`px-3 py-1.5 text-xs transition ${
                    effort === opt.value
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full">
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">
            Feature (opcional)
          </label>
          <select
            value={selectedFeature}
            onChange={(e) => setSelectedFeature(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">— sem vínculo —</option>
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title} ({STATUS_META[f.status].label})
              </option>
            ))}
          </select>
        </div>

        <div className="w-full">
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">
            Objetivo da sessão
          </label>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Descreva o que vai fazer — sugerimos uma feature relacionada"
            rows={2}
            className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          {suggestions.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] text-[var(--color-text-dim)]">
                Features relacionadas:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map(({ feature }) => {
                  const on = selectedFeature === feature.id
                  const meta = STATUS_META[feature.status]
                  return (
                    <button
                      key={feature.id}
                      type="button"
                      onClick={() => setSelectedFeature(on ? '' : feature.id)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition ${
                        on
                          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                      }`}
                      title={meta.label}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: meta.color }}
                      />
                      {feature.title}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
