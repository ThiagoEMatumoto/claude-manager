// Thin re-export of window.api for ergonomic imports in features.
// Always prefer importing from here so we have a single chokepoint
// for cross-cutting concerns (logging, error wrapping) later.

const api = window.api

export const projectsApi = api.projects
export const sessionsApi = api.sessions
export const shellApi = api.shell
export const appApi = api.app
export const dialogApi = api.dialog
export const prefsApi = api.prefs
export const vaultApi = api.vault
export const repoApi = api.repo
export const workspaceApi = api.workspace
export const ccConfigsApi = api.ccConfigs
export const ccPluginsApi = api.ccPlugins
export const updatesApi = api.updates
export const usageApi = api.usage
export const metricsApi = api.metrics
export const featuresApi = api.features
export const objectivesApi = api.objectives
export const tasksApi = api.tasks
export const windowApi = api.window
export const notificationsApi = api.notifications
export const mcpApi = api.mcp

export { api }
