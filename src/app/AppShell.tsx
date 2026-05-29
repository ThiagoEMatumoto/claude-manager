import 'dockview/dist/styles/dockview.css'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview'
import { IconRail } from './IconRail'
import { ProjectsSidebar } from '@/features/projects/ProjectsSidebar'
import { Terminal } from '@/features/sessions/Terminal'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { useAppStore, type ActivePane } from '@/store/appStore'

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
      onClose={() => closePane(pane.paneId)}
    />
  )
}

const components = { terminal: TerminalPanel }

export function AppShell() {
  const area = useAppStore((s) => s.area)
  const panes = useAppStore((s) => s.panes)
  const closePane = useAppStore((s) => s.closePane)
  const restoreBlocked = useAppStore((s) => s.restoreBlocked)
  const retryRestore = useAppStore((s) => s.retryRestore)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const apiRef = useRef<DockviewApi | null>(null)
  const [ready, setReady] = useState(false)
  // paneIds que o store já removeu — usado pra suprimir o eco do onDidRemovePanel
  // (quando nós mesmos chamamos api.removePanel, ele dispara o evento de volta).
  const removingFromStore = useRef(new Set<string>())

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
      setReady(true)
    },
    [closePane],
  )

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
      api.addPanel<PaneParams>({
        id: pane.paneId,
        component: 'terminal',
        params: { pane },
        position: active ? { referencePanel: active.id, direction: 'right' } : undefined,
      })
    }
  }, [panes, ready])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <IconRail onOpenSettings={() => setSettingsOpen(true)} />

      {area === 'projects' && <ProjectsSidebar />}

      <main className="flex flex-1 flex-col overflow-hidden">
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
