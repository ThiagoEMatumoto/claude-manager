import type { SourceClass } from '../../../../shared/types/ipc'

// Classificação de fonte por heurística de domínio. Determinística e barata —
// roda no estágio de busca pra derivar o trust tier (via TRUST_TIER_BY_CLASS)
// sem custo de LLM. As listas são exportadas pra extensão fácil.

// Domínios de software jurídico/previdenciário (conteúdo = marketing do fornecedor).
export const VENDOR_DOMAINS = [
  'aurum.com.br',
  'astrea',
  'simplesprev',
  'projuris',
  'advbox',
  'chatjuridico',
  'previdenciarista',
  'easyjur',
  'sajadv',
  'themisweb',
]

// Grandes portais de notícia / imprensa (inclui imprensa jurídica reputada).
export const NEWS_DOMAINS = [
  'g1.globo.com',
  'globo.com',
  'uol.com.br',
  'folha.uol.com.br',
  'folha.com.br',
  'estadao.com.br',
  'cnnbrasil.com.br',
  'bbc.com',
  'bbc.co.uk',
  'reuters.com',
  'metropoles.com',
  'jota.info',
  'conjur.com.br',
  'migalhas.com.br',
]

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function classifySource(url: string): SourceClass {
  const host = hostnameOf(url)
  if (!host) return 'blog_seo'

  if (host.endsWith('.gov.br') || host.endsWith('.jus.br') || host.includes('.gov.'))
    return 'primary_official'

  if (
    host === 'arxiv.org' ||
    host.endsWith('.edu') ||
    host.endsWith('.edu.br') ||
    host.includes('semanticscholar') ||
    host.includes('scholar.google') ||
    host.includes('scielo') ||
    host.includes('pubmed') ||
    host.includes('researchgate') ||
    host.includes('ssrn')
  )
    return 'academic'

  if (host.includes('youtube.com') || host === 'youtu.be' || host.includes('vimeo.com'))
    return 'practitioner_video'

  if (
    host.includes('reddit.com') ||
    host.includes('jusbrasil.com.br') ||
    host.includes('quora.com') ||
    host.includes('stackexchange') ||
    host.includes('forum')
  )
    return 'forum_ugc'

  if (VENDOR_DOMAINS.some((d) => host.includes(d))) return 'vendor_marketing'

  if (NEWS_DOMAINS.some((d) => host.includes(d))) return 'reputable_press'

  return 'blog_seo'
}
