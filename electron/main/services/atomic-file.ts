import { access, copyFile, rename, writeFile } from 'node:fs/promises'

// Escrita atômica: grava num .tmp ao lado e faz rename (atômico no mesmo fs).
// Evita deixar o arquivo alvo truncado se o processo morrer no meio do write.
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

// Backup único: copia para `<path>.bak` apenas na PRIMEIRA escrita gerenciada
// pelo app (se o .bak já existe, preserva — é o snapshot pré-app do usuário).
export async function backupOnce(path: string): Promise<void> {
  const bak = `${path}.bak`
  try {
    await access(bak)
    return
  } catch {
    // sem .bak ainda — segue pro copy
  }
  try {
    await copyFile(path, bak)
  } catch {
    // arquivo original não existe: nada a preservar
  }
}
