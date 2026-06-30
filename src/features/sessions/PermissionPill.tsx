import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PermissionMode } from '../../../shared/types/ipc'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuSection } from '@/components/ui/Menu'
import { PERMISSION_OPTIONS } from './permission-modes'
import { permissionStyle } from './pill-state'

interface Props {
  /** Modo ATIVO (refletido do rodapé da TUI). null = ainda não detectado → padrão seguro. */
  currentMode: PermissionMode | null
  /** Seleção direta de um modo (quando a fiação suportar set-exato). */
  onSelect?: (mode: PermissionMode) => void
  /** Fallback: envia um passo de ciclo (Shift+Tab) ao PTY. */
  onCycle?: () => void
}

// Seletor VISÍVEL de modo de permissão, colorido pelo modo ATIVO (permissionStyle):
// default/plan = seguro (cor normal, ShieldCheck); acceptEdits = aviso (âmbar);
// auto/bypass/dontAsk = perigo (vermelho, ShieldAlert). O ícone segue o estado.
//
// Aplicação: na CRIAÇÃO da sessão o modo é EXATO (SpawnSessionDialog → --permission-mode).
// Em runtime a CLI não tem set-exato (sem /permission) — só o ciclo nativo via Shift+Tab.
// Por isso clicar num modo prefere onSelect (quando a fiação souber aplicar) e cai em
// onCycle (UM passo do ciclo) como fallback. O modo ativo vem do rodapé do próprio Claude.
export function PermissionPill({ currentMode, onSelect, onCycle }: Props) {
  const [open, setOpen] = useState(false)
  const style = permissionStyle(currentMode)
  const activeLabel =
    PERMISSION_OPTIONS.find((opt) => opt.value === currentMode)?.label ?? 'Padrão'

  const sections: MenuSection[] = [
    {
      title: 'Permissão · modo ativo destacado',
      items: PERMISSION_OPTIONS.map((opt) => ({
        label: opt.label,
        active: opt.value === currentMode,
        onClick: () => {
          if (onSelect) onSelect(opt.value)
          else onCycle?.()
        },
      })),
    },
  ]

  return (
    <Menu open={open} onClose={() => setOpen(false)} sections={sections} portal align="left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Modo de permissão (ativo refletido do rodapé do Claude). O modo exato é garantido na criação da sessão; em runtime, selecionar avança o ciclo nativo (Shift+Tab)."
        className={`flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] transition hover:border-current/50 ${style.text}`}
      >
        <Icon as={style.icon} size={11} style={{ color: style.color }} />
        <span className="whitespace-nowrap">{activeLabel}</span>
        <Icon as={ChevronDown} size={10} className="text-[var(--color-text-dim)]" />
      </button>
    </Menu>
  )
}
