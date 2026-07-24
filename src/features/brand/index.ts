export { PitwallLogo } from './PitwallLogo'
export type { PitwallLogoState } from './PitwallLogo'
export { ApexDot } from './ApexDot'
export { Ruler } from './Ruler'
export { MeasureBlocks } from './MeasureBlocks'
export { SessionChip } from './SessionChip'
export type { SessionState } from './SessionChip'
export { GradientBorder } from './GradientBorder'
export { ControlPill } from './ControlPill'
export { Button } from './Button'
export { cx } from './cx'

// Marcador de item/sessão ativa (box-shadow inset accent na borda esquerda).
// Drop-in como className Tailwind; equivalente à classe utilitária .pw-active-marker.
export const activeMarker = 'shadow-[inset_2px_0_0_var(--color-accent)]'
