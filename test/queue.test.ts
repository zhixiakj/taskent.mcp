import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireFlushLock, appendItems, dropFirstN, readLines } from "../src/core/queue.js";
import type { TaskItem } from "../src/core/types.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "taskent-test-"));
  process.env.TASKENT_HOME = tmp;
});

afterEach(() => {
  delete process.env.TASKENT_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function item(taskId: string): TaskItem {
  return {
    v: 1,
    taskId,
    project: { slug: "demo", name: "demo" },
    title: taskId,
    status: "doing",
    agent: { harness: "zcode" },
    source: "mcp",
  };
}

describe("queue", () => {
  it("append then read back", () => {
    appendItems([item("demo:a"), item("demo:b")]);
    const lines = readLines().filter((l) => l.line !== null);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.line!.item.taskId).toBe("demo:a");
  });

  it("dropFirstN removes only the first N valid lines", () => {
    appendItems([item("demo:a"), item("demo:b"), item("demo:c")]);
    dropFirstN(2);
    const lines = readLines().filter((l) => l.line !== null);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line!.item.taskId).toBe("demo:c");
  });

  it("malformed lines are dropped on rewrite", () => {
    appendItems([item("demo:a")]);
    const file = path.join(tmp, "queue", "pending.jsonl");
    fs.appendFileSync(file, "{not json}\n");
    appendItems([item("demo:b")]);
    dropFirstN(1);
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line?.item.taskId).toBe("demo:b");
  });

  it("readLines on missing file returns empty", () => {
    expect(readLines()).toEqual([]);
  });
});

describe("flush lock", () => {
  it("second acquire while held returns null", () => {
    const lock = acquireFlushLock();
    expect(lock).not.toBeNull();
    expect(acquireFlushLock()).toBeNull();
    lock!.release();
    expect(acquireFlushLock()).not.toBeNull();
  });

  it("stale lock is stolen", () => {
    const lock = acquireFlushLock();
    expect(lock).not.toBeNull();
    const dir = path.join(tmp, "queue", ".flushlock");
    const old = new Date(Date.now() - 130_000);
    fs.utimesSync(dir, old, old);
    const stolen = acquireFlushLock(120_000);
    expect(stolen).not.toBeNull();
    stolen!.release();
  });
});
