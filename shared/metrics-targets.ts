// Metas e baselines do roadmap de auto-melhoria de orquestração.
// baseline = ponto de partida medido; target = objetivo a bater.
export const ORCH_KPI = {
  parallelization: { target: 0.3, baseline: 0.0, label: 'Paralelização' },
  delegation: { target: 0.4, baseline: 0.156, label: 'Delegação' },
  // Manager-mode score = subagentTurns / turns. Bands canônicas do kz_dashboard
  // (health.py band_manager): >=0.30 good | >=0.15 watch | <0.15 bad.
  managerMode: { target: 0.3, baseline: 0.15, label: 'Manager-mode' },
} as const

export type OrchKpiKey = keyof typeof ORCH_KPI
