import crypto from "node:crypto";
import fs from "node:fs";
import { ensureHome, keyFile } from "./paths.js";
import type { TaskItem } from "./types.js";

export const KDF_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 6; // Shared by the init and encrypt commands.
const ENVELOPE_PREFIX = "v1.AESGCM.";

export interface DerivedKey {
  v: 1;
  salt: string; // b64url(16B)
  key: string; // b64url(32B) derived key; never uploaded
  iter: number;
}

export function deriveKey(
  passphrase: string,
  saltB64url: string,
  iterations = KDF_ITERATIONS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      passphrase,
      Buffer.from(saltB64url, "base64url"),
      iterations,
      32,
      "sha256",
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

export function blindId(key: Buffer, slug: string): string {
  const hex = crypto.createHmac("sha256", key).update("blind:" + slug).digest("hex");
  return "b1_" + hex.slice(0, 16);
}

export function encryptText(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // The ct||tag layout matches Web Crypto AES-GCM output for cross-client compatibility.
  return `${ENVELOPE_PREFIX}${iv.toString("base64url")}.${Buffer.concat([ct, tag]).toString("base64url")}`;
}

export function decryptText(key: Buffer, envelope: string): string {
  if (!envelope.startsWith(ENVELOPE_PREFIX)) throw new Error("not an E2EE envelope");
  const [ivPart, dataPart] = envelope.slice(ENVELOPE_PREFIX.length).split(".");
  if (!ivPart || !dataPart) throw new Error("malformed envelope");
  const iv = Buffer.from(ivPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  if (iv.length !== 12 || data.length < 16) throw new Error("malformed envelope");
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function loadKeyFile(): DerivedKey | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(keyFile(), "utf8")) as DerivedKey;
    if (typeof parsed.key !== "string" || typeof parsed.salt !== "string") return null;
    return { ...parsed, v: 1, iter: parsed.iter ?? KDF_ITERATIONS };
  } catch {
    return null;
  }
}

export function saveKeyFile(salt: string, key: Buffer, iter = KDF_ITERATIONS): void {
  ensureHome();
  fs.writeFileSync(
    keyFile(),
    JSON.stringify({ v: 1, salt, key: key.toString("base64url"), iter }) + "\n",
    { mode: 0o600 },
  );
}

export function clearKeyFile(): void {
  try {
    fs.rmSync(keyFile(), { force: true });
  } catch {}
}

// Blind taskId because plaintext "{slug}:{titleSlug}" would reveal project identity.
export function blindTaskId(key: Buffer, taskId: string): string {
  const hex = crypto.createHmac("sha256", key).update("task:" + taskId).digest("hex");
  return "t1_" + hex.slice(0, 20);
}

// Encrypt content and blind identifiers when a key exists; otherwise keep plaintext.
export function finalizeForQueue(item: TaskItem): TaskItem {
  const dk = loadKeyFile();
  if (!dk || item.enc) return item;
  const key = Buffer.from(dk.key, "base64url");
  const slug = item.project.slug ?? "";
  const enc: TaskItem["enc"] = { v: 1, title: encryptText(key, item.title ?? "") };
  if (item.progress !== undefined) enc.progress = encryptText(key, item.progress);
  if (item.project.name !== undefined) enc.name = encryptText(key, item.project.name);
  return {
    ...item,
    taskId: blindTaskId(key, item.taskId),
    title: undefined,
    progress: undefined,
    project: { blindId: blindId(key, slug) },
    enc,
  };
}
