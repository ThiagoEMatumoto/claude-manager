// Metas e baselines do roadmap de auto-melhoria de orquestração.
// baseline = ponto de partida medido; target = objetivo a bater.
export const ORCH_KPI = {
  parallelization: { target: 0.3, baseline: 0.0, label: 'Paralelização' },
  delegation: { target: 0.4, baseline: 0.156, label: 'Delegação' },
} as const

export type OrchKpiKey = keyof typeof ORCH_KPI
