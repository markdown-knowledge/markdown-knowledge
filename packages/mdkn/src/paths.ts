import { MdkError } from "./errors";

/**
 * Normalise a document path (relative to `docs/`).
 *  - converts backslashes to `/`
 *  - strips leading `./` and `/`
 *  - appends `.md` if no markdown extension present
 *  - rejects `..`, empty segments and control characters (zip-slip safety)
 */
export function normalizeDocPath(input: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new MdkError("INVALID_PATH", "Document path must be a non-empty string");
  }
  let p = input.trim().replace(/\\/g, "/");
  p = p.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  if (p.startsWith("docs/")) p = p.slice(5);

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new MdkError("INVALID_PATH", `Invalid document path: "${input}"`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f<>:"|?*]/.test(seg)) {
      throw new MdkError("INVALID_PATH", `Illegal character in document path: "${input}"`);
    }
  }
  if (!/\.(md|markdown)$/i.test(p)) p += ".md";
  return p;
}

/** Normalise a folder prefix (may be empty). */
export function normalizeFolder(input: string | undefined): string {
  if (!input) return "";
  const p = input.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (p === "") return "";
  for (const seg of p.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new MdkError("INVALID_PATH", `Invalid folder: "${input}"`);
    }
  }
  return p;
}

/** Minimal glob → RegExp (`*` within a segment, `**` across segments, `?`). */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  const g = glob.replace(/\\/g, "/");
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        re += ".*";
        i++;
        if (g[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}
