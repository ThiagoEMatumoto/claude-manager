import 'dockview/dist/styles/dockview.css'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DockviewDefaultTab,
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview'
import { IconRail } from './IconRail'
import { ProjectsSidebar } from '@/features/projects/ProjectsSidebar'
import { CcConfigsArea } from '@/features/cc-configs/CcConfigsArea'
import { Terminal } from '@/features/sessions/Terminal'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { useAppStore, type ActivePane } from '@/store/appStore'
import { workspaceApi } from '@/lib/ipc'

interface PaneParams {
  pane: ActivePane
}

function TerminalPanel(props: IDockviewPanelProps<PaneParams>) {
  const { pane } = props.params
  const closePane = useAppStore((s) => s.closePane)
  return (
    <Terminal
      session={pane.session}
      repoLabel={pane.repo.label}
      repoPath={pane.repo.path}
      projectName={pane.projectName}
      projectIcon={pane.projectIcon}
      projectColor={pane.projectColor}
      onClose={() => closePane(pane.paneId)}
      onTitleChange={(t) => props.api.setTitle(t)}
    />
  )
}

// Aba do dockview com um dot na cor do projeto antes do título/close padrão.
// Reusa DockviewDefaultTab pra herdar o título dinâmico (api.title via setTitle) e o X.
function TerminalTab(props: IDockviewPanelHeaderProps<PaneParams>) {
  const color = props.params.pane?.projectColor ?? null
  return (
    <div className="flex items-center">
      <span
        className="ml-2 h-2 w-2 shrink-0 rounded-full"
        style={{ background: color ?? 'var(--color-border)' }}
      />
      <DockviewDefaultTab {...props} />
    </div>
  )
}

// Título inicial legível pra aba (nunca o paneId). O Terminal sobrescreve ao vivo
// via onTitleChange assim que o nome do CC chega.
function paneTabTitle(pane: ActivePane): string {
  if (!pane.projectName) return pane.repo.label
  return `${pane.projectIcon ?? ''} ${pane.repo.label}`.trim()
}

const components = { terminal: TerminalPanel }
const tabComponents = { terminal: TerminalTab }

export function AppShell() {
  const area = useAppStore((s) => s.area)
  const panes = useAppStore((s) => s.panes)
  const closePane = useAppStore((s) => s.closePane)
  const openSession = useAppStore((s) => s.openSession)
  const restoreBlocked = useAppStore((s) => s.restoreBlocked)
  const retryRestore = useAppStore((s) => s.retryRestore)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const apiRef = useRef<DockviewApi | null>(null)
  const [ready, setReady] = useState(false)
  // paneIds que o store já removeu — usado pra suprimir o eco do onDidRemovePanel
  // (quando nós mesmos chamamos api.removePanel, ele dispara o evento de volta).
  const removingFromStore = useRef(new Set<string>())
  // Posição do próximo painel novo. O atalho seta a intent ANTES de openSession;
  // o reconcile consome no addPanel (relativo ao painel ativo) e reseta pra default.
  // 'tab' = mesmo grupo do ativo; 'right'/'below' = split. undefined = clique normal
  // no repo, mantendo o comportamento atual (split à direita do ativo).
  const nextPosition = useRef<'tab' | 'right' | 'below' | undefined>(undefined)
  // Guard: true enquanto api.fromJSON do restore roda — suprime persist e a
  // reconciliação store→dockview (que duplicaria/removeria painéis).
  const applyingLayout = useRef(false)
  // false até o fluxo de restore concluir (ou se não houver restore pendente).
  // Enquanto false, NÃO persistimos layout (evita sobrescrever o salvo com vazio
  // antes das panes voltarem).
  const restoreDone = useRef(false)

  // Debounce do persist de layout: onDidLayoutChange dispara a cada drag/resize.
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api
      event.api.onDidRemovePanel((panel) => {
        // Loop guard: se a remoção partiu do store (api.removePanel nosso), ignora.
        if (removingFromStore.current.delete(panel.id)) return
        // Veio do usuário (botão X do dockview / move). closePane é idempotente.
        if (useAppStore.getState().panes.some((p) => p.paneId === panel.id)) {
          closePane(panel.id)
        }
      })
      event.api.onDidLayoutChange(() => {
        // Não persiste enquanto aplicamos o layout do restore (evita salvar estados
        // intermediários da reconstrução) nem antes do restore ter terminado.
        if (applyingLayout.current || !restoreDone.current) return
        if (layoutTimer.current) clearTimeout(layoutTimer.current)
        layoutTimer.current = setTimeout(() => {
          const api = apiRef.current
          if (!api) return
          const layout = api.panels.length > 0 ? JSON.stringify(api.toJSON()) : null
          void workspaceApi.saveLayout(layout)
        }, 500)
      })
      setReady(true)
    },
    [closePane],
  )

  // Libera o persist de layout assim que o dockview está pronto. No Commit C este
  // gate passa a esperar o restore do layout salvo aplicar antes de liberar.
  useEffect(() => {
    if (ready) restoreDone.current = true
  }, [ready])

  // Reconciliação store → dockview. O store é a fonte da verdade: criamos painéis
  // pra panes novas e removemos painéis órfãos, SEM tocar nos painéis existentes
  // (preserva o xterm vivo). defaultRenderer="always" mantém o DOM montado em
  // move/split, então arrastar uma pane não remonta o Terminal.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return

    const storeIds = new Set(panes.map((p) => p.paneId))

    for (const panel of api.panels) {
      if (!storeIds.has(panel.id)) {
        removingFromStore.current.add(panel.id)
        api.removePanel(panel)
      }
    }

    for (const pane of panes) {
      const existing = api.getPanel(pane.paneId)
      if (existing) {
        // Atualiza os params caso o objeto pane tenha sido recriado (ex: rename).
        existing.api.updateParameters({ pane })
        continue
      }
      const active = api.activePanel
      const intent = nextPosition.current
      // Sem ativo: primeiro painel, sem posição relativa. Com ativo: 'tab' entra no
      // mesmo grupo (within); 'right'/'below' fazem split; default (clique) = right.
      const position = active
        ? intent === 'tab'
          ? { referenceGroup: active.group.id }
          : { referencePanel: active.id, direction: intent ?? 'right' }
        : undefined
      api.addPanel<PaneParams>({
        id: pane.paneId,
        component: 'terminal',
        tabComponent: 'terminal',
        title: paneTabTitle(pane),
        params: { pane },
        position,
      })
      nextPosition.current = undefined
    }
  }, [panes, ready])

  // Atalhos de pane. Priorizamos os atalhos do app sobre o xterm: o terminal só
  // intercepta copy/paste (ver Terminal.attachCustomKeyEventHandler), então estes
  // combos nunca colidem com o que o claude precisa receber. preventDefault evita
  // o default do Electron (ex: Ctrl+W fecharia a janela).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return
      const api = apiRef.current

      // Ctrl+W: fecha o painel ativo.
      if (e.key === 'w' && !e.shiftKey) {
        const id = api?.activePanel?.id
        if (id) {
          e.preventDefault()
          closePane(id)
        }
        return
      }

      // Ctrl+\ (split à direita) / Ctrl+Shift+\ (split abaixo): nova sessão no
      // repo do painel ativo. Usamos e.code === 'Backslash' porque e.key vira '|'
      // com Shift pressionado, fazendo Ctrl+Shift+\ nunca casar com '\\'.
      if (e.code === 'Backslash') {
        const active = api?.activePanel
        const pane = active
          ? useAppStore.getState().panes.find((p) => p.paneId === active.id)
          : undefined
        if (pane) {
          e.preventDefault()
          nextPosition.current = e.shiftKey ? 'below' : 'right'
          void openSession(pane.repo, pane.projectName, pane.projectIcon, pane.projectColor)
        }
        return
      }

      // Ctrl+T: nova sessão como aba no mesmo grupo do painel ativo.
      if (e.key === 't' && !e.shiftKey) {
        const active = api?.activePanel
        const pane = active
          ? useAppStore.getState().panes.find((p) => p.paneId === active.id)
          : undefined
        if (pane) {
          e.preventDefault()
          nextPosition.current = 'tab'
          void openSession(pane.repo, pane.projectName, pane.projectIcon, pane.projectColor)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closePane, openSession])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <IconRail onOpenSettings={() => setSettingsOpen(true)} />

      {area === 'cc-configs' && <CcConfigsArea />}

      {/* O bloco de projetos fica sempre montado (dockview/xterm vivo), apenas
          escondido quando outra área está ativa. */}
      {area === 'projects' && <ProjectsSidebar />}

      <main className={`flex flex-1 flex-col overflow-hidden ${area === 'projects' ? '' : 'hidden'}`}>
        {restoreBlocked && (
          <div
            className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg-elevated, var(--color-bg))',
              color: 'var(--color-text-dim)',
            }}
          >
            <span>Houve um problema ao restaurar as sessões anteriores.</span>
            <button
              onClick={() => void retryRestore()}
              className="rounded px-2 py-1 text-xs"
              style={{ background: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              Restaurar sessões
            </button>
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          {panes.length === 0 && <EmptyMain />}
          <DockviewReact
            className="absolute inset-0"
            theme={themeAbyss}
            components={components}
            tabComponents={tabComponents}
            defaultRenderer="always"
            onReady={onReady}
          />
        </div>
      </main>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function EmptyMain() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex h-full items-center justify-center">
      <div className="max-w-md text-center text-[var(--color-text-dim)]">
        <div className="mb-2 text-lg font-medium text-[var(--color-text)]">
          Nenhuma sessão aberta
        </div>
        <div>Selecione um repo na barra lateral pra abrir uma sessão.</div>
      </div>
    </div>
  )
}
