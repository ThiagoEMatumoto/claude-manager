import { useEffect, useState } from 'react'
import { AppShell } from './AppShell'
import { useProjects } from '@/features/projects/useProjects'
import { WelcomeDialog } from '@/features/settings/WelcomeDialog'
import { vaultApi } from '@/lib/ipc'
import { useAppStore } from '@/store/appStore'

export default function App() {
  const { projects } = useProjects()
  const [vaultConfigured, setVaultConfigured] = useState<boolean | null>(null)
  const [restored, setRestored] = useState(false)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)

  useEffect(() => {
    void vaultApi.isConfigured().then(setVaultConfigured)
  }, [])

  useEffect(() => {
    void useAppStore
      .getState()
      .initActiveProject()
      .then(() => setRestored(true))
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

  if (vaultConfigured === false) {
    return <WelcomeDialog onDone={() => setVaultConfigured(true)} />
  }

  return <AppShell />
}
