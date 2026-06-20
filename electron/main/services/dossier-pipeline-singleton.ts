import * as store from './dossier-store'
import { DossierPipeline } from './dossier-pipeline'
import {
  StubExtractor,
  StubSourceProvider,
  StubSynthesizer,
  StubVerifier,
} from './dossier-pipeline-stubs'

// Instância única do motor do funil no main. Nesta fatia roda com os STUBS
// determinísticos (sem web real, sem chave de API): a lógica de produto
// (roteamento do verifier, agrupamento da síntese, proveniência verbatim) é real;
// só a ingestão e a prosa final são fabricadas. Os provedores reais entram nas
// próximas fatias trocando estas deps.
let pipeline: DossierPipeline | null = null

export function getDossierPipeline(): DossierPipeline {
  if (!pipeline) {
    pipeline = new DossierPipeline(store, {
      sourceProvider: new StubSourceProvider(),
      extractor: new StubExtractor(),
      verifier: new StubVerifier(),
      synthesizer: new StubSynthesizer(),
    })
  }
  return pipeline
}
