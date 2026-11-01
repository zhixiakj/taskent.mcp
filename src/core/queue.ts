import fs from "node:fs";
import path from "node:path";
import { deadLetterFile, ensureHome, flushLockDir, queueFile } from "./paths.js";
import type { QueueLine, TaskItem } from "./types.js";

export function appendItems(items: TaskItem[]): number {
  if (items.length === 0) return 0;
  ensureHome();
  const chunk = items
    .map((item) => JSON.stringify({ v: 1, ts: new Date().toISOString(), item }))
    .join("\n") + "\n";
  fs.appendFileSync(queueFile(), chunk, "utf8");
  return items.length;
}

export function readLines(file = queueFile()): { raw: string; line: QueueLine | null }[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((raw) => {
      try {
        const line = JSON.parse(raw) as QueueLine;
        if (!line || typeof line !== "object" || !line.item?.taskId) return { raw, line: null };
        return { raw, line };
      } catch {
        return { raw, line: null };
      }
    });
}

export function queueDepth(): number {
  return readLines().filter((l) => l.line !== null).length;
}

// After a successful batch, rewrite without the first n valid lines and discard corrupt lines.
export function dropFirstN(n: number): void {
  const file = queueFile();
  const lines = readLines(file);
  let remaining = n;
  const kept: string[] = [];
  for (const { raw, line } of lines) {
    if (line === null) continue;
    if (remaining > 0) {
      remaining--;
      continue;
    }
    kept.push(raw);
  }
  fs.writeFileSync(file, kept.length > 0 ? kept.join("\n") + "\n" : "", "utf8");
}

export function appendDeadLetters(lines: string[]): void {
  if (lines.length === 0) return;
  fs.appendFileSync(deadLetterFile(), lines.join("\n") + "\n", "utf8");
}

export interface FlushLock {
  release(): void;
}

// Atomic mkdir lock with a pid and stale takeover (architecture.md §9.4) prevents
// concurrent replay by the MCP process and hook-spawned flush children.
export function acquireFlushLock(staleMs = 120_000): FlushLock | null {
  const dir = flushLockDir();
  ensureHome(); // Ensure the parent exists; non-recursive mkdir keeps locking atomic.
  const tryAcquire = (): boolean => {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
      return true;
    } catch {
      return false;
    }
  };
  if (tryAcquire()) {
    return {
      release() {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {}
      },
    };
  }
  let stale: boolean;
  try {
    stale = Date.now() - fs.statSync(dir).mtimeMs >= staleMs;
  } catch {
    stale = true; // The holder released it during this check, so takeover is safe.
  }
  if (!stale) return null;
  // Rebuild a stale lock whose previous holder may have crashed or hung.
  fs.rmSync(dir, { recursive: true, force: true });
  if (!tryAcquire()) return null;
  return {
    release() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}
