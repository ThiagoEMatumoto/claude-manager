import { describe, expect, it } from 'vitest'
import {
  decideObjectiveLink,
  decideRegistration,
  deriveTitle,
  fuzzyScore,
  humanizeBranch,
  isProtectedBranch,
  normalizeBranch,
  OBJECTIVE_LINK_THRESHOLD_HIGH,
  OBJECTIVE_LINK_THRESHOLD_MEDIUM,
  pickWorkBranch,
  type RegistrationInputs,
} from './feature-heuristics'

describe('pickWorkBranch', () => {
  it('escolhe a branch feat/* sobre a main inicial (a causa do bug)', () => {
    // Sessão começa na main e cria a branch de trabalho dentro dela.
    expect(pickWorkBranch(['main', 'feat/metrics-kpi-targets'])).toBe('feat/metrics-kpi-targets')
  })

  it('pega a ÚLTIMA não-protegida quando há várias', () => {
    expect(pickWorkBranch(['main', 'feat/a', 'main', 'feat/b'])).toBe('feat/b')
  })

  it('cai na última branch quando todas são protegidas (trabalho na main)', () => {
    expect(pickWorkBranch(['main', 'master'])).toBe('master')
  })

  it('retorna null sem nenhuma branch', () => {
    expect(pickWorkBranch([])).toBeNull()
    expect(pickWorkBranch(['', '  '])).toBeNull()
  })
})

describe('isProtectedBranch', () => {
  it('reconhece protegidas (case-insensitive) e libera feat/*', () => {
    expect(isProtectedBranch('main')).toBe(true)
    expect(isProtectedBranch('MASTER')).toBe(true)
    expect(isProtectedBranch('develop')).toBe(true)
    expect(isProtectedBranch('feat/x')).toBe(false)
  })
})

describe('normalizeBranch', () => {
  it('descarta vazio/HEAD/detached', () => {
    expect(normalizeBranch(null)).toBeNull()
    expect(normalizeBranch('HEAD')).toBeNull()
    expect(normalizeBranch('(detached)')).toBeNull()
    expect(normalizeBranch('  feat/x  ')).toBe('feat/x')
  })
})

describe('humanizeBranch', () => {
  it('humaniza tirando o prefixo e os separadores', () => {
    expect(humanizeBranch('feat/penalty-clause-s4')).toBe('Penalty clause s4')
    expect(humanizeBranch('fix/auth_redirect')).toBe('Auth redirect')
  })
})

describe('deriveTitle', () => {
  it('deriva da 1ª linha do prompt, capitaliza e trunca', () => {
    expect(deriveTitle('investiga o bug do registro\nlinha 2')).toBe(
      'Investiga o bug do registro',
    )
    expect(deriveTitle('a'.repeat(100))?.length).toBe(60)
  })

  it('retorna null para prompt vazio/nulo', () => {
    expect(deriveTitle(null)).toBeNull()
    expect(deriveTitle('   \n  ')).toBeNull()
  })
})

describe('fuzzyScore', () => {
  it('dá 1 em substring e agrupa por overlap de tokens', () => {
    expect(fuzzyScore('arruma o login do usuario', 'login')).toBe(1)
    expect(fuzzyScore('reordenar projetos e repos', 'Reordenar projetos')).toBeGreaterThanOrEqual(
      0.5,
    )
    expect(fuzzyScore('algo totalmente diferente', 'Metrics kpi')).toBeLessThan(0.5)
  })
})

describe('decideRegistration', () => {
  const base: RegistrationInputs = {
    synthMode: 'threshold',
    userTurns: 5,
    editCount: 10,
    workBranch: null,
    firstPrompt: null,
    byBranchFeatureId: null,
    fuzzyMatch: null,
  }

  it('CRIA por objetivo no trabalho na main (o caso do bug) — antes pulava', () => {
    const d = decideRegistration({ ...base, firstPrompt: 'investiga o registro de features' })
    expect(d).toEqual({ action: 'create', title: 'Investiga o registro de features' })
  })

  it('CRIA por branch quando há feat/* nova', () => {
    const d = decideRegistration({ ...base, workBranch: 'feat/metrics-kpi-targets' })
    expect(d).toEqual({ action: 'create', title: 'Metrics kpi targets' })
  })

  it('LINKA a feature existente da branch de trabalho', () => {
    const d = decideRegistration({ ...base, workBranch: 'feat/x', byBranchFeatureId: 'F1' })
    expect(d).toEqual({ action: 'link', featureId: 'F1' })
  })

  it('LINKA por fuzzy de objetivo acima do threshold', () => {
    const d = decideRegistration({
      ...base,
      firstPrompt: 'arruma o login',
      fuzzyMatch: { featureId: 'F2', score: 0.8 },
    })
    expect(d).toEqual({ action: 'link', featureId: 'F2' })
  })

  it('PULA sessão trivial em modo threshold (<2 turns ou 0 edits)', () => {
    expect(decideRegistration({ ...base, userTurns: 1, firstPrompt: 'x' }).action).toBe('skip')
    expect(decideRegistration({ ...base, editCount: 0, firstPrompt: 'x' }).action).toBe('skip')
  })

  it('em modo auto, ignora a guarda de atividade e cria', () => {
    const d = decideRegistration({
      ...base,
      synthMode: 'auto',
      userTurns: 0,
      editCount: 0,
      firstPrompt: 'qualquer coisa',
    })
    expect(d.action).toBe('create')
  })

  it('PULA quando não há branch nem prompt para nomear', () => {
    expect(decideRegistration({ ...base, firstPrompt: null }).action).toBe('skip')
  })
})

describe('decideObjectiveLink', () => {
  it('LINKA em score alto (>= threshold alto)', () => {
    expect(decideObjectiveLink(OBJECTIVE_LINK_THRESHOLD_HIGH)).toBe('link')
    expect(decideObjectiveLink(1)).toBe('link')
  })

  it('sinaliza needs-review em score médio (entre os dois thresholds)', () => {
    expect(decideObjectiveLink(OBJECTIVE_LINK_THRESHOLD_MEDIUM)).toBe('needs-review')
    expect(decideObjectiveLink(OBJECTIVE_LINK_THRESHOLD_HIGH - 0.01)).toBe('needs-review')
  })

  it('PULA em score baixo (abaixo do threshold médio) — nunca grava silenciosamente', () => {
    expect(decideObjectiveLink(OBJECTIVE_LINK_THRESHOLD_MEDIUM - 0.01)).toBe('skip')
    expect(decideObjectiveLink(0)).toBe('skip')
  })
})
