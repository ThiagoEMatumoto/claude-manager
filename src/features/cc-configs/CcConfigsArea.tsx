import { useState } from 'react'
import { CcConfigsSidebar, type CcTab, type ComponentTab } from './CcConfigsSidebar'
import { CcConfigsView } from './CcConfigsView'
import { MarketplaceTab } from './MarketplaceTab'
import type { FocusedItem } from './navigation'
import { PluginsTab } from './PluginsTab'
import { useCcConfigs } from './useCcConfigs'
import { usePlugins } from './usePlugins'

export function CcConfigsArea() {
  const { configs, loading, reload } = useCcConfigs()
  const plugins = usePlugins()
  const [tab, setTab] = useState<CcTab>('plugins')
  const [focus, setFocus] = useState<FocusedItem | null>(null)

  const counts: Record<CcTab, number> = {
    plugins: plugins.installed.length,
    marketplace: plugins.available.length,
    agents: configs.agents.length,
    skills: configs.skills.length,
    mcps: configs.mcps.length,
    hooks: configs.hooks.length,
  }

  function handleSelect(next: CcTab) {
    if (next !== tab) setFocus(null)
    setTab(next)
    if (next === 'marketplace') plugins.ensureAvailable()
  }

  function navigateToComponent(target: FocusedItem) {
    setFocus(target)
    setTab(target.tab)
  }

  function handleReload() {
    if (tab === 'plugins') void plugins.loadInstalled()
    else if (tab === 'marketplace') void plugins.loadAvailable()
    else void reload()
  }

  const reloading =
    tab === 'plugins'
      ? plugins.loadingInstalled
      : tab === 'marketplace'
        ? plugins.loadingAvailable
        : loading

  return (
    <>
      <CcConfigsSidebar
        active={tab}
        counts={counts}
        onSelect={handleSelect}
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
            onNavigate={navigateToComponent}
          />
        ) : tab === 'marketplace' ? (
          <MarketplaceTab
            available={plugins.available}
            loading={plugins.loadingAvailable}
            error={plugins.availableError}
            runInstall={(name) => plugins.runAction('install', name)}
          />
        ) : (
          <CcConfigsView
            tab={tab as ComponentTab}
            configs={configs}
            loading={loading}
            focus={focus}
            onClearFocus={() => setFocus(null)}
          />
        )}
      </main>
    </>
  )
}
