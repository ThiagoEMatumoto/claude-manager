import { existsSync } from 'node:fs'

// Resolução PURA (testável) de qual sidecar usar: o REAL (faster-whisper, exige
// o python do venv configurado) ou o FAKE (stdlib, dev/sem-setup).
//
// Critério de "configurado": a pref `meeting_sidecar_python` aponta para um
// executável que existe E o script real `sidecar.py` existe no diretório do
// sidecar. Faltando qualquer um → fallback fake (não crasha; a UI mostra o
// aviso de 1ª classe "sidecar não configurado").

export const MEETING_SIDECAR_PYTHON_KEY = 'meeting_sidecar_python'

// Caminho do python do venv quando o setup roda no path padrão do
// scripts/setup-meeting-sidecar.sh. Relativo ao home do usuário.
export const DEFAULT_VENV_PYTHON_REL = '.claude-manager/meeting-sidecar/.venv/bin/python'

// Resolve o python a usar: a pref tem precedência; vazia → tenta o venv no path
// padrão (auto-detecção, p/ quem rodou o setup sem setar a pref manualmente).
// Puro/testável: home + existsSync injetáveis. Retorna null se nenhum vale.
export function resolveSidecarPython(opts: {
  pythonPref: string | null | undefined
  home: string
  exists?: (p: string) => boolean
  join: (...parts: string[]) => string
}): string | null {
  const pref = (opts.pythonPref ?? '').trim()
  if (pref) return pref
  const exists = opts.exists ?? existsSync
  const candidate = opts.join(opts.home, DEFAULT_VENV_PYTHON_REL)
  return exists(candidate) ? candidate : null
}

export interface SidecarConfigEnv {
  // Caminho do python do venv (pref `meeting_sidecar_python`), ou null/'' se
  // não configurado.
  pythonPref: string | null | undefined
  // Caminho absoluto do sidecar REAL (resolveSidecarScript('sidecar.py')).
  realScriptPath: string
  // Caminho absoluto do sidecar FAKE (resolveSidecarScript('fake_sidecar.py')).
  fakeScriptPath: string
  // Injeção do existsSync p/ teste (default: fs.existsSync).
  exists?: (p: string) => boolean
}

export interface SidecarResolution {
  configured: boolean
  // Comando (interpretador) + args completos para o spawn.
  command: string
  script: string
  // 'real' = faster-whisper; 'fake' = stdlib (não configurado).
  mode: 'real' | 'fake'
}

function fileExists(env: SidecarConfigEnv, p: string): boolean {
  return (env.exists ?? existsSync)(p)
}

// É o sidecar real utilizável? Pref preenchida + python existe + sidecar.py existe.
export function isMeetingSidecarConfigured(env: SidecarConfigEnv): boolean {
  const python = (env.pythonPref ?? '').trim()
  if (!python) return false
  return fileExists(env, python) && fileExists(env, env.realScriptPath)
}

// Resolve o comando+script a usar. Configurado → real (python do venv +
// sidecar.py); senão → fake (python3 herdado + fake_sidecar.py).
export function resolveSidecar(env: SidecarConfigEnv, fallbackPython: string): SidecarResolution {
  if (isMeetingSidecarConfigured(env)) {
    return {
      configured: true,
      command: (env.pythonPref ?? '').trim(),
      script: env.realScriptPath,
      mode: 'real',
    }
  }
  return {
    configured: false,
    command: fallbackPython,
    script: env.fakeScriptPath,
    mode: 'fake',
  }
}
