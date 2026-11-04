import os from "node:os";
import readline from "node:readline/promises";
import { saveConfig, type TaskentConfig } from "../core/config.js";
import { MIN_PASSPHRASE_LENGTH } from "../core/crypto.js";
import { SERVER_URL, askUrlSnippet } from "../core/harness.js";
import { askHintAndSave, enableEncryption } from "./encrypt.js";
import { ensureHome } from "../core/paths.js";

interface InitFlags {
  token?: string;
  machine?: string;
  harness?: string;
}

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

// ZCode stores MCP and hooks in ~/.zcode/cli/config.json. Hooks require
// hooks.enabled and an events wrapper. Its stdin payload is Claude Code-compatible,
// but ZCode does not provide a Notification event.
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

    // Optional E2EE (architecture §11): derive and cache the key locally, using
    // the token to fetch a per-user salt. Reprompt when the passphrase is too short.
    let passphrase = "";
    for (;;) {
      passphrase = (await rl.question("encryption passphrase (press Enter for plaintext mode): ")).trim();
      if (passphrase.length === 0 || passphrase.length >= MIN_PASSPHRASE_LENGTH) break;
      console.error(
        `passphrase too short (min ${MIN_PASSPHRASE_LENGTH} chars; press Enter for plaintext mode)`,
      );
    }
    if (passphrase.length > 0) {
      const encResult = await enableEncryption(serverUrl, passphrase, token);
      if (encResult.ok) {
        console.log("e2ee enabled (derived key cached locally, 0600)");
        // Optional recall hint, stored in plaintext server-side (peripheral: never fails init).
        const savedHint = await askHintAndSave(rl, serverUrl, token, passphrase, { interactive: true });
        if (savedHint !== null) console.log("hint saved on the server (plaintext; shown where you unlock)");
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
    console.log(
      "\nTip: `taskent add agent` writes the MCP + hooks config automatically (zcode, claude-code, gemini, cursor, opencode).",
    );
  } finally {
    rl.close();
  }
}
