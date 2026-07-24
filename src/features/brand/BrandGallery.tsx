import { Cpu, Gauge, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { PitwallLogo } from './PitwallLogo'
import { ApexDot } from './ApexDot'
import { Ruler } from './Ruler'
import { MeasureBlocks } from './MeasureBlocks'
import { SessionChip } from './SessionChip'
import { GradientBorder } from './GradientBorder'
import { ControlPill } from './ControlPill'
import { Button } from './Button'
import { activeMarker } from './index'

// Galeria de QA dos primitivos da marca (storybook-like). Não é roteada no app;
// serve para inspeção visual manual/screenshot. Cada seção tem data-testid.
function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section
      data-testid={id}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
    >
      <h3 className="mb-4 text-[13px] font-semibold text-[var(--color-text-dim)]">{title}</h3>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  )
}

export function BrandGallery() {
  return (
    <div
      data-testid="brand-gallery"
      className="min-h-full bg-[var(--color-bg)] p-6 text-[var(--color-text)]"
    >
      <div className="mx-auto grid max-w-4xl gap-4">
        <Section id="gallery-logo" title="PitwallLogo (estados)">
          <PitwallLogo state="em-pista" title="em pista" />
          <PitwallLogo state="box-aberto" title="box aberto" />
          <PitwallLogo state="fila" title="fila" />
          <PitwallLogo state="bandeira" title="bandeira" />
        </Section>

        <Section id="gallery-apexdot" title="ApexDot (O Ápice)">
          <ApexDot size={10} active />
          <ApexDot size={16} active />
          <ApexDot size={12} active={false} />
          <ApexDot size={12} active color="var(--color-danger)" />
        </Section>

        <Section id="gallery-ruler" title="Ruler (A Régua)">
          <Ruler variant="progress" value={0.4} />
          <Ruler variant="progress" steps={[{ done: true }, { done: true }, { done: false }, { done: false }]} />
          <Ruler variant="equalizer" count={5} />
          <Ruler variant="equalizer" count={7} height={18} />
        </Section>

        <Section id="gallery-measureblocks" title="MeasureBlocks (▮▯)">
          <MeasureBlocks percent={42} label="ctx" value="42%" />
          <MeasureBlocks percent={78} label="5h" value="78%" />
          <MeasureBlocks percent={94} label="7d" value="94%" />
        </Section>

        <Section id="gallery-sessionchip" title="SessionChip">
          <SessionChip state="no-box" />
          <SessionChip state="em-pista" />
          <SessionChip state="na-garagem" />
          <SessionChip state="bandeira" />
          <SessionChip state="no-box" size="sm" label="1 no box" />
        </Section>

        <Section id="gallery-gradientborder" title="GradientBorder">
          <GradientBorder innerClassName="px-4 py-3 text-sm">card de decisão</GradientBorder>
          <GradientBorder radius={24} innerBg="var(--color-bg)" innerClassName="px-4 py-3 text-sm">
            composer
          </GradientBorder>
          <GradientBorder active={false} innerClassName="px-4 py-3 text-sm text-[var(--color-text-dim)]">
            inativo
          </GradientBorder>
        </Section>

        <Section id="gallery-controlpill" title="ControlPill">
          <ControlPill icon={Cpu} label="Opus 4.8" caret onClick={() => {}} />
          <ControlPill icon={Gauge} label="high" caret tone="accent" onClick={() => {}} />
          <ControlPill icon={ShieldCheck} label="plan" caret tone="warning" onClick={() => {}} />
        </Section>

        <Section id="gallery-button" title="Button">
          <Button variant="primary">Aprovar plano</Button>
          <Button variant="secondary">Continuar planejando</Button>
          <Button variant="ghost">Cancelar</Button>
          <Button variant="danger">Interromper</Button>
          <Button variant="primary" size="sm">
            Enviar
          </Button>
        </Section>

        <Section id="gallery-activemarker" title="activeMarker (item ativo)">
          <div
            className={`rounded-lg bg-[var(--color-surface-2)] px-4 py-3 text-sm ${activeMarker}`}
          >
            sessão ativa
          </div>
        </Section>
      </div>
    </div>
  )
}
