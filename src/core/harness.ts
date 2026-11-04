import path from "node:path";
import os from "node:os";

// The hosted service is the only entry point (mirrors init: no server override).
export const SERVER_URL = "https://app.taskent.io";

export type Json = Record<string, unknown>;

export interface MergeResult {
  next: Json;
  // Human-readable list of what this merge would change; empty = already configured.
  changes: string[];
}

export type HarnessKind = "full" | "mcp-only" | "print-only";

// JSON target: parsed, merged key-by-key, atomically rewritten.
export interface JsonTarget {
  // Config file path relative to the user's home directory.
  relPath: string;
  // Pure merge: current document -> next document + change list. Never touches
  // foreign keys — only sets taskent's own entries and appends its own hook
  // commands (deduped).
  merge: (current: Json) => MergeResult;
  // Registration probe for "already configured" detection; absent on
  // hooks-only files (the MCP file is the source of truth).
  hasRegistration?: (doc: Json | null) => boolean;
}

// Append target: non-JSON config we must not re-serialize (e.g. a YAML patch
// list or TOML hooks table that may carry user comments and unrelated entries).
// We append one self-contained block; the marker string detects an existing
// registration, and validate() rejects file shapes where appending is unsafe.
export interface AppendSpec {
  marker: string;
  block: string;
  validate?: (text: string) => string | null;
}

export interface AppendTarget {
  relPath: string;
  append: AppendSpec;
}

// Verify-only target: taskent never writes this file (owned by another tool,
// e.g. Codex's config.toml), but the marker lets doctor and `add agent` status
// detection recognize a registration the user added by hand.
export interface VerifyTarget {
  relPath: string;
  // String whose presence means taskent's registration exists (same semantics
  // as AppendSpec.marker).
  marker: string;
}

export type HarnessTarget = JsonTarget | AppendTarget | VerifyTarget;

export interface HarnessSpec {
  id: string;
  label: string;
  kind: HarnessKind;
  // Any of these existing means the harness is installed on this machine.
  installPaths: string[];
  targets: HarnessTarget[];
}

export function asObject(v: unknown): Json {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

export function harnessFile(relPath: string): string {
  return path.join(os.homedir(), relPath);
}

export const hookCommand = (harness: string, event: string): string =>
  `taskent hook --harness ${harness} --event ${event}`;

function mcpEntry(harness: string): Json {
  return { command: "taskent", args: ["mcp"], env: { TASKENT_HARNESS: harness } };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// True when an event array already holds our hook command for this harness/event.
export function hookEventPresent(events: Json, harness: string, event: string): boolean {
  const list = events[event];
  if (!Array.isArray(list)) return false;
  const ours = hookCommand(harness, event);
  return list.some((entry) => {
    const group = asObject(entry);
    const hooks = group.hooks;
    if (!Array.isArray(hooks)) return false;
    return hooks.some((h) => typeof asObject(h).command === "string" && (asObject(h).command as string).includes(ours));
  });
}

// Appends our hook entry to events[event] unless one with our command exists.
// `events` is a fresh shallow copy owned by the caller; `label` prefixes change entries.
function appendHookEvent(events: Json, harness: string, event: string, matcher: string | undefined, label: string, changes: string[]): void {
  const list = Array.isArray(events[event]) ? ([...events[event]] as unknown[]) : [];
  if (hookEventPresent(events, harness, event)) return;
  const entry: Json = matcher
    ? { matcher, hooks: [{ type: "command", command: hookCommand(harness, event) }] }
    : { hooks: [{ type: "command", command: hookCommand(harness, event) }] };
  list.push(entry);
  events[event] = list;
  changes.push(`${label}.${event}`);
}

// --- per-harness merges -----------------------------------------------------

// ZCode (~/.zcode/cli/config.json): MCP under mcp.servers; hooks REQUIRE
// enabled: true and events nested under events (mcp-PLAN §2a-1). No Notification event.
export function mergeZcodeConfig(current: Json): MergeResult {
  const changes: string[] = [];
  const next: Json = { ...current };

  const mcp = { ...asObject(next.mcp) };
  const servers = { ...asObject(mcp.servers) };
  const server = mcpEntry("zcode");
  if (!sameJson(servers.taskent, server)) {
    servers.taskent = server;
    mcp.servers = servers;
    next.mcp = mcp;
    changes.push("mcp.servers.taskent");
  }

  const hooks = { ...asObject(next.hooks) };
  if (hooks.enabled !== true) {
    hooks.enabled = true;
    changes.push("hooks.enabled = true (required on ZCode)");
  }
  const events = { ...asObject(hooks.events) };
  appendHookEvent(events, "zcode", "PostToolUse", "Task|TodoWrite", "hooks.events", changes);
  appendHookEvent(events, "zcode", "Stop", undefined, "hooks.events", changes);
  hooks.events = events;
  next.hooks = hooks;

  return { next, changes };
}

// Claude Code hooks (~/.claude/settings.json): events sit directly under hooks
// (no events wrapper), and Notification is supported.
export function mergeClaudeSettings(current: Json): MergeResult {
  const changes: string[] = [];
  const next: Json = { ...current };
  const hooks = { ...asObject(next.hooks) };
  appendHookEvent(hooks, "claude-code", "PostToolUse", "Task|TodoWrite", "hooks", changes);
  appendHookEvent(hooks, "claude-code", "Stop", undefined, "hooks", changes);
  appendHookEvent(hooks, "claude-code", "Notification", undefined, "hooks", changes);
  next.hooks = hooks;
  return { next, changes };
}

// Claude-style mcpServers block (~/.claude.json user scope, ~/.gemini/settings.json,
// ~/.cursor/mcp.json).
export function mergeMcpServers(current: Json, harness: string): MergeResult {
  const changes: string[] = [];
  const next: Json = { ...current };
  const servers = { ...asObject(next.mcpServers) };
  const server = mcpEntry(harness);
  if (!sameJson(servers.taskent, server)) {
    servers.taskent = server;
    next.mcpServers = servers;
    changes.push("mcpServers.taskent");
  }
  return { next, changes };
}

// OpenCode (~/.config/opencode/opencode.json): top-level mcp key, type: local,
// command is an array, env vars live under "environment".
export function mergeOpencode(current: Json): MergeResult {
  const changes: string[] = [];
  const next: Json = { ...current };
  const mcp = { ...asObject(next.mcp) };
  const server = { type: "local", command: ["taskent", "mcp"], environment: { TASKENT_HARNESS: "opencode" } };
  if (!sameJson(mcp.taskent, server)) {
    mcp.taskent = server;
    next.mcp = mcp;
    changes.push("mcp.taskent");
  }
  return { next, changes };
}

// --- registration probes ----------------------------------------------------

const zcodeRegistered = (doc: Json | null): boolean => {
  if (!doc) return false;
  if (!asObject(asObject(doc.mcp).servers).taskent) return false;
  const hooks = asObject(doc.hooks);
  if (hooks.enabled !== true) return false;
  const events = asObject(hooks.events);
  return hookEventPresent(events, "zcode", "PostToolUse") && hookEventPresent(events, "zcode", "Stop");
};

const mcpServersRegistered = (doc: Json | null): boolean =>
  !!doc && !!asObject(asObject(doc.mcpServers).taskent).command;

const opencodeRegistered = (doc: Json | null): boolean =>
  !!doc && Array.isArray(asObject(asObject(doc.mcp).taskent).command);

const claudeSettingsRegistered = (doc: Json | null): boolean => {
  if (!doc) return false;
  const hooks = asObject(doc.hooks);
  return (
    hookEventPresent(hooks, "claude-code", "PostToolUse") && hookEventPresent(hooks, "claude-code", "Stop")
  );
};

// --- registry ---------------------------------------------------------------

export const HARNESSES: readonly HarnessSpec[] = [
  {
    id: "zcode",
    label: "ZCode",
    kind: "full",
    installPaths: [".zcode/cli/config.json"],
    targets: [
      { relPath: ".zcode/cli/config.json", merge: mergeZcodeConfig, hasRegistration: zcodeRegistered },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "full",
    installPaths: [".claude.json", ".claude/settings.json"],
    targets: [
      { relPath: ".claude/settings.json", merge: mergeClaudeSettings, hasRegistration: claudeSettingsRegistered },
      { relPath: ".claude.json", merge: (c) => mergeMcpServers(c, "claude-code"), hasRegistration: mcpServersRegistered },
    ],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    kind: "mcp-only",
    installPaths: [".gemini/settings.json"],
    targets: [
      {
        relPath: ".gemini/settings.json",
        merge: (c) => mergeMcpServers(c, "gemini"),
        hasRegistration: mcpServersRegistered,
      },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "mcp-only",
    installPaths: [".cursor/mcp.json"],
    targets: [
      { relPath: ".cursor/mcp.json", merge: (c) => mergeMcpServers(c, "cursor"), hasRegistration: mcpServersRegistered },
    ],
  },
  {
    id: "opencode",
    label: "OpenCode",
    kind: "mcp-only",
    installPaths: [".config/opencode/opencode.json"],
    targets: [
      { relPath: ".config/opencode/opencode.json", merge: mergeOpencode, hasRegistration: opencodeRegistered },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek Harness",
    kind: "mcp-only",
    installPaths: [".dsh"],
    targets: [{ relPath: ".dsh/cordis.patch.yml", append: dshAppendSpec() }],
  },
  {
    id: "kimi",
    label: "Kimi Code",
    kind: "full",
    installPaths: [".kimi-code"],
    targets: [
      {
        relPath: ".kimi-code/mcp.json",
        merge: (c) => mergeMcpServers(c, "kimi"),
        hasRegistration: mcpServersRegistered,
      },
      { relPath: ".kimi-code/config.toml", append: kimiHooksAppendSpec() },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    kind: "print-only",
    installPaths: [".codex/config.toml"],
    // We never write codex's TOML — but the snippet we print plants this table
    // header, so doctor can verify it and `add agent` can show "configured ✓".
    targets: [{ relPath: ".codex/config.toml", marker: "[mcp_servers.taskent]" }],
  },
];

const ALIASES: Record<string, string> = { claude: "claude-code", cc: "claude-code", dsh: "deepseek", "kimi-code": "kimi" };

export function findHarness(id: string): HarnessSpec | undefined {
  const norm = id.trim().toLowerCase();
  return HARNESSES.find((h) => h.id === norm || h.id === ALIASES[norm]);
}

// --- append targets (YAML / non-JSON) ---------------------------------------

// DeepSeek Harness (dsh): MCP servers are Cordis plugin entries; the persistent
// user patch layer is ~/.dsh/cordis.patch.yml — a YAML LIST of patch items.
// Their docs require merging (never overwriting) because the file may hold
// unrelated user patches, so we append one self-contained insert item.
// dsh has no Claude-Code-compatible hooks — MCP-only. $DSH_HOME defaults to ~/.dsh.
export function dshAppendSpec(): AppendSpec {
  const marker = "id: mcp-taskent";
  const block = [
    "- insert:",
    "    - id: mcp-taskent",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    "        serverName: taskent",
    "        transport: stdio",
    "        command: taskent",
    "        args: ['mcp']",
    "        env:",
    "          TASKENT_HARNESS: deepseek",
  ].join("\n");
  return {
    marker,
    block,
    validate: (text) => (looksLikeYamlPatchList(text) ? null : "not a YAML patch list (unexpected first entry)"),
  };
}

// Kimi Code (Moonshot): MCP servers live in ~/.kimi-code/mcp.json (Claude-style
// mcpServers), while lifecycle hooks are [[hooks]] array-of-tables in
// ~/.kimi-code/config.toml — TOML, so append. Their todo tool is named TodoList
// (not TodoWrite); the matcher uses the bare tool name, which is safe under both
// exact-match and regex matcher semantics. Payload is Claude-Code-compatible
// (snake_case tool_name/tool_input, session_id on every event).
export function kimiHooksAppendSpec(): AppendSpec {
  const marker = "taskent hook --harness kimi";
  const block = [
    "[[hooks]]",
    'event = "PostToolUse"',
    'matcher = "TodoList"',
    `command = "${hookCommand("kimi", "PostToolUse")}"`,
    "",
    "[[hooks]]",
    'event = "Stop"',
    `command = "${hookCommand("kimi", "Stop")}"`,
    "",
    "[[hooks]]",
    'event = "Notification"',
    `command = "${hookCommand("kimi", "Notification")}"`,
  ].join("\n");
  return {
    marker,
    block,
    validate: (text) => (tomlAppendSafe(text) ? null : "ends inside an open construct (truncated TOML?)"),
  };
}

// Appending a [[table]] block to a TOML document is well-defined as long as the
// document is complete. We cannot fully parse TOML here; this cheap check only
// rejects files whose last line looks truncated (fail closed).
export function tomlAppendSafe(text: string): boolean {
  const lines = text.split("\n").filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("#");
  });
  const last = lines[lines.length - 1];
  if (last === undefined) return true;
  const t = last.trim();
  return !/[={[,]$/.test(t) && !t.endsWith('"""') && !t.endsWith("'''");
}

// Conservative guard before appending: the document must look like a top-level
// YAML list of patches (or be empty). Anything else (mapping, scalar) means we
// do not understand the file — abort instead of guessing.
export function looksLikeYamlPatchList(text: string): boolean {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    return t.startsWith("- ");
  }
  return true;
}

export type AppendPlan =
  | { status: "up-to-date" }
  | { status: "append"; nextText: string }
  | { status: "error"; error: string };

// Pure planning for append targets: marker present -> no-op; validate rejects
// unsafe shapes -> error; otherwise append the block after a blank separator.
export function buildAppendPlan(text: string | null, append: AppendSpec): AppendPlan {
  if (text !== null && text.includes(append.marker)) return { status: "up-to-date" };
  if (text !== null) {
    const invalid = append.validate?.(text) ?? null;
    if (invalid) return { status: "error", error: invalid };
  }
  const base = text === null ? "" : text.endsWith("\n") ? text : `${text}\n`;
  return { status: "append", nextText: `${base}${text === null ? "" : "\n"}${append.block}\n` };
}

// --- print-only snippets ------------------------------------------------------

// npx-based snippet for harnesses we don't auto-configure (also used by init).
export function askUrlSnippet(harness: string): string {
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

// Codex keeps its config in TOML managed by codex itself — snippet only. The
// [mcp_servers.taskent] table header doubles as the verify marker above; keep
// the two in sync.
export function codexSnippet(): string {
  return [
    "# ~/.codex/config.toml — append these tables (keep existing content)",
    "[mcp_servers.taskent]",
    'command = "taskent"',
    'args = ["mcp"]',
    "",
    "[mcp_servers.taskent.env]",
    'TASKENT_HARNESS = "codex"',
  ].join("\n");
}
