import os from "node:os";
import readline from "node:readline/promises";
import { saveConfig, type TaskentConfig } from "../core/config.js";
import { enableEncryption } from "./encrypt.js";
import { ensureHome } from "../core/paths.js";

interface InitFlags {
  token?: string;
  machine?: string;
  harness?: string;
}

// 托管服务唯一入口：server 闭源、不存在自托管场景，init 不提问也不提供覆盖项
const SERVER_URL = "https://app.taskent.io";

export function parseInitFlags(argv: string[]): InitFlags {
  const flags: InitFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--token") flags.token = argv[++i];
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

// ZCode：MCP 与 hooks 同在 ~/.zcode/cli/config.json，且配置文件 hooks 需要
// hooks.enabled + events 嵌套（字段依据 docs/mcp-PLAN.md T1 摸底：ZCode 3.16.3 实测，
// stdin payload 为 Claude Code 兼容超集；事件白名单无 Notification）
function zcodeConfigSnippets(): { mcp: string; hooks: string } {
  return {
    mcp: JSON.stringify(
      {
        mcp: {
          servers: {
            taskent: {
              command: "taskent",
              args: ["mcp"],
              env: { TASKENT_HARNESS: "zcode" },
            },
          },
        },
      },
      null,
      2,
    ),
    hooks: JSON.stringify(
      {
        hooks: {
          enabled: true,
          events: {
            PostToolUse: [
              {
                matcher: "Task|TodoWrite",
                hooks: [{ type: "command", command: "taskent hook --harness zcode --event PostToolUse" }],
              },
            ],
            Stop: [
              {
                hooks: [{ type: "command", command: "taskent hook --harness zcode --event Stop" }],
              },
            ],
          },
        },
      },
      null,
      2,
    ),
  };
}

function claudeCodeHooksSnippet(harness: string): string {
  return JSON.stringify(
    {
      hooks: {
        PostToolUse: [
          {
            matcher: "Task|TodoWrite",
            hooks: [{ type: "command", command: `taskent hook --harness ${harness} --event PostToolUse` }],
          },
        ],
        Stop: [
          {
            hooks: [{ type: "command", command: `taskent hook --harness ${harness} --event Stop` }],
          },
        ],
        Notification: [
          {
            hooks: [{ type: "command", command: `taskent hook --harness ${harness} --event Notification` }],
          },
        ],
      },
    },
    null,
    2,
  );
}

export async function runInit(argv: string[]): Promise<void> {
  const flags = parseInitFlags(argv);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const serverUrl = SERVER_URL;

    let token = flags.token;
    if (!token) {
      token = (
        await rl.question(`ingest token (${serverUrl} → Settings → Collector tokens; sign in first): `)
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

    const h = (harness || "").trim().toLowerCase() || "claude-code";
    if (h === "zcode") {
      const zc = zcodeConfigSnippets();
      console.log("\n1) ZCode — merge BOTH blocks into ~/.zcode/cli/config.json (keep your existing keys):");
      console.log("\n   MCP registration (\"mcp\" key):");
      console.log(zc.mcp);
      console.log(
        '\n   Task capture ("hooks" key; requires global install: npm i -g taskent; open a NEW session to activate):',
      );
      console.log(zc.hooks);
      console.log(
        "\n   (ZCode has no Notification event — the waiting-for-input signal is not captured on ZCode.)",
      );
      console.log("\n2) Verify:\n   taskent doctor");
    } else if (h === "claude-code") {
      console.log("\n1) Register the MCP server (.mcp.json / claude mcp add):");
      console.log(askUrlSnippet("claude-code"));
      console.log('\n   (with a global install you can use command "taskent" args ["mcp"] instead)');
      console.log(
        "\n2) Hooks — paste into ~/.claude/settings.json (requires global install: npm i -g taskent):",
      );
      console.log(claudeCodeHooksSnippet("claude-code"));
      console.log("\n3) Verify:\n   taskent doctor");
    } else {
      console.log("\n1) Register the MCP server + hooks for your harness — per-harness snippets:");
      console.log("   see the Setup section of the README: npmjs.com/package/taskent");
      console.log("\n2) Verify:\n   taskent doctor");
    }
  } finally {
    rl.close();
  }
}
