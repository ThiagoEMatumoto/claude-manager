import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseSubagentTurns, type SubagentInfo } from './chat-transcript'

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

// Meta de um subagente: agent-<hash>.meta.json = { agentType, description, toolUseId }.
// toolUseId casa com o id do tool_use Task/Agent no JSONL principal — é a chave da
// associação. agentType é o nome exibível (ex.: 'Explore', 'general-purpose').
interface SubagentMeta {
  agentType?: string
  description?: string
  toolUseId?: string
}

// Lê os subagentes de uma sessão e indexa por toolUseId, pro parser do chat trocar
// o tool_use genérico pelo card de subagente. Cada subagente são dois arquivos
// irmãos na pasta subagents/: agent-<hash>.meta.json (associação + nome) e
// agent-<hash>.jsonl (os turnos). Degrada pra mapa vazio quando a pasta não existe
// e pula silenciosamente arquivos ilegíveis/malformados.
export function readSubagentInfos(dir: string, sessionId: string): Map<string, SubagentInfo> {
  const out = new Map<string, SubagentInfo>()
  const subDir = join(dir, sessionId, 'subagents')
  if (!existsSync(subDir)) return out

  let files: string[]
  try {
    files = readdirSync(subDir).filter((f) => f.endsWith('.meta.json'))
  } catch {
    return out
  }

  for (const metaFile of files) {
    let meta: SubagentMeta
    try {
      meta = JSON.parse(readFileSync(join(subDir, metaFile), 'utf8')) as SubagentMeta
    } catch {
      continue // meta ilegível/malformada — pula este subagente.
    }
    if (!meta.toolUseId) continue

    const jsonlFile = metaFile.replace(/\.meta\.json$/, '.jsonl')
    let turns: { turnCount: number; turns: string[] } = { turnCount: 0, turns: [] }
    try {
      turns = parseSubagentTurns(readFileSync(join(subDir, jsonlFile), 'utf8'))
    } catch {
      // sem o .jsonl ainda (subagente recém-disparado): mostra nome/descrição, 0 turnos.
    }

    out.set(meta.toolUseId, {
      name: meta.agentType ?? 'subagente',
      description: meta.description ?? '',
      turnCount: turns.turnCount,
      turns: turns.turns,
    })
  }
  return out
}
