import fs from "node:fs";
import { configFile, ensureHome, stateFile } from "./paths.js";

export interface TaskentConfig {
  configVersion: 1;
  serverUrl: string;
  token: string;
  machine?: string;
  harness?: string;
}

export interface TaskentState {
  lastVersionCheck?: string;
  latestVersion?: string;
  backoffLevel?: number;
  nextAttemptAt?: string;
  lastFlushAt?: string;
}

export function loadConfig(): TaskentConfig | null {
  try {
    const raw = fs.readFileSync(configFile(), "utf8");
    const parsed = JSON.parse(raw) as TaskentConfig;
    if (typeof parsed.serverUrl !== "string" || typeof parsed.token !== "string") return null;
    if (!/^https?:\/\//.test(parsed.serverUrl)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveConfig(config: TaskentConfig): void {
  ensureHome();
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n");
}

export function loadState(): TaskentState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as TaskentState;
  } catch {
    return {};
  }
}

export function saveState(state: TaskentState): void {
  ensureHome();
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2) + "\n");
}
