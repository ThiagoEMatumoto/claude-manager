import { useState } from 'react'
import { CcConfigsSidebar, type CcTab } from './CcConfigsSidebar'
import { CcConfigsView } from './CcConfigsView'
import { PluginsTab } from './PluginsTab'
import { useCcConfigs } from './useCcConfigs'
import { usePlugins } from './usePlugins'

export function CcConfigsArea() {
  const { configs, loading, reload } = useCcConfigs()
  const plugins = usePlugins()
  const [tab, setTab] = useState<CcTab>('plugins')

  const counts: Record<CcTab, number> = {
    plugins: plugins.installed.length,
    agents: configs.agents.length,
    skills: configs.skills.length,
    mcps: configs.mcps.length,
  }

  function handleReload() {
    if (tab === 'plugins') void plugins.loadInstalled()
    else void reload()
  }

  const reloading = tab === 'plugins' ? plugins.loadingInstalled : loading

  return (
    <>
      <CcConfigsSidebar
        active={tab}
        counts={counts}
        onSelect={setTab}
        onReload={handleReload}
        loading={reloading}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        {tab === 'plugins' ? (
          <PluginsTab
            installed={plugins.installed}
            loading={plugins.loadingInstalled}
            error={plugins.installedError}
            runAction={(action, name) => plugins.runAction(action, name)}
          />
        ) : (
          <CcConfigsView tab={tab} configs={configs} loading={loading} />
        )}
      </main>
    </>
  )
}
