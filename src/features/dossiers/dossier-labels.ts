import type {
  DossierRunStatus,
  EvidenceState,
  SourceClass,
  TrustTier,
} from '../../../shared/types/ipc'

// Labels e cores compartilhados pelo painel de dossiês. Tokens de cor do tema
// (var(--color-*)), mesmo vocabulário visual do HandoffsPanel.

export const RUN_STATUS_LABEL: Record<DossierRunStatus, string> = {
  planning: 'Planejando',
  awaiting_gate_a: 'Aguardando Gate A',
  searching: 'Buscando',
  fetching: 'Baixando',
  extracting: 'Extraindo',
  awaiting_gate_b: 'Aguardando Gate B',
  verifying: 'Verificando',
  synthesizing: 'Sintetizando',
  done: 'Concluído',
  failed: 'Falhou',
  paused: 'Pausado',
}

export const RUN_STATUS_COLOR: Record<DossierRunStatus, string> = {
  planning: 'var(--color-text-dim)',
  awaiting_gate_a: 'var(--color-warning)',
  searching: 'var(--color-info)',
  fetching: 'var(--color-info)',
  extracting: 'var(--color-info)',
  awaiting_gate_b: 'var(--color-warning)',
  verifying: 'var(--color-info)',
  synthesizing: 'var(--color-info)',
  done: 'var(--color-success)',
  failed: 'var(--color-danger)',
  paused: 'var(--color-text-dim)',
}

export const SOURCE_CLASS_LABEL: Record<SourceClass, string> = {
  primary_official: 'Fonte oficial',
  academic: 'Acadêmica',
  reputable_press: 'Imprensa',
  practitioner_video: 'Vídeo',
  forum_ugc: 'Fórum',
  vendor_marketing: 'Marketing',
  blog_seo: 'Blog/SEO',
}

export const TRUST_TIER_LABEL: Record<TrustTier, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  biased: 'Enviesada',
}

export const TRUST_TIER_COLOR: Record<TrustTier, string> = {
  high: 'var(--color-success)',
  medium: 'var(--color-info)',
  low: 'var(--color-text-dim)',
  biased: 'var(--color-warning)',
}

export const EVIDENCE_STATE_LABEL: Record<EvidenceState, string> = {
  primary_accepted: 'Primário aceito',
  corroborated: 'Corroborado',
  single_source: 'Fonte única',
  contested: 'Contestado',
  unverified: 'Não verificado',
  refuted: 'Refutado',
}
