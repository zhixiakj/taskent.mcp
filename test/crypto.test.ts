import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  blindId,
  decryptText,
  deriveKey,
  encryptText,
  finalizeForQueue,
  loadKeyFile,
  saveKeyFile,
} from "../src/core/crypto.js";
import type { TaskItem } from "../src/core/types.js";

const SALT = "c2FsdDEyMzQ1Njc4OTA"; // b64url-ish fixture
const TEST_ITER = 1_000; // 测试用低迭代，生产行为由 doctor/init 走 600k

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "taskent-crypto-"));
  process.env.TASKENT_HOME = tmp;
});

afterEach(() => {
  delete process.env.TASKENT_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function plainItem(): TaskItem {
  return {
    v: 1,
    taskId: "demo:secret-task",
    project: { slug: "demo", name: "Demo Project" },
    title: "secret task title",
    status: "doing",
    progress: "working on it",
    agent: { harness: "zcode", machine: "mac" },
    source: "hook",
  };
}

describe("key derivation", () => {
  it("is deterministic for same passphrase+salt and differs otherwise", async () => {
    const a = await deriveKey("correct horse", SALT, TEST_ITER);
    const b = await deriveKey("correct horse", SALT, TEST_ITER);
    const c = await deriveKey("wrong horse", SALT, TEST_ITER);
    const d = await deriveKey("correct horse", "b3RoZXJzYWx0", TEST_ITER);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(d)).toBe(false);
    expect(a.length).toBe(32);
  });
});

describe("envelope roundtrip", () => {
  it("encrypts and decrypts", async () => {
    const key = await deriveKey("pass", SALT, TEST_ITER);
    const env = encryptText(key, "任务 title with 中文 + emoji 🎉");
    expect(env.startsWith("v1.AESGCM.")).toBe(true);
    expect(env).not.toContain("任务");
    expect(decryptText(key, env)).toBe("任务 title with 中文 + emoji 🎉");
  });

  it("fails on tampered ciphertext (AEAD)", async () => {
    const key = await deriveKey("pass", SALT, TEST_ITER);
    const env = encryptText(key, "secret");
    const parts = env.split(".");
    const tampered = "v1.AESGCM." + parts[1] + "." + ("A" + parts[2]!.slice(1));
    expect(() => decryptText(key, tampered)).toThrow();
  });

  it("fails with wrong key", async () => {
    const key1 = await deriveKey("pass1", SALT, TEST_ITER);
    const key2 = await deriveKey("pass2", SALT, TEST_ITER);
    const env = encryptText(key1, "secret");
    expect(() => decryptText(key2, env)).toThrow();
  });

  it("rejects malformed envelopes", () => {
    expect(() => decryptText(Buffer.alloc(32), "not-an-envelope")).toThrow();
    expect(() => decryptText(Buffer.alloc(32), "v1.AESGCM.only.one.part")).toThrow();
  });
});

describe("blind index", () => {
  it("is deterministic, prefixed, and slug-sensitive", async () => {
    const key = await deriveKey("pass", SALT, TEST_ITER);
    const a = blindId(key, "demo");
    expect(a).toBe(blindId(key, "demo"));
    expect(a.startsWith("b1_")).toBe(true);
    expect(a).toHaveLength(3 + 16);
    expect(a).not.toBe(blindId(key, "other"));
    const key2 = await deriveKey("pass2", SALT, TEST_ITER);
    expect(a).not.toBe(blindId(key2, "demo"));
  });
});

describe("finalizeForQueue", () => {
  it("encrypts when key file exists and strips plaintext", async () => {
    const key = await deriveKey("pass", SALT, TEST_ITER);
    saveKeyFile(SALT, key, TEST_ITER);
    const out = finalizeForQueue(plainItem());
    expect(out.enc).toBeDefined();
    expect(out.title).toBeUndefined();
    expect(out.progress).toBeUndefined();
    expect(out.project.slug).toBeUndefined();
    expect(out.project.blindId).toMatch(/^b1_[0-9a-f]{16}$/);
    // taskId 也盲化：不泄露 slug 与 title slug
    expect(out.taskId).toMatch(/^t1_[0-9a-f]{20}$/);
    expect(out.taskId).not.toContain("demo");
    expect(JSON.stringify(out)).not.toContain("secret task title");
    expect(decryptText(key, out.enc!.title)).toBe("secret task title");
    expect(decryptText(key, out.enc!.progress!)).toBe("working on it");
    expect(decryptText(key, out.enc!.name!)).toBe("Demo Project");
  });

  it("keeps plaintext when no key file", () => {
    expect(loadKeyFile()).toBeNull();
    const out = finalizeForQueue(plainItem());
    expect(out.enc).toBeUndefined();
    expect(out.title).toBe("secret task title");
    expect(out.project.slug).toBe("demo");
  });

  it("is idempotent for already-encrypted items", async () => {
    const key = await deriveKey("pass", SALT, TEST_ITER);
    saveKeyFile(SALT, key, TEST_ITER);
    const once = finalizeForQueue(plainItem());
    const twice = finalizeForQueue(once);
    expect(twice.enc!.title).toBe(once.enc!.title);
    expect(twice.project.blindId).toBe(once.project.blindId);
  });
});
