import { MdkError } from "./errors";

export interface OutputOptions {
  json?: boolean;
}

export function print(opts: OutputOptions, data: unknown, human: () => string | void): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    const s = human();
    if (s !== undefined) process.stdout.write(s.endsWith("\n") ? s : s + "\n");
  }
}

export function hint(opts: OutputOptions, msg: string): void {
  if (!opts.json && process.stderr.isTTY !== false) process.stderr.write(`\x1b[2m${msg}\x1b[0m\n`);
}

export function fail(opts: OutputOptions, err: unknown): never {
  const code = err instanceof MdkError ? err.code : "ERROR";
  const message = err instanceof Error ? err.message : String(err);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ error: { code, message } }, null, 2) + "\n");
  } else {
    process.stderr.write(`mdk: ${message}${code !== "ERROR" ? ` [${code}]` : ""}\n`);
  }
  process.exit(1);
}

export function table(rows: string[][]): string {
  if (!rows.length) return "";
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  ")).join("\n");
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return reject(new MdkError("INVALID_ARGUMENT", "--stdin given but nothing is piped to stdin"));
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
