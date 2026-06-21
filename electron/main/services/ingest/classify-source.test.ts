import { describe, expect, it } from 'vitest'
import { classifySource } from './classify-source'

describe('classifySource', () => {
  it('classifica domínios gov/jus como primary_official', () => {
    expect(classifySource('https://portal.tcu.gov.br/audit')).toBe('primary_official')
    expect(classifySource('https://www.inss.gov.br/bpc')).toBe('primary_official')
    expect(classifySource('https://www.trf3.jus.br/processo')).toBe('primary_official')
  })

  it('classifica acadêmico', () => {
    expect(classifySource('https://arxiv.org/abs/2401.00001')).toBe('academic')
    expect(classifySource('https://www.scielo.br/j/rdp/a/x')).toBe('academic')
    expect(classifySource('https://www.usp.edu.br/pesquisa')).toBe('academic')
    expect(classifySource('https://www.semanticscholar.org/paper/x')).toBe('academic')
  })

  it('classifica vídeo de prática', () => {
    expect(classifySource('https://www.youtube.com/watch?v=abc')).toBe('practitioner_video')
    expect(classifySource('https://youtu.be/abc')).toBe('practitioner_video')
  })

  it('classifica fórum/UGC', () => {
    expect(classifySource('https://www.reddit.com/r/brasil')).toBe('forum_ugc')
    expect(classifySource('https://www.jusbrasil.com.br/artigos/x')).toBe('forum_ugc')
  })

  it('classifica vendor de software jurídico', () => {
    expect(classifySource('https://www.aurum.com.br/astrea')).toBe('vendor_marketing')
    expect(classifySource('https://previdenciarista.com/blog/softwares')).toBe('vendor_marketing')
    expect(classifySource('https://simplesprev.com.br/')).toBe('vendor_marketing')
  })

  it('classifica imprensa reputada', () => {
    expect(classifySource('https://g1.globo.com/economia/x')).toBe('reputable_press')
    expect(classifySource('https://www.conjur.com.br/2026-jan-01/x')).toBe('reputable_press')
  })

  it('cai em blog_seo por padrão e em URL inválida', () => {
    expect(classifySource('https://algumblogqualquer.net/post')).toBe('blog_seo')
    expect(classifySource('not a url')).toBe('blog_seo')
  })
})
