import {
  routeEvidenceState,
  type ExtractedClaim,
  type Extractor,
  type FetchedDocument,
  type SearchOpts,
  type Snippet,
  type SourceProvider,
  type SynthRecord,
  type Synthesizer,
  type VerifyCandidate,
  type Verifier,
  type VerifyVerdict,
} from './dossier-pipeline-types'

// Stubs determinísticos: sem web real. A LÓGICA de produto (roteamento do verifier,
// agrupamento da síntese, proveniência verbatim do extractor) é REAL; só a
// ingestão (search/fetch) e a prosa final são fixas/fabricadas.

export class StubSourceProvider implements SourceProvider {
  searchCalls = 0
  fetchCalls = 0
  private readonly failOnFetchCall: number

  // failOnFetchCall: índice 1-based; o k-ésimo `fetch` lança (simula throttle).
  // 0 = nunca falha.
  constructor(opts?: { failOnFetchCall?: number }) {
    this.failOnFetchCall = opts?.failOnFetchCall ?? 0
  }

  async search(query: string, opts?: SearchOpts): Promise<Snippet[]> {
    this.searchCalls++
    const limit = opts?.limit ?? 4
    // Inclui sempre 1 primary_official e 1 vendor_marketing pra exercitar o
    // roteamento do verifier e a seção "Sinal de mercado".
    const base: Snippet[] = [
      {
        url: `https://gov.example/${encodeURIComponent(query)}/official`,
        title: `Official record on ${query}`,
        publisher: 'Gov Portal',
        sourceClass: 'primary_official',
        snippet: `Official source addressing ${query}.`,
      },
      {
        url: `https://vendor.example/${encodeURIComponent(query)}/promo`,
        title: `Vendor take on ${query}`,
        publisher: 'Acme Vendor',
        sourceClass: 'vendor_marketing',
        snippet: `Buy our solution for ${query}.`,
      },
      {
        url: `https://press.example/${encodeURIComponent(query)}/news`,
        title: `Press coverage of ${query}`,
        publisher: 'Daily Press',
        sourceClass: 'reputable_press',
        snippet: `Reporting on ${query}.`,
      },
      {
        url: `https://forum.example/${encodeURIComponent(query)}/thread`,
        title: `Forum thread on ${query}`,
        publisher: 'Community Forum',
        sourceClass: 'forum_ugc',
        snippet: `Anecdote about ${query}.`,
      },
    ]
    return base.slice(0, limit)
  }

  async fetch(url: string): Promise<FetchedDocument> {
    this.fetchCalls++
    if (this.failOnFetchCall > 0 && this.fetchCalls === this.failOnFetchCall) {
      throw new Error(`stub fetch throttled on call ${this.fetchCalls} (${url})`)
    }
    // Texto fixo com 2 segmentos; as quotes do extractor são substrings deste texto.
    const first = 'The reported outcome improved measurably after the intervention.'
    const second = 'Independent analysis confirmed the same directional effect.'
    const text = `${first} ${second}`
    return {
      url,
      title: `Document for ${url}`,
      text,
      segments: [
        { anchor: 'char:0', text: first },
        { anchor: `char:${first.length + 1}`, text: second },
      ],
    }
  }
}

export class StubExtractor implements Extractor {
  // Extrai 1-2 claims por doc; cada verbatimQuote é substring REAL de doc.text e
  // anchor é o offset de char REAL dessa substring (proveniência verdadeira).
  async extract(doc: FetchedDocument, _sourceId: string): Promise<ExtractedClaim[]> {
    const segments = doc.segments ?? [{ anchor: 'char:0', text: doc.text }]
    const claims: ExtractedClaim[] = []
    for (let i = 0; i < Math.min(2, segments.length); i++) {
      const quote = segments[i].text
      const offset = doc.text.indexOf(quote)
      if (offset < 0) {
        throw new Error(`stub extractor: segment text not found in doc.text (segment ${i})`)
      }
      claims.push({
        claim: `Claim ${i + 1} derived from ${doc.url}`,
        verbatimQuote: quote,
        anchor: `char:${offset}`,
        importance: i === 0 ? 0.9 : 0.4,
      })
    }
    return claims
  }
}

// Base de um claim para o pareamento determinístico do stub: 'não X' e 'X' têm a
// mesma base, e é isso que caracteriza a contradição aqui.
function claimBase(claim: string): { base: string; negated: boolean } {
  const trimmed = claim.trim().toLowerCase()
  const match = /^(não|nao|not)\s+(.*)$/.exec(trimmed)
  return match ? { base: match[2], negated: true } : { base: trimmed, negated: false }
}

// Verifier com roteamento REAL (regra de produto compartilhada com o verifier
// Claude, via routeEvidenceState). O que é stub aqui é só o pareamento semântico,
// que vira uma comparação textual determinística entre fontes DISTINTAS:
//  - mesma base e mesma polaridade  → corrobora
//  - mesma base e polaridade oposta → contradiz (→ contested)
export class StubVerifier implements Verifier {
  async verify(candidates: readonly VerifyCandidate[]): Promise<Map<string, VerifyVerdict>> {
    const parsed = candidates.map((c) => ({ candidate: c, ...claimBase(c.claim) }))
    const out = new Map<string, VerifyVerdict>()

    for (const self of parsed) {
      const corroboratedBy: string[] = []
      const contradictedBy: string[] = []
      for (const other of parsed) {
        if (other.candidate.id === self.candidate.id) continue
        if (other.candidate.sourceId === self.candidate.sourceId) continue
        if (other.base !== self.base) continue
        if (other.negated === self.negated) corroboratedBy.push(other.candidate.id)
        else contradictedBy.push(other.candidate.id)
      }
      out.set(self.candidate.id, {
        state: routeEvidenceState(self.candidate.trustTier, corroboratedBy, contradictedBy),
        corroboratedBy,
        contradictedBy,
      })
    }
    return out
  }
}

const SECTION_TITLES: Record<string, string> = {
  confirmed: '✅ Confirmado',
  contested: '⚖️ Contestado',
  singleSource: '• Fonte-única',
  marketSignal: '📣 Sinal de mercado',
  gaps: '🕳️ Lacunas',
}

// Decide a seção de um record. vendor_marketing sempre cai em "Sinal de mercado"
// (independe do state); o resto segue o state de verificação.
function sectionForRecord(record: SynthRecord): keyof typeof SECTION_TITLES {
  if (record.sourceClass === 'vendor_marketing') return 'marketSignal'
  switch (record.state) {
    case 'primary_accepted':
    case 'corroborated':
      return 'confirmed'
    case 'contested':
      return 'contested'
    case 'single_source':
      return 'singleSource'
    default:
      return 'gaps'
  }
}

// Synthesizer: agrupamento REAL nas 5 seções; prosa fixa. Sempre emite as 5
// seções (vazias incluídas) pra que o teste de síntese graduada as encontre.
export class StubSynthesizer implements Synthesizer {
  async synthesize(records: readonly SynthRecord[]): Promise<string> {
    const buckets: Record<keyof typeof SECTION_TITLES, SynthRecord[]> = {
      confirmed: [],
      contested: [],
      singleSource: [],
      marketSignal: [],
      gaps: [],
    }
    for (const record of records) {
      buckets[sectionForRecord(record)].push(record)
    }

    const order: (keyof typeof SECTION_TITLES)[] = [
      'confirmed',
      'contested',
      'singleSource',
      'marketSignal',
      'gaps',
    ]
    const parts = order.map((key) => {
      const lines = buckets[key].map(
        (r) => `- ${r.claim} — "${r.verbatimQuote}" [${r.sourceClass}]`,
      )
      const body = lines.length > 0 ? lines.join('\n') : '_nenhum_'
      return `## ${SECTION_TITLES[key]}\n${body}`
    })
    return parts.join('\n\n')
  }
}
