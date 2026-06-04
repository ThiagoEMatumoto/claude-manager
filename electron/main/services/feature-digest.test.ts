import { describe, it, expect } from 'vitest'
import {
  parseTranscriptText,
  digestFromLines,
  renderDigestForRecord,
  stripCodeFence,
  stripToFrontmatter,
  isValidDoc,
  renderRecords,
} from './feature-digest'

function line(obj: unknown): string {
  return JSON.stringify(obj)
}

describe('digestFromLines', () => {
  const transcript = [
    line({ message: { role: 'user', content: 'Implementar feature de export (PR #42)' } }),
    line({ gitBranch: 'feat/export', message: { role: 'assistant', content: 'Vou começar.' } }),
    line({
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm   run   build' } },
        ],
      },
    }),
    // tool_result volta como role:user com content estruturado/sem texto — não conta turno.
    line({ message: { role: 'user', content: '<tool_result>ok</tool_result>' } }),
    line({
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Write', input: { path: 'src/b.ts' } },
          {
            type: 'tool_use',
            name: 'TodoWrite',
            input: { todos: [{ content: 'antigo', status: 'pending' }] },
          },
        ],
      },
    }),
    line({ message: { role: 'user', content: 'Agora ajusta o teste' } }),
    line({
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'export', status: 'completed' },
                { content: 'teste', status: 'in_progress' },
              ],
            },
          },
        ],
      },
    }),
    line({ message: { role: 'assistant', content: 'Pronto: export implementado e testado.' } }),
  ].join('\n')

  const d = digestFromLines(parseTranscriptText(transcript))

  it('conta turnos só de texto real do usuário (ignora tool_result)', () => {
    expect(d.userTurns).toBe(2)
  })

  it('faz rollup de ferramentas por nome', () => {
    expect(d.toolRollup).toMatchObject({ Edit: 1, Write: 1, Bash: 1, TodoWrite: 2 })
  })

  it('conta edits e coleta arquivos tocados (file_path e path)', () => {
    expect(d.editCount).toBe(2)
    expect(d.filesTouched.sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('normaliza comandos bash', () => {
    expect(d.bashCommands).toEqual(['npm run build'])
  })

  it('mantém apenas o snapshot MAIS RECENTE do TodoWrite, com status', () => {
    expect(d.todos).toEqual(['[completed] export', '[in_progress] teste'])
  })

  it('captura a última mensagem do assistant como resumo final', () => {
    expect(d.finalSummary).toBe('Pronto: export implementado e testado.')
  })

  it('extrai branch de trabalho e refs citadas', () => {
    expect(d.gitBranch).toBe('feat/export')
    expect(d.refs).toContain('PR #42')
  })
})

describe('renderDigestForRecord', () => {
  it('inclui as seções do digest enriquecido', () => {
    const d = digestFromLines(
      parseTranscriptText(
        [
          line({ gitBranch: 'feat/x', message: { role: 'user', content: 'faz X' } }),
          line({ message: { role: 'user', content: 'continua' } }),
          line({
            message: {
              role: 'assistant',
              content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'f.ts' } }],
            },
          }),
          line({ message: { role: 'assistant', content: 'feito' } }),
        ].join('\n'),
      ),
    )
    const r = renderDigestForRecord(d)
    expect(r).toContain('Branch: feat/x')
    expect(r).toContain('Ferramentas usadas:')
    expect(r).toContain('Arquivos editados (1)')
    expect(r).toContain('Resumo final do assistant')
  })
})

describe('stripCodeFence', () => {
  it('remove cercas ```...``` envolvendo o conteúdo inteiro', () => {
    expect(stripCodeFence('```md\nhello\n```')).toBe('hello')
  })
  it('deixa intacto texto sem cerca', () => {
    expect(stripCodeFence('hello')).toBe('hello')
  })
})

describe('renderRecords', () => {
  it('data o cabeçalho pelo sessionAt (data real da sessão), não pelo createdAt', () => {
    const rec = {
      sessionId: 's1',
      featureId: 'f1',
      ccSessionId: null,
      summary: 'fez X',
      model: null,
      sessionAt: Date.parse('2026-05-01T10:00:00Z'),
      createdAt: Date.parse('2026-06-03T20:00:00Z'),
    }
    const out = renderRecords([rec])
    expect(out).toContain('### Sessão — 2026-05-01')
    expect(out).not.toContain('2026-06-03')
  })
})

describe('stripToFrontmatter', () => {
  it('corta preâmbulo conversacional antes do frontmatter', () => {
    const out = 'Vou sintetizar. Segue o Markdown:\n\n---\nid: x\ntitle: T\nstatus: in-progress\n---\n\n## Visão geral\nok\n'
    const cleaned = stripToFrontmatter(out)
    expect(cleaned.startsWith('---')).toBe(true)
    expect(isValidDoc(cleaned)).toBe(true)
  })
  it('deixa intacto output que já começa com --- (a menos de trim)', () => {
    const md = '---\nid: x\ntitle: T\nstatus: done\n---\n\n## Visão geral\n'
    expect(stripToFrontmatter(md)).toBe(md.trim())
  })
  it('remove cerca ``` e preâmbulo juntos', () => {
    const out = '```md\n---\nid: x\ntitle: T\nstatus: done\n---\n\n## X\n```'
    expect(stripToFrontmatter(out).startsWith('---')).toBe(true)
  })
})

describe('isValidDoc', () => {
  it('aceita doc com frontmatter mínimo (id/title/status)', () => {
    const md = '---\nid: x\ntitle: T\nstatus: in-progress\n---\n\n## Visão geral\n'
    expect(isValidDoc(md)).toBe(true)
  })
  it('rejeita doc sem frontmatter', () => {
    expect(isValidDoc('## só corpo')).toBe(false)
  })
})
