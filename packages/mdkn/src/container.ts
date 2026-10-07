import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import JSZip from "jszip";
import { MdkError } from "./errors";
import {
  MIMETYPE,
  Manifest,
  DocumentEntry,
  DocumentInfo,
  createManifest,
  parseManifest,
  INDEX_SCHEMA_VERSION,
} from "./manifest";
import { normalizeDocPath, normalizeFolder, globToRegExp } from "./paths";
import { parseFrontMatter, extractTitle, extractTags, setFrontMatter, insertContent, InsertOptions } from "./markdown";
import { MdkIndex, IndexSource } from "./indexer";
import { getSqlJs } from "./sqlite";

const MANIFEST = "manifest.json";
const DOCS = "docs/";
const INDEX_FILE = "index/index.sqlite";

export interface CreateOptions {
  title?: string;
  description?: string;
  /** overwrite an existing file */
  overwrite?: boolean;
}

export interface WriteOptions {
  title?: string;
  tags?: string[];
  /** fail with ALREADY_EXISTS instead of replacing an existing document */
  noOverwrite?: boolean;
}

export interface ListOptions {
  tag?: string;
  /** glob over doc paths */
  glob?: string;
}

export function hashContent(content: string): string {
  return "sha256:" + createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * An in-memory, mutable view of a `.mdk` container.
 * Mutations are applied in memory; call {@link save} to persist atomically.
 */
export class MdkContainer implements IndexSource {
  private docs = new Map<string, string>();
  /** zip entries we don't manage (assets/*, unknown files) – preserved verbatim */
  private extra = new Map<string, Uint8Array>();
  private indexBytes: Uint8Array | null = null;
  private index: MdkIndex | null = null;
  private _dirty = false;

  private constructor(public filePath: string | null, public manifest: Manifest) {}

  // -------------------------------------------------------------- lifecycle

  static async create(filePath: string, opts: CreateOptions = {}): Promise<MdkContainer> {
    const abs = path.resolve(filePath);
    if (!opts.overwrite && fs.existsSync(abs)) {
      throw new MdkError("ALREADY_EXISTS", `File already exists: ${abs}`);
    }
    const title = opts.title ?? path.basename(abs).replace(/\.mdk$/i, "");
    const c = new MdkContainer(abs, createManifest(randomUUID(), title, opts.description));
    c._dirty = true;
    await c.save();
    return c;
  }

  static async open(filePath: string): Promise<MdkContainer> {
    const abs = path.resolve(filePath);
    let buf: Buffer;
    try {
      buf = await fsp.readFile(abs);
    } catch (e: any) {
      if (e?.code === "ENOENT") throw new MdkError("NOT_FOUND", `Container not found: ${abs}`);
      throw e;
    }
    return MdkContainer.fromBuffer(buf, abs);
  }

  static async fromBuffer(data: Uint8Array, filePath: string | null = null): Promise<MdkContainer> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(data);
    } catch (e) {
      throw new MdkError("INVALID_CONTAINER", `Not a valid .mdk (zip) file: ${(e as Error).message}`);
    }
    const mf = zip.file(MANIFEST);
    if (!mf) throw new MdkError("INVALID_CONTAINER", "Missing manifest.json");
    const manifest = parseManifest(await mf.async("string"));
    const c = new MdkContainer(filePath, manifest);

    const entries = Object.values(zip.files).filter((f) => !f.dir);
    for (const f of entries) {
      if (f.name === MANIFEST || f.name === "mimetype") continue;
      if (f.name === INDEX_FILE) {
        c.indexBytes = await f.async("uint8array");
      } else if (f.name.startsWith(DOCS) && /\.(md|markdown)$/i.test(f.name)) {
        let p: string;
        try {
          p = normalizeDocPath(f.name.slice(DOCS.length));
        } catch {
          continue; // skip unsafe names
        }
        c.docs.set(p, await f.async("string"));
      } else {
        c.extra.set(f.name, await f.async("uint8array"));
      }
    }
    c.reconcile();
    return c;
  }

  /** Make manifest consistent with actual docs (handles containers edited by plain zip tools). */
  private reconcile(): void {
    const now = new Date().toISOString();
    for (const p of Object.keys(this.manifest.documents)) {
      if (!this.docs.has(p)) {
        delete this.manifest.documents[p];
        this._dirty = true;
      }
    }
    for (const [p, content] of this.docs) {
      const entry = this.manifest.documents[p];
      const hash = hashContent(content);
      if (!entry) {
        this.manifest.documents[p] = this.buildEntry(p, content, { id: randomUUID(), createdAt: now, updatedAt: now });
        this._dirty = true;
      } else if (entry.hash !== hash) {
        this.manifest.documents[p] = this.buildEntry(p, content, { id: entry.id || randomUUID(), createdAt: entry.createdAt, updatedAt: now });
        this._dirty = true;
      }
    }
  }

  private buildEntry(p: string, content: string, base: Pick<DocumentEntry, "id" | "createdAt" | "updatedAt">): DocumentEntry {
    const fm = parseFrontMatter(content);
    return {
      ...base,
      title: extractTitle(content, p),
      tags: extractTags(fm.data),
      hash: hashContent(content),
      size: Buffer.byteLength(content, "utf8"),
    };
  }

  /** true if there are unsaved changes */
  get dirty(): boolean {
    return this._dirty || !!this.index?.isDirty;
  }

  /** Serialise the container to a zip buffer. */
  async toBuffer(): Promise<Buffer> {
    if (this.index) {
      this.indexBytes = this.index.export();
      this.manifest.index = { builtAt: this.index.builtAt, schemaVersion: INDEX_SCHEMA_VERSION };
    }
    const zip = new JSZip();
    // mimetype first & uncompressed so the format can be sniffed from the first bytes
    zip.file("mimetype", MIMETYPE, { compression: "STORE" });
    const docs: Record<string, DocumentEntry> = {};
    for (const p of [...this.docs.keys()].sort()) docs[p] = this.manifest.documents[p];
    this.manifest.documents = docs;
    zip.file(MANIFEST, JSON.stringify(this.manifest, null, 2) + "\n");
    for (const p of Object.keys(docs)) zip.file(DOCS + p, this.docs.get(p)!);
    for (const [name, bytes] of this.extra) zip.file(name, bytes);
    if (this.indexBytes) zip.file(INDEX_FILE, this.indexBytes);
    return zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      platform: "UNIX",
    });
  }

  /** Atomically write the container (temp file + rename). */
  async save(filePath?: string): Promise<void> {
    const target = path.resolve(filePath ?? this.filePath ?? "");
    if (!filePath && !this.filePath) throw new MdkError("INVALID_ARGUMENT", "No file path to save to");
    const buf = await this.toBuffer();
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
    await fsp.writeFile(tmp, buf);
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(tmp, target);
        break;
      } catch (e: any) {
        // Windows: target may be briefly locked by another reader/AV scanner
        if (attempt < 5 && (e?.code === "EPERM" || e?.code === "EBUSY" || e?.code === "EACCES")) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }
        await fsp.rm(tmp, { force: true });
        throw e;
      }
    }
    this.filePath = target;
    this._dirty = false;
  }

  // -------------------------------------------------------------- documents

  hasDocument(docPath: string): boolean {
    return this.docs.has(normalizeDocPath(docPath));
  }

  getDocument(docPath: string): DocumentInfo {
    const p = normalizeDocPath(docPath);
    const e = this.manifest.documents[p];
    if (!e || !this.docs.has(p)) throw new MdkError("NOT_FOUND", `Document not found: ${p}`);
    return { path: p, ...e };
  }

  listDocuments(opts: ListOptions = {}): DocumentInfo[] {
    const re = opts.glob ? globToRegExp(opts.glob) : null;
    const tag = opts.tag?.toLowerCase();
    return [...this.docs.keys()]
      .sort()
      .map((p) => ({ path: p, ...this.manifest.documents[p] }))
      .filter((d) => (!re || re.test(d.path)) && (!tag || d.tags.some((t) => t.toLowerCase() === tag)));
  }

  /** Folders (derived from document paths). */
  listFolders(): string[] {
    const set = new Set<string>();
    for (const p of this.docs.keys()) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
    }
    return [...set].sort();
  }

  readDocument(docPath: string): string {
    const p = normalizeDocPath(docPath);
    const c = this.docs.get(p);
    if (c === undefined) throw new MdkError("NOT_FOUND", `Document not found: ${p}`);
    return c;
  }

  /** Create or replace a document. `title`/`tags` are written into the YAML front matter. */
  writeDocument(docPath: string, markdown: string, opts: WriteOptions = {}): DocumentInfo {
    const p = normalizeDocPath(docPath);
    const existing = this.manifest.documents[p];
    if (existing && this.docs.has(p) && opts.noOverwrite) {
      throw new MdkError("ALREADY_EXISTS", `Document already exists: ${p}`);
    }
    let content = markdown;
    if (opts.title !== undefined || opts.tags !== undefined) {
      content = setFrontMatter(content, {
        title: opts.title,
        tags: opts.tags && opts.tags.length ? opts.tags : opts.tags ? null : undefined,
      });
    }
    const now = new Date().toISOString();
    if (existing && this.docs.get(p) === content) return { path: p, ...existing };
    this.docs.set(p, content);
    this.manifest.documents[p] = this.buildEntry(p, content, {
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.touch();
    return { path: p, ...this.manifest.documents[p] };
  }

  /** Insert text into an existing document (see {@link InsertOptions}). */
  insertContent(docPath: string, text: string, opts: InsertOptions = {}): DocumentInfo {
    const p = normalizeDocPath(docPath);
    const current = this.readDocument(p);
    return this.writeDocument(p, insertContent(current, text, opts));
  }

  deleteDocument(docPath: string): void {
    const p = normalizeDocPath(docPath);
    if (!this.docs.has(p)) throw new MdkError("NOT_FOUND", `Document not found: ${p}`);
    this.docs.delete(p);
    delete this.manifest.documents[p];
    this.touch();
  }

  /** Delete every document under a folder. Returns deleted paths. */
  deleteFolder(folder: string): string[] {
    const f = normalizeFolder(folder);
    const removed = [...this.docs.keys()].filter((p) => p.startsWith(f + "/"));
    for (const p of removed) this.deleteDocument(p);
    return removed;
  }

  renameDocument(from: string, to: string): DocumentInfo {
    const a = normalizeDocPath(from);
    const b = normalizeDocPath(to);
    if (a === b) return this.getDocument(a);
    const content = this.readDocument(a);
    if (this.docs.has(b)) throw new MdkError("ALREADY_EXISTS", `Document already exists: ${b}`);
    const entry = this.manifest.documents[a];
    this.docs.delete(a);
    delete this.manifest.documents[a];
    this.docs.set(b, content);
    this.manifest.documents[b] = { ...this.buildEntry(b, content, entry), updatedAt: new Date().toISOString() };
    this.touch();
    return { path: b, ...this.manifest.documents[b] };
  }

  /** Recursively import *.md / *.markdown files from a directory. */
  async importDirectory(dir: string, opts: { prefix?: string; noOverwrite?: boolean } = {}): Promise<DocumentInfo[]> {
    const root = path.resolve(dir);
    const prefix = normalizeFolder(opts.prefix);
    const out: DocumentInfo[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
        if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) await walk(full);
        else if (ent.isFile() && /\.(md|markdown)$/i.test(ent.name)) {
          const rel = path.relative(root, full).split(path.sep).join("/");
          const docPath = prefix ? `${prefix}/${rel}` : rel;
          if (opts.noOverwrite && this.hasDocument(docPath)) continue;
          out.push(this.writeDocument(docPath, await fsp.readFile(full, "utf8")));
        }
      }
    };
    await walk(root);
    return out;
  }

  /** Extract all documents (and assets) into a directory. */
  async exportTo(dir: string): Promise<string[]> {
    const root = path.resolve(dir);
    const written: string[] = [];
    for (const [p, content] of this.docs) {
      const target = path.join(root, ...p.split("/"));
      if (!target.startsWith(root)) continue; // zip-slip guard
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, "utf8");
      written.push(target);
    }
    for (const [name, bytes] of this.extra) {
      if (!name.startsWith("assets/")) continue;
      const target = path.join(root, ...name.split("/"));
      if (!target.startsWith(root) || name.includes("..")) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, bytes);
      written.push(target);
    }
    return written;
  }

  setInfo(info: { title?: string; description?: string }): void {
    if (info.title !== undefined) this.manifest.title = info.title;
    if (info.description !== undefined) this.manifest.description = info.description;
    this.touch();
  }

  private touch(): void {
    this.manifest.updatedAt = new Date().toISOString();
    this._dirty = true;
  }

  // -------------------------------------------------------------- index

  /** Load (or create) the embedded SQLite search index. */
  async getIndex(): Promise<MdkIndex> {
    if (!this.index) {
      const SQL = await getSqlJs();
      this.index = await MdkIndex.load(SQL, this, this.indexBytes);
    }
    return this.index;
  }

  /** true if the container contains a persisted index file */
  get hasPersistedIndex(): boolean {
    return !!this.indexBytes;
  }

  /** Drop the index entirely (it will be removed from the file on next save). */
  dropIndex(): void {
    this.index?.close();
    this.index = null;
    this.indexBytes = null;
    this.manifest.index = { builtAt: null, schemaVersion: INDEX_SCHEMA_VERSION };
    this._dirty = true;
  }

  close(): void {
    this.index?.close();
    this.index = null;
  }
}
