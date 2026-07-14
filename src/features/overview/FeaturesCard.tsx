import { useState } from 'react'
import { relativeTime } from '@/lib/time'
import { useAppStore } from '@/store/appStore'
import { STATUS_META as FEATURE_STATUS_META } from '@/features/features/status'
import { isStalledFeature, selectFeaturesWithoutObjective } from '../../../shared/home-selectors'
import type { OverviewFeatureActivity } from '../../../shared/types/ipc'
import { CardEmpty, HomeCard } from './HomeGrid'

// Card "Features em andamento": atividade real de sessões por feature
// (data.features do agregado), com destaque "parada >3d" via isStalledFeature
// e um resumo "sem OKR" (achado-raiz #2 da curadoria: o dado existia — Onda 0
// — mas não era exposto em lugar nenhum).
export function FeaturesCard({ features }: { features: OverviewFeatureActivity[] }) {
  const setArea = useAppStore((s) => s.setArea)
  const [now] = useState(() => Date.now())
  const withoutObjective = selectFeaturesWithoutObjective(features)

  return (
    <HomeCard
      title="Features em andamento"
      count={features.length}
      action={
        <button
          type="button"
          onClick={() => setArea('features')}
          className="text-[10px] text-[var(--color-text-dim)] transition hover:text-[var(--color-accent)]"
        >
          ver todas
        </button>
      }
    >
      {withoutObjective.length > 0 && (
        <button
          type="button"
          onClick={() => setArea('features')}
          title="Features de trabalho sem vínculo a nenhum objetivo/OKR"
          className="mb-2 flex w-full items-center gap-1.5 rounded-md border border-[var(--color-info)]/40 bg-[var(--color-info)]/10 px-2.5 py-1.5 text-left text-[11px] text-[var(--color-info)] transition hover:bg-[var(--color-info)]/20"
        >
          <span className="font-semibold tabular-nums">{withoutObjective.length}</span>
          feature{withoutObjective.length === 1 ? '' : 's'} de trabalho sem OKR
        </button>
      )}
      {features.length === 0 ? (
        <CardEmpty>Nenhuma feature em andamento.</CardEmpty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {features.map((f) => (
            <FeatureRow key={f.id} feature={f} now={now} />
          ))}
        </ul>
      )}
    </HomeCard>
  )
}

function FeatureRow({ feature, now }: { feature: OverviewFeatureActivity; now: number }) {
  const meta = FEATURE_STATUS_META[feature.status]
  const stalled = isStalledFeature(feature, now)
  return (
    <li className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-2.5 py-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: meta.color }}
        title={meta.label}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">
        {feature.title}
      </span>
      {stalled && (
        <span className="shrink-0 rounded-full border border-[var(--color-warning)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-warning)]">
          parada {relativeTime(feature.lastSessionAt)}
        </span>
      )}
      <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-dim)]">
        {feature.sessionCount === 1 ? '1 sessão' : `${feature.sessionCount} sessões`}
      </span>
      {!stalled && feature.lastSessionAt !== null && (
        <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-dim)]">
          {relativeTime(feature.lastSessionAt)}
        </span>
      )}
    </li>
  )
}
