// Validação pura do nome de pasta pra criação de repo do zero — mantida fora do
// handler IPC pra ser testável sem Electron (mesmo padrão de untracked-folders.ts).

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/
const MAX_NAME_LENGTH = 100

export type BlankRepoNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string }

// Aceita um nome digitado pelo usuário e retorna o nome normalizado (trim) ou
// um erro legível. Regras: sem separadores de path (bloqueia traversal), sem
// dotfiles, sem '.'/'..', começa com alfanumérico, tamanho limitado.
export function validateBlankRepoName(raw: string): BlankRepoNameResult {
  const name = raw.trim()
  if (!name) {
    return { ok: false, error: 'Defina um nome para a pasta.' }
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Nome muito longo (máx. ${MAX_NAME_LENGTH} caracteres).` }
  }
  if (/[/\\]/.test(name) || name === '.' || name === '..') {
    return { ok: false, error: 'Nome inválido: não pode conter separadores de caminho.' }
  }
  if (!SAFE_NAME.test(name)) {
    return {
      ok: false,
      error: 'Nome inválido: use letras, números, ponto, hífen, underscore ou espaço (começando com letra ou número).',
    }
  }
  return { ok: true, name }
}
