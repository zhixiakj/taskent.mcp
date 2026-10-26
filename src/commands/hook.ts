import { spawn } from "node:child_process";
import { loadConfig } from "../core/config.js";
import { toTaskItems } from "../core/normalize.js";
import { appendItems, queueDepth } from "../core/queue.js";
import { resolveProject } from "../core/project.js";

interface HookArgs {
  harness: string;
  event: string;
  cwd?: string;
}

export function parseHookArgs(argv: string[]): HookArgs | null {
  const args: HookArgs = { harness: "", event: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--harness") args.harness = argv[++i] ?? "";
    else if (a === "--event") args.event = argv[++i] ?? "";
    else if (a === "--cwd") args.cwd = argv[++i];
  }
  if (!args.harness) args.harness = process.env.TASKENT_HARNESS ?? "";
  if (!args.harness || !args.event) return null;
  return args;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

// hook 是 harness 同步等待的短进程：读 stdin → 写队列 → detached 派生 flush → 立即退出 0。
// 任何内部错误都不得阻塞 harness（architecture.md §9.4 降级矩阵）。
export async function runHook(argv: string[]): Promise<void> {
  try {
    const args = parseHookArgs(argv);
    if (!args) return;
    const raw = await readStdin();
    if (raw.trim().length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const cwd = args.cwd ?? (typeof (payload as { cwd?: string })?.cwd === "string" ? (payload as { cwd: string }).cwd : process.cwd());
    const config = loadConfig();
    const project = resolveProject(cwd);
    const items = toTaskItems(args.harness, args.event, payload, {
      project,
      harness: args.harness,
      ...(config?.machine ? { machine: config.machine } : {}),
    });
    if (items.length === 0) return;
    appendItems(items);

    if (config && queueDepth() > 0) {
      const self = process.argv[1];
      if (self) {
        const child = spawn(process.execPath, [self, "flush"], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      }
    }
  } catch (err) {
    console.error(`taskent hook: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    process.exitCode = 0;
  }
}
