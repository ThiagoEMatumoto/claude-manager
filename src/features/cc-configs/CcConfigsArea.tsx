import { useState } from 'react'
import { CcConfigsSidebar, type CcTab, type ComponentTab } from './CcConfigsSidebar'
import { CcConfigsView } from './CcConfigsView'
import { ClaudeMdTab } from './ClaudeMdTab'
import { CliSettingsTab } from './CliSettingsTab'
import { MarketplaceTab } from './MarketplaceTab'
import { McpServersTab } from './McpServersTab'
import type { FocusedItem } from './navigation'
import { PluginsTab } from './PluginsTab'
import { RulesTab } from './RulesTab'
import { useCcConfigs } from './useCcConfigs'
import { usePlugins } from './usePlugins'

// Abas do CLI claude (~/.claude): componentes autocontidos que carregam seus
// próprios dados — o Atualizar da sidebar força remount via key.
const CLI_TAB_IDS: CcTab[] = ['settings', 'mcp', 'claude-md', 'rules']

export function CcConfigsArea() {
  const { configs, loading, reload } = useCcConfigs()
  const plugins = usePlugins()
  const [tab, setTab] = useState<CcTab>('plugins')
  const [focus, setFocus] = useState<FocusedItem | null>(null)
  const [cliReloadKey, setCliReloadKey] = useState(0)

  const counts: Partial<Record<CcTab, number>> = {
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
    else if (CLI_TAB_IDS.includes(tab)) setCliReloadKey((k) => k + 1)
    else void reload()
  }

  const reloading =
    tab === 'plugins'
      ? plugins.loadingInstalled
      : tab === 'marketplace'
        ? plugins.loadingAvailable
        : CLI_TAB_IDS.includes(tab)
          ? false
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
        ) : tab === 'settings' ? (
          <CliSettingsTab key={cliReloadKey} />
        ) : tab === 'mcp' ? (
          <McpServersTab key={cliReloadKey} />
        ) : tab === 'claude-md' ? (
          <ClaudeMdTab key={cliReloadKey} />
        ) : tab === 'rules' ? (
          <RulesTab key={cliReloadKey} />
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
