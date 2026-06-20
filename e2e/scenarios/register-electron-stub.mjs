// Hook de resolução (Node ESM loader) que redireciona `import 'electron'` para o
// stub local. Usado pelo smoke via `node --import`. Mantém db.ts/claude-cli.ts
// importáveis fora do Electron sem mockar o serviço inteiro.
import { pathToFileURL } from 'node:url'

const STUB = pathToFileURL(new URL('./electron-stub.mjs', import.meta.url).pathname).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: STUB, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
