import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Clock, Loader, TerminalSquare } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { ChatMessage, SessionActivity } from '../../../../shared/types/ipc'
import { CommandCard, CommandOutputCard } from './CommandCard'
import { CompactSummaryCard } from './CompactSummaryCard'
import { MessageBubble } from './MessageBubble'
import { MetaCard } from './MetaCard'
import { ModelChangeChip } from './ModelChangeChip'
import { PermissionCard } from './PermissionCard'
import { PlanCard } from './PlanCard'
import { QuestionCard } from './QuestionCard'
import { SubagentCard } from './SubagentCard'
import { SystemCard } from './SystemCard'
import { ThinkingCard } from './ThinkingCard'
import { ToolResultCard, ToolUseCard } from './ToolCard'
import { useChatTranscript, usePlanFile } from './useChatTranscript'
import { buildDigitKey, buildPlanKeys, findManualApproveIndex } from './respond-keys'
import { gateMenuByStatus, menuFingerprint, type TuiMenu } from '../tui-menu-parser'
import {
  countUserMessages,
  isAtBottom,
  nextResolveAt,
  pendingEchoes,
  pendingInteractive,
  resolveChatViewState,
  resolveInteractive,
  showTerminalWaitBanner,
  type Echo,
} from './chat-logic'

export interface ChatViewHandle {
  // Eco otimista: chamado pelo Terminal ao enviar pelo composer em modo chat.
  pushEcho: (text: string) => void
}

interface Props {
  sessionId: string
  // Status da sessão (do broadcast session:activity, via Terminal) pra mostrar um
  // indicador discreto de "trabalhando" enquanto o claude computa a resposta.
  status?: SessionActivity['status']
  // Alterna pro modo terminal. Usado pelo banner de espera genérica (ex.: prompt
  // de permissão y/n, TTY-only) pra levar o usuário ao único lugar que o renderiza.
  onToggleMode?: () => void
  // Reproduz sequências de teclas no PTY vivo (mesmo write() do onForwardKey do
  // composer). Vem do Terminal; ausente = cards ficam read-only. Consumido pelo
  // caminho de clique baseado no menu TUI parseado (não pelo transcript: a CLI
  // não grava o tool_use pendente no JSONL, então cards de transcript nunca
  // estão pendentes — só pós-resposta).
  onRespond?: (seqs: string[]) => void
  // Menu TUI pendente parseado do buffer do xterm (Terminal, debounced). É a
  // FONTE do momento pendente clicável. null = sem menu íntegro parseado.
  tuiMenu?: TuiMenu | null
  // Re-parse FRESCO do buffer, chamado imediatamente antes de digitar (guard de
  // clique: o menu pode ter fechado/mudado desde o último debounce).
  reparseMenu?: () => TuiMenu | null
}

// Render híbrido do transcript JSONL. O PTY segue vivo por baixo (xterm oculto no
// Terminal); esta view só LÊ o transcript e adiciona ecos otimistas das mensagens
// recém-enviadas até o disco alcançar.
// Placeholder do card de plano pendente quando o conteúdo não pôde ser resolvido
// (CLI antiga sem plan file, leitura falhou) — fail-safe, comportamento anterior.
const PLAN_PLACEHOLDER = '_O plano está na conversa acima — revise antes de decidir._'

// PlanCard de transcript (pós-fato) com fallback de robustez: se o input do
// ExitPlanMode veio com plan vazio mas com planFilePath, busca o arquivo.
// Componente próprio porque usePlanFile é um hook (não pode viver no map).
function TranscriptPlanCard({
  plan,
  planFilePath,
  decision,
}: {
  plan: string
  planFilePath: string | null
  decision?: boolean
}) {
  const fetched = usePlanFile(plan ? null : planFilePath)
  return <PlanCard plan={plan || fetched || PLAN_PLACEHOLDER} decision={decision} />
}

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView({ sessionId, status, onToggleMode, onRespond, tuiMenu, reparseMenu }, ref) {
  const { messages, loading, transcriptExists, lastPlanFilePath } = useChatTranscript(sessionId)
  const [echoes, setEchoes] = useState<Echo[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  // Só auto-scrollamos se o usuário já estava colado no fim (não roubamos a
  // rolagem de quem subiu pra reler).
  const stickRef = useRef(true)

  const diskUserCount = useMemo(() => countUserMessages(messages), [messages])

  useImperativeHandle(
    ref,
    () => ({
      pushEcho: (text: string) => {
        stickRef.current = true
        setEchoes((prev) => [...prev, { text, resolveAt: nextResolveAt(diskUserCount, prev.length) }])
      },
    }),
    [diskUserCount],
  )

  // Poda ecos resolvidos quando a contagem de usuário no disco avança.
  useEffect(() => {
    setEchoes((prev) => {
      const next = pendingEchoes(prev, diskUserCount)
      return next.length === prev.length ? prev : next
    })
  }, [diskUserCount])

  function onScroll() {
    const el = scrollRef.current
    if (el) stickRef.current = isAtBottom(el)
  }

  const rendered = useMemo<ChatMessage[]>(
    () => [...messages, ...echoes.map((e) => ({ kind: 'user', text: e.text }) as ChatMessage)],
    [messages, echoes],
  )

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [rendered])

  // Re-pina no fim quando a ALTURA do conteúdo cresce de forma assíncrona (syntax
  // highlight, imagens, web-font swap, expand de card) — o effect de [rendered] acima
  // só roda no commit do React e perde esse crescimento. Observa o div de conteúdo via
  // callback ref (que só existe no estado 'ready') e reusa o MESMO stickRef, então o
  // scroll-up desengata daqui também.
  const observerRef = useRef<ResizeObserver | null>(null)
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current
      if (el && stickRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(node)
    observerRef.current = ro
  }, [])
  useEffect(() => () => observerRef.current?.disconnect(), [])

  // Liga cada pergunta/plano (por id) à resposta/decisão posterior, pra fundir
  // ambos no mesmo card e não renderizar a mensagem de resposta solta. Sobre as
  // mensagens de disco: ecos otimistas são só texto do usuário.
  const interactive = useMemo(() => resolveInteractive(messages), [messages])
  const pendingPrompt = useMemo(() => pendingInteractive(messages), [messages])

  // ── Momento pendente vindo do menu TUI parseado do buffer ──────────────────
  const menuFp = tuiMenu ? menuFingerprint(tuiMenu) : null
  // Clique já enviado pro menu atual (identificado por fingerprint) + contagem
  // de respostas resolvidas no momento do envio, pra detectar a resposta real.
  const [tuiSent, setTuiSent] = useState<{
    fp: string
    label?: string
    resolvedCount: number
  } | null>(null)
  // Fingerprint do menu cuja resposta JÁ chegou no JSONL: enquanto o menu
  // (idêntico) ainda não sumiu do buffer, o card sintetizado não renderiza —
  // senão duplicaria com o card respondido que o transcript acabou de trazer.
  const [consumedFp, setConsumedFp] = useState<string | null>(null)
  const resolvedCount = interactive.answers.size + interactive.plans.size

  useEffect(() => {
    if (menuFp == null) setConsumedFp(null)
  }, [menuFp])

  // Reconciliação do clique otimista: resposta real chegou (contagem avançou) →
  // menu consumido; menu mudou/sumiu sem resposta (ex.: Esc no terminal) → limpa
  // o sent pra não bloquear cliques num menu novo.
  useEffect(() => {
    if (!tuiSent) return
    if (resolvedCount > tuiSent.resolvedCount) {
      setConsumedFp(tuiSent.fp)
      setTuiSent(null)
    } else if (menuFp !== tuiSent.fp) {
      setTuiSent(null)
    }
  }, [tuiSent, resolvedCount, menuFp])

  // Dados sintetizados pro QuestionCard: sentinelas (Type something./Chat about
  // this) ficam fora das opções clicáveis — free-text segue pelo compositor.
  const tuiQuestion = useMemo(() => {
    if (!tuiMenu || tuiMenu.kind !== 'question') return null
    const clickable = tuiMenu.options.filter((o) => o.sentinel == null)
    if (clickable.length === 0) return null
    return {
      clickable,
      questions: [
        {
          question: tuiMenu.question ?? 'Claude fez uma pergunta (veja o terminal).',
          header: '',
          multiSelect: tuiMenu.multiSelect,
          options: clickable.map((o) => ({ label: o.label, description: o.description ?? '' })),
        },
      ],
    }
  }, [tuiMenu])

  const manualApproveIndex =
    tuiMenu && tuiMenu.kind === 'plan' ? findManualApproveIndex(tuiMenu) : null

  // Prompt TTY-only (permissão de tool / trust de diretório) espelhado do buffer:
  // as opções vão inteiras pro card (não há sentinelas nesses menus).
  const tuiPermission =
    tuiMenu && (tuiMenu.kind === 'permission' || tuiMenu.kind === 'trust') ? tuiMenu : null

  // Conteúdo do plano pro card PENDENTE: o tool_use do ExitPlanMode ainda não
  // está no JSONL, mas o plan file foi escrito durante o plan mode — lemos ele
  // pelo path do último Write/Edit em ~/.claude/plans/. Sem path ou leitura
  // falhou → placeholder (fail-safe, CLIs antigas continuam como antes).
  const pendingPlanText = usePlanFile(
    tuiMenu?.kind === 'plan' ? lastPlanFilePath : null,
  )

  // Card sintetizado só quando: menu íntegro + status elegível pro kind
  // ('waiting' pra qualquer um; 'starting'/'idle' pré-transcript só pra
  // permission/trust — mesmo gate do Terminal, defesa em profundidade) + o
  // transcript não tem momento pendente próprio (nunca duplicar) + o menu não
  // foi consumido.
  const showTuiCard =
    tuiMenu != null &&
    gateMenuByStatus(tuiMenu, status) != null &&
    pendingPrompt == null &&
    menuFp !== consumedFp &&
    (tuiMenu.kind === 'plan' || tuiQuestion != null || tuiPermission != null)
  const canRespondTui = onRespond != null && showTuiCard && tuiSent == null

  // Guard de clique: RE-PARSE fresco do buffer imediatamente antes de digitar.
  // Menu fechou/mudou (respondido pelo terminal, resize) → fingerprint diverge →
  // NÃO digita nada no PTY.
  function freshMenuMatches(): TuiMenu | null {
    const fresh = reparseMenu?.() ?? null
    if (!fresh || menuFp == null || menuFingerprint(fresh) !== menuFp) return null
    return fresh
  }

  function respondTuiQuestion(clickIndex: number, label: string) {
    if (!canRespondTui || !tuiQuestion || menuFp == null) return
    const target = tuiQuestion.clickable[clickIndex]
    if (!target || !freshMenuMatches()) return
    const keys = buildDigitKey(target.index)
    if (keys.length === 0) return
    setTuiSent({ fp: menuFp, label, resolvedCount })
    onRespond?.(keys)
  }

  // Permissão/trust: mesmo caminho da F3b — re-parse fresco + dígito da opção.
  // Diferente do respondTuiQuestion, os índices são diretos (sem sentinelas).
  function respondTuiPermission(clickIndex: number, label: string) {
    if (!canRespondTui || !tuiPermission || menuFp == null) return
    const target = tuiPermission.options[clickIndex]
    if (!target || !freshMenuMatches()) return
    const keys = buildDigitKey(target.index)
    if (keys.length === 0) return
    setTuiSent({ fp: menuFp, label, resolvedCount })
    onRespond?.(keys)
  }

  function respondTuiPlan(d: 'approve' | 'reject') {
    if (!canRespondTui || menuFp == null) return
    const fresh = freshMenuMatches()
    if (!fresh) return
    // O dígito de aprovação vem do RE-PARSE (não do menu do estado): se a opção
    // manual sumiu/mudou de posição, buildPlanKeys devolve [] e nada é enviado.
    const keys = buildPlanKeys(d, findManualApproveIndex(fresh))
    if (keys.length === 0) return
    setTuiSent({ fp: menuFp, resolvedCount })
    onRespond?.(keys)
  }

  // Espera que o chat não consegue representar (provável prompt de permissão
  // y/n / menu TTY): status 'waiting' sem card conhecido — nem do transcript,
  // nem sintetizado do menu TUI (que tem precedência sobre o banner).
  const waitInTerminal =
    showTerminalWaitBanner({ status, pending: pendingPrompt }) && !showTuiCard

  const viewState = resolveChatViewState({
    loading,
    transcriptExists,
    messageCount: rendered.length,
  })

  /* Card pendente sintetizado do menu TUI parseado do buffer (o transcript não
     expõe o momento pendente — a CLI só grava após a resposta; permission/trust
     nunca chegam ao JSONL). O clique envia o DÍGITO da opção, que seleciona e
     submete na TUI. Extraído em variável porque renderiza TAMBÉM no estado
     pré-transcript (loading/waiting/empty) — o trust prompt aparece antes de
     existir qualquer mensagem. */
  const tuiCardNode = showTuiCard ? (
    <>
      {tuiMenu?.kind === 'question' && tuiQuestion && (
        <QuestionCard
          questions={tuiQuestion.questions}
          onRespond={canRespondTui ? respondTuiQuestion : undefined}
          sentLabel={tuiSent && tuiSent.fp === menuFp ? tuiSent.label : undefined}
        />
      )}
      {tuiMenu?.kind === 'plan' && (
        <PlanCard
          plan={pendingPlanText ?? PLAN_PLACEHOLDER}
          onDecide={canRespondTui ? respondTuiPlan : undefined}
          sent={tuiSent != null && tuiSent.fp === menuFp}
          canApprove={manualApproveIndex != null}
        />
      )}
      {tuiPermission && (
        <PermissionCard
          kind={tuiPermission.kind === 'trust' ? 'trust' : 'permission'}
          question={tuiPermission.question}
          context={tuiPermission.context}
          options={tuiPermission.options}
          onRespond={canRespondTui ? respondTuiPermission : undefined}
          sentLabel={tuiSent && tuiSent.fp === menuFp ? tuiSent.label : undefined}
        />
      )}
    </>
  ) : null

  if (viewState !== 'ready') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-[var(--color-bg)] p-6">
        <div className="flex flex-col items-center gap-2 text-center text-sm text-[var(--color-text-dim)]">
          {(viewState === 'loading' || viewState === 'waiting') && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-text-dim)]" />
          )}
          {viewState === 'loading' && 'Carregando conversa…'}
          {viewState === 'waiting' &&
            'Aguardando transcript… a conversa aparece assim que o claude responder.'}
          {viewState === 'empty' &&
            'Sem mensagens ainda. Envie um prompt pelo compositor abaixo — a conversa aparece aqui assim que o claude responder.'}
        </div>
        {/* Prompt TTY-only pré-transcript (ex.: trust de diretório): o card
            precisa aparecer MESMO sem nenhuma mensagem — é o que destrava a
            sessão pra própria conversa nascer. */}
        {tuiCardNode && <div className="w-full max-w-3xl text-left">{tuiCardNode}</div>}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="absolute inset-0 z-10 overflow-y-auto bg-[var(--color-bg)] px-3 py-4"
    >
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3">
        {rendered.map((m, i) => {
          // Ecos otimistas vêm DEPOIS das mensagens de disco; marcamos como pendentes.
          const echoPending = i >= messages.length
          switch (m.kind) {
            case 'user':
              return <MessageBubble key={i} role="user" text={m.text} pending={echoPending} />
            case 'assistant':
              return <MessageBubble key={i} role="assistant" text={m.text} />
            case 'thinking':
              return <ThinkingCard key={i} text={m.text} />
            case 'system':
              return (
                <SystemCard
                  key={i}
                  label={m.label}
                  detail={m.detail}
                  level={m.level}
                  trigger={m.trigger}
                  preTokens={m.preTokens}
                  postTokens={m.postTokens}
                />
              )
            case 'compact_summary':
              return <CompactSummaryCard key={i} text={m.text} />
            case 'model_change':
              return <ModelChangeChip key={i} from={m.from} to={m.to} />
            case 'command':
              return <CommandCard key={i} name={m.name} args={m.args} />
            case 'command_output':
              return <CommandOutputCard key={i} text={m.text} />
            case 'meta':
              return <MetaCard key={i} text={m.text} label={m.label} />
            case 'tool_use':
              return <ToolUseCard key={i} name={m.name} input={m.input} />
            case 'subagent':
              return (
                <SubagentCard
                  key={i}
                  name={m.name}
                  description={m.description}
                  turnCount={m.turnCount}
                  turns={m.turns}
                  status={
                    interactive.subagents.has(m.id)
                      ? interactive.subagents.get(m.id)
                        ? 'error'
                        : 'ok'
                      : undefined
                  }
                />
              )
            case 'tool_result':
              return <ToolResultCard key={i} content={m.content} isError={m.isError} />
            // Cards de transcript são PÓS-resposta por natureza: a CLI só grava o
            // tool_use no JSONL junto com a resposta, então nunca estão pendentes.
            // O momento pendente (clicável) vem do menu TUI parseado do buffer.
            case 'ask_user_question':
              return (
                <QuestionCard key={i} questions={m.questions} answers={interactive.answers.get(m.id)} />
              )
            case 'exit_plan_mode':
              return (
                <TranscriptPlanCard
                  key={i}
                  plan={m.plan}
                  planFilePath={m.planFilePath}
                  decision={interactive.plans.get(m.id)}
                />
              )

            // Resposta/decisão/status são fundidos no card acima (por forId) — não
            // renderizam sozinhos.
            case 'ask_user_question_answered':
            case 'plan_decision':
            case 'subagent_result':
              return null
          }
        })}
        {tuiCardNode}
        {pendingPrompt && (
          <div className="sticky bottom-0 flex items-center gap-2 rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            <Icon as={Clock} size={14} className="shrink-0 text-[var(--color-accent)]" />
            {pendingPrompt.kind === 'plan'
              ? 'Claude está aguardando sua aprovação do plano — responda no compositor ou no terminal.'
              : 'Claude está aguardando sua resposta — responda no compositor ou no terminal.'}
          </div>
        )}
        {/* Espera genérica (TTY-only): o chat não tem card pra mostrar. Direciona ao
            terminal, único lugar que renderiza o prompt (ex.: permissão y/n). */}
        {waitInTerminal && (
          <div className="sticky bottom-0 flex items-center gap-2 rounded-md border border-[var(--color-warning)]/60 bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-warning)]" />
            <Icon as={Clock} size={14} className="shrink-0 text-[var(--color-warning)]" />
            <span className="flex-1">
              Claude está aguardando sua resposta no terminal (ex.: permissão). Abra o Terminal pra
              responder.
            </span>
            {onToggleMode && (
              <button
                type="button"
                onClick={onToggleMode}
                className="flex shrink-0 items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs font-medium hover:border-[var(--color-warning)]"
              >
                <Icon as={TerminalSquare} size={13} />
                Ir pro Terminal
              </button>
            )}
          </div>
        )}
        {/* Indicador discreto de atividade. Suprimido quando há um prompt pendente
            (status 'waiting'), pra não competir com o banner acima. */}
        {status === 'working' && !pendingPrompt && (
          <div className="flex items-center gap-2 px-1 text-xs text-[var(--color-text-dim)]">
            <Icon as={Loader} size={13} className="animate-spin text-[var(--color-accent)]" />
            Claude está trabalhando…
          </div>
        )}
      </div>
    </div>
  )
})
