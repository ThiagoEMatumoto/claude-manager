import { z } from 'zod'
import {
  CLAUDE_SETTINGS_PATH,
  readRawSettingsAt,
  writeRawSettingsAt,
} from './claude-settings'
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

const disableSchema = z
  .object({ event: eventSchema, index: z.number().int().min(0).max(999) })
  .strict()

// event acompanha o disabledIndex como checagem de frescor: se o stash mudou
// desde que a UI carregou, o mismatch barra religar a entry errada.
const enableSchema = z
  .object({ event: eventSchema, disabledIndex: z.number().int().min(0).max(9999) })
  .strict()

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
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
        out.push({ event, index, matcher, summary, disabled: false })
      })
    }
  }
  readStash().forEach((rec, i) => {
    const { matcher, summary } = summarizeHookEntry(rec.entry)
    out.push({ event: rec.event, index: i, matcher, summary, disabled: true })
  })
  out.sort(
    (a, b) =>
      a.event.localeCompare(b.event) ||
      Number(a.disabled) - Number(b.disabled) ||
      a.index - b.index,
  )
  return out
}

export async function disableHookEntry(rawPayload: unknown): Promise<void> {
  const { event, index } = disableSchema.parse(rawPayload)
  const { raw, exists } = await readRawSettingsAt(CLAUDE_SETTINGS_PATH)
  if (!exists) throw new Error('~/.claude/settings.json não existe')
  const { next, removed } = removeHookEntryAt(raw, event, index)
  // Stash primeiro: se a escrita do settings falhar, desfazemos o stash — a
  // entry original nunca fica só no .bak.
  const stash = readStash()
  const record: DisabledHookRecord = {
    event,
    position: index,
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
}

export async function enableHookEntry(rawPayload: unknown): Promise<void> {
  const { event, disabledIndex } = enableSchema.parse(rawPayload)
  const stash = readStash()
  const record = stash[disabledIndex]
  if (!record || record.event !== event) {
    throw new Error('Lista de hooks desligados desatualizada — recarregue')
  }
  const { raw } = await readRawSettingsAt(CLAUDE_SETTINGS_PATH)
  const next = insertHookEntryAt(raw, record.event, record.position, record.entry)
  await writeRawSettingsAt(CLAUDE_SETTINGS_PATH, next)
  setPref(
    DISABLED_HOOKS_PREF_KEY,
    stash.filter((_, i) => i !== disabledIndex),
  )
}
