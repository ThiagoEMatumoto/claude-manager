import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Turns de subagente vivem em arquivos aninhados:
//   <dir>/<sessionId>/subagents/agent-*.jsonl
// Cada linha `type==='assistant'` é um turn de subagente (todas têm
// isSidechain:true). Conta linhas assistant em todos os arquivos da pasta.
// Degrada para 0 quando a pasta não existe — não quebra o scan.
export function countSubagentTurns(dir: string, sessionId: string): number {
  const subDir = join(dir, sessionId, 'subagents')
  if (!existsSync(subDir)) return 0

  let files: string[]
  try {
    files = readdirSync(subDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return 0
  }

  let count = 0
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(join(subDir, file), 'utf8')
    } catch {
      continue // arquivo ilegível — pula.
    }
    for (const raw of content.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      try {
        const obj = JSON.parse(line) as { type?: string }
        if (obj.type === 'assistant') count += 1
      } catch {
        // linha inválida ou parcial — ignora.
      }
    }
  }
  return count
}
