#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command, Option } from "commander";
import {
  MdkContainer,
  MdkError,
  retrieve,
  formatRetrieveMarkdown,
  InsertPosition,
  DocumentInfo,
} from "./index";
import { print, hint, fail, table, readStdin, OutputOptions } from "./cli-output";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../package.json");

type Opts = OutputOptions & Record<string, any>;

const program = new Command();
program
  .name("mdkn")
  .description("Markdown Knowledge (.mdk) – single-file Markdown knowledge base with built-in SQLite search.\nCommands can be run with either 'mdkn' or 'mdk'.\nEvery command accepts --json for machine-readable output (ideal for AI agents).")
  .version(pkg.version)
  .showHelpAfterError();

/** Register a command with the shared --json flag and uniform error handling. */
function cmd(name: string, description: string) {
  return program.command(name).description(description).option("--json", "machine-readable JSON output");
}

function action<A extends unknown[]>(fn: (...args: [...A, Opts]) => Promise<void>) {
  return async (...args: unknown[]) => {
    // commander passes (...positionals, options, command)
    const opts = args[args.length - 2] as Opts;
    try {
      await fn(...(args.slice(0, -1) as [...A, Opts]));
    } catch (e) {
      fail(opts, e);
    }
  };
}

async function contentFrom(opts: Opts, required = true): Promise<string | undefined> {
  const sources = [opts.content !== undefined, !!opts.file, !!opts.stdin].filter(Boolean).length;
  if (sources > 1) throw new MdkError("INVALID_ARGUMENT", "Use only one of --content, --file, --stdin");
  if (opts.content !== undefined) return String(opts.content).replace(/\\n/g, "\n");
  if (opts.file === "-" || opts.stdin) return readStdin();
  if (opts.file) return fs.readFileSync(path.resolve(opts.file), "utf8");
  if (required) throw new MdkError("INVALID_ARGUMENT", "Provide content with --content, --file <path> or --stdin");
  return undefined;
}

const parseTags = (v?: string) => (v ? v.split(",").map((t) => t.trim()).filter(Boolean) : undefined);

/** After a mutation: optionally refresh the index, then save. */
async function commit(c: MdkContainer, opts: Opts): Promise<{ indexed?: unknown }> {
  let indexed: unknown;
  if (opts.index) indexed = (await c.getIndex()).update();
  await c.save();
  return indexed ? { indexed } : {};
}

function docLine(d: DocumentInfo) {
  return `${d.path}  (${d.title}${d.tags.length ? `; tags: ${d.tags.join(", ")}` : ""})`;
}

// ---------------------------------------------------------------- init / info

cmd("init <container>", "create a new empty .mdk container")
  .option("-t, --title <title>", "container title")
  .option("-d, --description <text>", "container description")
  .option("-f, --force", "overwrite if the file exists")
  .action(action(async (file: string, opts: Opts) => {
    const target = /\.mdk$/i.test(file) ? file : `${file}.mdk`;
    const c = await MdkContainer.create(target, { title: opts.title, description: opts.description, overwrite: !!opts.force });
    print(opts, { file: c.filePath, manifest: c.manifest }, () => `Created ${c.filePath}`);
  }));

cmd("info <container>", "show container metadata and index freshness")
  .action(action(async (file: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const docs = c.listDocuments();
    const st = (await c.getIndex()).status();
    const data = {
      file: c.filePath, id: c.manifest.id, title: c.manifest.title, description: c.manifest.description,
      createdAt: c.manifest.createdAt, updatedAt: c.manifest.updatedAt,
      documents: docs.length, folders: c.listFolders().length,
      bytes: docs.reduce((n, d) => n + d.size, 0),
      tags: [...new Set(docs.flatMap((d) => d.tags))].sort(),
      index: { persisted: c.hasPersistedIndex, ...st },
    };
    print(opts, data, () => {
      const idx = !c.hasPersistedIndex ? "not built (run: mdk index)" : st.fresh ? `fresh, ${st.chunks} chunks, built ${st.builtAt}`
        : `STALE – ${st.stale.length} changed, ${st.missing.length} new, ${st.orphaned.length} removed (run: mdk index)`;
      return table([
        ["Title", data.title], ["File", String(data.file)], ["Documents", String(data.documents)],
        ["Size", `${data.bytes} bytes`], ["Tags", data.tags.join(", ") || "-"], ["Updated", data.updatedAt], ["Index", idx],
      ]);
    });
  }));

// ---------------------------------------------------------------- read

cmd("ls <container> [glob]", "list documents (optionally filtered by glob, e.g. 'guides/**')")
  .option("--tag <tag>", "only documents with this tag")
  .action(action(async (file: string, glob: string | undefined, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const docs = c.listDocuments({ glob, tag: opts.tag });
    print(opts, docs, () => docs.length
      ? table([["PATH", "TITLE", "TAGS", "SIZE"], ...docs.map((d) => [d.path, d.title, d.tags.join(","), String(d.size)])])
      : "(no documents)");
  }));

cmd("cat <container> <doc>", "print a document")
  .option("--no-frontmatter", "strip YAML front matter")
  .option("--lines <range>", "only print lines, e.g. 10-40")
  .action(action(async (file: string, doc: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const info = c.getDocument(doc);
    let content = c.readDocument(doc);
    if (opts.frontmatter === false) {
      const { parseFrontMatter } = await import("./index");
      content = parseFrontMatter(content).body.replace(/^\n+/, "");
    }
    if (opts.lines) {
      const [a, b] = String(opts.lines).split("-").map(Number);
      content = content.split(/\r?\n/).slice(Math.max(0, a - 1), b || undefined).join("\n");
    }
    print(opts, { ...info, content }, () => content);
  }));

// ---------------------------------------------------------------- write

cmd("add <container> <doc>", "insert a new document (or replace with --force)")
  .option("-c, --content <markdown>", "document content (\\n is expanded)")
  .option("-f, --file <path>", "read content from a file ('-' for stdin)")
  .option("--stdin", "read content from stdin")
  .option("-t, --title <title>", "set title (front matter)")
  .option("--tags <a,b>", "set tags (front matter)")
  .option("--force", "replace the document if it already exists")
  .option("--index", "update the search index in the same write")
  .action(action(async (file: string, doc: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    let content = await contentFrom(opts, false);
    if (content === undefined) content = opts.title ? `# ${opts.title}\n` : "";
    const info = c.writeDocument(doc, content, { title: opts.title, tags: parseTags(opts.tags), noOverwrite: !opts.force });
    const extra = await commit(c, opts);
    print(opts, { document: info, ...extra }, () => `Added ${docLine(info)}`);
  }));

cmd("insert <container> <doc>", "insert content into an existing document")
  .option("-c, --content <markdown>", "content to insert (\\n is expanded)")
  .option("-f, --file <path>", "read content from a file ('-' for stdin)")
  .option("--stdin", "read content from stdin")
  .option("-s, --section <heading>", "target section by heading text or breadcrumb ('Install > Linux')")
  .addOption(new Option("-p, --position <pos>", "where to insert").choices(["start", "end", "before", "after", "replace"]))
  .option("-l, --line <n>", "insert before 1-based line n", (v) => parseInt(v, 10))
  .option("--create", "create the document if it does not exist")
  .option("--index", "update the search index in the same write")
  .addHelpText("after", `
Positions:
  (no --section)  start = after front matter | end = end of document (default)
  with --section  start   = right after the heading
                  end     = end of the section's own text (before sub-headings)
                  after   = after the whole section incl. sub-sections
                  before  = before the heading
                  replace = replace the section body, keep the heading

Examples:
  mdk insert kb.mdk guides/deploy --section "Kubernetes" --content "- run helm upgrade"
  echo "## FAQ" | mdk insert kb.mdk guides/deploy --stdin --position end`)
  .action(action(async (file: string, doc: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const text = (await contentFrom(opts))!;
    let info: DocumentInfo;
    if (!c.hasDocument(doc) && opts.create) info = c.writeDocument(doc, text);
    else info = c.insertContent(doc, text, { section: opts.section, position: opts.position as InsertPosition, line: opts.line });
    const extra = await commit(c, opts);
    print(opts, { document: info, ...extra }, () => `Updated ${docLine(info)}`);
  }));

cmd("rm <container> <doc...>", "delete one or more documents")
  .option("--index", "update the search index in the same write")
  .action(action(async (file: string, docs: string[], opts: Opts) => {
    const c = await MdkContainer.open(file);
    for (const d of docs) c.deleteDocument(d);
    const extra = await commit(c, opts);
    print(opts, { deleted: docs, ...extra }, () => `Deleted ${docs.length} document(s)`);
  }));

cmd("mv <container> <from> <to>", "rename / move a document")
  .option("--index", "update the search index in the same write")
  .action(action(async (file: string, from: string, to: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const info = c.renameDocument(from, to);
    const extra = await commit(c, opts);
    print(opts, { document: info, ...extra }, () => `Moved to ${info.path}`);
  }));

cmd("import <container> <dir>", "bulk-import all .md files from a directory")
  .option("--prefix <folder>", "place imported docs under this folder")
  .option("--skip-existing", "do not overwrite documents that already exist")
  .option("--index", "update the search index in the same write")
  .action(action(async (file: string, dir: string, opts: Opts) => {
    const c = fs.existsSync(file) ? await MdkContainer.open(file) : await MdkContainer.create(file);
    const docs = await c.importDirectory(dir, { prefix: opts.prefix, noOverwrite: !!opts.skipExisting });
    const extra = await commit(c, opts);
    print(opts, { imported: docs.map((d) => d.path), ...extra }, () => `Imported ${docs.length} document(s)`);
  }));

cmd("export <container> <dir>", "extract all documents to a directory")
  .action(action(async (file: string, dir: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const files = await c.exportTo(dir);
    print(opts, { exported: files }, () => `Exported ${files.length} file(s) to ${path.resolve(dir)}`);
  }));

// ---------------------------------------------------------------- index / search

cmd("index <container>", "build or refresh the SQLite full-text index stored inside the .mdk")
  .option("--rebuild", "drop and rebuild the whole index")
  .option("--status", "only report index freshness, don't modify")
  .option("--max-chunk-tokens <n>", "max tokens per chunk (default 512)", (v) => parseInt(v, 10))
  .action(action(async (file: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const idx = await c.getIndex();
    if (opts.status) {
      const st = idx.status();
      print(opts, st, () => st.fresh ? `Index is fresh (${st.chunks} chunks)` : `Index is stale: ${JSON.stringify({ stale: st.stale, missing: st.missing, orphaned: st.orphaned })}`);
      return;
    }
    const stats = idx.update({ rebuild: !!opts.rebuild, maxChunkTokens: opts.maxChunkTokens });
    await c.save();
    const st = idx.status();
    print(opts, { ...stats, totalChunks: st.chunks, documents: st.indexedDocuments }, () =>
      `Indexed ${st.indexedDocuments} document(s), ${st.chunks} chunks ` +
      `(+${stats.added} ~${stats.updated} -${stats.removed} =${stats.unchanged}) in ${stats.durationMs} ms`);
  }));

/** Open container + index, refreshing a stale index in memory. */
async function openForQuery(file: string, opts: Opts) {
  const c = await MdkContainer.open(file);
  const idx = await c.getIndex();
  const st = idx.status();
  let refreshed = false;
  if (!st.fresh) {
    idx.update();
    refreshed = true;
    hint(opts, `note: index was stale and refreshed in memory – run "mdk index ${file}" to persist`);
  }
  return { c, idx, refreshed };
}

const searchOptions = (c: Command) =>
  c.option("-n, --limit <n>", "max results", (v) => parseInt(v, 10))
    .option("--doc <glob>", "restrict to document paths matching glob")
    .option("--tag <tag...>", "require tag(s)")
    .option("--raw", "pass query as raw FTS syntax (NEAR, OR, \"phrase\", prefix*, heading:term)")
    .addOption(new Option("--mode <mode>", "term matching").choices(["and", "or"]));

searchOptions(cmd("search <container> <query...>", "full-text search (BM25 ranked)"))
  .action(action(async (file: string, query: string[], opts: Opts) => {
    const { idx, refreshed } = await openForQuery(file, opts);
    const q = query.join(" ");
    const hits = idx.search(q, { limit: opts.limit ?? 10, doc: opts.doc, tags: opts.tag, raw: opts.raw, mode: opts.mode });
    print(opts, { query: q, indexRefreshed: refreshed, hits: hits.map(({ content, ...h }) => h) }, () => {
      if (!hits.length) return "No results.";
      return hits.map((h, i) =>
        `${i + 1}. ${h.path}:${h.startLine}  ${h.heading || h.title}  \x1b[2m(score ${h.score.toFixed(2)})\x1b[0m\n   ${h.snippet.replace(/\s+/g, " ")}`
      ).join("\n");
    });
  }));

searchOptions(cmd("retrieve <container> <query...>", "retrieve token-budgeted context for an AI prompt"))
  .option("-m, --max-tokens <n>", "token budget (default 4000)", (v) => parseInt(v, 10))
  .addOption(new Option("-e, --expand <mode>", "return matching sections or whole documents").choices(["section", "document"]).default("section"))
  .action(action(async (file: string, query: string[], opts: Opts) => {
    const { c, refreshed } = await openForQuery(file, opts);
    const r = await retrieve(c, query.join(" "), {
      maxTokens: opts.maxTokens, limit: opts.limit, expand: opts.expand,
      doc: opts.doc, tags: opts.tag, raw: opts.raw, mode: opts.mode,
    });
    print(opts, { ...r, indexRefreshed: refreshed }, () => (r.items.length ? formatRetrieveMarkdown(r) : "No results."));
  }));

cmd("outline <container> <doc>", "show the heading structure of a document (useful before 'insert --section')")
  .action(action(async (file: string, doc: string, opts: Opts) => {
    const c = await MdkContainer.open(file);
    const { parseHeadings } = await import("./index");
    const hs = parseHeadings(c.readDocument(doc)).map((h) => ({ level: h.level, text: h.text, line: h.line + 1 }));
    print(opts, hs, () => hs.map((h) => `${"  ".repeat(h.level - 1)}${"#".repeat(h.level)} ${h.text}  \x1b[2mL${h.line}\x1b[0m`).join("\n") || "(no headings)");
  }));

program.parseAsync(process.argv).catch((e) => fail({}, e));
