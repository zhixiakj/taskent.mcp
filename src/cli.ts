#!/usr/bin/env node
import { runInit } from "./commands/init.js";
import { runMcp } from "./commands/mcp.js";
import { runHook } from "./commands/hook.js";
import { runFlush } from "./commands/flush.js";
import { runUpgrade } from "./commands/upgrade.js";
import { runDoctor } from "./commands/doctor.js";
import { runEncrypt } from "./commands/encrypt.js";

const HELP = `taskent — report AI agent task status to your taskent server

usage:
  taskent init                    interactive setup (config + MCP/hooks snippets + optional E2EE)
  taskent mcp                     run the MCP server (stdio; for harness registration)
  taskent hook --harness H --event E [--cwd DIR]
                                  harness hook entry (reads JSON payload on stdin)
  taskent flush                   flush the local queue to the server now
  taskent encrypt [--passphrase P]
                                  enable/reset end-to-end encryption (passphrase never leaves this machine)
  taskent upgrade                 self-update via npm (npm i -g taskent@latest)
  taskent doctor [--force]        health check (config/version/queue/e2ee/server)

env:
  TASKENT_HOME     state directory (default ~/.taskent)
  TASKENT_HARNESS  harness name hint for MCP server (set by registration snippet)
  TASKENT_REGISTRY npm registry for update checks (default https://registry.npmjs.org)
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "init":
      await runInit(rest);
      return;
    case "mcp":
      await runMcp();
      return;
    case "hook":
      await runHook(rest);
      return;
    case "flush":
      await runFlush();
      return;
    case "encrypt":
      await runEncrypt(rest);
      return;
    case "upgrade":
      runUpgrade();
      return;
    case "doctor":
      await runDoctor(rest);
      return;
    default:
      process.stdout.write(HELP);
      process.exitCode = cmd === "help" || cmd === "--help" || cmd === undefined ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
