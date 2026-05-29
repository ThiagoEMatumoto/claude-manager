// Thin re-export of window.api for ergonomic imports in features.
// Always prefer importing from here so we have a single chokepoint
// for cross-cutting concerns (logging, error wrapping) later.

const api = window.api

export const projectsApi = api.projects
export const sessionsApi = api.sessions
export const shellApi = api.shell
export const dialogApi = api.dialog
export const vaultApi = api.vault
export const repoApi = api.repo
export const workspaceApi = api.workspace

export { api }
