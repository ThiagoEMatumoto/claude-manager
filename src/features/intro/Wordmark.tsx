/**
 * Camada DOM do wordmark. Fica por cima do canvas porque texto em WebGL a 14px
 * de altura de x é sempre pior que texto do navegador — e a fonte já está
 * bundlada e pré-carregada (main.tsx faz document.fonts.load da JetBrains Mono).
 */
export function Wordmark({ reveal, tagline = true }: { reveal: number; tagline?: boolean }) {
  // O nome entra no ato final; a tagline vem logo atrás.
  const name = ease(clamp01((reveal - 0.55) / 0.35))
  const sub = ease(clamp01((reveal - 0.72) / 0.28))

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <div
        className="font-bold"
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 'clamp(2rem, 7vw, 4.5rem)',
          letterSpacing: '0.22em',
          // O letterspacing só empurra à direita; sem isso o bloco fica torto.
          textIndent: '0.22em',
          color: 'var(--color-text)',
          opacity: name,
          transform: `translateY(${(1 - name) * 10}px)`,
        }}
      >
        PITWALL
      </div>
      {tagline && (
        <div
          className="mt-3"
          style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 'clamp(0.7rem, 1.3vw, 0.9rem)',
            letterSpacing: '0.34em',
            textIndent: '0.34em',
            color: 'var(--color-text-dim)',
            opacity: sub * 0.9,
          }}
        >
          harness every run.
        </div>
      )}
    </div>
  )
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
/** ease-out-expo: a mesma curva confiante do resto do app. */
const ease = (v: number) => (v >= 1 ? 1 : 1 - Math.pow(2, -10 * v))
