# Sonda empírica — AskUserQuestion no claude 2.1.216

Fase 0 do plano `tenho-mais-alguns-feedbacks-shiny-meteor.md`. Gerado por
`e2e/scenarios/probe-tui-2116.ts` (+ follow-up `probe-tui-2116-d2.ts` pro layout d).
Toda linha vem de observação real: node-pty spawnando `claude` 2.1.216 de verdade
(sem Electron), buffer capturado com `@xterm/headless` (mesma primitiva que
`Terminal.tsx` usa via `readTailText`/`translateToString`), e o **parser real**
`parseTuiMenu` do repo rodando contra o texto capturado.

## Nota metodológica (limitação observada)

A confirmação por JSONL da sessão ("o transcript ganha o tool_result") **não foi
possível**: as sessões de sonda nunca chegaram a gravar um `<sessionId>.jsonl` em
`~/.claude/projects/<projeto>/` no tempo de vida curto do probe (só a subpasta
`memory/` aparece). A confirmação usada foi o **buffer real via o parser real**:
o menu desaparece (`parseTuiMenu` volta a `null`) ou muda de tela/kind
(`question` → `question_review` → sumiço). Esse sinal é forte porque é
exatamente a mesma fonte de verdade que a produção usa (`readTuiMenu` em
`Terminal.tsx`), mas é mais fraco que um `tool_result` no JSONL — registrado
para transparência.

## Tabela-verdade resumida

| Layout | submitOnDigit (parser) | tabs? | multiSelect? | Sequência confirmada |
|---|---|---|---|---|
| a) single 2-opt, sem preview | true | não | false | **digit-only** (ex: `"1"`) |
| b) single 3-opt, description longa | true | não | false | **digit-only** (ex: `"2"`) — description NÃO virou preview em box, ver nota |
| c) multi-select, 3 opções | true | sim (`[categoria, Submit]`) | true | **nav-right até a aba "Submit" + Enter** (dígito sozinho ou dígito+Enter NÃO submetem, só fazem toggle) |
| d) multi-pergunta (2 questions) | true | sim (`[Q1, Q2, Submit]`) | false | **digit-only por pergunta avança de aba**; na ÚLTIMA pergunta cai em `question_review`; ali **digit(1)+Enter ("Submit answers")** faz o submit final do conjunto |
| e) pergunta longa (wrap) | true | não | false | **digit-only** — mecanismo de submit não quebra, mas **Bug 1 confirmado** (ver abaixo) |

## Achados que confirmam hipóteses do plano

**Bug 1 (truncação) — CONFIRMADO.** Rodei `parseTuiMenu` direto contra o buffer
capturado do layout (e): a pergunta real tinha 9 linhas de wrap visual
("Imagine um sistema distribuído... qual abordagem você prefere?"), e o campo
`question` retornado foi **só a última linha**:
`"inconsistência temporária: qual abordagem você prefere?"`. Confirma
exatamente o diagnóstico do plano (`parseTuiMenu` só sobe até achar a primeira
linha não-branca acima da 1ª opção, não junta o wrap).

**Bug 3 (multi-select não submete) — CONFIRMADO, com mecanismo exato.** No
layout (c): dígito sozinho faz toggle (`fingerprintChanged=false`), Enter puro
depois do toggle também não resolve. Só resolveu com navegação de aba
(`→` três vezes) + `Enter` na aba "Submit". Confirma a suspeita do plano:
`buildTabKeys` (respond-keys.ts) precisa terminar em Enter pra *entrar* na
tela de submit — hoje só manda setas.

## Achados que CONTRADIZEM ou REFINAM hipóteses do plano

**Bug 2 (single 2-opt "não consegue enviar") — NÃO REPRODUZIDO como descrito.**
O plano hipotetizava que a AskUserQuestion "sempre desenha uma barra de abas"
e que isso quebraria `submitOnDigit`. Não observei isso: nos layouts (a), (b) e
(e) — todos single-select sem `multiSelect` e com só 1 pergunta — **NÃO havia
`tabs`** (a barra `←...→` só apareceu em (c) e (d), que têm multi-select ou
multi-pergunta). Nesses três casos, dígito sozinho selecionou E submeteu de
primeira, igual ao comportamento "antigo" documentado nos comentários. Ou
seja: a causa raiz do Bug 2 relatado pelo usuário **provavelmente não é** "toda
pergunta agora tem aba" — pode ser um detalhe específico da app real (timing do
guard de re-parse em `respond-keys.ts`/`ChatView.tsx`, ou um layout com
`header` mais longo que estoura e produz um formato ainda não coberto por esta
sonda) que precisa de mais investigação dirigida na Fase 1, não uma correção
cega baseada nesta hipótese.

**Preview em box não apareceu para `description` textual.** No layout (b), as
3 opções tinham `description` de 2+ frases cada, mas a CLI renderizou como
texto indentado comum (linhas de continuação), **não** como um box
`┌─...─┐`. `previewParts.length` ficou 0, `submitOnDigit` continuou `true`, e
digit-only submeteu normalmente. O mecanismo de preview em box (que dispara
`submitOnDigit: false` no parser) pode ser reservado pra outro tipo de conteúdo
(ex: diffs/código) não testado aqui — não reproduzido, não inventar.

**Chip/header não capturado pelo parser (achado novo, não é bug funcional).**
Em (a), (b) e (e) apareceu uma linha de "chip" acima da pergunta, com um glyph
de checkbox: ` ☐ Confirmação`, ` ☐ Abordagem`, ` ☐ Arquitetura` — parece ser o
campo `header` da tool AskUserQuestion truncado, prefixado por um glyph que
lembra `TAB_TOKEN_RE` mas SEM o wrapper `← ... →`, então `extractTabBar` não
casa (retorna `undefined` corretamente, fail-soft). Não quebra o parse da
pergunta (a pergunta em si está na linha seguinte, correta), mas é um elemento
novo na versão 2.1.216 que os comentários antigos não mencionavam. Vale nota
pra quem for mexer em `extractTabBar`/classificação, mas fora do escopo dos 3
bugs reportados.

**Multi-pergunta: mecanismo de 2 estágios, não 1 (refina o plano).** O plano
tratava "multi-pergunta" e "multi-select" como variações do mesmo problema
(barra de abas + Submit). Na prática são dois fluxos DIFERENTES:
- multi-select (c): dígito só faz toggle, sempre; só sai via nav-to-Submit-tab.
- multi-pergunta com respostas single-select (d): dígito responde E avança
  automaticamente pra próxima pergunta (aba muda de `☐` pra `☒`/done); só na
  ÚLTIMA pergunta o "avanço" leva a uma tela nova e distinta,
  `kind: 'question_review'` (já reconhecida por `QUESTION_REVIEW_RE` no parser
  atual — ver texto capturado abaixo), com opções próprias "1. Submit answers"
  / "2. Cancel". `digit(1)` + `Enter` nessa tela resolveu (não isolei se
  `digit(1)` sozinho já bastaria).

## Detalhe por layout

### a) single-select, 2 opções, sem preview

```
 ☐ Confirmação
Você confirma?
❯ 1. Sim
  2. Não
  3. Type something.
────────────────────────────────────────────────────────────────────────────
  4. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel
```
Parse real: `{"kind":"question","multiSelect":false,"submitOnDigit":true}` (4
opções — as 2 reais + as 2 sentinelas `other`/`chat`, sem `tabs`).
Sequência confirmada: **digit-only("1")** — menu desapareceu (`parseTuiMenu`
voltou `null`) logo após.

### b) single-select, 3 opções com description longa (sem virar preview)

```
 ☐ Abordagem
Qual abordagem você prefere para resolver o bug?
❯ 1. Abordagem A
     Reescrever do zero a parte afetada do código. Isso elimina qualquer resquício de lógica
     defeituosa e permite aplicar um design mais limpo desde o início, mas tem custo maior de tempo
     e risco de introduzir regressões novas.
  2. Abordagem B
     ...
  3. Abordagem C
     ...
  4. Type something.
────────────────────────────────────────────────────────────────────────────
  5. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel
```
Parse real: `submitOnDigit: true`, todas as opções com `hasPreview: false`
(description capturada como texto normal, não como box). Sequência
confirmada: **digit-only("2")** — resolveu de primeira.

### c) multi-select (3 opções marcáveis)

```
←  ☐ Linguagens  ✔ Submit  →
Quais linguagens você usa no dia a dia?
❯ 1. [ ] TypeScript
  2. [ ] Python
  3. [ ] Rust
  4. [ ] Type something
────────────────────────────────────────────────────────────────────────────
  5. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel
```
Parse real: `multiSelect: true`, `tabs: [{label:"Linguagens",done:false},
{label:"Submit",done:true}]`.
Log de tentativas:
1. `keys=["1","2"]` (toggle TypeScript + Python) → `fingerprintChanged=false` — só marcou os checkboxes, não submeteu.
2. `keys=["\r"]` (Enter puro) → `fingerprintChanged=false` — não submeteu.
3. `keys=["\x1b[C","\x1b[C","\x1b[C","\r"]` (→ ×3 + Enter) → **resolveu**, menu sumiu.

Sequência confirmada: **nav-right (suficiente com 3, mínimo não isolado) até a
aba "Submit" + Enter**.

### d) múltiplas perguntas numa só chamada (2 questions)

Primeira pergunta:
```
←  ☐ Cor  ☐ Animal  ✔ Submit  →
Qual sua cor favorita?
❯ 1. Vermelho
     Cor vermelha
  2. Azul
     Cor azul
  3. Type something.
────────────────────────────────────────────────────────────────────────────
  4. Chat about this
Enter to select · Tab/Arrow keys to navigate · Esc to cancel
```
`digit("1")` → avança para a 2ª pergunta (tab "Cor" vira `done:true`):
```
menu2 = {"question":"Qual seu animal favorito?","tabs":[{"label":"Cor","done":true},{"label":"Animal","done":false},{"label":"Submit","done":true}],"kind":"question"}
```
`digit("1")` de novo (na última pergunta) → cai na tela de revisão:
```
←  ☒ Cor  ☒ Animal  ✔ Submit  →
Review your answers
 ● Qual sua cor favorita?
   → Vermelho
 ● Qual seu animal favorito?
   → Cachorro
Ready to submit your answers?
❯ 1. Submit answers
  2. Cancel
```
Parse real dessa tela: `kind: "question_review"` (via `QUESTION_REVIEW_RE`,
já implementado). `digit("1")` + `Enter` nessa tela → menu resolveu (sumiu).

Sequência confirmada: **digit-only por pergunta (avança automaticamente entre
abas); na última pergunta, digit-only leva a `question_review`; ali
digit(1)+Enter ("Submit answers") faz o submit final.**

### e) pergunta longa (wrap em várias linhas visuais, cols=80)

```
 ☐ Arquitetura
Imagine um sistema distribuído com dezenas de microsserviços onde o serviço de
pagamentos precisa consultar o serviço de inventário e o serviço de usuários em
tempo real antes de confirmar uma transação, mas o serviço de inventário está em
uma região geográfica diferente com latência de rede de 150ms e usa
consistência eventual via replicação assíncrona, enquanto o serviço de
pagamentos exige consistência forte para evitar overselling, e o time precisa
decidir entre sincronizar tudo de forma síncrona aceitando a latência alta ou
usar um padrão de saga com compensação assíncrona aceitando uma janela de
inconsistência temporária: qual abordagem você prefere?
❯ 1. Opção 1
     Chamadas síncronas com consistência forte, aceitando maior latência
  2. Opção 2
     Saga assíncrona com compensação, aceitando inconsistência temporária
  3. Type something.
────────────────────────────────────────────────────────────────────────────
  4. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel
```
Rodando `parseTuiMenu` real contra esse texto: `question ===
"inconsistência temporária: qual abordagem você prefere?"` — **as 8 linhas
anteriores da pergunta são perdidas** (Bug 1 confirmado). Mecanismo de
select/submit não é afetado: `digit-only("1")` resolveu normalmente.

## O que NÃO foi possível reproduzir

Nada dos 5 layouts pedidos ficou sem reprodução — todos os 5 (a-e) produziram
um `AskUserQuestion` real e uma sequência de teclas testada empiricamente.
A única limitação é a metodológica já registrada acima (confirmação via JSONL
não disponível; usei o parser real sobre o buffer real como fonte de verdade).

## Fase 2 — Sonda dos tipos de cobertura ampla (multi-pergunta, Other)

Gerado por `e2e/scenarios/probe-fase2-multiq-other.ts`. Diferença metodológica
da Fase 0: aqui a sonda chama as **funções de produção reais**
(`buildSelectKeys`, `buildOtherKeys`, `buildReviewKeys`, `playKeys` de
`respond-keys.ts`) contra o `claude` real, em vez de tentar sequências de tecla
cruas — o objetivo é confirmar se o *wiring já existente* resolve, não
redescobrir a sequência.

**Cenário A — single-select com "Other".** `buildOtherKeys(2, 'Elixir')` →
`["3", "Elixir", "\r"]`. Aplicado via `playKeys`, o menu desapareceu do buffer
(resolvido) na primeira tentativa. **Já funcionava, sem mudança de código.**

**Cenário B — multi-pergunta (2 perguntas) com Other na 2ª.**
`buildSelectKeys(Q1, 0)` → `["1"]` respondeu a Q1 e avançou pra Q2
automaticamente (tab "Cor" virou `done:true`). Na Q2, `buildOtherKeys(2,
'Fotografia')` → `["3", "Fotografia", "\r"]` levou direto pra
`kind: 'question_review'` com o resumo `Cor → Vermelho` / `Hobby →
Fotografia` correto (Other apareceu no resumo com o texto digitado, não com
"Type something."). `buildReviewKeys(review, 'submit')` → `["1"]` (SEM Enter)
resolveu o conjunto inteiro — confirma que o `question_review` tem
`submitOnDigit: true` (sem preview) e dígito sozinho basta, refinando a
incerteza registrada na Fase 0 ("não isolei se digit(1) sozinho já bastaria").

**Conclusão Fase 2:** as 3 sub-features do catálogo de cobertura ampla:
1. **Multi-pergunta numa só chamada** — mecanismo de submit E "Other" dentro
   da sequência já funcionavam via `tabs`/`question_review` existentes (Fase
   1/Bug 3 já validou o mesmo caminho pro multi-select). Único gap real era
   UX: a barra de abas não deixava explícito "você está na pergunta 2 de 2"
   (só os rótulos truncados + done/undone) — adicionado `questionPositionLabel`
   (`tui-menu-parser.ts`) + render no `QuestionCard`, sem tocar no mecanismo
   de teclas.
2. **"Other" dinâmico** — já funcionava, inclusive dentro de multi-pergunta
   (não coberto antes por sonda dedicada). Só o comentário em `QuestionCard.tsx`
   estava desatualizado ("sem evidência validada pro caso multi+Other");
   corrigido para reflexo do achado (multi-SELECT+Other continua sem
   evidência e é filtrado à parte, isso não mudou).
3. **Transições de permission-mode no chat** — investigado, NÃO implementado
   nesta rodada: o modo atual (`currentMode`, `Terminal.tsx`) já é visível de
   forma persistente via `PermissionPill`/`ComposerToolbar`, renderizado FORA
   do toggle Terminal⇄Chat (visível nos dois modos). O pedido original
   ("linha de sistema tipo 'Modo alterado para plan' quando o modo muda") é
   um artefato DIFERENTE — um evento efêmero (nunca vai pro JSONL) que
   precisaria de (a) histórico de transições com timestamp em `Terminal.tsx`
   (hoje só guarda o valor atual) e (b) merge desse histórico na lista
   `rendered` do `ChatView` pra aparecer na posição cronológica certa entre
   as mensagens — mesmo padrão de "chip de sistema centralizado" já usado por
   `SystemCard.tsx` (hoje só alimentado por `compact_boundary`, um evento real
   do transcript, não por leitura de rodapé). Decisão de design que volta pro
   usuário (ver relatório da sessão).
