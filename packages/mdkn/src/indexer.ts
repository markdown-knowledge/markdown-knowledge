import type { Database, SqlJsStatic } from "sql.js";
import { INDEX_SCHEMA_VERSION, DocumentInfo } from "./manifest";
import { chunkMarkdown, ChunkOptions } from "./markdown";
import { globToRegExp } from "./paths";
import { MdkError } from "./errors";

/** What the indexer needs from a container. */
export interface IndexSource {
  listDocuments(): DocumentInfo[];
  readDocument(path: string): string;
}

export interface IndexStatus {
  /** true when every document is indexed with its current content */
  fresh: boolean;
  indexedDocuments: number;
  chunks: number;
  builtAt: string | null;
  /** indexed but content changed since */
  stale: string[];
  /** in container but never indexed */
  missing: string[];
  /** indexed but no longer in container */
  orphaned: string[];
}

export interface IndexStats {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  chunks: number;
  durationMs: number;
  rebuilt: boolean;
}

export interface SearchOptions {
  limit?: number;
  /** glob over document paths, e.g. "guides/**" */
  doc?: string;
  /** require all of these tags */
  tags?: string[];
  /** pass the query through as raw FTS4 syntax */
  raw?: boolean;
  /** "and" (default, falls back to "or" when nothing matches) | "or" */
  mode?: "and" | "or";
}

export interface SearchHit {
  chunkId: number;
  path: string;
  title: string;
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  ord: number;
  tokens: number;
  score: number;
  snippet: string;
  content: string;
  tags: string[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS documents (
  path  TEXT PRIMARY KEY,
  id    TEXT NOT NULL,
  title TEXT,
  tags  TEXT,
  hash  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id         INTEGER PRIMARY KEY,
  doc_path   TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  title      TEXT,
  tags       TEXT,
  heading    TEXT,
  level      INTEGER,
  start_line INTEGER,
  end_line   INTEGER,
  content    TEXT NOT NULL,
  tokens     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_path, ord);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts4(
  content='chunks', title, heading, content, tags,
  tokenize=unicode61 'remove_diacritics=2'
);
`;

/** BM25 column weights: title, heading, content, tags */
const WEIGHTS = [5.0, 3.0, 1.0, 2.0];
const K1 = 1.2;
const B = 0.75;

export class MdkIndex {
  private constructor(private readonly db: Database, private readonly source: IndexSource, private dirty: boolean) {}

  static async load(SQL: SqlJsStatic, source: IndexSource, bytes: Uint8Array | null): Promise<MdkIndex> {
    let db: Database | null = null;
    let dirty = false;
    if (bytes && bytes.length) {
      try {
        db = new SQL.Database(bytes);
        const v = db.exec("SELECT value FROM meta WHERE key='schemaVersion'");
        if (!v.length || Number(v[0].values[0][0]) !== INDEX_SCHEMA_VERSION) {
          db.close();
          db = null; // incompatible → recreate
        }
      } catch {
        db = null; // corrupt index → recreate
      }
    }
    if (!db) {
      db = new SQL.Database();
      dirty = true;
    }
    db.exec(SCHEMA);
    db.run("INSERT OR IGNORE INTO meta(key,value) VALUES ('schemaVersion', ?)", [String(INDEX_SCHEMA_VERSION)]);
    return new MdkIndex(db, source, dirty);
  }

  /** true when the index was modified since load/export */
  get isDirty(): boolean {
    return this.dirty;
  }

  get builtAt(): string | null {
    const r = this.db.exec("SELECT value FROM meta WHERE key='builtAt'");
    return r.length ? String(r[0].values[0][0]) : null;
  }

  status(): IndexStatus {
    const indexed = new Map<string, string>();
    const res = this.db.exec("SELECT path, hash FROM documents");
    if (res.length) for (const [p, h] of res[0].values) indexed.set(String(p), String(h));

    const stale: string[] = [];
    const missing: string[] = [];
    const current = new Set<string>();
    for (const d of this.source.listDocuments()) {
      current.add(d.path);
      const h = indexed.get(d.path);
      if (h === undefined) missing.push(d.path);
      else if (h !== d.hash) stale.push(d.path);
    }
    const orphaned = [...indexed.keys()].filter((p) => !current.has(p));
    const chunks = Number(this.db.exec("SELECT count(*) FROM chunks")[0].values[0][0]);
    return {
      fresh: !stale.length && !missing.length && !orphaned.length,
      indexedDocuments: indexed.size,
      chunks,
      builtAt: this.builtAt,
      stale,
      missing,
      orphaned,
    };
  }

  /** Incrementally (or fully, with `rebuild`) bring the index in sync with the container. */
  update(opts: { rebuild?: boolean; paths?: string[] } & ChunkOptions = {}): IndexStats {
    const t0 = Date.now();
    const stats: IndexStats = { added: 0, updated: 0, removed: 0, unchanged: 0, chunks: 0, durationMs: 0, rebuilt: !!opts.rebuild };
    const db = this.db;
    db.exec("BEGIN");
    try {
      if (opts.rebuild) {
        db.exec("DELETE FROM chunks; DELETE FROM documents; INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');");
      }
      const st = this.status();
      const only = opts.paths ? new Set(opts.paths) : null;
      const docs = this.source.listDocuments();
      const missing = new Set(st.missing);
      const stale = new Set(st.stale);

      for (const p of st.orphaned) {
        if (only && !only.has(p)) continue;
        this.removeDoc(p);
        stats.removed++;
      }
      for (const d of docs) {
        if (only && !only.has(d.path)) continue;
        const isNew = missing.has(d.path);
        if (!isNew && !stale.has(d.path)) {
          stats.unchanged++;
          continue;
        }
        if (!isNew) this.removeDoc(d.path);
        stats.chunks += this.insertDoc(d, opts);
        if (isNew) stats.added++;
        else stats.updated++;
      }
      const changed = stats.added + stats.updated + stats.removed > 0 || opts.rebuild;
      if (changed) {
        db.run("INSERT OR REPLACE INTO meta(key,value) VALUES ('builtAt', ?)", [new Date().toISOString()]);
        this.dirty = true;
      } else if (!this.builtAt) {
        db.run("INSERT OR REPLACE INTO meta(key,value) VALUES ('builtAt', ?)", [new Date().toISOString()]);
        this.dirty = true;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new MdkError("SQLITE", `Index update failed: ${(e as Error).message}`);
    }
    stats.durationMs = Date.now() - t0;
    return stats;
  }

  private removeDoc(path: string): void {
    // FTS4 external content: delete from FTS first (it reads old values from chunks)
    this.db.run("DELETE FROM chunks_fts WHERE docid IN (SELECT id FROM chunks WHERE doc_path = ?)", [path]);
    this.db.run("DELETE FROM chunks WHERE doc_path = ?", [path]);
    this.db.run("DELETE FROM documents WHERE path = ?", [path]);
  }

  private insertDoc(d: DocumentInfo, opts: ChunkOptions): number {
    const md = this.source.readDocument(d.path);
    const tags = d.tags.join(" ");
    this.db.run("INSERT INTO documents(path,id,title,tags,hash) VALUES (?,?,?,?,?)", [d.path, d.id, d.title, tags, d.hash]);
    const chunks = chunkMarkdown(md, opts);
    // index an empty doc by title so it is still discoverable
    if (!chunks.length) chunks.push({ ord: 0, heading: "", level: 0, startLine: 1, endLine: 1, content: "", tokens: 0 });
    const ins = this.db.prepare(
      "INSERT INTO chunks(doc_path,ord,title,tags,heading,level,start_line,end_line,content,tokens) VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    const fts = this.db.prepare("INSERT INTO chunks_fts(docid,title,heading,content,tags) VALUES (?,?,?,?,?)");
    try {
      for (const c of chunks) {
        ins.run([d.path, c.ord, d.title, tags, c.heading, c.level, c.startLine, c.endLine, c.content, c.tokens]);
        const id = Number(this.db.exec("SELECT last_insert_rowid()")[0].values[0][0]);
        fts.run([id, d.title, c.heading, c.content, tags]);
      }
    } finally {
      ins.free();
      fts.free();
    }
    return chunks.length;
  }

  /** Full-text search with BM25 ranking. */
  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = opts.limit ?? 10;
    if (opts.raw) return this.runQuery(query, limit, opts);
    const terms = queryTerms(query);
    if (!terms.length) return [];
    // short terms match exactly; longer ones as prefixes (deploy → deploy*, deployment, …)
    const expr = (op: string) => terms.map((t) => (t.length >= 3 ? `"${t}*"` : `"${t}"`)).join(op);
    if (opts.mode === "or") return this.runQuery(expr(" OR "), limit, opts);
    const hits = this.runQuery(expr(" "), limit, opts);
    if (!hits.length && terms.length > 1) return this.runQuery(expr(" OR "), limit, opts);
    return hits;
  }

  /** All chunks of a document in reading order. */
  documentChunks(path: string): SearchHit[] {
    const stmt = this.db.prepare(
      "SELECT id, doc_path, title, heading, level, start_line, end_line, ord, tokens, content, tags FROM chunks WHERE doc_path = ? ORDER BY ord"
    );
    const out: SearchHit[] = [];
    try {
      stmt.bind([path]);
      while (stmt.step()) {
        const r = stmt.get();
        out.push({
          chunkId: Number(r[0]), path: String(r[1]), title: String(r[2] ?? ""), heading: String(r[3] ?? ""),
          level: Number(r[4]), startLine: Number(r[5]), endLine: Number(r[6]), ord: Number(r[7]),
          tokens: Number(r[8]), content: String(r[9]), tags: splitTags(r[10]), score: 0, snippet: "",
        });
      }
    } finally {
      stmt.free();
    }
    return out;
  }

  private runQuery(match: string, limit: number, opts: SearchOptions): SearchHit[] {
    const docRe = opts.doc ? globToRegExp(opts.doc) : null;
    const wantTags = (opts.tags ?? []).map((t) => t.toLowerCase());
    let stmt;
    try {
      stmt = this.db.prepare(`
        SELECT c.id, c.doc_path, c.title, c.heading, c.level, c.start_line, c.end_line, c.ord, c.tokens,
               snippet(chunks_fts, '«', '»', '…', -1, 24), matchinfo(chunks_fts, 'pcnalx'), c.content, c.tags
        FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.docid
        WHERE chunks_fts MATCH ?`);
    } catch (e) {
      throw new MdkError("SQLITE", (e as Error).message);
    }
    const hits: SearchHit[] = [];
    try {
      stmt.bind([match]);
      while (stmt.step()) {
        const r = stmt.get();
        const path = String(r[1]);
        const tags = splitTags(r[12]);
        if (docRe && !docRe.test(path)) continue;
        if (wantTags.length && !wantTags.every((t) => tags.some((x) => x.toLowerCase() === t))) continue;
        hits.push({
          chunkId: Number(r[0]), path, title: String(r[2] ?? ""), heading: String(r[3] ?? ""),
          level: Number(r[4]), startLine: Number(r[5]), endLine: Number(r[6]), ord: Number(r[7]),
          tokens: Number(r[8]), snippet: String(r[9] ?? ""), score: bm25(r[10] as Uint8Array),
          content: String(r[11]), tags,
        });
      }
    } catch (e) {
      throw new MdkError("SQLITE", `Invalid search query: ${(e as Error).message}`);
    } finally {
      stmt.free();
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  export(): Uint8Array {
    const bytes = this.db.export();
    this.dirty = false;
    return bytes;
  }

  close(): void {
    this.db.close();
  }
}

/** Split a natural-language query into safe FTS terms. */
export function tokenize(query: string): string[] {
  const m = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(m)].slice(0, 32);
}

const STOPWORDS = new Set(
  ("a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our " +
    "should so than that the their them then there these this to us was we what when where which who why will " +
    "with would you your about please tell show find give get").split(" ")
);

/** Tokenize and drop stopwords (unless the query consists only of stopwords). */
export function queryTerms(query: string): string[] {
  const all = tokenize(query);
  const filtered = all.filter((t) => !STOPWORDS.has(t));
  return filtered.length ? filtered : all;
}

function splitTags(v: unknown): string[] {
  return v ? String(v).split(/\s+/).filter(Boolean) : [];
}

/** Okapi BM25 from FTS4 matchinfo('pcnalx'). Higher = better. */
export function bm25(blob: Uint8Array): number {
  const mi = new Uint32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  const p = mi[0];
  const c = mi[1];
  const n = mi[2];
  const avg = 3; // offset of 'a'
  const len = 3 + c; // offset of 'l'
  const x = 3 + 2 * c; // offset of 'x'
  let score = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < c; j++) {
      const base = x + 3 * (i * c + j);
      const tf = mi[base];
      if (!tf) continue;
      const df = mi[base + 2];
      const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);
      const avgLen = mi[avg + j] || 1;
      const docLen = mi[len + j];
      const w = WEIGHTS[j] ?? 1;
      score += w * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * docLen) / avgLen)));
    }
  }
  return Math.round(score * 1e4) / 1e4;
}
