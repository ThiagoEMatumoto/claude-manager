import { describe, it, expect } from 'vitest'
import { resolveSidecarDir, resolveSidecarScript } from './sidecar-path'

describe('resolveSidecarDir', () => {
  it('packaged: resolve a partir de resourcesPath (fora do asar)', () => {
    const dir = resolveSidecarDir({
      isPackaged: true,
      resourcesPath: '/opt/Claude Manager/resources',
      moduleDir: '/opt/Claude Manager/resources/app.asar/out/main',
    })
    expect(dir).toBe('/opt/Claude Manager/resources/sidecar')
  })

  it('build/e2e: <repoRoot>/out/main → <repoRoot>/sidecar', () => {
    const dir = resolveSidecarDir({
      isPackaged: false,
      resourcesPath: '/ignored/in/dev',
      moduleDir: '/home/user/repo/out/main',
    })
    expect(dir).toBe('/home/user/repo/sidecar')
  })

  it('dev (electron-vite serve de out/main): mesma derivação', () => {
    const dir = resolveSidecarDir({
      isPackaged: false,
      resourcesPath: '/ignored',
      moduleDir: '/home/user/repo/out/main',
    })
    expect(dir).toBe('/home/user/repo/sidecar')
  })
})

describe('resolveSidecarScript', () => {
  it('anexa o nome do script ao diretório resolvido', () => {
    const script = resolveSidecarScript(
      {
        isPackaged: false,
        resourcesPath: '/ignored',
        moduleDir: '/home/user/repo/out/main',
      },
      'fake_sidecar.py',
    )
    expect(script).toBe('/home/user/repo/sidecar/fake_sidecar.py')
  })
})
