import { Check, MessageCircleQuestion } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { ChatQuestion } from '../../../../shared/types/ipc'

interface Props {
  questions: ChatQuestion[]
  // Mapa pergunta→opção(ões) escolhida(s); ausente = ainda não respondido. Em
  // multiSelect o valor vem como "Opção A, Opção B" (labels juntos por ", ").
  answers?: Record<string, string>
  // Clique-pra-responder: presente = o ChatView liberou o clique (card é o momento
  // pendente + sessão 'waiting'). O handler de lá re-checa os guards no clique.
  onRespond?: (optionIndex: number, label: string) => void
  // Label da opção clicada, enquanto a resposta real não chega no JSONL (forId).
  sentLabel?: string
}

// Uma opção foi escolhida se bate exata (single) ou aparece na lista juntada
// (multiSelect). includes como rede de segurança pra separadores fora do padrão.
function isSelected(answer: string | undefined, label: string): boolean {
  if (answer == null) return false
  return answer === label || answer.split(', ').includes(label) || answer.includes(label)
}

// Render dedicado de um AskUserQuestion (substitui o tool card genérico). Mostra
// header + pergunta + opções (label em destaque, description abaixo). Quando
// respondido, marca a(s) opção(ões) escolhida(s). Com onRespond presente, as opções
// viram botões que enviam a escolha ao PTY — V1 só pra pergunta ÚNICA sem
// multiSelect (multi-pergunta tem tabs + "Review your answers" na TUI; multiSelect
// exige espaço+Enter). Free-text/"Other" segue pelo compositor.
export function QuestionCard({ questions, answers, onRespond, sentLabel }: Props) {
  const answered = answers != null
  const sent = sentLabel != null && !answered
  const clickable =
    onRespond != null && !answered && !sent && questions.length === 1 && !questions[0].multiSelect
  return (
    <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-surface)]/60 text-sm">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        <Icon as={MessageCircleQuestion} size={14} className="shrink-0 text-[var(--color-accent)]" />
        <span className="font-medium text-[var(--color-text)]">
          {answered ? 'Pergunta respondida' : 'Claude perguntou'}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-3 py-2.5">
        {questions.map((q, qi) => {
          const answer = answers?.[q.question]
          return (
            <div key={qi} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                {q.header && (
                  <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
                    {q.header}
                  </span>
                )}
                <span className="text-[var(--color-text)]">{q.question}</span>
                {q.multiSelect && (
                  <span className="shrink-0 text-[10px] text-[var(--color-text-dim)]">
                    (múltipla)
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {q.options.map((opt, oi) => {
                  const selected = isSelected(answer, opt.label)
                  // Eco otimista do clique: check em tom dim até a resposta real
                  // chegar no transcript e virar `selected`.
                  const sentSelected = sent && opt.label === sentLabel
                  const content = (
                    <>
                      <Icon
                        as={Check}
                        size={13}
                        className={`mt-0.5 shrink-0 ${
                          selected
                            ? 'text-[var(--color-accent)]'
                            : sentSelected
                              ? 'text-[var(--color-text-dim)]'
                              : 'text-transparent'
                        }`}
                      />
                      <div className="min-w-0">
                        <div
                          className={`font-medium ${selected ? 'text-[var(--color-text)]' : 'text-[var(--color-text)]/90'}`}
                        >
                          {opt.label}
                        </div>
                        {opt.description && (
                          <div className="text-xs text-[var(--color-text-dim)]">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </>
                  )
                  if (clickable) {
                    return (
                      <button
                        key={oi}
                        type="button"
                        onClick={() => onRespond(oi, opt.label)}
                        className="flex w-full items-start gap-2 rounded border border-[var(--color-border)] px-2 py-1.5 text-left transition hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-accent)]/10"
                      >
                        {content}
                      </button>
                    )
                  }
                  return (
                    <div
                      key={oi}
                      className={`flex items-start gap-2 rounded border px-2 py-1.5 ${
                        selected
                          ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10'
                          : sentSelected
                            ? 'border-[var(--color-border)] bg-[var(--color-surface-2)]'
                            : 'border-[var(--color-border)]'
                      }`}
                    >
                      {content}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {!answered && (
          <div className="text-xs text-[var(--color-text-dim)]">
            {sent
              ? 'Resposta enviada…'
              : clickable
                ? 'Clique numa opção pra responder — ou use o compositor/terminal.'
                : 'Responda no compositor abaixo (ou no terminal) — selecione com as setas e Enter.'}
          </div>
        )}
      </div>
    </div>
  )
}
