import { BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import matter from 'gray-matter'
import type { Feature, FeatureSynthError, FeatureSynthMode } from '../../../shared/types/ipc'
import { getDb } from './db'
import {
  get as getFeature,
  create as createFeature,
  markSelfWrite,
  reindexFromFile,
  findFeatureByRepoBranch,
  listActiveFeaturesByProject,
  getProjectIdForRepo,
  getRepoPath,
} from './feature-store'
import { findTranscriptPath } from './session-activity'
import { runClaude } from './claude-cli'
import {
  isProtectedBranch,
  normalizeBranch,
  pickWorkBranch,
  fuzzyScore,
  decideRegistration,
} from './feature-heuristics'

const SYNTH_TIMEOUT_MS = 90_000
const DEBOUNCE_MS = 4_000
const MAX_USER_PROMPT_CHARS = 600
const MAX_ASSISTANT_TEXT_CHARS = 400
const MAX_DIGEST_ENTRIES = 40
const SYNTH_MODEL_KEY = 'synth_model'
const SYNTH_MODE_KEY = 'synth_mode'

const MAX_AUTO_OBJECTIVE_CHARS = 600

// Modo de síntese global (app_prefs); 'threshold' como default seguro.
function globalSynthMode(): FeatureSynthMode {
  try {
    const row = getDb().prepare('SELECT value FROM app_prefs WHERE key = ?').get(SYNTH_MODE_KEY) as
      | { value: string }
      | undefined
    const v = row?.value?.trim()
    if (v === 'auto' || v === 'manual' || v === 'threshold') return v
  } catch {
    // sem tabela/pref — cai no default.
  }
  return 'threshold'
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function emitSynthError(featureId: string, message: string): void {
  const event: FeatureSynthError = { featureId, message, at: Date.now() }
  broadcast('feature:synth-error', event)
}

// ---- Distilação do transcript (reusa o shape de TranscriptLine de session-activity) ----

interface ContentItem {
  type?: string
  text?: string
  name?: string
  input?: { file_path?: string; path?: string }
}

interface TranscriptLine {
  type?: string
  gitBranch?: string
  message?: {
    role?: string
    content?: ContentItem[] | string
  }
}

interface Digest {
  userPrompts: string[]
  assistantNotes: string[]
  filesTouched: string[]
  gitBranch: string | null
  refs: string[] // PR/commit citados
  userTurns: number
  editCount: number
}

const PR_RE = /\b(?:PR\s*#?\d+|#\d+|\b[0-9a-f]{7,40}\b)/gi

function parseTranscript(path: string): TranscriptLine[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const out: TranscriptLine[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t) as TranscriptLine)
    } catch {
      // linha parcial/inválida — ignora.
    }
  }
  return out
}

function contentText(content: ContentItem[] | string | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
    .trim()
}

// Lê o JSONL inteiro UMA vez e produz um digest compacto. NUNCA inclui o JSONL
// cru no prompt — só prompts truncados, notas do assistant, arquivos editados,
// branch e refs citados.
function buildDigest(path: string): Digest {
  const lines = parseTranscript(path)
  const userPrompts: string[] = []
  const assistantNotes: string[] = []
  const filesTouched = new Set<string>()
  const refs = new Set<string>()
  const branchesSeen: string[] = []
  let userTurns = 0
  let editCount = 0

  for (const l of lines) {
    if (l.gitBranch && branchesSeen[branchesSeen.length - 1] !== l.gitBranch) {
      branchesSeen.push(l.gitBranch)
    }
    const role = l.message?.role
    const content = l.message?.content

    if (role === 'user') {
      const text = contentText(content)
      // Mensagens de tool_result voltam como role:user com content estruturado
      // sem texto — só contamos turnos com texto real do usuário.
      if (text && !text.startsWith('<')) {
        userTurns++
        userPrompts.push(text.slice(0, MAX_USER_PROMPT_CHARS))
        for (const m of text.match(PR_RE) ?? []) refs.add(m)
      }
    } else if (role === 'assistant') {
      const text = contentText(content)
      if (text) {
        assistantNotes.push(text.slice(0, MAX_ASSISTANT_TEXT_CHARS))
        for (const m of text.match(PR_RE) ?? []) refs.add(m)
      }
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === 'tool_use' && (c.name === 'Edit' || c.name === 'Write')) {
            editCount++
            const fp = c.input?.file_path ?? c.input?.path
            if (fp) filesTouched.add(fp)
          }
        }
      }
    }
  }

  return {
    userPrompts: userPrompts.slice(-MAX_DIGEST_ENTRIES),
    assistantNotes: assistantNotes.slice(-MAX_DIGEST_ENTRIES),
    filesTouched: [...filesTouched],
    gitBranch: pickWorkBranch(branchesSeen),
    refs: [...refs].slice(0, 20),
    userTurns,
    editCount,
  }
}

function renderDigest(d: Digest): string {
  const parts: string[] = []
  if (d.gitBranch) parts.push(`Branch: ${d.gitBranch}`)
  if (d.refs.length) parts.push(`Referências citadas (PR/commit): ${d.refs.join(', ')}`)
  if (d.filesTouched.length) {
    parts.push(`Arquivos editados (${d.filesTouched.length}):\n${d.filesTouched.map((f) => `- ${f}`).join('\n')}`)
  }
  if (d.userPrompts.length) {
    parts.push(`Pedidos do usuário (cronológico):\n${d.userPrompts.map((p) => `- ${p}`).join('\n')}`)
  }
  if (d.assistantNotes.length) {
    parts.push(`Notas do assistant (cronológico):\n${d.assistantNotes.map((p) => `- ${p}`).join('\n')}`)
  }
  return parts.join('\n\n')
}

// ---- Prompt + parse do output ----

function buildPrompt(currentMd: string, digest: string): string {
  return [
    'Você é um curador de documentação de feature do claude-manager.',
    'Abaixo está o documento Markdown ATUAL da feature (com frontmatter YAML) e um RESUMO da última sessão de trabalho.',
    '',
    'Sua tarefa:',
    '- Atualize as seções "## Progress", "## Next Steps" e "## Decisions" com o que aconteceu na sessão.',
    '- APPEND (não substitua) uma entrada datada na seção "## History" no formato exato `- YYYY-MM-DD: <evento sucinto>` (use a data de hoje).',
    '- PRESERVE integralmente as seções "## Overview", "## Business Rules" e "## Approach" — não as reescreva.',
    '- Mantenha o MESMO frontmatter YAML (id/title/status/etc) inalterado, exceto se a sessão indicar claramente mudança de status.',
    '- Seja conciso e factual. Não invente trabalho que não está no resumo.',
    '',
    'Devolva APENAS o Markdown COMPLETO do documento (frontmatter + corpo), sem cercas de código, sem comentários extras.',
    '',
    '===== DOCUMENTO ATUAL =====',
    currentMd,
    '',
    '===== RESUMO DA SESSÃO =====',
    digest,
  ].join('\n')
}

// Remove cercas de código markdown que o modelo às vezes envolve no output inteiro.
function stripCodeFence(s: string): string {
  const t = s.trim()
  if (t.startsWith('```')) {
    const firstNl = t.indexOf('\n')
    const lastFence = t.lastIndexOf('```')
    if (firstNl !== -1 && lastFence > firstNl) {
      return t.slice(firstNl + 1, lastFence).trim()
    }
  }
  return t
}

// Valida que o output parseia no gray-matter com frontmatter mínimo (id/title/status).
function isValidDoc(md: string): boolean {
  if (!md.trim()) return false
  try {
    const parsed = matter(md)
    const fm = parsed.data as { id?: unknown; title?: unknown; status?: unknown }
    return typeof fm.id === 'string' && typeof fm.title === 'string' && typeof fm.status === 'string'
  } catch {
    return false
  }
}

function resolveModel(feature: Feature): string | null {
  if (feature.model) return feature.model
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_prefs WHERE key = ?')
      .get(SYNTH_MODEL_KEY) as { value: string } | undefined
    return row?.value?.trim() || null
  } catch {
    return null
  }
}

// ---- Serviço ----

export interface SessionExitInfo {
  sessionId: string
  ccSessionId: string | null
  repoId: string
  // Feature escolhida manualmente no spawn (precedência absoluta). null => auto-resolver.
  featureId: string | null
}

type LinkKind = 'manual' | 'auto-linked' | 'auto-created'

class FeatureMemoryService {
  // Debounce por-feature: várias sessões da mesma feature encerrando em sequência
  // colapsam numa única síntese.
  private timers = new Map<string, NodeJS.Timeout>()
  private running = new Set<string>()

  onSessionExit(info: SessionExitInfo): void {
    if (!info.ccSessionId) return
    const ccSessionId = info.ccSessionId

    let resolution: { featureId: string; kind: LinkKind } | null = null
    try {
      resolution = this.resolveFeature(info, ccSessionId)
    } catch (err) {
      console.error('[feature-memory] resolução de feature falhou:', err)
      return
    }
    if (!resolution) return

    const { featureId, kind } = resolution
    console.log(`[feature-memory] session ${info.sessionId} ${kind} -> feature ${featureId}`)

    // Observabilidade: a UI recarrega a lista assim que a feature é criada/linkada
    // (antes só havia console.log no main — o usuário nunca via que registrou).
    const feat = getFeature(featureId)
    if (feat) broadcast('feature:updated', feat)

    const existing = this.timers.get(featureId)
    if (existing) clearTimeout(existing)
    this.timers.set(
      featureId,
      setTimeout(() => {
        this.timers.delete(featureId)
        void this.synthesize(featureId, ccSessionId)
      }, DEBOUNCE_MS),
    )
  }

  // Backfill: resolve + cria/linka uma sessão JÁ encerrada, SEM agendar síntese LLM
  // (o backfill só registra; a síntese fica sob demanda). Retorna o resultado para
  // contagem, ou null se a sessão não rende feature (atividade insuficiente, etc).
  registerOnly(info: SessionExitInfo): { featureId: string; kind: LinkKind } | null {
    if (!info.ccSessionId) return null
    try {
      return this.resolveFeature(info, info.ccSessionId)
    } catch (err) {
      console.error('[feature-memory] backfill resolve falhou:', err)
      return null
    }
  }

  // Resolve (ou cria) a feature a vincular à sessão e persiste sessions.feature_id.
  // Retorna null quando não deve vincular nem sintetizar (trivial / sem branch
  // utilizável / branch protegida sem feature pré-existente).
  private resolveFeature(
    info: SessionExitInfo,
    ccSessionId: string,
  ): { featureId: string; kind: LinkKind } | null {
    // 1. Manual vence (sem guarda de atividade — o usuário escolheu a feature).
    if (info.featureId) {
      const f = getFeature(info.featureId)
      if (f) return { featureId: f.id, kind: 'manual' }
      // feature manual sumiu — cai pra auto-resolução.
    }

    // 2. Distila o transcript. `digest.gitBranch` já é a branch de TRABALHO (última
    // não-protegida vista — pegar a primeira/main era a causa de 0 registros).
    const transcriptPath = findTranscriptPath(ccSessionId)
    if (!transcriptPath) return null
    const digest = buildDigest(transcriptPath)

    const branch = normalizeBranch(digest.gitBranch)
    const workBranch = branch && !isProtectedBranch(branch) ? branch : null
    const firstPrompt = digest.userPrompts[0] ?? null

    const projectId = getProjectIdForRepo(info.repoId)
    if (!projectId) return null

    // Candidatos a vínculo: por branch de trabalho e por fuzzy de objetivo.
    const byBranch = workBranch ? findFeatureByRepoBranch(info.repoId, workBranch) : null
    let fuzzyMatch: { featureId: string; score: number } | null = null
    if (firstPrompt) {
      for (const f of listActiveFeaturesByProject(projectId)) {
        const score = fuzzyScore(firstPrompt, f.title)
        if (!fuzzyMatch || score > fuzzyMatch.score) fuzzyMatch = { featureId: f.id, score }
      }
    }

    const decision = decideRegistration({
      synthMode: globalSynthMode(),
      userTurns: digest.userTurns,
      editCount: digest.editCount,
      workBranch,
      firstPrompt,
      byBranchFeatureId: byBranch?.id ?? null,
      fuzzyMatch,
    })

    if (decision.action === 'skip') return null
    if (decision.action === 'link') {
      this.persistLink(info.sessionId, decision.featureId)
      return { featureId: decision.featureId, kind: 'auto-linked' }
    }

    // create: título já decidido (pela branch ou pelo objetivo).
    const repoPath = getRepoPath(info.repoId)
    const created = createFeature({
      projectId,
      title: decision.title,
      status: 'in-progress',
      objective: firstPrompt ? firstPrompt.slice(0, MAX_AUTO_OBJECTIVE_CHARS) : null,
      repos: [{ repoId: info.repoId, branch: workBranch ?? branch ?? 'main', worktreePath: repoPath }],
    })
    // create() já fez markSelfWrite no `.md`; nada extra a fazer aqui.
    this.persistLink(info.sessionId, created.id)
    return { featureId: created.id, kind: 'auto-created' }
  }

  private persistLink(sessionId: string, featureId: string): void {
    try {
      getDb().prepare('UPDATE sessions SET feature_id = ? WHERE id = ?').run(featureId, sessionId)
    } catch (err) {
      console.error('[feature-memory] falha ao persistir feature_id:', err)
    }
  }

  private async synthesize(featureId: string, ccSessionId: string): Promise<void> {
    if (this.running.has(featureId)) return
    this.running.add(featureId)
    try {
      const feature = getFeature(featureId)
      if (!feature) return
      if (feature.synthMode === 'manual') return

      const transcriptPath = findTranscriptPath(ccSessionId)
      if (!transcriptPath) return

      const digest = buildDigest(transcriptPath)

      // Guarda (modo 'threshold'): exige trabalho real. 'auto' pula a guarda.
      if (feature.synthMode !== 'auto') {
        if (digest.userTurns < 2 || digest.editCount === 0) return
      }

      const currentMd = (() => {
        try {
          return readFileSync(feature.docPath, 'utf8')
        } catch {
          return null
        }
      })()
      if (!currentMd) return

      const prompt = buildPrompt(currentMd, renderDigest(digest))
      const model = resolveModel(feature)
      const args = ['-p', prompt, '--output-format', 'text']
      if (model) args.push('--model', model)

      const result = await runClaude(args, { timeoutMs: SYNTH_TIMEOUT_MS })
      if (result.code !== 0) {
        emitSynthError(featureId, `síntese falhou (exit ${result.code}): ${result.stderr.slice(0, 300)}`)
        return
      }

      const md = stripCodeFence(result.stdout)
      if (!isValidDoc(md)) {
        emitSynthError(featureId, 'output da síntese inválido (frontmatter ausente ou não parseável)')
        return
      }

      // Escrita segura: marca self-write ANTES de escrever (o watcher ignora),
      // depois re-indexa pelo doc e emite o update.
      try {
        // Garante last_updated atualizado no frontmatter escrito.
        const reparsed = matter(md)
        reparsed.data.last_updated = Date.now()
        const finalMd = matter.stringify(reparsed.content, reparsed.data)
        markSelfWrite(feature.docPath)
        writeFileSync(feature.docPath, finalMd, 'utf8')
      } catch (err) {
        emitSynthError(featureId, `falha ao escrever doc: ${String(err)}`)
        return
      }

      const updated = reindexFromFile(feature.docPath)
      if (updated) broadcast('feature:updated', updated)
    } catch (err) {
      emitSynthError(featureId, `erro inesperado na síntese: ${String(err)}`)
    } finally {
      this.running.delete(featureId)
    }
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

export const featureMemory = new FeatureMemoryService()

// Helper público pra fase 6: extrai seções-chave do corpo de um doc pra injeção
// no system prompt (Overview/Business Rules/Approach/Next Steps).
export function extractKeySections(body: string): string {
  const wanted = ['Overview', 'Business Rules', 'Approach', 'Next Steps']
  const out: string[] = []
  // Quebra o body por headings de nível 2.
  const sections = body.split(/^## /m)
  for (const chunk of sections) {
    const nlIdx = chunk.indexOf('\n')
    if (nlIdx === -1) continue
    const heading = chunk.slice(0, nlIdx).trim()
    const content = chunk.slice(nlIdx + 1).trim()
    if (wanted.includes(heading) && content) {
      out.push(`## ${heading}\n\n${content}`)
    }
  }
  return out.join('\n\n')
}
