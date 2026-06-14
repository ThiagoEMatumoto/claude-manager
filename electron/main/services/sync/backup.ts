import type Database from 'better-sqlite3'
import { zipSync, unzipSync, type Zippable } from 'fflate'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { type ExportOpts, exportBundle } from './exporter'
import { type ImportOpts, importBundle } from './importer'

// Backup manual em .zip — INDEPENDENTE do git/sync. Exporta o bundle (mesma
// serialização determinística do sync, com portabilidade de paths via
// projectsRoot) para um único arquivo .zip restaurável, e importa de volta
// (DESTRUTIVO replace-all). Reusa exportBundle/importBundle: nada de
// serialização nova.

export type BackupExportOpts = ExportOpts
export type BackupImportOpts = ImportOpts

function mkTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

// Coleta recursivamente os arquivos de `root` num mapa { caminhoRelativo: bytes }
// pronto para o fflate. As chaves usam '/' como separador (formato de zip),
// independente do separador do SO.
function collectFiles(root: string): Zippable {
  const out: Zippable = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile()) {
        const rel = relative(root, abs).split(sep).join('/')
        out[rel] = new Uint8Array(readFileSync(abs))
      }
    }
  }
  walk(root)
  return out
}

// Escreve cada entrada do zip descompactado em `destRoot`, recriando os
// subdiretórios. As chaves vêm com '/' (formato zip) → reconvertidas para o
// separador do SO via join.
function writeUnzipped(destRoot: string, files: Record<string, Uint8Array>): void {
  for (const [rel, bytes] of Object.entries(files)) {
    // Ignora entradas de diretório puro (fflate não as emite, mas é defensivo).
    if (rel.endsWith('/')) continue
    const abs = join(destRoot, ...rel.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
  }
}

// Exporta um backup completo e restaurável para `destZipPath`.
// Sequência: exportBundle → tempdir → coletar arquivos → zipSync → gravar .zip.
// O tempdir é sempre limpo (finally). Retorna o path do .zip gravado.
export function exportBackup(
  db: Database.Database,
  destZipPath: string,
  opts?: BackupExportOpts,
): string {
  const work = mkTempDir('cm-backup-export-')
  try {
    exportBundle(db, work, opts)
    const files = collectFiles(work)
    const zipped = zipSync(files)
    writeFileSync(destZipPath, zipped)
    return destZipPath
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// Importa um backup .zip, SUBSTITUINDO TODO o estado sincronizável local
// (replace-all, idempotente). Sequência: ler .zip → unzipSync → tempdir →
// importBundle (respeita projectsRoot local). O tempdir é sempre limpo.
export function importBackup(
  db: Database.Database,
  srcZipPath: string,
  opts?: BackupImportOpts,
): void {
  const buf = new Uint8Array(readFileSync(srcZipPath))
  const files = unzipSync(buf)
  const work = mkTempDir('cm-backup-import-')
  try {
    writeUnzipped(work, files)
    importBundle(db, work, opts)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
