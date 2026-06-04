import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
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

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[/\\]+$/, '')}/${name}`
}

function isCollisionError(message: string): boolean {
  return /destino já existe|already exists|destination path|EEXIST|ENOTEMPTY/i.test(message)
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
  // Colisão: já existe uma pasta no destino do vault. Em vez de dead-end, oferecemos
  // registrar (adotar) a pasta existente.
  const [collision, setCollision] = useState<{ label: string; path: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setOrigin('local')
    setTarget(null)
    setUrl('')
    setLabel('')
    setRole(null)
    setError(null)
    setLinkChoice(null)
    setCollision(null)
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

  // Adota a pasta já existente no vault (registra como 'inside', sem mover/clonar).
  async function adoptExisting(adoptLabel: string, adoptPath: string) {
    setSubmitting(true)
    try {
      await done({ label: adoptLabel, path: adoptPath, linkKind: 'inside', source: 'local' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit() {
    if (submitting) return
    setError(null)
    setCollision(null)

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
    const cloneName = repoNameFromUrl(url)
    const cloneDest = joinPath(project.vaultPath, cloneName)

    setSubmitting(true)
    try {
      // Pré-check: se já existe uma pasta não-registrada nesse destino, não clona —
      // oferece adotar a existente (evita o erro cru do git "already exists").
      const existing = (await vaultApi.listUntracked(project.id)).find(
        (f) => f.name === cloneName,
      )
      if (existing) {
        setCollision({ label: finalLabel, path: existing.path })
        return
      }
      const { path } = await repoApi.cloneUrl(url.trim(), project.vaultPath)
      await done({
        label: finalLabel,
        path,
        linkKind: 'inside',
        source: `git-clone:${url.trim()}`,
      })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      if (isCollisionError(detail)) {
        setCollision({ label: finalLabel, path: cloneDest })
      } else {
        setError(`Não foi possível clonar o repositório. ${detail}`)
      }
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
          <div className="mt-3 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-text)]">
            <div className="flex items-center gap-1 font-medium text-[var(--color-danger)]">
              <Icon as={AlertCircle} size={13} />
              Erro
            </div>
            <div className="mt-0.5 break-words">{error}</div>
            <div className="mt-1 text-[10px] text-[var(--color-text-dim)]">
              Verifique a URL/permissões e tente novamente.
            </div>
          </div>
        )}

        {collision && (
          <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2 text-xs text-[var(--color-text)]">
            <div className="font-medium">Já existe uma pasta no vault</div>
            <div className="mt-0.5 break-words text-[var(--color-text-dim)]" title={collision.path}>
              {collision.path}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => void adoptExisting(collision.label, collision.path)}
                loading={submitting}
              >
                Registrar a pasta existente
              </Button>
              <Button variant="ghost" onClick={() => setCollision(null)}>
                Usar outro nome
              </Button>
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
          onError={(message) => {
            // Volta pro diálogo principal. Se a falha foi colisão de destino, oferece
            // adotar a pasta já existente em vez de só mostrar o erro cru.
            const dest = joinPath(project.vaultPath!, linkChoice.label)
            setLinkChoice(null)
            if (isCollisionError(message)) {
              setCollision({ label: linkChoice.label, path: dest })
            } else {
              setError(`Não foi possível adicionar o repositório. ${message}`)
            }
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
