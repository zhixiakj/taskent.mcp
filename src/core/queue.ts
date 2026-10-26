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

// 批量成功后重写文件：去掉前 sentCount 行有效行；损坏行在重写时一并丢弃（不重发也不积压）
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

// mkdir 原子锁 + pid + 过期抢占（architecture.md §9.4）：防止 MCP 长驻与 hook 派生的
// flush 子进程并发重放；at-least-once 投递由服务端 upsert 幂等兜底
export function acquireFlushLock(staleMs = 120_000): FlushLock | null {
  const dir = flushLockDir();
  ensureHome(); // 幂确保父目录；锁目录本身仍用非递归 mkdir 保证原子性
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
    stale = true; // 竞态消失（持有者刚释放）：视作可抢占
  }
  if (!stale) return null;
  // 过期锁：抢占重建（可能的上一个持有者已死或卡死）
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
