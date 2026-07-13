import { beforeEach, describe, it, expect, vi } from 'vitest'

// IO em memória: settings.json vira um objeto com delay artificial de escrita
// (expõe interleaving de read-modify-write) e o stash de prefs vira um Map.
const fsState = vi.hoisted(() => ({
  file: null as Record<string, unknown> | null, // null = arquivo não existe
  writeDelayMs: 0,
  writes: 0,
}))
const prefsState = vi.hoisted(() => ({ map: new Map<string, unknown>() }))

vi.mock('./claude-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./claude-settings')>()
  return {
    ...actual,
    readRawSettingsAt: vi.fn(async () => ({
      raw: fsState.file ? structuredClone(fsState.file) : {},
      exists: fsState.file !== null,
    })),
    writeRawSettingsAt: vi.fn(async (_path: string, next: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, fsState.writeDelayMs))
      fsState.file = structuredClone(next)
      fsState.writes += 1
    }),
  }
})

vi.mock('./prefs-store', () => ({
  getPref: (key: string, fallback: unknown) =>
    prefsState.map.has(key) ? structuredClone(prefsState.map.get(key)) : fallback,
  setPref: (key: string, value: unknown) => {
    prefsState.map.set(key, structuredClone(value))
  },
}))

import {
  DISABLED_HOOKS_PREF_KEY,
  disableHookEntry,
  enableHookEntry,
  findHookEntryIndex,
  insertHookEntryAt,
  removeHookEntryAt,
  summarizeHookEntry,
  type DisabledHookRecord,
} from './claude-hooks'

const ENTRY_A = { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'a.sh' }] }
const ENTRY_B = { hooks: [{ type: 'command', command: 'b.sh' }] }

function settingsWith(hooks: Record<string, unknown>) {
  return { model: 'opus', env: { X: '1' }, hooks }
}

function stash(): DisabledHookRecord[] {
  return (prefsState.map.get(DISABLED_HOOKS_PREF_KEY) as DisabledHookRecord[]) ?? []
}

beforeEach(() => {
  fsState.file = null
  fsState.writeDelayMs = 0
  fsState.writes = 0
  prefsState.map.clear()
})

describe('removeHookEntryAt', () => {
  it('remove a entry certa e preserva o resto do arquivo', () => {
    const current = settingsWith({ PreToolUse: [ENTRY_A, ENTRY_B], Stop: [ENTRY_B] })
    const { next, removed } = removeHookEntryAt(current, 'PreToolUse', 0)
    expect(removed).toEqual(ENTRY_A)
    expect(next.hooks).toEqual({ PreToolUse: [ENTRY_B], Stop: [ENTRY_B] })
    expect(next.model).toBe('opus')
    expect(next.env).toEqual({ X: '1' })
    // Imutável: original intacto.
    expect((current.hooks as Record<string, unknown[]>).PreToolUse).toHaveLength(2)
  })

  it('evento que fica vazio é removido do map', () => {
    const { next } = removeHookEntryAt(settingsWith({ Stop: [ENTRY_A] }), 'Stop', 0)
    expect('hooks' in next).toBe(false)
  })

  it('lança em evento/índice inexistente', () => {
    const current = settingsWith({ Stop: [ENTRY_A] })
    expect(() => removeHookEntryAt(current, 'PreToolUse', 0)).toThrow()
    expect(() => removeHookEntryAt(current, 'Stop', 1)).toThrow()
    expect(() => removeHookEntryAt({}, 'Stop', 0)).toThrow()
  })
})

describe('insertHookEntryAt', () => {
  it('round-trip: remover e re-inserir na posição original restaura o arquivo', () => {
    const original = settingsWith({ PreToolUse: [ENTRY_A, ENTRY_B], Stop: [ENTRY_B] })
    const { next, removed } = removeHookEntryAt(original, 'PreToolUse', 0)
    const restored = insertHookEntryAt(next, 'PreToolUse', 0, removed)
    expect(restored).toEqual(original)
  })

  it('round-trip recria evento (e chave hooks) removidos por ficarem vazios', () => {
    const original = settingsWith({ Stop: [ENTRY_A] })
    const { next, removed } = removeHookEntryAt(original, 'Stop', 0)
    const restored = insertHookEntryAt(next, 'Stop', 0, removed)
    expect(restored).toEqual(original)
  })

  it('clampa posição além do tamanho atual (array encolheu enquanto desligado)', () => {
    const restored = insertHookEntryAt(settingsWith({ Stop: [ENTRY_B] }), 'Stop', 5, ENTRY_A)
    expect(restored.hooks).toEqual({ Stop: [ENTRY_B, ENTRY_A] })
  })
})

describe('findHookEntryIndex', () => {
  it('usa o índice como dica quando bate por conteúdo', () => {
    const current = settingsWith({ Stop: [ENTRY_A, ENTRY_B] })
    expect(findHookEntryIndex(current, 'Stop', ENTRY_B, 1)).toBe(1)
  })

  it('cai pra busca por conteúdo quando a dica está errada (chaves reordenadas contam)', () => {
    const reordered = { hooks: [{ command: 'a.sh', type: 'command' }], matcher: 'Edit|Write' }
    const current = settingsWith({ Stop: [ENTRY_B, reordered] })
    expect(findHookEntryIndex(current, 'Stop', ENTRY_A, 0)).toBe(1)
  })

  it('-1 quando a entry não está no evento', () => {
    expect(findHookEntryIndex(settingsWith({ Stop: [ENTRY_B] }), 'Stop', ENTRY_A, 0)).toBe(-1)
  })
})

describe('disableHookEntry / enableHookEntry (IO serializado)', () => {
  it('round-trip disable → enable restaura o arquivo e limpa o stash', async () => {
    fsState.file = settingsWith({ PreToolUse: [ENTRY_A, ENTRY_B] })
    await disableHookEntry({ event: 'PreToolUse', index: 0, entry: ENTRY_A })
    expect((fsState.file as { hooks: unknown }).hooks).toEqual({ PreToolUse: [ENTRY_B] })
    expect(stash()).toHaveLength(1)
    await enableHookEntry({ event: 'PreToolUse', disabledIndex: 0 })
    expect(fsState.file).toEqual(settingsWith({ PreToolUse: [ENTRY_A, ENTRY_B] }))
    expect(stash()).toEqual([])
  })

  it('dois disables em paralelo não se perdem (lost update)', async () => {
    fsState.file = settingsWith({ PreToolUse: [ENTRY_A, ENTRY_B] })
    // Delay de escrita: sem a fila por arquivo, os dois leriam o mesmo estado
    // original e o segundo write ressuscitaria a entry removida pelo primeiro.
    fsState.writeDelayMs = 15
    await Promise.all([
      disableHookEntry({ event: 'PreToolUse', index: 0, entry: ENTRY_A }),
      disableHookEntry({ event: 'PreToolUse', index: 1, entry: ENTRY_B }),
    ])
    expect('hooks' in (fsState.file as Record<string, unknown>)).toBe(false)
    expect(stash()).toHaveLength(2)
    expect(stash().map((r) => r.entry)).toEqual([ENTRY_A, ENTRY_B])
  })

  it('disable casa por conteúdo quando o arquivo foi reordenado fora do app', async () => {
    // A UI listou [A, B] mas o arquivo agora está [B, A]: índice 0 aponta pra B.
    fsState.file = settingsWith({ PreToolUse: [ENTRY_B, ENTRY_A] })
    await disableHookEntry({ event: 'PreToolUse', index: 0, entry: ENTRY_A })
    expect((fsState.file as { hooks: unknown }).hooks).toEqual({ PreToolUse: [ENTRY_B] })
    expect(stash()[0]?.entry).toEqual(ENTRY_A)
  })

  it('disable falha com erro claro quando a entry sumiu do arquivo', async () => {
    fsState.file = settingsWith({ PreToolUse: [ENTRY_B] })
    await expect(
      disableHookEntry({ event: 'PreToolUse', index: 0, entry: ENTRY_A }),
    ).rejects.toThrow(/mudou fora do app/)
    expect(stash()).toEqual([])
  })

  it('enable com duplicata já no arquivo só limpa o stash (não insere de novo)', async () => {
    // Usuário re-adicionou a entry à mão enquanto ela estava desligada.
    fsState.file = settingsWith({ Stop: [ENTRY_A] })
    prefsState.map.set(DISABLED_HOOKS_PREF_KEY, [
      { event: 'Stop', position: 0, entry: ENTRY_A, disabledAt: '2026-07-13T00:00:00Z' },
    ])
    await enableHookEntry({ event: 'Stop', disabledIndex: 0 })
    expect((fsState.file as { hooks: unknown }).hooks).toEqual({ Stop: [ENTRY_A] })
    expect(fsState.writes).toBe(0)
    expect(stash()).toEqual([])
  })
})

describe('summarizeHookEntry', () => {
  it('extrai matcher e comandos', () => {
    expect(summarizeHookEntry(ENTRY_A)).toEqual({ matcher: 'Edit|Write', summary: 'a.sh' })
  })

  it('entry sem matcher → matcher null', () => {
    expect(summarizeHookEntry(ENTRY_B).matcher).toBeNull()
  })

  it('entry malformada não lança', () => {
    expect(summarizeHookEntry(null).summary).toBe('entry inválida')
    expect(summarizeHookEntry({ hooks: 'x' }).summary).toContain('0 hook(s)')
  })
})
