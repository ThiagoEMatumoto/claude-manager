import '@xterm/xterm/css/xterm.css'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Circle, Clock, Loader, Moon, Pencil, Zap } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { Icon } from '@/components/ui/Icon'
import { renderProjectIcon } from '@/components/ui/projectIcon'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { sessionsApi } from '@/lib/ipc'
import { matchCombo, resolveCombo } from '@/lib/keybindings'
import { useKeybindingsStore } from '@/lib/keybindings-store'
import { useAppStore, type PaneMode } from '@/store/appStore'
import { useSession } from './useSession'
import { Composer, type ComposerHandle } from './Composer'
import { ComposerToolbar } from './ComposerToolbar'
import { ChatView, type ChatViewHandle } from './chat/ChatView'
import { MODEL_ALIASES, EFFORT_LEVELS, type ModelAlias, type EffortLevel } from './ModelPill'
import { mergePending, nextPendingApply, type PendingSelection } from './model-queue'
import { useTerminalPrefsStore } from '@/lib/terminal-prefs-store'
import { useFilesStore } from '@/lib/files-store'
import { xtermTheme } from '@/lib/themes'
import { getCurrentThemeTokens, onThemeChange } from '@/app/useTheme'
import type { Session, SessionActivity } from '../../../shared/types/ipc'

interface Props {
  session: Session
  repoLabel: string
  repoPath: string
  projectName: string
  projectIcon?: string | null
  projectColor?: string | null
  // Display da pane (híbrido): 'terminal' mostra o xterm; 'chat' mostra o ChatView
  // renderizado do transcript com o xterm/PTY vivo por baixo. Default 'terminal'.
  mode?: PaneMode
  onToggleMode?: () => void
  onClose: () => void
  onTitleChange?: (title: string) => void
  onReopen?: () => void
  onOpenSettings?: () => void
}

interface StatusView {
  label: string
  icon: ComponentType<LucideProps>
  className: string
  spin?: boolean
}

function activityStatusView(status: SessionActivity['status'] | undefined): StatusView | null {
  switch (status) {
    case 'working':
      return { label: 'trabalhando', icon: Zap, className: 'text-[var(--color-accent)]' }
    case 'waiting':
      return { label: 'aguardando você', icon: Clock, className: 'text-[var(--color-warning)]' }
    case 'idle':
      return { label: 'ocioso', icon: Moon, className: 'text-[var(--color-text-dim)]' }
    case 'starting':
      return { label: 'iniciando', icon: Loader, className: 'text-[var(--color-text-dim)]', spin: true }
    case 'ended':
    default:
      return null
  }
}

// Colar conteúdo multilinha manda vários `\r` ⇒ o claude auto-submete cada linha
// (footgun). Conteúdo grande/multilinha passa por uma confirmação antes de colar.
const needsPasteConfirm = (t: string) => t.includes('\n') || t.length > 200

// Casa paths impressos no terminal: absolutos (/...), home (~/...) e relativos
// (./..., ../..., ou sem prefixo). Exige conter `/` (o `\/` no meio garante isso).
const PATH_RE = /(?:~|\.{1,2})?\/[\w./\-+@]+/g
// Pontuação de fim de frase grudada no path não faz parte dele.
const TRAILING = /[.,:;)\]}>'"]+$/

// Resolução simples de path no renderer (sem `path` do node): junta um path
// relativo ao cwd e colapsa segmentos `.`/`..`. Não toca em absolutos/`~`.
function resolvePath(raw: string, cwd: string | null): string | null {
  if (raw.startsWith('/') || raw.startsWith('~')) return raw
  if (!cwd) return null
  const base = cwd.replace(/\/+$/, '')
  const parts = `${base}/${raw}`.split('/')
  const out: string[] = []
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

function formatRelative(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `há ${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.round(m / 60)
  return `há ${h}h`
}

export function Terminal({
  session,
  repoLabel,
  repoPath,
  projectName,
  projectIcon,
  projectColor,
  mode = 'terminal',
  onToggleMode,
  onClose,
  onTitleChange,
  onReopen,
  onOpenSettings,
}: Props) {
  const { exited, exitCode, error, write, resize, setDataHandler } = useSession(session.id)
  const endSession = useAppStore((s) => s.endSession)
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Xterm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const fontSize = useTerminalPrefsStore((s) => s.fontSize)
  const scrollback = useTerminalPrefsStore((s) => s.scrollback)
  // Heurístico de "claude não encontrado": registramos se algum byte chegou do PTY.
  // Se o processo saiu rápido com código != 0 e nunca emitiu nada, provavelmente o
  // comando não foi resolvido (ENOENT) em vez de uma sessão de verdade ter morrido.
  const gotDataRef = useRef(false)
  // Instante do exit, pra medir quanto tempo a sessão viveu (heurístico abaixo).
  const exitAtRef = useRef<number | null>(null)

  const [title, setTitle] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [activity, setActivity] = useState<SessionActivity | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [pastePreview, setPastePreview] = useState<string | null>(null)
  const [multilineActive, setMultilineActive] = useState(false)
  const composerRef = useRef<ComposerHandle>(null)
  const chatViewRef = useRef<ChatViewHandle>(null)
  const visualLineNav = useTerminalPrefsStore((s) => s.visualLineNav)
  // O key handler do xterm é registrado uma vez (no mount); uma ref evita ler um
  // `activity` stale ao decidir interceptar as setas.
  const activityRef = useRef<SessionActivity | null>(activity)
  activityRef.current = activity

  // cwd da sessão pra resolver paths relativos clicados no terminal. É o path do
  // repo do pane; vazio em sessões avulsas (aí só linkamos absolutos/`~`). Ref pra
  // o link provider ler o valor atual sem recriar o xterm.
  const cwdRef = useRef(repoPath)
  cwdRef.current = repoPath

  useEffect(() => {
    setTitle(session.title ?? null)
  }, [session.title])

  // O ccSessionId é o próprio session.id (ver sessions:spawn no main).
  const ccSessionId = session.ccSessionId ?? null

  useEffect(() => {
    if (!ccSessionId || exited) return
    void sessionsApi.watchActivity(ccSessionId)
    const off = sessionsApi.onActivity((a) => {
      if (a.ccSessionId === ccSessionId) setActivity(a)
    })
    return () => {
      off()
      void sessionsApi.unwatchActivity(ccSessionId)
    }
  }, [ccSessionId, exited])

  // Tick para manter o "há Xs" relativo atualizado sem novos broadcasts.
  useEffect(() => {
    if (!activity?.lastActivityAt || exited) return
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [activity?.lastActivityAt, exited])

  // Backstop do indicador de multilinha: se o claude começou a processar (= submeteu)
  // ou a sessão saiu, o badge não faz mais sentido — zera mesmo sem o Enter ter passado
  // pelo handler do xterm (ex: submit por outro caminho).
  useEffect(() => {
    if (activity?.status === 'working' || exited) setMultilineActive(false)
  }, [activity?.status, exited])

  // Precedência do nome em destaque: name do CC (live) > rename salvo no DB > label do repo.
  const displayTitle = activity?.name ?? title ?? repoLabel
  // A sessão tem nome próprio (não é só o fallback pro label da pasta)? Só então o
  // título aparece após o '·' no breadcrumb — evita repetir a pasta (Projeto · Repo).
  // A sessão tem nome próprio (não é só o fallback pro label da pasta)? Só então o
  // título é exibido no header — a aba do dockview já mostra o nome da sessão, então
  // sem nome custom o header mostra só o projeto + path (evita o nome repetido).
  const isNamed = (activity?.name ?? title) != null && (activity?.name ?? title) !== repoLabel

  // Reflete o nome legível na aba do dockview. Ref pra callback evita re-disparar
  // quando o wrapper recria onTitleChange a cada render (dep só no displayTitle).
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange
  useEffect(() => {
    onTitleChangeRef.current?.(displayTitle)
  }, [displayTitle])

  // Só dá pra injetar /rename quando o claude está no prompt; em 'working' ele
  // está ocupado e a injeção concatenaria no meio de um comando/output.
  const canRename = !activity || activity.status !== 'working'

  // Troca de modelo/esforço é mais restrita que o rename: só em 'idle'. Em
  // 'waiting' pode haver um prompt de permissão aberto — injetar texto ali
  // responderia o prompt errado.
  const canSwitchModel = !exited && activity?.status === 'idle'

  // Injeção sanitizada: os valores vêm EXCLUSIVAMENTE das whitelists literais
  // do ModelPill — nunca texto livre. \x15 (Ctrl+U) limpa a linha do prompt
  // antes, pra não concatenar com algo já digitado (mesmo padrão do /rename).
  function injectModel(alias: ModelAlias) {
    if (MODEL_ALIASES.includes(alias)) write('\x15/model ' + alias + '\r')
  }
  function injectEffort(level: EffortLevel) {
    if (EFFORT_LEVELS.includes(level)) write('\x15/effort ' + level + '\r')
  }

  // Troca enfileirada enquanto a sessão está ocupada; aplicada no próximo idle.
  const [pending, setPending] = useState<PendingSelection>({})
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const prevStatusRef = useRef<SessionActivity['status'] | null>(null)

  // Em idle injeta direto; ocupada, enfileira (última troca de cada tipo vence).
  function selectModel(alias: ModelAlias) {
    if (!MODEL_ALIASES.includes(alias)) return
    if (canSwitchModel) injectModel(alias)
    else setPending((p) => mergePending(p, { model: alias }))
  }
  function selectEffort(level: EffortLevel) {
    if (!EFFORT_LEVELS.includes(level)) return
    if (canSwitchModel) injectEffort(level)
    else setPending((p) => mergePending(p, { effort: level }))
  }

  // Flush da fila na transição → idle (único estado seguro p/ injetar), uma vez.
  // Lê a pendência via ref pra não re-rodar quando ela muda — só na troca de status.
  useEffect(() => {
    const prev = prevStatusRef.current
    const current = activity?.status ?? null
    prevStatusRef.current = current
    if (exited) return
    const { apply, pending: rest } = nextPendingApply(prev, current, pendingRef.current)
    if (!apply) return
    if (apply.model) injectModel(apply.model)
    if (apply.effort) injectEffort(apply.effort)
    setPending(rest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.status, exited])

  const statusView = activityStatusView(activity?.status)
  const relTime = activity?.lastActivityAt ? formatRelative(now - activity.lastActivityAt) : null

  // Saiu em < 3s do start, com código != 0 e sem nunca ter emitido bytes →
  // tratamos como "claude não encontrado". Não é detecção perfeita, mas evita o
  // críptico "exited (127)" pro caso mais comum (comando não instalado / errado).
  if (exited && exitAtRef.current === null) exitAtRef.current = Date.now()
  const claudeNotFound =
    exited &&
    exitCode !== 0 &&
    !gotDataRef.current &&
    (exitAtRef.current ?? Date.now()) - session.startedAt < 3000

  function copySelection() {
    const sel = xtermRef.current?.getSelection()
    if (sel) void navigator.clipboard.writeText(sel)
  }

  async function paste() {
    const text = await navigator.clipboard.readText()
    if (!text) return
    if (needsPasteConfirm(text)) setPastePreview(text)
    else xtermRef.current?.paste(text) // respeita bracketed-paste, não auto-submete
  }

  // Compose box: injeta o texto no input do claude via paste (bracketed, não
  // auto-submete); sendPrompt ainda manda o \r final pra submeter.
  function insertPrompt(text: string) {
    xtermRef.current?.focus()
    xtermRef.current?.paste(text)
  }
  function sendPrompt(text: string) {
    insertPrompt(text)
    write('\r')
    // Eco otimista: em modo chat, a bolha do usuário aparece na hora; o ChatView
    // a reconcilia quando o transcript de disco alcança (ver chat-logic).
    if (mode === 'chat') chatViewRef.current?.pushEcho(text)
  }

  function commitRename() {
    setEditing(false)
    const next = draft.replace(/[\r\n]+/g, ' ').trim()
    if (next.length === 0) return
    // Cache no nosso DB (Fase 4/listagem). A exibição prioriza activity.name.
    void sessionsApi.rename(session.id, next)
    // Fonte de verdade do nome é o claude: injeta /rename. \x15 (Ctrl+U) limpa a
    // linha atual do prompt pra não concatenar com algo que o usuário digitou.
    if (canRename) write('\x15/rename ' + next + '\r')
  }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Esc cancela a confirmação de colagem.
  useEffect(() => {
    if (pastePreview == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPastePreview(null)
        xtermRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pastePreview])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Xterm({
      // Tema derivado dos tokens do app (Ember reproduz o antigo hardcoded).
      theme: xtermTheme(getCurrentThemeTokens()),
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: useTerminalPrefsStore.getState().fontSize,
      scrollback: useTerminalPrefsStore.getState().scrollback,
      cursorBlink: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    term.loadAddon(new ClipboardAddon())

    // Linkifica PATHS de arquivo impressos no terminal → abre no painel de arquivos
    // (o WebLinksAddon acima cuida de URLs http, que continuam abrindo externamente).
    // Barato por design: só regex no texto da linha; nenhum I/O em provideLinks (o
    // I/O — ler o arquivo — só acontece no activate via openPath).
    const linkProvider = term.registerLinkProvider({
      provideLinks(lineNumber, cb) {
        const line = term.buffer.active.getLine(lineNumber - 1)
        const text = line?.translateToString(true)
        if (!text) return cb(undefined)
        const links: import('@xterm/xterm').ILink[] = []
        PATH_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = PATH_RE.exec(text)) !== null) {
          let matched = m[0]
          const trimmed = matched.replace(TRAILING, '')
          if (trimmed.length < 2) continue // só "/" ou similar — ignora
          matched = trimmed
          const startX = m.index + 1 // coords do xterm são 1-based
          const endX = m.index + matched.length + 1
          const cwd = cwdRef.current || null
          const resolved = resolvePath(matched, cwd)
          if (!resolved) continue // relativo sem cwd disponível — não linka
          links.push({
            range: { start: { x: startX, y: lineNumber }, end: { x: endX, y: lineNumber } },
            text: matched,
            decorations: { underline: true, pointerCursor: true },
            activate() {
              void useFilesStore.getState().openPath(resolved)
            },
          })
        }
        cb(links.length ? links : undefined)
      },
    })

    term.open(host)
    fit.fit()

    xtermRef.current = term
    fitRef.current = fit

    // O processo já foi spawnado no clique, então pode já ter emitido bytes.
    // Para o replay: acumulamos a saída live num buffer (`liveTotal`) e buscamos
    // o backlog (snapshot do histórico no main). O backlog é prefixo do que vimos
    // até agora; escrevemos o backlog inteiro, depois só a cauda do live que ele
    // ainda não cobria. Assim não duplicamos os bytes que entraram em `liveTotal`
    // enquanto o IPC do backlog estava em voo. Idempotente em remounts (StrictMode)
    // porque o term é novo e zerado a cada mount.
    let flushed = false
    let liveTotal = ''
    setDataHandler((data) => {
      gotDataRef.current = true
      if (flushed) term.write(data)
      else liveTotal += data
    })
    term.onData((d) => write(d))

    void sessionsApi.getBacklog(session.id).then((backlog) => {
      if (xtermRef.current !== term) return
      term.write(backlog)
      if (liveTotal.length > backlog.length) term.write(liveTotal.slice(backlog.length))
      liveTotal = ''
      flushed = true
    })

    // Copy-on-select: copiar automaticamente o que for selecionado.
    term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) void navigator.clipboard.writeText(sel)
    })

    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true

      // Copiar: Ctrl+Shift+C (todas plataformas), ou Cmd+C no mac só se houver seleção.
      if ((e.ctrlKey && e.shiftKey && e.key === 'C') || (e.shiftKey && e.key === 'C' && e.metaKey)) {
        const sel = term.getSelection()
        if (sel) void navigator.clipboard.writeText(sel)
        return false
      }
      if (isMac && e.metaKey && !e.shiftKey && e.key === 'c') {
        const sel = term.getSelection()
        if (!sel) return true // sem seleção, deixa o Cmd+C passar
        void navigator.clipboard.writeText(sel)
        return false
      }

      // Colar (Ctrl+V, Ctrl+Shift+V, Cmd+V): o evento DOM `paste` (onPaste, abaixo) é o
      // ÚNICO inseridor. Aqui só retornamos false pra suprimir o paste/byte-de-controle que
      // o xterm dispara no keydown — chamar paste() aqui colaria 2x junto com o onPaste.
      if ((e.ctrlKey && (e.key === 'v' || e.key === 'V')) || (isMac && e.metaKey && e.key === 'v')) {
        return false
      }

      // Multiline: combo configurável (default Shift+Enter) + Alt+Enter fixo como alternativa.
      // O xterm manda `\r` puro (igual ao Enter); o claude só quebra linha quando recebe
      // ESC+CR (o mesmo que `/terminal-setup` configura no emulador nativo).
      // Lê overrides via getState() pra rebind valer sem recriar o xterm.
      const kbOverrides = useKeybindingsStore.getState().overrides
      if (matchCombo(e, resolveCombo('terminal.newline', kbOverrides)) || (e.key === 'Enter' && e.altKey)) {
        setMultilineActive(true)
        write('\x1b\r')
        return false
      }

      // Compose box: foca o dock do composer (default Ctrl+Shift+E).
      if (matchCombo(e, resolveCombo('terminal.compose', kbOverrides))) {
        composerRef.current?.focus()
        return false
      }

      // Navegação por linha visual (opt-in): ↑/↓ movem o cursor uma linha VISUAL
      // (uma largura de tela) em vez de cair no histórico do claude. Só quando o
      // modo está ligado, a sessão não está processando, e sem modificadores.
      if (
        useTerminalPrefsStore.getState().visualLineNav &&
        activityRef.current?.status !== 'working' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        const step = e.key === 'ArrowUp' ? '\x1b[D' : '\x1b[C'
        write(step.repeat(Math.max(1, term.cols)))
        return false
      }

      // Busca no terminal: combo configurável (default Ctrl/Cmd+F). Abre o overlay
      // por-pane ligado ao SearchAddon deste terminal.
      if (matchCombo(e, resolveCombo('terminal.search', useKeybindingsStore.getState().overrides))) {
        setSearchOpen(true)
        return false
      }

      // Limpar terminal: combo configurável (default Ctrl+Shift+K).
      if (matchCombo(e, resolveCombo('terminal.clear', useKeybindingsStore.getState().overrides))) {
        xtermRef.current?.clear()
        return false
      }

      // Enter puro = submit no claude: zera o indicador de multilinha. NÃO interceptamos.
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) setMultilineActive(false)

      // Ctrl+C simples NÃO é interceptado: precisa chegar ao claude como SIGINT/interrupt.
      return true
    })

    resize(term.cols, term.rows)

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, hasSelection: term.hasSelection() })
    }
    host.addEventListener('contextmenu', onContextMenu)

    // Único ponto de inserção para paste via DOM (Ctrl+V, clique direito, middle-click).
    // Sempre interceptamos em captura e inserimos nós mesmos — assim o paste nativo do
    // xterm não roda em paralelo (era a 2ª inserção do double-paste). Conteúdo grande/
    // multilinha abre a confirmação; o resto cola via term.paste() (respeita bracketed).
    let lastPasteText = ''
    let lastPasteAt = 0
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? ''
      if (!text) return
      e.preventDefault()
      e.stopPropagation()
      // Alguns ambientes (Electron/Chromium) emitem 2 eventos `paste` para um único gesto.
      // Descartamos o duplicado idêntico dentro de uma janela curta pra não colar 2x.
      const now = Date.now()
      if (text === lastPasteText && now - lastPasteAt < 50) return
      lastPasteText = text
      lastPasteAt = now
      if (needsPasteConfirm(text)) setPastePreview(text)
      else xtermRef.current?.paste(text)
    }
    host.addEventListener('paste', onPaste, true)

    const observer = new ResizeObserver(() => {
      if (!xtermRef.current || !fitRef.current) return
      fitRef.current.fit()
      resize(xtermRef.current.cols, xtermRef.current.rows)
    })
    observer.observe(host)

    // Tema ao vivo: quando o tema do app muda (Configurações), re-deriva o
    // tema do xterm sem recriar o terminal.
    const offTheme = onThemeChange((tokens) => {
      term.options.theme = xtermTheme(tokens)
    })

    // O cleanup NÃO mata a sessão — só desfaz o xterm e os listeners. A sessão
    // morre quando a pane é fechada (App.closePane → sessions:kill) ou via botão kill.
    return () => {
      host.removeEventListener('contextmenu', onContextMenu)
      host.removeEventListener('paste', onPaste, true)
      observer.disconnect()
      offTheme()
      linkProvider.dispose()
      setDataHandler(null)
      term.dispose()
      xtermRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Zoom ao vivo: atualiza a fonte do xterm já montado quando o store muda, sem
  // recriar o terminal (a criação lê o tamanho via getState()).
  useEffect(() => {
    const term = xtermRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.options.fontSize = fontSize
    fit.fit()
    resize(term.cols, term.rows)
  }, [fontSize, resize])

  // Scrollback ao vivo: atualiza o histórico do xterm já montado quando o store muda,
  // sem recriar o terminal (a criação lê o valor via getState()).
  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    term.options.scrollback = scrollback
  }, [scrollback])

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-start justify-between gap-3 border-b border-l-2 border-[var(--color-border)] border-b-white/[0.06] bg-gradient-to-b from-[var(--color-surface-2)]/70 to-[var(--color-surface)]/50 px-4 py-2 text-xs"
        style={projectColor ? { borderLeftColor: projectColor } : undefined}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {projectName && (
              <span className="flex shrink-0 items-center gap-1.5 font-medium text-[var(--color-text-dim)]">
                <span className="shrink-0">{renderProjectIcon(projectIcon)}</span>
                <span className="max-w-40 truncate">{projectName}</span>
              </span>
            )}
            {editing ? (
              <>
                {projectName && <span className="text-[var(--color-border)]">·</span>}
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  placeholder={repoLabel}
                  className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-0.5 font-medium outline-none focus:border-[var(--color-accent)]"
                />
              </>
            ) : isNamed || !projectName ? (
              // Nome custom (ou sem projeto pra contextualizar): mostra o título, clicável pra renomear.
              <>
                {projectName && <span className="text-[var(--color-border)]">·</span>}
                <button
                  type="button"
                  disabled={!canRename}
                  onClick={() => {
                    setDraft(activity?.name ?? title ?? '')
                    setEditing(true)
                  }}
                  className="truncate font-medium enabled:hover:text-[var(--color-accent)] disabled:cursor-not-allowed"
                  title={canRename ? 'Renomear sessão' : 'Aguarde a sessão ficar ociosa pra renomear'}
                >
                  {displayTitle}
                </button>
              </>
            ) : (
              // Sem nome custom: a aba já mostra o nome da pasta — aqui só um lápis discreto pra nomear.
              canRename && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft('')
                    setEditing(true)
                  }}
                  className="shrink-0 text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
                  title="Nomear esta sessão"
                  aria-label="Nomear esta sessão"
                >
                  <Icon as={Pencil} size={12} />
                </button>
              )
            )}
          </div>
          <span className="truncate text-[10px] text-[var(--color-text-dim)]">{repoPath}</span>
        </div>
        <div className="flex items-center gap-3 text-[var(--color-text-dim)]">
          {!exited && (
            <div className="flex min-w-0 items-center gap-2">
              {statusView ? (
                <span
                  className={`flex items-center gap-1 text-[11px] uppercase tracking-wider ${statusView.className}`}
                >
                  <Icon
                    as={statusView.icon}
                    size={13}
                    className={
                      statusView.spin ? 'animate-spin' : 'drop-shadow-[0_0_4px_currentColor]'
                    }
                  />
                  {statusView.label}
                </span>
              ) : activity?.status === 'ended' ? (
                <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">
                  encerrada
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-[var(--color-success)]">
                  <Icon as={Circle} size={9} className="fill-current drop-shadow-[0_0_4px_currentColor]" />
                  running
                </span>
              )}
              {relTime && <span className="text-[10px]">{relTime}</span>}
              {activity?.title && (
                <span className="max-w-40 truncate text-[10px] text-[var(--color-text-dim)]">
                  {activity.title}
                </span>
              )}
              {multilineActive && activity?.status !== 'working' && (
                <span
                  title="Modo multilinha — Enter envia, Shift+Enter quebra linha"
                  className="flex items-center gap-1 rounded border border-[var(--color-accent)]/40 px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]"
                >
                  ⇧⏎ multilinha
                </span>
              )}
              {visualLineNav && (
                <span
                  title="Navegação por linha visual ligada — ↑/↓ movem pelo prompt em vez do histórico (Configurações ▸ Terminal)"
                  className="flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-dim)]"
                >
                  ↕ por linha
                </span>
              )}
            </div>
          )}
          {exited &&
            (claudeNotFound ? (
              <span className="flex items-center gap-1 text-[var(--color-danger)]">
                <Icon as={AlertCircle} size={13} />
                claude não encontrado
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[var(--color-danger)]">
                <Icon as={Circle} size={9} className="fill-current" />
                encerrada ({exitCode ?? '?'})
              </span>
            ))}
          {error && !claudeNotFound && (
            <span className="flex items-center gap-1 text-[var(--color-danger)]">
              <Icon as={AlertCircle} size={13} />
              {error}
            </span>
          )}
          {onToggleMode && (
            <div className="inline-flex overflow-hidden rounded border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => mode !== 'terminal' && onToggleMode()}
                title="Terminal cru (PTY)"
                className={`px-2 py-0.5 transition ${
                  mode === 'terminal'
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                }`}
              >
                Terminal
              </button>
              <button
                type="button"
                onClick={() => mode !== 'chat' && onToggleMode()}
                title="Chat renderizado do transcript (PTY segue vivo por baixo)"
                className={`px-2 py-0.5 transition ${
                  mode === 'chat'
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                }`}
              >
                Chat
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Minimizar — mantém a sessão rodando em background, acessível no strip de sessões"
            className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            Minimizar
          </button>
          <button
            type="button"
            onClick={() => endSession(session.id)}
            disabled={exited}
            title="Encerrar o processo claude e fechar a sessão (some do strip)"
            className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] disabled:opacity-40"
          >
            Encerrar
          </button>
        </div>
      </div>

      {exited && (
        <div
          className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs"
          style={{ color: 'var(--color-text-dim)' }}
        >
          {claudeNotFound ? (
            <span className="text-[var(--color-text)]">
              <span className="text-[var(--color-danger)]">claude não encontrado</span> — verifique a instalação
              ou configure o comando em Configurações.
            </span>
          ) : (
            <span>
              A sessão foi encerrada{exitCode != null ? ` (código ${exitCode})` : ''}.
            </span>
          )}
          <div className="flex shrink-0 items-center gap-2">
            {claudeNotFound && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                Configurações
              </button>
            )}
            {onReopen && (
              <button
                type="button"
                onClick={onReopen}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]"
              >
                Reabrir
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {/* xterm SEMPRE montado: em modo chat só ocultamos visualmente (o
            sendPrompt usa xterm.paste, então o terminal precisa seguir vivo). */}
        <div
          ref={hostRef}
          className={`h-full bg-[var(--color-bg)] p-2 ${mode === 'chat' ? 'hidden' : ''}`}
        />

        {mode === 'chat' && <ChatView ref={chatViewRef} sessionId={session.id} />}

        {searchOpen && (
          <div
            className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={searchQuery}
              placeholder="Buscar…"
              onChange={(e) => {
                const value = e.target.value
                setSearchQuery(value)
                searchRef.current?.findNext(value)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) searchRef.current?.findPrevious(searchQuery)
                  else searchRef.current?.findNext(searchQuery)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setSearchOpen(false)
                  xtermRef.current?.focus()
                }
              }}
              className="w-44 bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
            />
            <button
              type="button"
              title="Anterior (Shift+Enter)"
              onClick={() => searchRef.current?.findPrevious(searchQuery)}
              className="rounded px-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
            >
              ↑
            </button>
            <button
              type="button"
              title="Próximo (Enter)"
              onClick={() => searchRef.current?.findNext(searchQuery)}
              className="rounded px-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
            >
              ↓
            </button>
            <button
              type="button"
              title="Fechar (Esc)"
              onClick={() => {
                setSearchOpen(false)
                xtermRef.current?.focus()
              }}
              className="rounded px-1 text-[var(--color-text-dim)] hover:text-[var(--color-danger)]"
            >
              ✕
            </button>
          </div>
        )}

        {pastePreview != null && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex max-h-full w-full max-w-md flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-xs shadow-2xl">
              <div className="font-medium text-[var(--color-text)]">
                Colar {pastePreview.split('\n').length} linha
                {pastePreview.split('\n').length === 1 ? '' : 's'}?
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--color-text-dim)]">
                {pastePreview.split('\n').slice(0, 12).join('\n').slice(0, 600)}
                {(pastePreview.split('\n').length > 12 || pastePreview.length > 600) && '\n…'}
              </pre>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPastePreview(null)
                    xtermRef.current?.focus()
                  }}
                  className="rounded border border-[var(--color-border)] px-3 py-1 text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = pastePreview
                    setPastePreview(null)
                    xtermRef.current?.paste(t)
                    xtermRef.current?.focus()
                  }}
                  className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1 font-medium text-[var(--color-bg)] hover:opacity-90"
                >
                  Colar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {!exited && (
        <Composer
          sessionId={session.id}
          ref={composerRef}
          onSend={sendPrompt}
          onInsert={insertPrompt}
          toolbar={
            <ComposerToolbar
              activity={activity}
              canSwitch={canSwitchModel}
              pending={pending}
              onSelectModel={selectModel}
              onSelectEffort={selectEffort}
              // Shift+Tab (CSI Z) cicla o modo de permissão no TUI do claude. A CLI
              // não tem set-exato em runtime (sem /permission) — só este ciclo nativo.
              onCyclePermission={() => write('\x1b[Z')}
            />
          }
        />
      )}

      {menu && (
        <div
          className="fixed z-50 min-w-28 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 text-xs shadow-lg"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.hasSelection && (
            <button
              type="button"
              onClick={() => {
                copySelection()
                setMenu(null)
              }}
              className="block w-full px-3 py-1 text-left hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)]"
            >
              Copiar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void paste()
              setMenu(null)
            }}
            className="block w-full px-3 py-1 text-left hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)]"
          >
            Colar
          </button>
          <button
            type="button"
            onClick={() => {
              xtermRef.current?.clear()
              setMenu(null)
            }}
            className="block w-full px-3 py-1 text-left hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)]"
          >
            Limpar
          </button>
        </div>
      )}
    </div>
  )
}
