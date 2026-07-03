import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { featuresApi } from '@/lib/ipc'
import { suggestFeatures } from '@/features/features/fuzzy'
import { STATUS_META } from '@/features/features/status'
import { useSessionPrefsStore } from '@/lib/session-prefs-store'
import { PERMISSION_OPTIONS } from './permission-modes'
import { MODEL_OPTIONS, EFFORT_OPTIONS, ADVISOR_OPTIONS } from './spawn-options'
import { WORK_MODE_PRESETS } from './work-mode-presets'
import type {
  AdvisorModel,
  EffortLevel,
  Feature,
  PermissionMode,
  Repo,
} from '../../../shared/types/ipc'

interface Props {
  open: boolean
  onClose: () => void
  repo: Repo
  // Feature já existente neste projeto (filtradas por projeto do repo).
  // Confirmar dispara o spawn com name, featureId, model, effort, permission,
  // advisorModel e initialCommand (este último só vem de um preset, ex. Ultracode).
  onConfirm: (
    name: string | undefined,
    featureId: string | undefined,
    model: string | undefined,
    effort: EffortLevel | undefined,
    permission: PermissionMode,
    advisorModel: AdvisorModel | undefined,
    initialCommand: string | undefined,
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
  // Modo de permissão inicial. 'default' = pergunta tudo (padrão da CLI).
  const [permission, setPermission] = useState<PermissionMode>('default')
  // Advisor tool inicial. '' = desligado (não passa --advisor).
  const [advisorModel, setAdvisorModel] = useState<'' | AdvisorModel>('')
  // Slash command a injetar no boot — só preenchido por um preset (ex. Ultracode).
  const [initialCommand, setInitialCommand] = useState('')
  // Só pra destacar o botão do preset escolhido; ajustes manuais depois não o desmarcam.
  const [selectedPreset, setSelectedPreset] = useState<string>('default')
  // bypassPermissions é destrutivo (pula TODAS as permissões): exige um 2º clique.
  const [confirmingBypass, setConfirmingBypass] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  // Aplica os overrides do preset aos controles — o usuário ainda pode ajustar
  // cada um manualmente depois (mesmo espírito do pré-preenchimento de defaults).
  // Campo ausente no preset = NÃO mexe no controle (contrato documentado em
  // work-mode-presets.ts); só "Padrão" é especial e reverte tudo pros defaults
  // persistidos, já que é o único preset sem nenhum campo próprio.
  function applyPreset(id: string) {
    setSelectedPreset(id)
    const preset = WORK_MODE_PRESETS.find((p) => p.id === id)
    if (!preset) return
    if (id === 'default') {
      const { defaultModel, defaultEffort, defaultPermission, defaultAdvisor } =
        useSessionPrefsStore.getState()
      setModel(defaultModel)
      setEffort(defaultEffort)
      setPermission(defaultPermission)
      setAdvisorModel(defaultAdvisor)
      setInitialCommand('')
      return
    }
    if (preset.model !== undefined) setModel(preset.model)
    if (preset.effort !== undefined) setEffort(preset.effort)
    if (preset.permission !== undefined) setPermission(preset.permission)
    if (preset.advisorModel !== undefined) setAdvisorModel(preset.advisorModel)
    if (preset.initialCommand !== undefined) setInitialCommand(preset.initialCommand)
  }

  useEffect(() => {
    if (!open) return
    setName('')
    setObjective('')
    setSelectedFeature('')
    setConfirmingBypass(false)
    setInitialCommand('')
    setSelectedPreset('default')
    // Pré-preenche modelo + effort + permissão + advisor com os defaults
    // persistidos (Settings → Sessão/Chat).
    void useSessionPrefsStore
      .getState()
      .load()
      .then(() => {
        const { defaultModel, defaultEffort, defaultPermission, defaultAdvisor } =
          useSessionPrefsStore.getState()
        setModel(defaultModel)
        setEffort(defaultEffort)
        setPermission(defaultPermission)
        setAdvisorModel(defaultAdvisor)
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

  function pickPermission(v: PermissionMode) {
    setPermission(v)
    setConfirmingBypass(false)
  }

  function confirm() {
    // bypassPermissions pula todas as permissões — pede um 2º clique de confirmação.
    if (permission === 'bypassPermissions' && !confirmingBypass) {
      setConfirmingBypass(true)
      return
    }
    onConfirm(
      name.trim() || undefined,
      featureId,
      model || undefined,
      effort || undefined,
      permission,
      advisorModel || undefined,
      initialCommand || undefined,
    )
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
          <Button onClick={confirm}>{confirmingBypass ? 'Confirmar bypass' : 'Abrir'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">
            Modo de trabalho
          </label>
          <div className="flex flex-wrap gap-1.5">
            {WORK_MODE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                title={preset.description}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  selectedPreset === preset.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

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

          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Advisor</label>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-border)]">
              {ADVISOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAdvisorModel(opt.value)}
                  className={`px-3 py-1.5 text-xs transition ${
                    advisorModel === opt.value
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {advisorModel && (
              <div className="mt-1 text-[10px] text-[var(--color-text-dim)]">
                Experimental — só Anthropic API direta.
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Permissão</label>
          <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-[var(--color-border)]">
            {PERMISSION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => pickPermission(opt.value)}
                className={`shrink-0 px-3 py-1.5 text-xs transition ${
                  permission === opt.value
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {permission === 'bypassPermissions' && (
            <div className="mt-1.5 text-[11px] text-[var(--color-danger)]">
              Bypass pula TODAS as permissões — o Claude executa qualquer ação sem
              perguntar. Clique em "Confirmar bypass" para prosseguir.
            </div>
          )}
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
