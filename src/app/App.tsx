import { useEffect, useState } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppShell } from './AppShell'
import { useProjects } from '@/features/projects/useProjects'
import { WelcomeDialog } from '@/features/settings/WelcomeDialog'
import { TitleBar } from '@/features/titlebar/TitleBar'
import { BootSplashGate } from '@/features/splash'
import { vaultApi } from '@/lib/ipc'
import { useAppStore } from '@/store/appStore'
import { loadAndApplyTheme } from './useTheme'

export default function App() {
  const { projects } = useProjects()
  const [vaultConfigured, setVaultConfigured] = useState<boolean | null>(null)
  const [restored, setRestored] = useState(false)
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
    if (!restored) return
    if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
      setActiveProject(null)
      return
    }
    if (!activeProjectId && projects.length > 0) {
      setActiveProject(projects[0].id)
    }
  }, [projects, activeProjectId, restored, setActiveProject])

  return (
    <BootSplashGate>
      <div className="flex h-full flex-col">
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
    </BootSplashGate>
  )
}
