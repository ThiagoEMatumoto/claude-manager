import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import {
  applySettingsPatch,
  readClaudeSettingsAt,
  toCliSettingsView,
  validateSettingsPatch,
  writeClaudeSettingsAt,
} from './claude-settings'

describe('validateSettingsPatch', () => {
  it('aceita patch completo válido', () => {
    const patch = {
      model: 'opus',
      effortLevel: 'high',
      autoMemoryEnabled: true,
      statusLineCommand: '~/.claude/statusline.sh',
      language: 'Portuguese',
      theme: 'dark-daltonized',
    }
    expect(validateSettingsPatch(patch)).toEqual(patch)
  })

  it('aceita model como ID completo (com colchetes)', () => {
    expect(validateSettingsPatch({ model: 'claude-fable-5[1m]' })).toEqual({
      model: 'claude-fable-5[1m]',
    })
  })

  it('null remove a chave — permitido em todas', () => {
    expect(validateSettingsPatch({ model: null, theme: null })).toEqual({
      model: null,
      theme: null,
    })
  })

  it('rejeita enum inválido', () => {
    expect(() => validateSettingsPatch({ effortLevel: 'turbo' })).toThrow()
    expect(() => validateSettingsPatch({ theme: 'solarized' })).toThrow()
  })

  it('rejeita chave desconhecida (strict)', () => {
    expect(() => validateSettingsPatch({ env: { HACK: '1' } })).toThrow()
    expect(() => validateSettingsPatch({ hooks: [] })).toThrow()
  })

  it('rejeita caracteres de controle no statusLineCommand', () => {
    expect(() => validateSettingsPatch({ statusLineCommand: 'foo\nbar' })).toThrow()
    expect(() => validateSettingsPatch({ statusLineCommand: 'foo\u0000bar' })).toThrow()
  })

  it('rejeita model com caracteres fora do pattern', () => {
    expect(() => validateSettingsPatch({ model: 'opus; rm -rf /' })).toThrow()
  })
})

describe('toCliSettingsView', () => {
  it('projeta chaves de alto uso e só os NOMES do env', () => {
    const view = toCliSettingsView(
      {
        model: 'opus',
        effortLevel: 'high',
        autoMemoryEnabled: true,
        statusLine: { type: 'command', command: 'status.sh', padding: 1 },
        language: 'Portuguese',
        theme: 'dark',
        env: { SECRET_TOKEN: 'sk-123', OTHER: 'x' },
        hooks: { Stop: [] },
      },
      true,
    )
    expect(view).toEqual({
      exists: true,
      model: 'opus',
      effortLevel: 'high',
      autoMemoryEnabled: true,
      statusLineCommand: 'status.sh',
      language: 'Portuguese',
      theme: 'dark',
      envKeys: ['OTHER', 'SECRET_TOKEN'],
    })
    // Garantia explícita: nenhum valor de env vaza na projeção.
    expect(JSON.stringify(view)).not.toContain('sk-123')
  })

  it('arquivo ausente/corrompido → tudo null', () => {
    const view = toCliSettingsView(null, false)
    expect(view.exists).toBe(false)
    expect(view.model).toBeNull()
    expect(view.envKeys).toEqual([])
  })
})

describe('applySettingsPatch', () => {
  it('preserva chaves desconhecidas intactas', () => {
    const current = { hooks: { Stop: [1] }, env: { A: 'x' }, model: 'opus' }
    const next = applySettingsPatch(current, { model: 'sonnet' })
    expect(next.hooks).toEqual({ Stop: [1] })
    expect(next.env).toEqual({ A: 'x' })
    expect(next.model).toBe('sonnet')
    // Imutável: o objeto original não muda.
    expect(current.model).toBe('opus')
  })

  it('null remove a chave', () => {
    const next = applySettingsPatch({ model: 'opus', theme: 'dark' }, { model: null })
    expect('model' in next).toBe(false)
    expect(next.theme).toBe('dark')
  })

  it('chave ausente no patch não mexe', () => {
    const next = applySettingsPatch({ model: 'opus' }, {})
    expect(next.model).toBe('opus')
  })

  it('statusLineCommand preserva os demais campos do statusLine', () => {
    const next = applySettingsPatch(
      { statusLine: { type: 'command', command: 'old.sh', padding: 1 } },
      { statusLineCommand: 'new.sh' },
    )
    expect(next.statusLine).toEqual({ type: 'command', command: 'new.sh', padding: 1 })
  })

  it('statusLineCommand null remove o objeto statusLine', () => {
    const next = applySettingsPatch(
      { statusLine: { type: 'command', command: 'old.sh' } },
      { statusLineCommand: null },
    )
    expect('statusLine' in next).toBe(false)
  })

  it('cria statusLine quando ausente', () => {
    const next = applySettingsPatch({}, { statusLineCommand: 'x.sh' })
    expect(next.statusLine).toEqual({ type: 'command', command: 'x.sh' })
  })
})

describe('escopo projeto (read/writeClaudeSettingsAt)', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ''
  })

  it('arquivo inexistente: cria .claude/settings.json ao salvar (sem .bak)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cm-settings-'))
    const file = join(dir, '.claude', 'settings.json')

    const before = await readClaudeSettingsAt(file)
    expect(before.exists).toBe(false)

    await writeClaudeSettingsAt(file, { model: 'opus', effortLevel: 'high' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      model: 'opus',
      effortLevel: 'high',
    })
    const after = await readClaudeSettingsAt(file)
    expect(after.exists).toBe(true)
    expect(after.model).toBe('opus')
    // Sem original pra preservar → sem .bak.
    await expect(access(`${file}.bak`)).rejects.toThrow()
  })

  it('arquivo existente: preserva chaves desconhecidas e cria .bak', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cm-settings-'))
    const file = join(dir, 'settings.json')
    await writeFile(file, JSON.stringify({ hooks: { Stop: [1] }, model: 'opus' }), 'utf8')

    await writeClaudeSettingsAt(file, { model: 'sonnet' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      hooks: { Stop: [1] },
      model: 'sonnet',
    })
    // .bak guarda o snapshot pré-app.
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8'))).toEqual({
      hooks: { Stop: [1] },
      model: 'opus',
    })
  })

  it('patch inválido não escreve nada', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cm-settings-'))
    const file = join(dir, 'settings.json')
    await expect(writeClaudeSettingsAt(file, { effortLevel: 'turbo' })).rejects.toThrow()
    await expect(access(file)).rejects.toThrow()
  })
})
