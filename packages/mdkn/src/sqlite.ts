import type { SqlJsStatic } from "sql.js";
import * as path from "path";

export interface SqliteOptions {
  /** Absolute path to `sql-wasm.wasm`. Needed when the library is bundled (e.g. VS Code extension). */
  wasmPath?: string;
}

let options: SqliteOptions = {};
let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Configure the sql.js loader. Must be called before the first index access to take effect. */
export function configureSqlite(opts: SqliteOptions): void {
  options = { ...options, ...opts };
  sqlPromise = null;
}

export function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require("sql.js") as (cfg?: { locateFile?: (f: string) => string }) => Promise<SqlJsStatic>;
    const wasmPath = options.wasmPath;
    sqlPromise = initSqlJs(
      wasmPath ? { locateFile: (file: string) => (file.endsWith(".wasm") ? wasmPath : path.join(path.dirname(wasmPath), file)) } : undefined
    ).catch((e) => {
      sqlPromise = null;
      throw e;
    });
  }
  return sqlPromise;
}
