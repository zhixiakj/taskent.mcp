import fs from "node:fs";
import path from "node:path";
import type { Json } from "./harness.js";

export type ReadJsonResult =
  | { status: "missing" }
  | { status: "ok"; doc: Json }
  | { status: "invalid"; error: string };

// Missing file is normal (we start from {}); anything unparsable must abort
// the write — never overwrite a file we could not read.
export function readJsonFile(file: string): ReadJsonResult {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { status: "missing" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "invalid", error: "not a JSON object" };
    }
    return { status: "ok", doc: parsed as Json };
  } catch (err) {
    return { status: "invalid", error: err instanceof Error ? err.message : String(err) };
  }
}

// tmp + rename; preserves the original file's mode, new files get 0600.
function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // new file
  }
  const tmp = `${file}.taskent-tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, doc: unknown): void {
  writeAtomic(file, JSON.stringify(doc, null, 2) + "\n");
}

export function writeTextAtomic(file: string, text: string): void {
  writeAtomic(file, text);
}

// Raw text read; null when the file does not exist.
export function readTextFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Timestamped sibling copy made before every write; returns null when the
// file does not exist yet (nothing to back up).
export function backupFile(file: string): string | null {
  try {
    fs.accessSync(file);
  } catch {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHmmss
  const bak = `${file}.taskent-bak-${stamp}`;
  fs.copyFileSync(file, bak);
  return bak;
}
