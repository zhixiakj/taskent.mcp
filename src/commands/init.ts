import os from "node:os";
import readline from "node:readline/promises";
import { saveConfig, type TaskentConfig } from "../core/config.js";
import { enableEncryption } from "./encrypt.js";
import { ensureHome } from "../core/paths.js";

interface InitFlags {
  serverUrl?: string;
  token?: string;
  machine?: string;
  harness?: string;
}

export function parseInitFlags(argv: string[]): InitFlags {
  const flags: InitFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server-url") flags.serverUrl = argv[++i];
    else if (a === "--token") flags.token = argv[++i];
    else if (a === "--machine") flags.machine = argv[++i];
    else if (a === "--harness") flags.harness = argv[++i];
  }
  return flags;
}

function askUrlSnippet(harness: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        taskent: {
          command: "npx",
          args: ["-y", "taskent@latest", "mcp"],
          env: { TASKENT_HARNESS: harness },
        },
      },
    },
    null,
    2,
  );
}

function hooksEntry(event: string, matcher: string | undefined, harness: string): string {
  const entry = {
    [event]: [
      {
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: "command", command: `taskent hook --harness ${harness} --event ${event}` }],
      },
    ],
  };
  return JSON.stringify(entry, null, 2);
}

function askHooksSnippet(harness: string): string {
  return [
    "// settings.json > hooks（Claude Code 格式；ZCode 的事件名以 taskent 摸底记录为准）",
    `// 任务列表变化：\n${hooksEntry("PostToolUse", "Task|TodoWrite", harness)}`,
    `// 会话结束：\n${hooksEntry("Stop", undefined, harness)}`,
    `// 等待输入：\n${hooksEntry("Notification", undefined, harness)}`,
  ].join("\n\n");
}

export async function runInit(argv: string[]): Promise<void> {
  const flags = parseInitFlags(argv);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    let serverUrl = flags.serverUrl;
    if (!serverUrl) {
      serverUrl = (await rl.question("taskent server URL (e.g. https://your-project.web.app): ")).trim();
    }
    serverUrl = serverUrl.replace(/\/+$/, "");
    if (!/^https?:\/\//.test(serverUrl)) {
      console.error("invalid server URL");
      process.exitCode = 1;
      return;
    }

    let token = flags.token;
    if (!token) {
      token = (
        await rl.question("ingest token (web → Settings → Collector tokens; sign in first): ")
      ).trim();
    }
    if (token.length === 0) {
      console.error("token is required");
      process.exitCode = 1;
      return;
    }

    let machine = flags.machine;
    if (machine === undefined) {
      machine = (await rl.question(`machine name [${os.hostname()}]: `)).trim() || os.hostname();
    }

    let harness = flags.harness;
    if (!harness) {
      harness = (
        await rl.question("primary harness on this machine (zcode | claude-code | other): ")
      ).trim();
    }

    ensureHome();
    const config: TaskentConfig = {
      configVersion: 1,
      serverUrl,
      token,
      machine,
      ...(harness ? { harness } : {}),
    };
    saveConfig(config);

    // 可选端到端加密（architecture §11）：口令派生密钥只落本地（带 token 取 per-user 盐）
    const passphrase = (await rl.question("encryption passphrase (empty = plaintext mode): ")).trim();
    if (passphrase.length > 0) {
      const encResult = await enableEncryption(serverUrl, passphrase, token);
      if (encResult.ok) {
        console.log("e2ee enabled (derived key cached locally, 0600)");
      } else {
        console.error(`e2ee NOT enabled (server /kdf unreachable or error: ${encResult.error}); run \`taskent encrypt\` later`);
      }
    }

    console.log(`\nsaved: ~/.taskent/config.json`);
    console.log("\n1) Register the MCP server (per harness config, e.g. mcp.json / claude mcp add):");
    console.log(askUrlSnippet(harness || "claude-code"));
    console.log("\n   (with a global install you can use command \"taskent\" args [\"mcp\"] instead)");
    console.log("\n2) Hooks (requires global install: npm i -g taskent):");
    console.log(askHooksSnippet(harness || "claude-code"));
    console.log("\n3) Verify:\n   taskent doctor");
  } finally {
    rl.close();
  }
}
