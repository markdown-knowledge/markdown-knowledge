import { MdkError } from "./errors";

export const MIMETYPE = "application/vnd.markdown-knowledge+zip";
export const FORMAT_VERSION = 1;
export const INDEX_SCHEMA_VERSION = 1;

export interface DocumentEntry {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  hash: string;
  size: number;
}

export interface DocumentInfo extends DocumentEntry {
  path: string;
}

export interface Manifest {
  format: "mdk";
  formatVersion: number;
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  documents: Record<string, DocumentEntry>;
  index: {
    builtAt: string | null;
    schemaVersion: number;
  };
}

export function createManifest(id: string, title: string, description = ""): Manifest {
  const now = new Date().toISOString();
  return {
    format: "mdk",
    formatVersion: FORMAT_VERSION,
    id,
    title,
    description,
    createdAt: now,
    updatedAt: now,
    documents: {},
    index: { builtAt: null, schemaVersion: INDEX_SCHEMA_VERSION },
  };
}

export function parseManifest(json: string): Manifest {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new MdkError("INVALID_CONTAINER", `manifest.json is not valid JSON: ${(e as Error).message}`);
  }
  if (!raw || raw.format !== "mdk") {
    throw new MdkError("INVALID_CONTAINER", "manifest.json: missing or wrong \"format\" (expected \"mdk\")");
  }
  if (typeof raw.formatVersion !== "number" || raw.formatVersion > FORMAT_VERSION) {
    throw new MdkError(
      "UNSUPPORTED_VERSION",
      `Container formatVersion ${raw.formatVersion} is not supported (max ${FORMAT_VERSION})`
    );
  }
  const m: Manifest = {
    format: "mdk",
    formatVersion: raw.formatVersion,
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    documents: {},
    index: {
      builtAt: raw.index?.builtAt ?? null,
      schemaVersion: Number(raw.index?.schemaVersion ?? INDEX_SCHEMA_VERSION),
    },
  };
  for (const [p, d] of Object.entries<any>(raw.documents ?? {})) {
    m.documents[p] = {
      id: String(d.id ?? ""),
      title: String(d.title ?? p),
      tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
      createdAt: String(d.createdAt ?? m.createdAt),
      updatedAt: String(d.updatedAt ?? m.updatedAt),
      hash: String(d.hash ?? ""),
      size: Number(d.size ?? 0),
    };
  }
  return m;
}
