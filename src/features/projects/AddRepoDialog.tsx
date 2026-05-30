import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { RoleSelect } from '@/components/ui/RoleSelect'
import { dialogApi, repoApi, vaultApi } from '@/lib/ipc'
import { LinkChoiceModal } from './LinkChoiceModal'
import type { CreateRepoInput, Project } from '../../../shared/types/ipc'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  onCreate: (input: Omit<CreateRepoInput, 'projectId'>) => Promise<void>
}

type Origin = 'local' | 'clone'

function basename(p: string): string {
  return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? p
}

function repoNameFromUrl(url: string): string {
  return basename(url.trim().replace(/\.git$/, '').replace(/\/+$/, ''))
}

export function AddRepoDialog({ open, onClose, project, onCreate }: Props) {
  const hasVault = !!project.vaultPath

  const [origin, setOrigin] = useState<Origin>('local')
  const [target, setTarget] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkChoice, setLinkChoice] = useState<{ source: string; label: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setOrigin('local')
    setTarget(null)
    setUrl('')
    setLabel('')
    setRole(null)
    setError(null)
    setLinkChoice(null)
  }, [open])

  async function pickLocal() {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    setTarget(picked)
    if (!label.trim()) setLabel(basename(picked))
  }

  const finalLabel = label.trim() || (origin === 'clone' ? repoNameFromUrl(url) : '')

  async function done(input: Omit<CreateRepoInput, 'projectId'>) {
    await onCreate({ ...input, role })
    onClose()
  }

  async function handleSubmit() {
    if (submitting) return
    setError(null)

    if (origin === 'local') {
      if (!target) {
        setError('Escolha uma pasta.')
        return
      }
      if (!finalLabel) {
        setError('Defina um label.')
        return
      }
      setSubmitting(true)
      try {
        if (!project.vaultPath) {
          await done({ label: finalLabel, path: target, linkKind: 'external', source: 'local' })
          return
        }
        const inside = await vaultApi.isInside(project.vaultPath, target)
        if (inside) {
          await done({ label: finalLabel, path: target, linkKind: 'inside', source: 'local' })
        } else {
          setLinkChoice({ source: target, label: finalLabel })
        }
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (!url.trim() || !project.vaultPath) return
    if (!finalLabel) {
      setError('Defina um label.')
      return
    }
    setSubmitting(true)
    try {
      const { path } = await repoApi.cloneUrl(url.trim(), project.vaultPath)
      await done({
        label: finalLabel,
        path,
        linkKind: 'inside',
        source: `git-clone:${url.trim()}`,
      })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setError(`Não foi possível clonar o repositório. ${detail}`)
    } finally {
      setSubmitting(false)
    }
  }

  const submitDisabled =
    submitting ||
    (origin === 'local' ? !target : !url.trim() || !hasVault)

  return (
    <>
      <Dialog
        open={open && !linkChoice}
        onClose={onClose}
        title="Adicionar repo"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={submitDisabled} loading={submitting}>
              {origin === 'clone' ? 'Clonar' : 'Adicionar'}
            </Button>
          </>
        }
      >
        <div className="mb-4 flex gap-1 rounded-md border border-[var(--color-border)] p-1">
          <TabButton active={origin === 'local'} onClick={() => setOrigin('local')}>
            Pasta local
          </TabButton>
          <TabButton
            active={origin === 'clone'}
            disabled={!hasVault}
            onClick={() => hasVault && setOrigin('clone')}
          >
            Clonar URL
          </TabButton>
        </div>

        {origin === 'local' ? (
          <div className="mb-3">
            <button
              type="button"
              onClick={pickLocal}
              className="w-full rounded-md border border-dashed border-[var(--color-border)] px-3 py-3 text-left text-sm text-[var(--color-text-dim)] hover:border-[var(--color-accent)]"
            >
              {target ? (
                <span className="text-[var(--color-text)]" title={target}>
                  {target}
                </span>
              ) : (
                'Escolher pasta…'
              )}
            </button>
            {!hasVault && (
              <p className="mt-1 text-xs text-[var(--color-text-dim)]">
                Será adicionado como referência externa. Defina um vault para mover/clonar.
              </p>
            )}
          </div>
        ) : (
          <Input
            label="URL do repositório"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              if (!label.trim()) setLabel(repoNameFromUrl(e.target.value))
            }}
            placeholder="https://github.com/user/repo.git"
            className="mb-3"
          />
        )}

        <Input
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={origin === 'clone' ? repoNameFromUrl(url) || 'nome' : 'nome'}
          className="mb-3"
        />
        <RoleSelect value={role} onChange={setRole} />

        {error && (
          <div className="mt-3 rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-300">
            <div className="font-medium text-red-400">⚠ Erro</div>
            <div className="mt-0.5 break-words">{error}</div>
            <div className="mt-1 text-[10px] text-red-300/70">
              Verifique a URL/permissões e tente novamente.
            </div>
          </div>
        )}
      </Dialog>

      {linkChoice && project.vaultPath && (
        <LinkChoiceModal
          open={!!linkChoice}
          onClose={() => setLinkChoice(null)}
          source={linkChoice.source}
          vaultPath={project.vaultPath}
          label={linkChoice.label}
          onChoose={async (repo) => {
            await done(repo)
          }}
        />
      )}
    </>
  )
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
          : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
      }`}
    >
      {children}
    </button>
  )
}
