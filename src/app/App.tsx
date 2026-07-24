import { lazy, Suspense, useEffect, useState } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppShell } from './AppShell'
import { useProjects } from '@/features/projects/useProjects'
import { WelcomeDialog } from '@/features/settings/WelcomeDialog'
import { TitleBar } from '@/features/titlebar/TitleBar'
import { vaultApi } from '@/lib/ipc'
import { useAppStore } from '@/store/appStore'
import { loadAndApplyTheme } from './useTheme'
import { IntroOverlay } from '@/features/intro/IntroOverlay'
import { getIntroScene, DEFAULT_INTRO_SCENE } from '@/features/intro/scenes'

const introScene = getIntroScene(DEFAULT_INTRO_SCENE)

// Comparador das variantes de abertura (Ctrl+Shift+G). Lazy: fica fora do bundle
// de boot, que é exatamente o que não pode engordar.
const IntroGallery = lazy(() => import('@/features/intro/IntroGallery'))

export default function App() {
  const { projects } = useProjects()
  const [vaultConfigured, setVaultConfigured] = useState<boolean | null>(null)
  const [restored, setRestored] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)

  useEffect(() => {
    void loadAndApplyTheme()
  }, [])

  useEffect(() => {
    void vaultApi.isConfigured().then(setVaultConfigured)
  }, [])

  useEffect(() => {
    void useAppStore
      .getState()
      .initActiveProject()
      .then(() => {
        setRestored(true)
        return useAppStore.getState().restoreWorkspace()
      })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // e.code (posição física da tecla), não e.key: em ABNT2 e outros layouts
      // Ctrl+Alt é AltGr, e o e.key vira o caractere alternativo — o atalho
      // simplesmente nunca dispara. Por isso também não usamos Ctrl+Alt aqui.
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyG') {
        e.preventDefault()
        setGalleryOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!restored) return
    if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
      setActiveProject(null)
      return
    }
    if (!activeProjectId && projects.length > 0) {
      setActiveProject(projects[0].id)
    }
  }, [projects, activeProjectId, restored, setActiveProject])

  // A intro segura enquanto o boot roda. `restored` já é o sinal certo: sai do
  // initActiveProject, antes do restoreWorkspace. O WelcomeDialog não depende de
  // restore nenhum, então libera assim que sabemos que o vault não existe.
  const bootReady = vaultConfigured !== null && (vaultConfigured === false || restored)

  return (
    <div className="flex h-full flex-col">
      <IntroOverlay scene={introScene} ready={bootReady} />
      {galleryOpen && (
        <Suspense fallback={null}>
          <IntroGallery onClose={() => setGalleryOpen(false)} />
        </Suspense>
      )}
      <TitleBar />
      <div className="min-h-0 flex-1">
        <ErrorBoundary>
          {vaultConfigured === false ? (
            <WelcomeDialog onDone={() => setVaultConfigured(true)} />
          ) : (
            <AppShell />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}
