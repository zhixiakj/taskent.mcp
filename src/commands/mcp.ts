import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../core/config.js";
import { flushOnce } from "../core/forward.js";
import { getOverview } from "../core/http.js";
import { VERSION } from "../core/meta.js";
import { appendItems, queueDepth } from "../core/queue.js";
import { resolveProject, slugify } from "../core/project.js";
import { relativeTime } from "../core/time.js";
import { checkForUpdate } from "../core/version.js";

const STATUSES = ["todo", "doing", "blocked", "done", "failed"] as const;

function currentHarness(): string {
  return process.env.TASKENT_HARNESS ?? loadConfig()?.harness ?? "unknown";
}

export async function runMcp(): Promise<void> {
  const server = new McpServer({ name: "taskent", version: VERSION });

  server.registerTool(
    "task_upsert",
    {
      title: "Report task status",
      description:
        "Idempotently report or update a task's status (queued locally first, never blocks you). " +
        "Call it when a task starts, progresses, blocks, or finishes.",
      inputSchema: {
        title: z.string().max(120).describe("Task title (≤120 chars, metadata only)"),
        status: z.enum(STATUSES).describe("todo | doing | blocked | done | failed"),
        taskId: z.string().max(128).optional().describe("Stable id; defaults to slug of title"),
        progress: z.string().max(80).optional().describe("One-line current step (≤80 chars)"),
      },
    },
    async (args) => {
      const config = loadConfig();
      const project = resolveProject(process.cwd());
      const harness = currentHarness();
      const taskId = args.taskId ?? `${project.slug}:${slugify(args.title)}`;
      appendItems([
        {
          v: 1,
          taskId,
          project,
          title: args.title,
          status: args.status,
          ...(args.progress ? { progress: args.progress } : {}),
          agent: { harness, ...(config?.machine ? { machine: config.machine } : {}) },
          source: "mcp",
        },
      ]);
      void flushOnce().catch(() => {});
      return {
        content: [
          { type: "text", text: `queued ${taskId} [${args.status}] (queue depth: ${queueDepth()})` },
        ],
      };
    },
  );

  server.registerTool(
    "task_list",
    {
      title: "List open tasks",
      description:
        "List unfinished tasks (todo/doing/blocked/failed) of the current project, so you can pick up where things left off.",
      inputSchema: {
        projectSlug: z.string().optional().describe("Defaults to current project"),
      },
    },
    async (args) => {
      const config = loadConfig();
      if (!config) {
        return { content: [{ type: "text", text: "taskent not configured; run `taskent init` first." }] };
      }
      const project = resolveProject(process.cwd());
      const slug = args.projectSlug ?? project.slug;
      try {
        const projects = await getOverview(config.serverUrl, config.token);
        const tasks = (projects.find((p) => p.slug === slug)?.tasks ?? []).filter(
          (t) => t.status !== "done",
        );
        if (tasks.length === 0) {
          return { content: [{ type: "text", text: `no open tasks in ${slug}` }] };
        }
        const lines = tasks.map(
          (t) => `- [${t.status}] ${t.title}${t.progress ? ` · ${t.progress}` : ""} · ${relativeTime(t.updatedAt)}`,
        );
        return { content: [{ type: "text", text: `open tasks in ${slug}:\n${lines.join("\n")}` }] };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `overview unavailable: ${err instanceof Error ? err.message : String(err)}` },
          ],
        };
      }
    },
  );

  // stdout 是 MCP 协议通道，一切日志走 stderr
  const update = await checkForUpdate(VERSION);
  if (update.hasUpdate && update.latestVersion) {
    console.error(`taskent ${update.latestVersion} available (current ${VERSION}); upgrade: taskent upgrade`);
  }
  await flushOnce().catch((err) => console.error(`startup flush: ${err}`));
  const timer = setInterval(() => {
    void flushOnce().catch((err) => console.error(`flush: ${err}`));
  }, 60_000);
  timer.unref();

  await server.connect(new StdioServerTransport());
}
