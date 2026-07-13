import { describe, expect, it } from 'vitest'
import { mapLiveSessionRepo, type LiveSessionJoinRow } from './live-session-mapping'

function baseRow(overrides: Partial<LiveSessionJoinRow> = {}): LiveSessionJoinRow {
  return {
    cc_session_id: 'cc-1',
    session_title: null,
    session_title_source: null,
    repo_id: null,
    repo_project_id: null,
    repo_label: null,
    repo_path: null,
    repo_role: null,
    repo_link_kind: null,
    repo_source: null,
    repo_position: null,
    repo_created_at: null,
    project_name: null,
    project_icon: null,
    project_color: null,
    ...overrides,
  }
}

describe('mapLiveSessionRepo', () => {
  it('sessão avulsa (repo_id null) → repo e projeto nulos', () => {
    expect(mapLiveSessionRepo(baseRow())).toEqual({
      repo: null,
      projectName: null,
      projectIcon: null,
      projectColor: null,
    })
  })

  it('sessão com repo → monta o Repo completo + campos do projeto', () => {
    const row = baseRow({
      repo_id: 'r1',
      repo_project_id: 'p1',
      repo_label: 'meu-repo',
      repo_path: '/home/x/meu-repo',
      repo_role: 'api',
      repo_link_kind: 'symlink',
      repo_source: 'cloned',
      repo_position: 2,
      repo_created_at: 1234,
      project_name: 'Projeto X',
      project_icon: '🚀',
      project_color: '#fff',
    })
    expect(mapLiveSessionRepo(row)).toEqual({
      repo: {
        id: 'r1',
        projectId: 'p1',
        label: 'meu-repo',
        path: '/home/x/meu-repo',
        role: 'api',
        linkKind: 'symlink',
        source: 'cloned',
        position: 2,
        createdAt: 1234,
        canvasX: null,
        canvasY: null,
        isHub: false,
      },
      projectName: 'Projeto X',
      projectIcon: '🚀',
      projectColor: '#fff',
    })
  })
})
