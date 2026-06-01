import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

// Convenção de ícone do design system:
// - 16px na UI densa (default), 18px em headers
// - strokeWidth 1.75, herda a cor via currentColor
export const ICON_SIZE = 16
export const ICON_SIZE_HEADER = 18
export const ICON_STROKE = 1.75

interface IconProps extends Omit<LucideProps, 'ref'> {
  as: ComponentType<LucideProps>
  size?: number
}

export function Icon({ as: Component, size = ICON_SIZE, strokeWidth = ICON_STROKE, ...rest }: IconProps) {
  return <Component size={size} strokeWidth={strokeWidth} {...rest} />
}
