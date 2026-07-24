// Concat de classes minúsculo (evita dependência de clsx só para os primitivos).
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
