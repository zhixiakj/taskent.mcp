import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HARNESSES,
  buildAppendPlan,
  dshAppendSpec,
  findHarness,
  hookEventPresent,
  kimiHooksAppendSpec,
  looksLikeYamlPatchList,
  mergeClaudeSettings,
  mergeMcpServers,
  mergeOpencode,
  mergeZcodeConfig,
  tomlAppendSafe,
  type AppendSpec,
} from "../src/core/harness.js";
import { backupFile, readJsonFile, writeJsonAtomic, writeTextAtomic } from "../src/core/jsonfile.js";

const zcodeSpec = HARNESSES.find((h) => h.id === "zcode")!;
const claudeSpec = HARNESSES.find((h) => h.id === "claude-code")!;
const opencodeSpec = HARNESSES.find((h) => h.id === "opencode")!;
const deepseekSpec = HARNESSES.find((h) => h.id === "deepseek")!;

describe("mergeZcodeConfig", () => {
  it("registers mcp + hooks on an empty config", () => {
    const { next, changes } = mergeZcodeConfig({});
    expect(next.mcp).toEqual({
      servers: { taskent: { command: "taskent", args: ["mcp"], env: { TASKENT_HARNESS: "zcode" } } },
    });
    const hooks = next.hooks as Record<string, unknown>;
    expect(hooks.enabled).toBe(true);
    expect(changes).toContain("mcp.servers.taskent");
    expect(changes).toContain("hooks.enabled = true (required on ZCode)");
    expect(changes).toContain("hooks.events.PostToolUse");
    expect(changes).toContain("hooks.events.Stop");
    expect(changes).not.toContain("hooks.events.Notification"); // ZCode has no Notification event
  });

  it("is idempotent — second merge changes nothing", () => {
    const first = mergeZcodeConfig({});
    const second = mergeZcodeConfig(first.next);
    expect(second.changes).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.next))).toEqual(first.next);
  });

  it("preserves foreign keys: plugins, other servers, other hook entries, timeoutMs", () => {
    const current = {
      plugins: { enabledPlugins: { "ios-simulator@zcode-plugins-official": true } },
      mcp: {
        servers: {
          other: { command: "something-else" },
          taskent: { command: "stale", args: [] },
        },
      },
      hooks: {
        timeoutMs: 10000,
        enabled: false,
        events: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "echo foreign" }] },
          ],
          Stop: [{ hooks: [{ type: "command", command: "echo stop-foreign" }] }],
        },
      },
    };
    const { next } = mergeZcodeConfig(current as never);
    expect((next.plugins as Record<string, unknown>).enabledPlugins).toEqual({
      "ios-simulator@zcode-plugins-official": true,
    });
    const servers = (next.mcp as Record<string, never>) as { servers: Record<string, unknown> };
    expect(servers.servers.other).toEqual({ command: "something-else" });
    expect(servers.servers.taskent).toEqual({
      command: "taskent",
      args: ["mcp"],
      env: { TASKENT_HARNESS: "zcode" },
    });
    const hooks = next.hooks as { timeoutMs: number; enabled: boolean; events: Record<string, unknown[]> };
    expect(hooks.timeoutMs).toBe(10000);
    expect(hooks.enabled).toBe(true);
    const post = hooks.events.PostToolUse as Record<string, unknown>[];
    expect(post).toHaveLength(2);
    expect(post[0]).toEqual({ matcher: "Bash", hooks: [{ type: "command", command: "echo foreign" }] });
    expect(hooks.events.Stop).toHaveLength(2);
    // input object is not mutated
    expect((current.hooks as { enabled: boolean }).enabled).toBe(false);
  });

  it("does not duplicate our entries when our command already exists", () => {
    const once = mergeZcodeConfig({});
    const twice = mergeZcodeConfig(once.next);
    const events = (twice.next.hooks as { events: Record<string, unknown[]> }).events;
    expect(events.PostToolUse).toHaveLength(1);
    expect(events.Stop).toHaveLength(1);
  });

  it("passes the registration probe exactly when fully registered", () => {
    const probe = zcodeSpec.targets[0].hasRegistration!;
    expect(probe(null)).toBe(false);
    expect(probe({})).toBe(false);
    expect(probe(mergeZcodeConfig({}).next)).toBe(true);
    // mcp registered but hooks disabled → not registered
    const partial = mergeZcodeConfig({});
    (partial.next.hooks as Record<string, unknown>).enabled = false;
    expect(probe(partial.next)).toBe(false);
  });
});

describe("mergeClaudeSettings", () => {
  it("adds the three events including Notification and preserves other settings", () => {
    const current = { effortLevel: "high", env: { ANTHROPIC_MODEL: "x" } };
    const { next, changes } = mergeClaudeSettings(current as never);
    const hooks = next.hooks as Record<string, unknown[]>;
    expect(Object.keys(hooks).sort()).toEqual(["Notification", "PostToolUse", "Stop"]);
    expect(next.effortLevel).toBe("high");
    expect(next.env).toEqual({ ANTHROPIC_MODEL: "x" });
    expect(changes).toEqual(["hooks.PostToolUse", "hooks.Stop", "hooks.Notification"]);
  });

  it("keeps foreign hook groups and is idempotent", () => {
    const current = { hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "fmt" }] }] } };
    const first = mergeClaudeSettings(current as never);
    const second = mergeClaudeSettings(first.next);
    expect(second.changes).toEqual([]);
    const post = (second.next.hooks as { PostToolUse: Record<string, unknown>[] }).PostToolUse;
    expect(post).toHaveLength(2);
    expect(post[0]).toEqual({ matcher: "Bash", hooks: [{ type: "command", command: "fmt" }] });
  });

  it("claude settings probe matches a merged config", () => {
    const probe = claudeSpec.targets[0].hasRegistration!;
    expect(probe(mergeClaudeSettings({}).next)).toBe(true);
    expect(probe({})).toBe(false);
  });
});

describe("mergeMcpServers (gemini / cursor / claude.json)", () => {
  it("adds taskent and preserves sibling servers byte-for-byte values", () => {
    const current = {
      ide: { enabled: true },
      mcpServers: {
        statsig: { command: "node", args: ["x.js"], env: { SECRET_TOKEN: "abc123—" } },
      },
    };
    const { next, changes } = mergeMcpServers(current as never, "cursor");
    expect(changes).toEqual(["mcpServers.taskent"]);
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers.statsig).toEqual({ command: "node", args: ["x.js"], env: { SECRET_TOKEN: "abc123—" } });
    expect(servers.taskent).toEqual({
      command: "taskent",
      args: ["mcp"],
      env: { TASKENT_HARNESS: "cursor" },
    });
    expect(next.ide).toEqual({ enabled: true });
  });

  it("is idempotent", () => {
    const once = mergeMcpServers({}, "gemini");
    expect(mergeMcpServers(once.next, "gemini").changes).toEqual([]);
  });
});

describe("mergeOpencode", () => {
  it("uses type local + command array + environment key", () => {
    const current = { $schema: "https://opencode.ai/config.json", provider: { zhipuglm: { apiKey: "k" } } };
    const { next, changes } = mergeOpencode(current as never);
    expect(changes).toEqual(["mcp.taskent"]);
    expect(next.mcp).toEqual({
      taskent: { type: "local", command: ["taskent", "mcp"], environment: { TASKENT_HARNESS: "opencode" } },
    });
    expect(next.$schema).toBe("https://opencode.ai/config.json");
    expect(next.provider).toEqual({ zhipuglm: { apiKey: "k" } });
    expect(mergeOpencode(next).changes).toEqual([]);
  });

  it("opencode probe matches a merged config", () => {
    const probe = opencodeSpec.targets[0].hasRegistration!;
    expect(probe(mergeOpencode({}).next)).toBe(true);
    expect(probe({})).toBe(false);
  });
});

describe("findHarness", () => {
  it("resolves ids and aliases", () => {
    expect(findHarness("claude")?.id).toBe("claude-code");
    expect(findHarness("cc")?.id).toBe("claude-code");
    expect(findHarness("ZCode")?.id).toBe("zcode");
    expect(findHarness("dsh")?.id).toBe("deepseek");
    expect(findHarness("kimi-code")?.id).toBe("kimi");
    expect(findHarness("nope")).toBeUndefined();
  });
});

describe("kimi append target", () => {
  const kimiSpec = HARNESSES.find((h) => h.id === "kimi")!;

  it("is a full harness: mcp.json merge + config.toml hooks append", () => {
    expect(kimiSpec.kind).toBe("full");
    const [mcp, hooks] = kimiSpec.targets as [{ relPath: string }, { relPath: string; append: { marker: string } }];
    expect(mcp.relPath).toBe(".kimi-code/mcp.json");
    expect(hooks.relPath).toBe(".kimi-code/config.toml");
    expect(hooks.append.marker).toBe("taskent hook --harness kimi");
  });

  it("builds [[hooks]] TOML blocks with the TodoList matcher and all three events", () => {
    const { marker, block } = kimiHooksAppendSpec();
    expect(block).toContain(marker);
    expect(block).toContain('matcher = "TodoList"');
    for (const ev of ["PostToolUse", "Stop", "Notification"]) {
      expect(block).toContain(`event = "${ev}"`);
    }
    expect((block.match(/\[\[hooks\]\]/g) ?? []).length).toBe(3);
  });

  it("tomlAppendSafe accepts complete documents and rejects truncated ones", () => {
    expect(tomlAppendSafe("")).toBe(true);
    expect(tomlAppendSafe("# comment\n")).toBe(true);
    expect(tomlAppendSafe('model = "kimi"\n[workspace]\ndirs = ["a"]\n')).toBe(true);
    expect(tomlAppendSafe('key = "value" # trailing comment')).toBe(true);
    expect(tomlAppendSafe("arr = [1,")).toBe(false);
    expect(tomlAppendSafe("tbl = {")).toBe(false);
    expect(tomlAppendSafe("key =")).toBe(false);
    expect(tomlAppendSafe('s = """')).toBe(false);
  });
});

describe("buildAppendPlan", () => {
  // Real append specs always embed the marker inside the block (asserted per
  // spec above) — that is what makes re-runs no-ops.
  const spec: AppendSpec = {
    marker: "taskent hook --harness kimi",
    block: '[[hooks]]\nevent = "Stop"\ncommand = "taskent hook --harness kimi --event Stop"',
  };

  it("is a no-op when the marker is already present (idempotency)", () => {
    const once = buildAppendPlan('model = "k"\n', spec);
    if (once.status !== "append") throw new Error("expected append");
    expect(buildAppendPlan(once.nextText, spec)).toEqual({ status: "up-to-date" });
  });

  it("appends after a blank separator and fixes a missing trailing newline", () => {
    const a = buildAppendPlan('model = "k"', spec);
    if (a.status !== "append") throw new Error("expected append");
    expect(a.nextText).toBe('model = "k"\n\n' + spec.block + '\n');
    expect(buildAppendPlan(null, spec)).toEqual({ status: "append", nextText: spec.block + "\n" });
  });

  it("returns the validator error instead of appending", () => {
    const guarded: AppendSpec = { ...spec, validate: () => "not a YAML patch list (unexpected first entry)" };
    expect(buildAppendPlan("insert: {}", guarded)).toEqual({
      status: "error",
      error: "not a YAML patch list (unexpected first entry)",
    });
  });
});

describe("deepseek (dsh) append target", () => {
  it("builds a Cordis insert patch with the marker and required fields", () => {
    const { marker, block } = dshAppendSpec();
    expect(block).toContain(marker);
    expect(block).toContain("name: '@deepseek-ai/dsh-mcp-client'");
    expect(block).toContain("serverName: taskent");
    expect(block).toContain("transport: stdio");
    expect(block).toContain("command: taskent");
    expect(block).toContain("TASKENT_HARNESS: deepseek");
    // every line is list/indentation only — safe to append to a patch list
    expect(block.split("\n").every((l) => l.startsWith("- ") || l.startsWith(" "))).toBe(true);
    expect(deepseekSpec.targets[0]).toMatchObject({ relPath: ".dsh/cordis.patch.yml" });
    expect(deepseekSpec.kind).toBe("mcp-only");
  });

  it("looksLikeYamlPatchList accepts lists/comments/empty, rejects mappings and scalars", () => {
    expect(looksLikeYamlPatchList("")).toBe(true);
    expect(looksLikeYamlPatchList("\n# a comment\n")).toBe(true);
    expect(looksLikeYamlPatchList("# leading comment\n- insert:\n    - id: x\n")).toBe(true);
    expect(looksLikeYamlPatchList("- insert:\n    - id: x\n")).toBe(true);
    expect(looksLikeYamlPatchList("insert:\n  - id: x\n")).toBe(false);
    expect(looksLikeYamlPatchList("just a scalar\n")).toBe(false);
  });
});

describe("hookEventPresent", () => {
  it("detects our command wherever it sits in the group list", () => {
    const events = {
      Stop: [{ hooks: [{ type: "command", command: "echo hi" }, { type: "command", command: "taskent hook --harness zcode --event Stop" }] }],
    };
    expect(hookEventPresent(events as never, "zcode", "Stop")).toBe(true);
    expect(hookEventPresent(events as never, "zcode", "PostToolUse")).toBe(false);
    expect(hookEventPresent(events as never, "claude-code", "Stop")).toBe(false);
  });
});

describe("jsonfile", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "taskent-harness-test-"));

  it("readJsonFile: missing / ok / invalid", () => {
    expect(readJsonFile(path.join(tmp, "nope.json")).status).toBe("missing");
    const ok = path.join(tmp, "ok.json");
    fs.writeFileSync(ok, '{"a":1}');
    expect(readJsonFile(ok)).toEqual({ status: "ok", doc: { a: 1 } });
    const bad = path.join(tmp, "bad.json");
    fs.writeFileSync(bad, "{not json");
    expect(readJsonFile(bad).status).toBe("invalid");
    const arr = path.join(tmp, "arr.json");
    fs.writeFileSync(arr, "[1,2]");
    expect(readJsonFile(arr).status).toBe("invalid");
  });

  it("writeJsonAtomic creates 0600 new files and preserves existing modes", () => {
    const fresh = path.join(tmp, "sub", "fresh.json");
    writeJsonAtomic(fresh, { a: 1 });
    expect((fs.statSync(fresh).mode & 0o777)).toBe(0o600);
    expect(fs.readFileSync(fresh, "utf8")).toBe('{\n  "a": 1\n}\n');

    const existing = path.join(tmp, "existing.json");
    fs.writeFileSync(existing, "{}\n", { mode: 0o644 });
    writeJsonAtomic(existing, { b: 2 });
    expect((fs.statSync(existing).mode & 0o777)).toBe(0o644);
    expect(readJsonFile(existing)).toEqual({ status: "ok", doc: { b: 2 } });
    expect(fs.readdirSync(tmp).some((f) => f.startsWith("existing.json.taskent-tmp-"))).toBe(false);
  });

  it("writeTextAtomic writes raw text with the same mode rules", () => {
    const file = path.join(tmp, "patch.yml");
    writeTextAtomic(file, "- insert:\n    - id: x\n");
    expect((fs.statSync(file).mode & 0o777)).toBe(0o600);
    expect(fs.readFileSync(file, "utf8")).toBe("- insert:\n    - id: x\n");
  });

  it("backupFile copies and returns null for missing files", () => {
    const file = path.join(tmp, "backed.json");
    fs.writeFileSync(file, '{"x":1}');
    const bak = backupFile(file)!;
    expect(fs.readFileSync(bak, "utf8")).toBe('{"x":1}');
    expect(bak).toContain(".taskent-bak-");
    expect(backupFile(path.join(tmp, "missing.json"))).toBeNull();
  });

  it("cleans up the temp dir", () => {
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
