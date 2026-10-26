import { describe, expect, it } from "vitest";
import { toTaskItems, type HookContext } from "../src/core/normalize.js";

const ctx: HookContext = {
  project: { slug: "demo", name: "Demo" },
  harness: "claude-code",
  machine: "mac1",
};

describe("claude-code hooks", () => {
  it("maps TodoWrite content list to tasks", () => {
    const items = toTaskItems(
      "claude-code",
      "PostToolUse",
      {
        tool_name: "TodoWrite",
        tool_input: {
          content: [
            { content: "write docs", status: "completed" },
            { content: "fix bug", status: "in_progress", activeForm: "Fixing the bug" },
            { content: "release", status: "pending" },
          ],
        },
        cwd: "/tmp/demo",
      },
      ctx,
    );
    expect(items.map((t) => [t.taskId, t.status])).toEqual([
      ["demo:write-docs", "done"],
      ["demo:fix-bug", "doing"],
      ["demo:release", "todo"],
    ]);
    expect(items[1]!.progress).toBe("Fixing the bug");
  });

  it("accepts Task tool with todos array and unknown statuses are skipped", () => {
    const items = toTaskItems(
      "claude-code",
      "PostToolUse",
      { tool_name: "Task", tool_input: { todos: [{ subject: "ship it", status: "weird" }] } },
      ctx,
    );
    expect(items).toEqual([]);
  });

  it("Stop maps session pseudo-task to done", () => {
    const items = toTaskItems("claude-code", "Stop", { session_id: "abc-12345678" }, ctx);
    expect(items).toHaveLength(1);
    expect(items[0]!.taskId).toBe("demo:session-12345678");
    expect(items[0]!.status).toBe("done");
  });

  it("Notification maps session to blocked without leaking message", () => {
    const items = toTaskItems(
      "claude-code",
      "Notification",
      { session_id: "abc-12345678", message: "/Users/secret/path needs permission" },
      ctx,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("blocked");
    expect(items[0]!.progress).toBe("awaiting input");
    expect(JSON.stringify(items[0]!)).not.toContain("secret");
  });

  it("unrelated tools and events produce nothing", () => {
    expect(toTaskItems("claude-code", "PostToolUse", { tool_name: "Bash" }, ctx)).toEqual([]);
    expect(toTaskItems("claude-code", "SubagentStop", {}, ctx)).toEqual([]);
    expect(toTaskItems("claude-code", "PreToolUse", { tool_name: "Task" }, ctx)).toEqual([]);
  });

  it("zcode harness best-effort parses the same shape", () => {
    const items = toTaskItems(
      "zcode",
      "PostToolUse",
      { tool_name: "TodoWrite", tool_input: { content: [{ content: "x", status: "in_progress" }] } },
      ctx,
    );
    expect(items).toHaveLength(1);
  });
});
