// Mapeamento puro da linha do LEFT JOIN sessions→repos→projects pros campos de
// repo/projeto do LiveSessionInfo. Fora do handler IPC pra ser testável sem
// Electron (mesmo padrão de blank-repo.ts / untracked-folders.ts).

import type { LinkKind, Repo } from '../../../shared/types/ipc'

// Sessão avulsa (repo_id null) → todas as colunas do JOIN vêm null.
export interface LiveSessionJoinRow {
  cc_session_id: string
  session_title: string | null
  repo_id: string | null
  repo_project_id: string | null
  repo_label: string | null
  repo_path: string | null
  repo_role: string | null
  repo_link_kind: string | null
  repo_source: string | null
  repo_position: number | null
  repo_created_at: number | null
  project_name: string | null
  project_icon: string | null
  project_color: string | null
}

export interface LiveSessionRepoInfo {
  repo: Repo | null
  projectName: string | null
  projectIcon: string | null
  projectColor: string | null
}

export function mapLiveSessionRepo(row: LiveSessionJoinRow): LiveSessionRepoInfo {
  if (!row.repo_id) {
    return { repo: null, projectName: null, projectIcon: null, projectColor: null }
  }
  return {
    repo: {
      id: row.repo_id,
      projectId: row.repo_project_id ?? '',
      label: row.repo_label ?? '',
      path: row.repo_path ?? '',
      role: row.repo_role,
      linkKind: (row.repo_link_kind ?? 'inside') as LinkKind,
      source: row.repo_source,
      position: row.repo_position ?? 0,
      createdAt: row.repo_created_at ?? 0,
      // Posição de canvas não é parte do join de live-session; default null.
      canvasX: null,
      canvasY: null,
    },
    projectName: row.project_name,
    projectIcon: row.project_icon,
    projectColor: row.project_color,
  }
}
