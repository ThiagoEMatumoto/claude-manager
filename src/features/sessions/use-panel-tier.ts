import { useEffect, useRef, useState } from 'react'

// Tier discreto de largura do painel — dirige tanto CSS (esconder texto) quanto
// troca de JSX (ícone-only vs label) no header e no rodapé do composer. Thresholds
// calibrados visualmente: >420px cabe tudo; 220-420px perde labels secundários;
// <220px só cabe ícone+status+ações essenciais.
export type PanelTier = 'wide' | 'mid' | 'narrow'

const WIDE_MIN = 420
const NARROW_MAX = 220

export function panelTierFor(width: number): PanelTier {
  if (width > WIDE_MIN) return 'wide'
  if (width > NARROW_MAX) return 'mid'
  return 'narrow'
}

// Mede a largura REAL do elemento (painel dockview, não a janela) via
// ResizeObserver — mesmo padrão já usado em Terminal.tsx pro FitAddon do xterm.
// Cada painel dockview tem sua própria largura ao dividir a janela em splits, e
// só a largura real do elemento reflete isso corretamente.
export function usePanelTier<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [tier, setTier] = useState<PanelTier>('wide')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width
      setTier(panelTierFor(width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, tier }
}
