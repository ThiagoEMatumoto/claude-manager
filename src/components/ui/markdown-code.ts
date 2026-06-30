// Nó mínimo da árvore HAST que o react-markdown passa pros componentes custom.
// rehype-highlight transforma o texto do code block em spans aninhados; pra
// recuperar o texto original (pra copiar) basta concatenar os nós de texto.
export interface HastNode {
  type?: string
  value?: string
  children?: HastNode[]
}

// Texto puro de um nó HAST (recursivo). Usado pra extrair o conteúdo de um
// <pre><code> já tokenizado pelo highlight — os spans só envolvem, o texto fica
// intacto. Pura e testável sem DOM.
export function nodeText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  if (!node.children) return ''
  return node.children.map(nodeText).join('')
}
