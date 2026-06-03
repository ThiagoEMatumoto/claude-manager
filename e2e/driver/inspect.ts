import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'

// Inspeção read-only do estado do app a partir da CÓPIA do userData.
// Usa sql.js (SQLite em wasm puro): sem dependência de `sqlite3` no sistema e sem
// o conflito de ABI do better-sqlite3 do app (compilado pra Electron, não pro Node
// do driver). Lê o arquivo em memória — nunca escreve no banco.
const require = createRequire(import.meta.url)
let sqlPromise: Promise<SqlJsStatic> | null = null

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const wasm = require.resolve('sql.js/dist/sql-wasm.wasm')
    sqlPromise = initSqlJs({ locateFile: () => wasm })
  }
  return sqlPromise
}

export async function queryDb<T = Record<string, unknown>>(
  userDataCopy: string,
  sql: string,
): Promise<T[]> {
  const SQL = await getSql()
  const db = new SQL.Database(readFileSync(join(userDataCopy, 'app.db')))
  try {
    const [res] = db.exec(sql)
    if (!res) return []
    return res.values.map((row) => {
      const obj: Record<string, unknown> = {}
      res.columns.forEach((col, i) => (obj[col] = row[i]))
      return obj as T
    })
  } finally {
    db.close()
  }
}

// Lista as tabelas — atalho útil pra descobrir o schema ao diagnosticar.
export async function listTables(userDataCopy: string): Promise<string[]> {
  const rows = await queryDb<{ name: string }>(
    userDataCopy,
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  )
  return rows.map((r) => r.name)
}
