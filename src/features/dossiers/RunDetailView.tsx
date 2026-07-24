import { useMemo } from 'react'
import { CheckCircle2, PlayCircle } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/features/brand'
import { useDossiersStore, type RunDetail } from '@/store/dossiersStore'
import type { DossierPlanInput, EvidenceRecord, Source } from '../../../shared/types/ipc'
import {
  EVIDENCE_STATE_LABEL,
  SOURCE_CLASS_LABEL,
  TRUST_TIER_COLOR,
  TRUST_TIER_LABEL,
} from './dossier-labels'

function parsePlan(planJson: string | null): DossierPlanInput | null {
  if (!planJson) return null
  try {
    return JSON.parse(planJson) as DossierPlanInput
  } catch {
    return null
  }
}

// Gate A: mostra o plano (sub-perguntas + classes) e o botão de aprovar antes de
// gastar busca/fetch.
function GateAView({ detail }: { detail: RunDetail }) {
  const busy = useDossiersStore((s) => s.busy)
  const approveGateA = useDossiersStore((s) => s.approveGateA)
  const plan = useMemo(() => parsePlan(detail.run.planJson), [detail.run.planJson])

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <h3 className="mb-2 text-sm font-medium text-[var(--color-text)]">Plano da pesquisa</h3>
        {plan ? (
          <>
            <div className="mb-2 text-xs text-[var(--color-text-dim)]">{plan.question}</div>
            <div className="mb-1 text-[11px] font-medium uppercase text-[var(--color-text-dim)]">
              Sub-perguntas
            </div>
            <ul className="mb-2 list-disc pl-4 text-sm text-[var(--color-text)]">
              {plan.subQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1">
              {plan.sourceClasses.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-dim)]"
                >
                  {SOURCE_CLASS_LABEL[c]}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-sm text-[var(--color-text-dim)]">Plano indisponível.</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void approveGateA(detail.run.id)}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-md border border-[var(--color-success)] px-3 py-2 text-sm font-medium text-[var(--color-success)] transition hover:bg-[var(--color-success)]/10 disabled:opacity-50"
      >
        <Icon as={CheckCircle2} size={16} />
        {busy ? 'Processando…' : 'Aprovar Gate A — buscar e extrair'}
      </button>
    </div>
  )
}

// Gate B: tabela de evidência (claim + fonte + trust tier) antes da síntese cara.
function GateBView({ detail }: { detail: RunDetail }) {
  const busy = useDossiersStore((s) => s.busy)
  const approveGateB = useDossiersStore((s) => s.approveGateB)
  const sourcesById = useMemo(() => indexSources(detail.sources), [detail.sources])

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--color-surface)] text-[11px] uppercase text-[var(--color-text-dim)]">
            <tr>
              <th className="px-3 py-2 font-medium">Afirmação</th>
              <th className="px-3 py-2 font-medium">Fonte</th>
              <th className="px-3 py-2 font-medium">Confiança</th>
            </tr>
          </thead>
          <tbody>
            {detail.evidence.map((ev) => {
              const source = sourcesById.get(ev.sourceId)
              return (
                <tr key={ev.id} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 text-[var(--color-text)]">{ev.claim}</td>
                  <td className="px-3 py-2 text-[var(--color-text-dim)]">
                    {source ? SOURCE_CLASS_LABEL[source.sourceClass] : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {source && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                        style={{
                          color: TRUST_TIER_COLOR[source.trustTier],
                          borderColor: `color-mix(in srgb, ${TRUST_TIER_COLOR[source.trustTier]} 45%, transparent)`,
                          background: `color-mix(in srgb, ${TRUST_TIER_COLOR[source.trustTier]} 12%, transparent)`,
                        }}
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: TRUST_TIER_COLOR[source.trustTier] }}
                        />
                        {TRUST_TIER_LABEL[source.trustTier]}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {detail.evidence.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-[var(--color-text-dim)]">
                  Nenhuma evidência extraída.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => void approveGateB(detail.run.id)}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-md border border-[var(--color-success)] px-3 py-2 text-sm font-medium text-[var(--color-success)] transition hover:bg-[var(--color-success)]/10 disabled:opacity-50"
      >
        <Icon as={CheckCircle2} size={16} />
        {busy ? 'Processando…' : 'Aprovar Gate B — verificar e sintetizar'}
      </button>
    </div>
  )
}

// Run concluída: síntese graduada (markdown cru no <pre>, sem dep nova de render)
// + apêndice de proveniência (cada evidence: fonte, verbatim, anchor, state).
function DoneView({ detail }: { detail: RunDetail }) {
  const sourcesById = useMemo(() => indexSources(detail.sources), [detail.sources])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--color-text)]">Síntese</h3>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-xs text-[var(--color-text)]">
          {detail.run.summary ?? '_sem síntese_'}
        </pre>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--color-text)]">Proveniência</h3>
        <div className="flex flex-col gap-2">
          {detail.evidence.map((ev) => (
            <ProvenanceCard key={ev.id} evidence={ev} source={sourcesById.get(ev.sourceId)} />
          ))}
          {detail.evidence.length === 0 && (
            <div className="text-sm text-[var(--color-text-dim)]">Sem registros de evidência.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProvenanceCard({
  evidence,
  source,
}: {
  evidence: EvidenceRecord
  source: Source | undefined
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[var(--color-text)]">{evidence.claim}</span>
        <span className="shrink-0 text-[11px] text-[var(--color-text-dim)]">
          {EVIDENCE_STATE_LABEL[evidence.state]}
        </span>
      </div>
      <blockquote className="mb-1 border-l-2 border-[var(--color-border)] pl-2 text-xs italic text-[var(--color-text-dim)]">
        “{evidence.verbatimQuote}”
      </blockquote>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-dim)]">
        {source && (
          <a
            href={source.url}
            onClick={(e) => {
              e.preventDefault()
              void window.api.shell.openExternal(source.url)
            }}
            className="truncate text-[var(--color-accent)] hover:underline"
            title={source.url}
          >
            {source.title ?? source.url}
          </a>
        )}
        {evidence.anchor && (
          <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono">
            {evidence.anchor}
          </span>
        )}
      </div>
    </div>
  )
}

function indexSources(sources: Source[]): Map<string, Source> {
  const map = new Map<string, Source>()
  for (const s of sources) map.set(s.id, s)
  return map
}

// Despacha o detalhe da run pelo status. Estados intermediários (searching…
// synthesizing) mostram um spinner textual; paused oferece retomar.
export function RunDetailView({ detail }: { detail: RunDetail }) {
  const busy = useDossiersStore((s) => s.busy)
  const resumeRun = useDossiersStore((s) => s.resumeRun)
  const { status } = detail.run

  if (status === 'awaiting_gate_a') return <GateAView detail={detail} />
  if (status === 'awaiting_gate_b') return <GateBView detail={detail} />
  if (status === 'done') return <DoneView detail={detail} />

  if (status === 'failed') {
    return (
      <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-danger)]">
        {detail.run.error ?? 'A run falhou.'}
      </div>
    )
  }

  if (status === 'paused') {
    return (
      <Button
        variant="primary"
        onClick={() => void resumeRun(detail.run.id)}
        disabled={busy}
        className="justify-center"
      >
        <Icon as={PlayCircle} size={16} />
        {busy ? 'Retomando…' : 'Retomar pesquisa'}
      </Button>
    )
  }

  // Estágios em curso (planning/searching/fetching/extracting/verifying/synthesizing).
  return (
    <div className="text-sm text-[var(--color-text-dim)]">
      Processando estágio: {detail.run.stage ?? status}…
    </div>
  )
}
