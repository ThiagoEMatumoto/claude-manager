import { useEffect, useState } from 'react'
import { objectivesApi } from '@/lib/ipc'
import type { ObjectiveWithProgress } from '../../../shared/types/ipc'

export interface ObjectiveLookups {
  objectives: ObjectiveWithProgress[]
  // KR id → título (pra resolver labels de vínculos a key results).
  krTitles: Map<string, string>
  // KR id → objective id (pra navegar: KR não tem view própria, leva pro
  // objetivo dono — Onda 2).
  krObjectiveId: Map<string, string>
}

// Objetivos + títulos dos KRs pra popular selects e resolver labels de chips.
// KRs exigem o detail de cada objetivo — volume pequeno (app pessoal), mesmo
// trade-off de TasksArea, que faz o mesmo fan-out.
export function useObjectiveLookups(): ObjectiveLookups {
  const [objectives, setObjectives] = useState<ObjectiveWithProgress[]>([])
  const [krTitles, setKrTitles] = useState<Map<string, string>>(new Map())
  const [krObjectiveId, setKrObjectiveId] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let alive = true
    void (async () => {
      const objs = await objectivesApi.list()
      if (!alive) return
      setObjectives(objs)
      const details = await Promise.all(objs.map((o) => objectivesApi.get(o.id)))
      if (!alive) return
      const titles = new Map<string, string>()
      const objectiveIds = new Map<string, string>()
      for (const d of details) {
        if (!d) continue
        for (const kr of d.keyResults) {
          titles.set(kr.id, kr.title)
          objectiveIds.set(kr.id, d.id)
        }
      }
      setKrTitles(titles)
      setKrObjectiveId(objectiveIds)
    })()
    return () => {
      alive = false
    }
  }, [])

  return { objectives, krTitles, krObjectiveId }
}
