import * as store from './dossier-store'
import { DossierPipeline } from './dossier-pipeline'
import { StubSourceProvider } from './dossier-pipeline-stubs'
import { ClaudeExtractor } from './dossier/claude-extractor'
import { ClaudeSynthesizer } from './dossier/claude-synthesizer'
import { ClaudeVerifier } from './dossier/claude-verifier'
import { TavilySourceProvider } from './ingest/tavily-source-provider'
import { getEnvVar } from './custom-env'
import type { SourceProvider } from './dossier-pipeline-types'

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

export function getDossierPipeline(): DossierPipeline {
  if (!pipeline) {
    pipeline = new DossierPipeline(store, {
      sourceProvider: resolveSourceProvider(),
      extractor: new ClaudeExtractor(),
      verifier: new ClaudeVerifier(),
      synthesizer: new ClaudeSynthesizer(),
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
