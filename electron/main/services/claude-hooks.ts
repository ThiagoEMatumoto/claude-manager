import { z } from 'zod'
import {
  CLAUDE_SETTINGS_PATH,
  readRawSettingsAt,
  writeRawSettingsAt,
} from './claude-settings'
import { withFileLock } from './file-lock'
import { getPref, setPref } from './prefs-store'
import type { HookToggleEntry } from '../../../shared/types/ipc'

// Liga/desliga POR entry de hook do ~/.claude/settings.json (estrutura
// hooks: { Event: [{ matcher?, hooks: [...] }] }). Desligar REMOVE a entry do
// arquivo (escrita atômica + .bak) e guarda o original em app_prefs
// (cc.disabledHooks) com evento e posição; religar re-insere no evento
// original. Hooks de plugins não passam por aqui — ficam view-only.

export const DISABLED_HOOKS_PREF_KEY = 'cc.disabledHooks'

export interface DisabledHookRecord {
  event: string
  position: number
  entry: unknown
  disabledAt: string
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const eventSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => !CONTROL_CHARS.test(s), 'caracteres de controle não permitidos')

// entry acompanha o índice porque o settings.json pode mudar fora do app entre
// o list e a ação: o disable casa por CONTEÚDO e usa o índice só como dica.
const disableSchema = z
  .object({ event: eventSchema, index: z.number().int().min(0).max(999), entry: z.unknown() })
  .strict()

// event acompanha o disabledIndex como checagem de frescor: se o stash mudou
// desde que a UI carregou, o mismatch barra religar a entry errada.
const enableSchema = z
  .object({ event: eventSchema, disabledIndex: z.number().int().min(0).max(9999) })
  .strict()

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Igualdade profunda de valores JSON (ordem de chaves não importa — edição
// manual pode reserializar o arquivo com chaves em outra ordem).
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqualJson(v, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((k) => k in b && deepEqualJson(a[k], b[k]))
  }
  return false
}

// Localiza a entry por CONTEÚDO dentro de hooks[event]; o índice vindo da UI é
// só dica (atalho quando o arquivo não mudou desde o list). -1 = não está lá.
export function findHookEntryIndex(
  current: unknown,
  event: string,
  entry: unknown,
  hintIndex: number,
): number {
  const root = isRecord(current) ? current : {}
  const hooks = isRecord(root.hooks) ? root.hooks : {}
  const defs = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
  if (hintIndex >= 0 && hintIndex < defs.length && deepEqualJson(defs[hintIndex], entry)) {
    return hintIndex
  }
  return defs.findIndex((d) => deepEqualJson(d, entry))
}

// Projeção legível de uma entry: matcher (se houver) + comandos dos hooks
// internos. Nunca lança — entry malformada vira texto genérico.
export function summarizeHookEntry(entry: unknown): { matcher: string | null; summary: string } {
  if (!isRecord(entry)) return { matcher: null, summary: 'entry inválida' }
  const matcher = typeof entry.matcher === 'string' && entry.matcher !== '' ? entry.matcher : null
  const inner = Array.isArray(entry.hooks) ? entry.hooks : []
  const commands = inner
    .map((h) => (isRecord(h) && typeof h.command === 'string' ? h.command : null))
    .filter((c): c is string => c !== null)
  const summary =
    commands.length > 0 ? commands.join(' · ') : `${inner.length} hook(s) sem command`
  return { matcher, summary }
}

// Remove imutavelmente hooks[event][index]. Evento que fica vazio é removido
// do map (e o map vazio, do root) — religar recria via insertHookEntryAt.
export function removeHookEntryAt(
  current: unknown,
  event: string,
  index: number,
): { next: Record<string, unknown>; removed: unknown } {
  const root = isRecord(current) ? current : {}
  const hooks = isRecord(root.hooks) ? root.hooks : null
  const defs = hooks && Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : null
  if (!hooks || !defs || index < 0 || index >= defs.length) {
    throw new Error(`Hook não encontrado em ${event}[${index}] — recarregue a lista`)
  }
  const removed = defs[index]
  const nextDefs = defs.filter((_, i) => i !== index)
  const nextHooks: Record<string, unknown> = { ...hooks }
  if (nextDefs.length === 0) delete nextHooks[event]
  else nextHooks[event] = nextDefs
  const next: Record<string, unknown> = { ...root }
  if (Object.keys(nextHooks).length === 0) delete next.hooks
  else next.hooks = nextHooks
  return { next, removed }
}

// Re-insere a entry na posição original (clampada ao tamanho atual do array,
// que pode ter encolhido enquanto ela esteve desligada).
export function insertHookEntryAt(
  current: unknown,
  event: string,
  position: number,
  entry: unknown,
): Record<string, unknown> {
  const root: Record<string, unknown> = isRecord(current) ? { ...current } : {}
  const hooks: Record<string, unknown> = isRecord(root.hooks) ? { ...root.hooks } : {}
  const defs = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : []
  const pos = Math.max(0, Math.min(position, defs.length))
  defs.splice(pos, 0, entry)
  hooks[event] = defs
  root.hooks = hooks
  return root
}

function readStash(): DisabledHookRecord[] {
  const stash = getPref<DisabledHookRecord[]>(DISABLED_HOOKS_PREF_KEY, [])
  return Array.isArray(stash) ? stash : []
}

// Entries ligadas (settings.json) + desligadas (stash). Para disabled=true,
// index é a posição no stash — é o handle pra religar.
export async function listHookToggleEntries(): Promise<HookToggleEntry[]> {
  const { raw } = await readRawSettingsAt(CLAUDE_SETTINGS_PATH)
  const out: HookToggleEntry[] = []
  const root = isRecord(raw) ? raw : {}
  if (isRecord(root.hooks)) {
    for (const [event, defs] of Object.entries(root.hooks)) {
      if (!Array.isArray(defs)) continue
      defs.forEach((entry, index) => {
        const { matcher, summary } = summarizeHookEntry(entry)
        out.push({ event, index, matcher, summary, disabled: false, entry })
      })
    }
  }
  readStash().forEach((rec, i) => {
    const { matcher, summary } = summarizeHookEntry(rec.entry)
    out.push({ event: rec.event, index: i, matcher, summary, disabled: true, entry: rec.entry })
  })
  out.sort(
    (a, b) =>
      a.event.localeCompare(b.event) ||
      Number(a.disabled) - Number(b.disabled) ||
      a.index - b.index,
  )
  return out
}

// disable/enable rodam sob withFileLock: o read-modify-write do settings.json
// (e o stash que anda junto) precisa ser serializado — dois toggles rápidos
// interleiam e o write mais lento ressuscita a entry que o outro removeu.

export async function disableHookEntry(rawPayload: unknown): Promise<void> {
  const { event, index, entry } = disableSchema.parse(rawPayload)
  await withFileLock(CLAUDE_SETTINGS_PATH, async () => {
    const { raw, exists } = await readRawSettingsAt(CLAUDE_SETTINGS_PATH)
    if (!exists) throw new Error('~/.claude/settings.json não existe')
    const actualIndex = findHookEntryIndex(raw, event, entry, index)
    if (actualIndex === -1) {
      throw new Error('Hook mudou fora do app — recarregue a lista')
    }
    const { next, removed } = removeHookEntryAt(raw, event, actualIndex)
    // Stash primeiro: se a escrita do settings falhar, desfazemos o stash — a
    // entry original nunca fica só no .bak.
    const stash = readStash()
    const record: DisabledHookRecord = {
      event,
      position: actualIndex,
      entry: removed,
      disabledAt: new Date().toISOString(),
    }
    setPref(DISABLED_HOOKS_PREF_KEY, [...stash, record])
    try {
      await writeRawSettingsAt(CLAUDE_SETTINGS_PATH, next)
    } catch (err) {
      setPref(DISABLED_HOOKS_PREF_KEY, stash)
      throw err
    }
  })
}

export async function enableHookEntry(rawPayload: unknown): Promise<void> {
  const { event, disabledIndex } = enableSchema.parse(rawPayload)
  await withFileLock(CLAUDE_SETTINGS_PATH, async () => {
    const stash = readStash()
    const record = stash[disabledIndex]
    if (!record || record.event !== event) {
      throw new Error('Lista de hooks desligados desatualizada — recarregue')
    }
    const { raw } = await readRawSettingsAt(CLAUDE_SETTINGS_PATH)
    // Se uma entry idêntica já voltou ao arquivo (ex.: usuário re-adicionou à
    // mão), inserir de novo duplicaria — só limpamos o stash.
    if (findHookEntryIndex(raw, record.event, record.entry, record.position) === -1) {
      const next = insertHookEntryAt(raw, record.event, record.position, record.entry)
      await writeRawSettingsAt(CLAUDE_SETTINGS_PATH, next)
    }
    setPref(
      DISABLED_HOOKS_PREF_KEY,
      stash.filter((_, i) => i !== disabledIndex),
    )
  })
}
