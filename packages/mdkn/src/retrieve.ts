import type { MdkContainer } from "./container";
import type { SearchHit, SearchOptions } from "./indexer";
import { parseFrontMatter, estimateTokens } from "./markdown";

export interface RetrieveOptions extends Omit<SearchOptions, "limit"> {
  /** token budget for the returned context (default 4000) */
  maxTokens?: number;
  /** max number of candidate chunks considered (default 30) */
  limit?: number;
  /** "section" (default) returns matching chunks, "document" returns whole documents of top hits */
  expand?: "section" | "document";
}

export interface RetrievedItem {
  path: string;
  title: string;
  heading: string;
  startLine: number;
  endLine: number;
  score: number;
  tokens: number;
  content: string;
  truncated?: boolean;
}

export interface RetrieveResult {
  query: string;
  tokens: number;
  maxTokens: number;
  expand: "section" | "document";
  items: RetrievedItem[];
}

/**
 * Build a token-budgeted context bundle for an AI model.
 * Assumes the index is up to date (call `index.update()` first if needed).
 */
export async function retrieve(container: MdkContainer, query: string, opts: RetrieveOptions = {}): Promise<RetrieveResult> {
  const maxTokens = opts.maxTokens ?? 4000;
  const expand = opts.expand ?? "section";
  const index = await container.getIndex();
  const hits = index.search(query, { ...opts, limit: opts.limit ?? 30 });
  const items: RetrievedItem[] = [];
  let used = 0;

  if (expand === "document") {
    const seen = new Set<string>();
    for (const h of hits) {
      if (seen.has(h.path)) continue;
      seen.add(h.path);
      const body = parseFrontMatter(container.readDocument(h.path)).body.trim();
      const t = estimateTokens(body);
      const remaining = maxTokens - used;
      if (remaining <= 50) break;
      if (t <= remaining) {
        items.push(docItem(h, body, t));
        used += t;
      } else if (!items.length) {
        // always return something: truncate the best document to the budget
        const cut = body.slice(0, remaining * 4);
        items.push({ ...docItem(h, cut, estimateTokens(cut)), truncated: true });
        used += estimateTokens(cut);
        break;
      }
    }
  } else {
    const picked: SearchHit[] = [];
    for (const h of hits) {
      if (used + h.tokens > maxTokens) continue; // try smaller chunks further down
      picked.push(h);
      used += h.tokens;
    }
    if (!picked.length && hits.length) {
      const h = hits[0];
      const cut = h.content.slice(0, maxTokens * 4);
      picked.push({ ...h, content: cut, tokens: estimateTokens(cut) });
      used = estimateTokens(cut);
    }
    // group by document (in order of best score), reading order within a doc
    const order: string[] = [];
    for (const h of picked) if (!order.includes(h.path)) order.push(h.path);
    for (const p of order) {
      for (const h of picked.filter((x) => x.path === p).sort((a, b) => a.ord - b.ord)) {
        items.push({
          path: h.path, title: h.title, heading: h.heading, startLine: h.startLine, endLine: h.endLine,
          score: h.score, tokens: h.tokens, content: h.content,
          ...(h.content.length < (hits.find((x) => x.chunkId === h.chunkId)?.content.length ?? 0) ? { truncated: true } : {}),
        });
      }
    }
  }
  return { query, tokens: used, maxTokens, expand, items };
}

function docItem(h: SearchHit, content: string, tokens: number): RetrievedItem {
  return { path: h.path, title: h.title, heading: "", startLine: 1, endLine: content.split("\n").length, score: h.score, tokens, content };
}

/** Render a retrieve result as Markdown context suitable for pasting into a prompt. */
export function formatRetrieveMarkdown(r: RetrieveResult): string {
  const out = [`<!-- mdk:retrieve query=${JSON.stringify(r.query)} tokens=${r.tokens} items=${r.items.length} -->`];
  for (const it of r.items) {
    const parts = it.heading ? it.heading.split(" > ") : [];
    if (parts[0] === it.title) parts.shift();
    const crumb = [it.title, ...parts].join(" › ");
    out.push("", `## [${it.path}#L${it.startLine}-L${it.endLine}] ${crumb}`, "", it.content + (it.truncated ? "\n\n…(truncated)" : ""));
  }
  return out.join("\n") + "\n";
}
