import { join } from 'node:path'

export interface SidecarPathEnv {
  // app.isPackaged — true quando rodando dentro de um build empacotado (asar).
  isPackaged: boolean
  // process.resourcesPath — só relevante em packaged (extraResources copia
  // `sidecar/` para cá, FORA do asar, de onde o python pode lê-lo).
  resourcesPath: string
  // __dirname do módulo compilado. Em dev/build/e2e o main vive em
  // `<repoRoot>/out/main`, então `<moduleDir>/../../sidecar` = `<repoRoot>/sidecar`.
  // Estável nos três modos não-empacotados, ao contrário de app.getAppPath()
  // (que em e2e retorna `out/main`, não a raiz do repo).
  moduleDir: string
}

// Resolve o diretório `sidecar/` (onde vive fake_sidecar.py) de forma robusta
// em DEV (electron-vite), BUILD/e2e (electron out/main) e PACKAGED (AppImage/deb).
// Função pura para ser testável sem mockar o módulo `electron`.
export function resolveSidecarDir(env: SidecarPathEnv): string {
  if (env.isPackaged) {
    return join(env.resourcesPath, 'sidecar')
  }
  return join(env.moduleDir, '..', '..', 'sidecar')
}

export function resolveSidecarScript(env: SidecarPathEnv, scriptName: string): string {
  return join(resolveSidecarDir(env), scriptName)
}

// Resolve o diretório `scripts/` (onde vive setup-meeting-sidecar.sh). Em
// PACKAGED: ao lado do sidecar, sob resourcesPath. Em DEV/BUILD/e2e: a raiz do
// repo é `<moduleDir>/../..` (out/main → repoRoot) e `scripts/` fica nela. Pura
// para ser testável sem mockar `electron`.
export function resolveScriptsDir(env: SidecarPathEnv): string {
  if (env.isPackaged) {
    return join(env.resourcesPath, 'scripts')
  }
  return join(env.moduleDir, '..', '..', 'scripts')
}

export function resolveSetupScript(env: SidecarPathEnv): string {
  return join(resolveScriptsDir(env), 'setup-meeting-sidecar.sh')
}
