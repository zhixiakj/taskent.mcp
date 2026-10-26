import fs from "node:fs";
import { loadConfig, loadState } from "../core/config.js";
import { getHealthz } from "../core/http.js";
import { VERSION } from "../core/meta.js";
import { configFile, deadLetterFile, flushLockDir, home } from "../core/paths.js";
import { readLines } from "../core/queue.js";
import { checkForUpdate } from "../core/version.js";

export async function runDoctor(argv: string[]): Promise<void> {
  const force = argv.includes("--force");
  let healthy = true;
  const line = (ok: boolean, label: string, detail: string) => {
    healthy = healthy && ok;
    console.log(`${ok ? "✅" : "⚠️ "} ${label}: ${detail}`);
  };

  console.log(`taskent doctor (v${VERSION})`);
  console.log(`home: ${home()}`);

  const config = loadConfig();
  if (config) {
    line(true, "config", `${configFile()} → ${config.serverUrl}`);
  } else {
    line(false, "config", `missing or invalid (${configFile()}); run: taskent init`);
  }

  const update = await checkForUpdate(VERSION, force ? { force: true } : {});
  if (update.latestVersion) {
    line(
      !update.hasUpdate,
      "version",
      update.hasUpdate
        ? `${VERSION} → ${update.latestVersion} available; run: taskent upgrade`
        : `${VERSION} (latest)`,
    );
  } else {
    line(false, "version", `${VERSION} (registry unreachable; TASKENT_REGISTRY can override)`);
  }

  const depth = readLines().filter((l) => l.line !== null).length;
  const dead = readLines(deadLetterFile()).length;
  line(depth < 100, "queue", `${depth} pending, ${dead} dead-letter${dead > 0 ? ` (${deadLetterFile()})` : "s"}`);

  const state = loadState();
  if (state.nextAttemptAt) {
    line(false, "flush", `backing off until ${state.nextAttemptAt} (level ${state.backoffLevel ?? "?"})`);
  } else if (state.lastFlushAt) {
    line(true, "flush", `last ok at ${state.lastFlushAt}`);
  } else {
    line(true, "flush", "never ran yet");
  }
  const lockActive = fs.existsSync(flushLockDir());
  if (lockActive) line(true, "flush lock", "held (a flush is in progress)");

  if (config) {
    try {
      const health = await getHealthz(config.serverUrl);
      line(true, "server", `${config.serverUrl} (v${health.version ?? "?"})`);
    } catch (err) {
      line(false, "server", `${config.serverUrl} unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  process.exitCode = healthy ? 0 : 1;
}
