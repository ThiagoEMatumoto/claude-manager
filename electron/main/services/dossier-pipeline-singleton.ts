import * as store from './dossier-store'
import { DossierPipeline } from './dossier-pipeline'
import {
  StubExtractor,
  StubSourceProvider,
  StubSynthesizer,
  StubVerifier,
} from './dossier-pipeline-stubs'
import { TavilySourceProvider } from './ingest/tavily-source-provider'
import type { SourceProvider } from './dossier-pipeline-types'

// Instância única do motor do funil no main. A BUSCA web é real (Tavily + Jina)
// quando há TAVILY_API_KEY; senão cai no provedor stub (app segue funcional, só
// sem web). Extractor/Verifier/Synthesizer ainda são os stubs: a lógica de
// produto (roteamento do verifier, agrupamento da síntese, proveniência
// verbatim) é real; a extração semântica via claude -p entra na próxima fatia.
let pipeline: DossierPipeline | null = null

function resolveSourceProvider(): SourceProvider {
  const key = process.env.TAVILY_API_KEY
  if (key) return new TavilySourceProvider(key)
  console.warn('[dossier] TAVILY_API_KEY ausente — usando provedor stub (busca web desativada)')
  return new StubSourceProvider()
}

export function getDossierPipeline(): DossierPipeline {
  if (!pipeline) {
    pipeline = new DossierPipeline(store, {
      sourceProvider: resolveSourceProvider(),
      extractor: new StubExtractor(),
      verifier: new StubVerifier(),
      synthesizer: new StubSynthesizer(),
    })
  }
  return pipeline
}
