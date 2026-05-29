import { useState } from 'react'
import { CcConfigsSidebar, type CcTab } from './CcConfigsSidebar'
import { CcConfigsView } from './CcConfigsView'
import { useCcConfigs } from './useCcConfigs'

export function CcConfigsArea() {
  const { configs, loading, reload } = useCcConfigs()
  const [tab, setTab] = useState<CcTab>('plugins')

  const counts: Record<CcTab, number> = {
    plugins: configs.plugins.length,
    agents: configs.agents.length,
    skills: configs.skills.length,
    mcps: configs.mcps.length,
  }

  return (
    <>
      <CcConfigsSidebar
        active={tab}
        counts={counts}
        onSelect={setTab}
        onReload={() => void reload()}
        loading={loading}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <CcConfigsView tab={tab} configs={configs} loading={loading} />
      </main>
    </>
  )
}
