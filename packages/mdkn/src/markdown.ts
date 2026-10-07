/**
 * Markdown utilities built on established libraries:
 *  - markdown-it  : CommonMark tokenizer (headings, fences, setext, block line maps)
 *  - gray-matter  : YAML front matter parse/stringify
 *
 * MDK only adds the knowledge-specific logic on top: heading breadcrumbs,
 * token-bounded chunking and section-aware content insertion.
 */
import MarkdownIt from "markdown-it";
import matter from "gray-matter";
import { MdkError } from "./errors";

const md = new MarkdownIt({ html: true });

type Token = ReturnType<typeof md.parse>[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function detectEol(text: string): "\n" | "\r\n" {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

// ---------------------------------------------------------------------------
// Front matter (gray-matter)
// ---------------------------------------------------------------------------

export interface FrontMatter {
  data: Record<string, unknown>;
  /** markdown without the front-matter block */
  body: string;
  /** number of lines occupied by the front-matter block (0 if none) */
  lineCount: number;
}

export function parseFrontMatter(markdown: string): FrontMatter {
  const src = markdown.replace(/\r\n/g, "\n");
  let parsed: matter.GrayMatterFile<string>;
  try {
    // passing an options object disables gray-matter's global result cache
    parsed = matter(src, {});
  } catch {
    return { data: {}, body: src, lineCount: 0 }; // invalid YAML → treat as plain markdown
  }
  if (!parsed.matter && !src.startsWith("---")) return { data: {}, body: src, lineCount: 0 };
  const body = parsed.content;
  const lineCount = src.endsWith(body) ? splitLines(src).length - splitLines(body).length : 0;
  return { data: (parsed.data ?? {}) as Record<string, unknown>, body, lineCount: Math.max(0, lineCount) };
}

/** Merge `patch` into the document's front matter (creating it if absent). `null` deletes a key. */
export function setFrontMatter(markdown: string, patch: Record<string, unknown>): string {
  const eol = detectEol(markdown);
  const fm = parseFrontMatter(markdown);
  const data: Record<string, unknown> = { ...fm.data };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete data[k];
    else data[k] = v;
  }
  const body = fm.body.replace(/^\n+/, "");
  const out = Object.keys(data).length ? matter.stringify(body, data) : body;
  return eol === "\r\n" ? out.replace(/\r?\n/g, "\r\n") : out;
}

export function extractTags(data: Record<string, unknown>): string[] {
  const raw = data.tags ?? data.tag ?? data.keywords;
  let tags: string[] = [];
  if (Array.isArray(raw)) tags = raw.map((t) => String(t));
  else if (typeof raw === "string") tags = raw.split(/[,\s]+/);
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Tokens (markdown-it)
// ---------------------------------------------------------------------------

export interface Heading {
  level: number;
  text: string;
  /** 0-based line index in the full document (first line of the heading) */
  line: number;
  /** 0-based exclusive end line (setext headings span 2 lines) */
  endLine: number;
}

interface Parsed {
  fm: FrontMatter;
  lines: string[];
  headings: Heading[];
  /** top-level block ranges [start, end) in full-document line numbers */
  blocks: Array<[number, number]>;
}

function parse(markdown: string): Parsed {
  const fm = parseFrontMatter(markdown);
  const lines = splitLines(markdown);
  const tokens: Token[] = md.parse(fm.body, {});
  const off = fm.lineCount;
  const headings: Heading[] = [];
  const blocks: Array<[number, number]> = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level === 0 && t.map && t.nesting !== -1) blocks.push([t.map[0] + off, t.map[1] + off]);
    if (t.type === "heading_open" && t.map) {
      const inline = tokens[i + 1];
      headings.push({
        level: Number(t.tag.slice(1)),
        text: inline?.type === "inline" ? inline.content.trim() : "",
        line: t.map[0] + off,
        endLine: t.map[1] + off,
      });
    }
  }
  return { fm, lines, headings, blocks };
}

export function parseHeadings(markdown: string): Heading[] {
  return parse(markdown).headings;
}

export function extractTitle(markdown: string, fallbackPath: string): string {
  const fm = parseFrontMatter(markdown);
  if (typeof fm.data.title === "string" && fm.data.title.trim()) return fm.data.title.trim();
  const h1 = parseHeadings(markdown).find((h) => h.level === 1 && h.text);
  if (h1) return h1.text;
  const base = fallbackPath.split("/").pop() ?? fallbackPath;
  return base.replace(/\.(md|markdown)$/i, "").replace(/[-_]+/g, " ").trim() || base;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export interface Chunk {
  ord: number;
  /** breadcrumb e.g. "Guide > Install > Linux" ("" for preamble) */
  heading: string;
  level: number;
  /** 1-based inclusive line numbers in the full document */
  startLine: number;
  endLine: number;
  content: string;
  tokens: number;
}

export interface ChunkOptions {
  maxChunkTokens?: number;
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxChunkTokens ?? 512;
  const { fm, lines, headings, blocks } = parse(markdown);

  interface Section { heading: string; level: number; from: number; to: number } // body lines [from, to)
  const sections: Section[] = [];
  const stack: Heading[] = [];
  const firstHeadingLine = headings.length ? headings[0].line : lines.length;
  if (firstHeadingLine > fm.lineCount) {
    sections.push({ heading: "", level: 0, from: fm.lineCount, to: firstHeadingLine });
  }
  headings.forEach((h, idx) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
    sections.push({
      heading: stack.map((s) => s.text).join(" > "),
      level: h.level,
      from: h.endLine,
      to: idx + 1 < headings.length ? headings[idx + 1].line : lines.length,
    });
  });

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const sectionBlocks = blocks.filter(([a]) => a >= s.from && a < s.to);
    for (const [from, to] of splitSection(lines, s.from, s.to, sectionBlocks, maxTokens)) {
      let a = from;
      let b = to;
      while (a < b && lines[a].trim() === "") a++;
      while (b > a && lines[b - 1].trim() === "") b--;
      if (a >= b) continue;
      const content = lines.slice(a, b).join("\n");
      chunks.push({ ord: chunks.length, heading: s.heading, level: s.level, startLine: a + 1, endLine: b, content, tokens: estimateTokens(content) });
    }
  }
  return chunks;
}

/**
 * Split a section into ranges of at most maxTokens, cutting only between
 * markdown-it top-level blocks (so code fences, lists and tables stay intact).
 * A single block larger than the budget is hard-split by lines.
 */
function splitSection(lines: string[], from: number, to: number, blocks: Array<[number, number]>, maxTokens: number): Array<[number, number]> {
  const tok = (a: number, b: number) => estimateTokens(lines.slice(a, b).join("\n"));
  if (tok(from, to) <= maxTokens || !blocks.length) return [[from, to]];

  const out: Array<[number, number]> = [];
  let curFrom = -1;
  let curTo = -1;
  let cur = 0;
  const flush = () => {
    if (curFrom !== -1) out.push([curFrom, curTo]);
    curFrom = -1;
    cur = 0;
  };
  for (const [a, b] of blocks) {
    const t = tok(a, b);
    if (t > maxTokens) {
      flush();
      let s = a;
      let acc = 0;
      for (let i = a; i < b; i++) {
        const lt = estimateTokens(lines[i]) + 1;
        if (acc + lt > maxTokens && i > s) {
          out.push([s, i]);
          s = i;
          acc = 0;
        }
        acc += lt;
      }
      if (s < b) out.push([s, b]);
      continue;
    }
    if (curFrom !== -1 && cur + t > maxTokens) flush();
    if (curFrom === -1) curFrom = a;
    curTo = b;
    cur += t;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Content insertion
// ---------------------------------------------------------------------------

export type InsertPosition = "start" | "end" | "before" | "after" | "replace";

export interface InsertOptions {
  /**
   * Without `section`: "start" (after front matter) or "end" (default).
   * With `section`:
   *   start   – right after the heading
   *   end     – end of the section's own content, before its first sub-heading
   *   after   – after the whole section incl. sub-sections (e.g. add a sibling section)
   *   before  – before the heading
   *   replace – replace the section body (incl. sub-sections), keep the heading
   */
  position?: InsertPosition;
  /** Heading text or breadcrumb ("Install > Linux"), case-insensitive. */
  section?: string;
  /** Insert before this 1-based line (raw insert, no blank-line padding). */
  line?: number;
}

export interface SectionRange {
  heading: Heading;
  /** 0-based index of first line after the heading */
  bodyStart: number;
  /** 0-based exclusive end of own content (first child heading or section end) */
  ownEnd: number;
  /** 0-based exclusive end incl. sub-sections */
  end: number;
}

export function findSection(markdown: string, section: string): SectionRange | null {
  const { headings, lines } = parse(markdown);
  const wanted = section
    .split(">")
    .map((s) => s.replace(/^#+\s*/, "").trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return null;

  const stack: Heading[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
    const tail = stack.map((s) => s.text.toLowerCase()).slice(-wanted.length);
    if (tail.length !== wanted.length || !tail.every((c, k) => c === wanted[k])) continue;

    let end = lines.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        end = headings[j].line;
        break;
      }
    }
    const ownEnd = i + 1 < headings.length ? Math.min(headings[i + 1].line, end) : end;
    return { heading: h, bodyStart: h.endLine, ownEnd, end };
  }
  return null;
}

export function insertContent(markdown: string, text: string, opts: InsertOptions = {}): string {
  const eol = detectEol(markdown);
  const lines = splitLines(markdown);
  const block = splitLines(text.replace(/\s+$/, ""));
  while (block.length && block[0].trim() === "") block.shift();

  if (opts.line !== undefined) {
    const n = Math.floor(opts.line);
    if (!(n >= 1 && n <= lines.length + 1)) {
      throw new MdkError("INVALID_ARGUMENT", `line must be between 1 and ${lines.length + 1}`);
    }
    lines.splice(n - 1, 0, ...block);
    return lines.join(eol);
  }

  const position = opts.position ?? "end";

  if (!opts.section) {
    if (position === "start") {
      const at = parseFrontMatter(markdown).lineCount;
      return padInsert(lines, at, at, block).join(eol);
    }
    if (position === "end") {
      const at = trimBack(lines, lines.length, 0);
      const out = padInsert(lines.slice(0, at), at, at, block);
      out.push("");
      return out.join(eol);
    }
    throw new MdkError("INVALID_ARGUMENT", `position "${position}" requires a section`);
  }

  const sec = findSection(markdown, opts.section);
  if (!sec) throw new MdkError("SECTION_NOT_FOUND", `Section not found: "${opts.section}"`);

  switch (position) {
    case "before":
      return padInsert(lines, sec.heading.line, sec.heading.line, block).join(eol);
    case "start":
      return padInsert(lines, sec.bodyStart, sec.bodyStart, block).join(eol);
    case "end": {
      const at = trimBack(lines, sec.ownEnd, sec.bodyStart);
      return padInsert(lines, at, at, block).join(eol);
    }
    case "after": {
      const at = trimBack(lines, sec.end, sec.bodyStart);
      return padInsert(lines, at, at, block).join(eol);
    }
    case "replace":
      return padInsert(lines, sec.bodyStart, sec.end, block, true).join(eol);
    default:
      throw new MdkError("INVALID_ARGUMENT", `Unknown position "${position}"`);
  }
}

function trimBack(lines: string[], idx: number, min: number): number {
  while (idx > min && lines[idx - 1].trim() === "") idx--;
  return idx;
}

/** Replace lines[from,to) with block, ensuring blank-line separation from neighbours. */
function padInsert(lines: string[], from: number, to: number, block: string[], replacing = false): string[] {
  const before = lines.slice(0, from);
  const after = lines.slice(to);
  const out = [...before];
  if (out.length && out[out.length - 1].trim() !== "") out.push("");
  out.push(...block);
  if (after.length && after[0].trim() !== "") out.push("");
  else if (replacing && after.length === 0) out.push("");
  out.push(...after);
  return out;
}
