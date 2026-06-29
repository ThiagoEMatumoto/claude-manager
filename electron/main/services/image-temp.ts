// Helpers puros pra arquivos temporários de imagem (paste/drag no composer).
// Sem electron/fs — testável em vitest puro. O I/O (writeFile/readdir/unlink)
// vive em ipc/sessions.ts e consome estas funções.

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/heic': 'heic',
}

// Prefixo comum a todo temp de imagem; o sweep de boot usa pra reconhecer órfãos.
export const IMAGE_TEMP_PREFIX = 'img-'

const KNOWN_EXTS = Array.from(new Set(Object.values(MIME_EXT)))

export function extFromMime(mime: string): string {
  return MIME_EXT[(mime ?? '').toLowerCase().trim()] ?? 'png'
}

// img-<sessionId>-<uuid>.<ext> — embutir o sessionId no nome permite limpeza por
// sessão no pty:exit sem precisar rastrear paths em memória.
export function buildImageFilename(opts: { id: string; mime: string; sessionId: string }): string {
  return `${IMAGE_TEMP_PREFIX}${opts.sessionId}-${opts.id}.${extFromMime(opts.mime)}`
}

const IMAGE_FILE_RE = new RegExp(`^${IMAGE_TEMP_PREFIX}.+\\.(${KNOWN_EXTS.join('|')})$`, 'i')

// É um temp de imagem que nós criamos? Predicado de "órfão a limpar" no boot:
// num processo fresco nenhum compose em andamento referencia esses paths.
export function isImageTempFile(filename: string): boolean {
  return IMAGE_FILE_RE.test(filename)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// É um temp de imagem desta sessão específica? Predicado da limpeza no pty:exit.
export function isSessionImageTempFile(filename: string, sessionId: string): boolean {
  if (!isImageTempFile(filename)) return false
  return new RegExp(`^${IMAGE_TEMP_PREFIX}${escapeRegExp(sessionId)}-`).test(filename)
}
