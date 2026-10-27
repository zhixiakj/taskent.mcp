import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function home(): string {
  return process.env.TASKENT_HOME ?? path.join(os.homedir(), ".taskent");
}

export function ensureHome(): string {
  const h = home();
  fs.mkdirSync(path.join(h, "queue"), { recursive: true });
  return h;
}

export function configFile(): string {
  return path.join(home(), "config.json");
}

export function stateFile(): string {
  return path.join(home(), "state.json");
}

export function keyFile(): string {
  return path.join(home(), "key");
}

export function queueFile(): string {
  return path.join(home(), "queue", "pending.jsonl");
}

export function deadLetterFile(): string {
  return path.join(home(), "queue", "dead.jsonl");
}

export function flushLockDir(): string {
  return path.join(home(), "queue", ".flushlock");
}
