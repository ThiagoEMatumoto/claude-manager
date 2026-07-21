import * as store from './dossier-store'
import { DossierPipeline } from './dossier-pipeline'
import {
  StubSourceProvider,
  StubExtractor,
  StubVerifier,
  StubSynthesizer,
} from './dossier-pipeline-stubs'
import { ClaudeExtractor } from './dossier/claude-extractor'
import { ClaudeSynthesizer } from './dossier/claude-synthesizer'
import { ClaudeVerifier } from './dossier/claude-verifier'
import { TavilySourceProvider } from './ingest/tavily-source-provider'
import { getEnvVar } from './custom-env'
import type { Extractor, SourceProvider, Synthesizer, Verifier } from './dossier-pipeline-types'

// Instância única do motor do funil no main. A BUSCA web é real (Tavily + Jina)
// quando há TAVILY_API_KEY; senão cai no provedor stub (app segue funcional, só
// sem web). Extração, verificação cruzada e síntese são reais via `claude -p`;
// o roteamento por trust tier segue determinístico (routeEvidenceState).
let pipeline: DossierPipeline | null = null

export const TAVILY_API_KEY = 'TAVILY_API_KEY'

// A UI usa isto pro banner "busca web desligada" — a falha deixa de ser silenciosa.
export function isWebSearchEnabled(): boolean {
  return Boolean(getEnvVar(TAVILY_API_KEY))
}

function resolveSourceProvider(): SourceProvider {
  const key = getEnvVar(TAVILY_API_KEY)
  if (key) return new TavilySourceProvider(key)
  console.warn('[dossier] TAVILY_API_KEY ausente — usando provedor stub (busca web desativada)')
  return new StubSourceProvider()
}

// Seam de E2E: com CM_E2E_STUB_PIPELINE=1, as etapas que chamam `claude -p`
// (extração/verificação/síntese) são substituídas por stubs determinísticos.
// Sem isto, o fluxo E2E invocaria o CLI real — lento e não-determinístico.
// A lógica de produto (roteamento por trust tier, agrupamento) continua real.
function resolveStageServices(): {
  extractor: Extractor
  verifier: Verifier
  synthesizer: Synthesizer
} {
  if (process.env.CM_E2E_STUB_PIPELINE === '1') {
    console.warn('[dossier] CM_E2E_STUB_PIPELINE=1 — etapas claude -p substituídas por stubs')
    return {
      extractor: new StubExtractor(),
      verifier: new StubVerifier(),
      synthesizer: new StubSynthesizer(),
    }
  }
  return {
    extractor: new ClaudeExtractor(),
    verifier: new ClaudeVerifier(),
    synthesizer: new ClaudeSynthesizer(),
  }
}

export function getDossierPipeline(): DossierPipeline {
  if (!pipeline) {
    pipeline = new DossierPipeline(store, {
      sourceProvider: resolveSourceProvider(),
      ...resolveStageServices(),
    })
  }
  return pipeline
}

// Descarta a instância cacheada para que a próxima run releia as credenciais
// (chamada quando `custom_env_vars` muda — sem isso, configurar a chave só teria
// efeito depois de reiniciar o app).
export function resetDossierPipeline(): void {
  pipeline = null
}
