import type { AnchorHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { shellApi } from '@/lib/ipc'

// Links de PR/docs no markdown abrem no browser do sistema. Sem isso, o clique
// num <a> puro dispara navegação no Electron e a janela do app some / abre em
// branco em vez de levar a URL pro Chrome.
function MarkdownLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href) void shellApi.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

const MARKDOWN_COMPONENTS: Components = { a: MarkdownLink }

interface Props {
  content: string
}

export function MarkdownViewer({ content }: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
