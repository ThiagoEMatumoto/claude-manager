// Lógica pura do paste/drop de imagem no composer — sem DOM, testável em vitest.
// O Composer faz o I/O (file.arrayBuffer + IPC saveImage) e usa estas funções
// pra (a) achar os itens de imagem num payload de clipboard/drop simulável e
// (b) inserir o path no textarea preservando a posição do cursor.

export interface ImageItemLike {
  kind: string
  type: string
}

// Itens de clipboard que são arquivos de imagem (DataTransferItemList simulável).
export function pickImageItems<T extends ImageItemLike>(items: readonly T[]): T[] {
  return items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
}

// Arquivos de imagem de uma FileList (fallback do paste / drop).
export function pickImageFiles<T extends { type: string }>(files: readonly T[]): T[] {
  return files.filter((f) => f.type.startsWith('image/'))
}

// Insere o path como token isolado na posição do cursor, garantindo espaços de
// separação (a CLI lê o caminho absoluto colado como texto, então não pode colar
// grudado no que já estava escrito). Idempotente quanto a espaços duplicados.
export function insertPathToken(
  value: string,
  path: string,
  selStart: number,
  selEnd: number,
): { value: string; cursor: number } {
  const before = value.slice(0, selStart)
  const after = value.slice(selEnd)
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trail = after.length === 0 || !/^\s/.test(after) ? ' ' : ''
  const token = lead + path + trail
  return { value: before + token + after, cursor: before.length + token.length }
}
