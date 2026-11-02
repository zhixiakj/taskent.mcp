import fs from "node:fs";
import readline from "node:readline/promises";
import { loadConfig, saveConfig } from "../core/config.js";
import {
  HARNESSES,
  askUrlSnippet,
  buildAppendPlan,
  codexSnippet,
  findHarness,
  harnessFile,
  type HarnessSpec,
  type Json,
} from "../core/harness.js";
import { backupFile, readJsonFile, readTextFile, writeJsonAtomic, writeTextAtomic } from "../core/jsonfile.js";

interface AddAgentFlags {
  yes?: boolean;
}

export function parseAddAgentFlags(argv: string[]): AddAgentFlags {
  const flags: AddAgentFlags = {};
  for (const a of argv) {
    if (a === "--yes" || a === "-y") flags.yes = true;
  }
  return flags;
}

// Registrations invoke the global `taskent` binary (MCP command + hook commands),
// so a global install is a hard prerequisite.
function taskentOnPath(): boolean {
  const dirs = (process.env.PATH ?? "").split(pathSeparator()).filter(Boolean);
  return dirs.some((d) => {
    try {
      fs.accessSync(`${d}/taskent`, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function pathSeparator(): string {
  return process.platform === "win32" ? ";" : ":";
}

function isInstalled(spec: HarnessSpec): boolean {
  return spec.installPaths.some((rel) => {
    try {
      fs.accessSync(harnessFile(rel));
      return true;
    } catch {
      return false;
    }
  });
}

function isConfigured(spec: HarnessSpec): boolean {
  return spec.targets.some((t) => {
    const file = harnessFile(t.relPath);
    if ("append" in t) return readTextFile(file)?.includes(t.append.marker) ?? false;
    if (!t.hasRegistration) return false;
    const read = readJsonFile(file);
    return read.status === "ok" && t.hasRegistration(read.doc);
  });
}

async function pickHarness(rl: readline.Interface): Promise<HarnessSpec | "other" | null> {
  console.log("\nWhich agent do you want to add?");
  HARNESSES.forEach((spec, i) => {
    const state = isConfigured(spec) ? "configured ✓" : isInstalled(spec) ? "detected" : "not found";
    console.log(`  ${i + 1}) ${spec.label} (${spec.id}) — ${state}`);
  });
  console.log(`  ${HARNESSES.length + 1}) other (print a generic MCP snippet)`);
  const answer = (await rl.question(`choice [1-${HARNESSES.length + 1}]: `)).trim();
  const n = Number(answer);
  const picked = Number.isInteger(n) && n >= 1 && n <= HARNESSES.length ? HARNESSES[n - 1] : undefined;
  if (picked) return picked;
  if (n === HARNESSES.length + 1) return "other";
  console.error(`invalid choice: ${answer}`);
  return null;
}

function printOnly(spec: HarnessSpec): void {
  if (spec.id === "codex") {
    console.log(`\nCodex keeps its config in ~/.codex/config.toml (TOML, managed by codex) — not auto-written yet.`);
    console.log("Add this MCP registration manually:\n");
    console.log(codexSnippet());
    console.log("\nCodex has no Claude-Code-compatible hooks — task updates go through the MCP tool.");
  } else {
    console.log(`\n${spec.label}: no automatic configuration available; see the Setup section of the README.`);
  }
  console.log("\nVerify:\n  taskent doctor");
}

async function printOtherSnippet(rl: readline.Interface): Promise<void> {
  const name = (await rl.question("harness name (used as the agent label, e.g. aider, droid): ")).trim();
  const harness = name || "other";
  console.log("\nRegister the MCP server wherever your harness reads MCP config:");
  console.log(askUrlSnippet(harness));
  console.log(
    "\nIf your harness has Claude-Code-compatible hook events (stdin JSON with tool_name/tool_input/session_id),\n" +
      "the `taskent hook --harness <name> --event <event>` commands from the README work as-is.",
  );
  console.log("\nVerify:\n  taskent doctor");
}

function recordHarness(id: string): void {
  const config = loadConfig();
  if (!config) return;
  const harnesses = [...new Set([...(config.harnesses ?? []), id])];
  if (harnesses.length === (config.harnesses ?? []).length) return;
  saveConfig({ ...config, harnesses });
}

interface FilePlan {
  file: string;
  // json targets rewrite a parsed document; append targets rewrite raw text.
  next?: Json;
  nextText?: string;
  changes: string[];
}

export async function runAddAgent(argv: string[]): Promise<void> {
  const flags = parseAddAgentFlags(argv);
  const positional = argv.find((a) => !a.startsWith("-"));

  const config = loadConfig();
  if (!config) {
    console.error("no taskent config found — run: taskent init");
    process.exitCode = 1;
    return;
  }
  if (!taskentOnPath()) {
    console.error("taskent not found on PATH — registrations invoke the global binary.");
    console.error("install it first: npm i -g taskent");
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let spec: HarnessSpec | "other" | null;
    if (positional) {
      spec = findHarness(positional) ?? null;
      if (!spec) {
        console.error(`unknown agent: ${positional}`);
        console.error(`known agents: ${HARNESSES.map((h) => h.id).join(", ")}`);
        process.exitCode = 1;
        return;
      }
    } else {
      spec = await pickHarness(rl);
      if (!spec) {
        process.exitCode = 1;
        return;
      }
    }

    if (spec === "other") {
      await printOtherSnippet(rl);
      return;
    }
    if (spec.kind === "print-only") {
      printOnly(spec);
      return;
    }

    // Plan every file first; any unreadable or unrecognized file aborts the
    // whole harness before anything is written.
    const plans: FilePlan[] = [];
    for (const target of spec.targets) {
      const file = harnessFile(target.relPath);
      if ("append" in target) {
        const plan = buildAppendPlan(readTextFile(file), target.append);
        if (plan.status === "error") {
          console.error(`\n${file}: ${plan.error} — merge manually instead.`);
          console.error("nothing was written.");
          process.exitCode = 1;
          return;
        }
        if (plan.status === "append") {
          plans.push({ file, nextText: plan.nextText, changes: [`append: ${target.append.marker}`] });
        } else {
          plans.push({ file, changes: [] });
        }
        continue;
      }
      const read = readJsonFile(file);
      if (read.status === "invalid") {
        console.error(`\n${file}: not valid JSON (${read.error}) — fix or remove the file, then retry.`);
        console.error("nothing was written.");
        process.exitCode = 1;
        return;
      }
      const current = read.status === "missing" ? {} : read.doc;
      const { next, changes } = target.merge(current);
      plans.push({ file, next, changes });
    }

    const withChanges = plans.filter((p) => p.changes.length > 0);
    if (withChanges.length === 0) {
      console.log(`\n${spec.label} (${spec.id}): already configured ✓`);
      recordHarness(spec.id);
      return;
    }

    console.log(`\n${spec.label} (${spec.id}) — planned changes:`);
    for (const p of withChanges) {
      console.log(`  ${p.file}`);
      for (const c of p.changes) console.log(`    + ${c}`);
    }

    const answer = flags.yes ? "y" : (await rl.question("apply? [Y/n] ")).trim().toLowerCase();
    if (answer !== "" && answer !== "y" && answer !== "yes") {
      console.log("aborted — nothing was written.");
      return;
    }

    for (const p of withChanges) {
      const bak = backupFile(p.file);
      if (p.nextText !== undefined) writeTextAtomic(p.file, p.nextText);
      else writeJsonAtomic(p.file, p.next!);
      console.log(`  written: ${p.file}${bak ? ` (backup: ${bak})` : " (new file)"}`);
    }
    recordHarness(spec.id);

    const hookNote = spec.kind === "full" ? " Open a NEW session of the agent to activate hooks + MCP." : " Open a NEW session of the agent to connect the MCP server.";
    console.log(`\nDone.${hookNote}`);
    console.log("Verify:\n  taskent doctor");
  } finally {
    rl.close();
  }
}
