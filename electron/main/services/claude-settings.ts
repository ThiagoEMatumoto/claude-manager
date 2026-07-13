import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { backupOnce, writeFileAtomic } from './atomic-file'
import { withFileLock } from './file-lock'
import type { ClaudeCliSettings, ClaudeCliSettingsPatch } from '../../../shared/types/ipc'

// Editor validado das chaves de alto uso de ~/.claude/settings.json. Postura
// anti-injeção da fronteira: whitelists/patterns literais por chave, chaves
// desconhecidas do arquivo são preservadas intactas, env NUNCA expõe valores.

export const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const CLI_THEMES = [
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
] as const

// Aceita aliases (opus, sonnet) e IDs completos (ex.: claude-fable-5[1m]).
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,99}$/
const LANGUAGE_PATTERN = /^[A-Za-z][A-Za-z -]{0,49}$/
// Comando do statusLine roda no shell do CLI claude, não no app — mas barramos
// caracteres de controle pra não corromper o JSON/terminal.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const patchSchema = z
  .object({
    model: z.string().regex(MODEL_PATTERN).nullable().optional(),
    effortLevel: z.enum(EFFORT_LEVELS).nullable().optional(),
    autoMemoryEnabled: z.boolean().nullable().optional(),
    statusLineCommand: z
      .string()
      .min(1)
      .max(500)
      .refine((s) => !CONTROL_CHARS.test(s), 'caracteres de controle não permitidos')
      .nullable()
      .optional(),
    language: z.string().regex(LANGUAGE_PATTERN).nullable().optional(),
    theme: z.enum(CLI_THEMES).nullable().optional(),
  })
  .strict()

export function validateSettingsPatch(raw: unknown): ClaudeCliSettingsPatch {
  return patchSchema.parse(raw)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Projeção read-only do JSON cru pra visão editável. Valores fora do esperado
// viram null (a UI mostra "não definido") — nunca lançam.
export function toCliSettingsView(raw: unknown, exists: boolean): ClaudeCliSettings {
  const data = isRecord(raw) ? raw : {}
  const statusLine = isRecord(data.statusLine) ? data.statusLine : null
  return {
    exists,
    model: typeof data.model === 'string' ? data.model : null,
    effortLevel: typeof data.effortLevel === 'string' ? data.effortLevel : null,
    autoMemoryEnabled:
      typeof data.autoMemoryEnabled === 'boolean' ? data.autoMemoryEnabled : null,
    statusLineCommand:
      statusLine && typeof statusLine.command === 'string' ? statusLine.command : null,
    language: typeof data.language === 'string' ? data.language : null,
    theme: typeof data.theme === 'string' ? data.theme : null,
    envKeys: isRecord(data.env) ? Object.keys(data.env).sort() : [],
  }
}

// Aplica o patch imutavelmente sobre o JSON cru: chave ausente não mexe, null
// remove, valor grava. statusLineCommand só toca o campo `command` do objeto
// statusLine (padding etc. são preservados).
export function applySettingsPatch(
  current: unknown,
  patch: ClaudeCliSettingsPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = isRecord(current) ? { ...current } : {}

  const scalarKeys = ['model', 'effortLevel', 'autoMemoryEnabled', 'language', 'theme'] as const
  for (const key of scalarKeys) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === null) delete next[key]
    else next[key] = value
  }

  if ('statusLineCommand' in patch) {
    if (patch.statusLineCommand === null) {
      delete next.statusLine
    } else {
      const existing = isRecord(next.statusLine) ? next.statusLine : {}
      next.statusLine = { ...existing, type: 'command', command: patch.statusLineCommand }
    }
  }

  return next
}

// Helpers de IO parametrizados por path — reutilizados pelo toggle de hooks
// (mesmo arquivo, chave hooks) e pelo escopo de projeto. Quem faz
// read-modify-write com eles deve segurar withFileLock(path) por fora — os
// helpers em si não serializam (e não podem chamar o lock: deadlock).
export async function readRawSettingsAt(path: string): Promise<{ raw: unknown; exists: boolean }> {
  try {
    const text = await readFile(path, 'utf8')
    return { raw: JSON.parse(text), exists: true }
  } catch {
    return { raw: {}, exists: false }
  }
}

export async function writeRawSettingsAt(
  path: string,
  next: Record<string, unknown>,
): Promise<void> {
  // backupOnce é no-op se o arquivo original não existe.
  await backupOnce(path)
  await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`)
}

// Variantes parametrizadas por path — mesmas chaves/validação para o escopo
// user (~/.claude/settings.json) e projeto (<repo>/.claude/settings.json).
export async function readClaudeSettingsAt(path: string): Promise<ClaudeCliSettings> {
  const { raw, exists } = await readRawSettingsAt(path)
  return toCliSettingsView(raw, exists)
}

export async function writeClaudeSettingsAt(path: string, rawPatch: unknown): Promise<void> {
  const patch = validateSettingsPatch(rawPatch)
  // Mesma fila do toggle de hooks: o arquivo é compartilhado e read-modify-write
  // concorrente perde updates.
  await withFileLock(path, async () => {
    const { raw } = await readRawSettingsAt(path)
    const next = applySettingsPatch(raw, patch)
    // Repo pode não ter .claude/ ainda — o arquivo de projeto é criado ao salvar.
    await mkdir(dirname(path), { recursive: true })
    await writeRawSettingsAt(path, next)
  })
}

export async function readClaudeSettings(): Promise<ClaudeCliSettings> {
  return readClaudeSettingsAt(CLAUDE_SETTINGS_PATH)
}

export async function writeClaudeSettings(rawPatch: unknown): Promise<void> {
  await writeClaudeSettingsAt(CLAUDE_SETTINGS_PATH, rawPatch)
}
