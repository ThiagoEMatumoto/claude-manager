import { useState } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuSection } from '@/components/ui/Menu'
import { PERMISSION_OPTIONS } from './permission-modes'

interface Props {
  /** Envia um passo de ciclo (Shift+Tab) ao PTY. */
  onCycle: () => void
}

// Seletor VISÍVEL de modo de permissão (estilo "ajuste" do Claude Desktop),
// substituindo o botão de ciclo cego. Lista os 6 modos da CLI via Menu+portal
// (mesmo fix dos outros pills, pra não cortar na pane vizinha).
//
// Aplicação: na CRIAÇÃO da sessão o modo é EXATO (SpawnSessionDialog → --permission-mode).
// Em runtime a CLI NÃO tem set-exato (não há /permission) — só o ciclo nativo via
// Shift+Tab. A ordem do ciclo da TUI não é confiável pra inferir um mapeamento
// seleção→N passos, então clicar em QUALQUER modo envia UM Shift+Tab (um passo).
// O modo ativo é refletido no rodapé do próprio Claude, que é a fonte da verdade.
export function PermissionPill({ onCycle }: Props) {
  const [open, setOpen] = useState(false)

  const sections: MenuSection[] = [
    {
      title: 'Permissão · Shift+Tab cicla (1 passo)',
      items: PERMISSION_OPTIONS.map((opt) => ({
        label: opt.label,
        onClick: onCycle,
      })),
    },
  ]

  return (
    <Menu open={open} onClose={() => setOpen(false)} sections={sections} portal align="left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Modo de permissão. A CLI não permite definir um modo exato em runtime: clicar em qualquer modo envia Shift+Tab (um passo do ciclo nativo do Claude). O modo ativo aparece no rodapé do Claude; o modo exato é garantido na criação da sessão."
        className="flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)] transition hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]"
      >
        <Icon as={ShieldCheck} size={11} className="text-[var(--color-accent)]" />
        <span className="whitespace-nowrap">Permissão</span>
        <Icon as={ChevronDown} size={10} className="text-[var(--color-text-dim)]" />
      </button>
    </Menu>
  )
}
