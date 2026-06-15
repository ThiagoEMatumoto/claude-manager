// Loader ESM mínimo que resolve `electron` para um stub (o e2e roda em Node, não
// em Electron). exporter/importer só usam app.getPath/getVersion como fallback;
// o cenário injeta featuresRoot explicitamente, então o stub nunca é exercitado
// de fato — só precisa existir para o módulo resolver.
import { tmpdir } from 'node:os'

const STUB = `
export const app = {
  getPath: () => ${JSON.stringify(tmpdir())},
  getVersion: () => '0.0.0-e2e',
}
export const BrowserWindow = { getAllWindows: () => [] }
export default { app, BrowserWindow }
`

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: 'cm-electron-stub:electron', shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === 'cm-electron-stub:electron') {
    return { format: 'module', source: STUB, shortCircuit: true }
  }
  return nextLoad(url, context)
}
