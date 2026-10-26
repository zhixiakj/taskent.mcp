import { slugify } from "./project.js";
import { clampText, type TaskItem, type TaskStatus } from "./types.js";

export interface HookContext {
  project: { slug: string; name: string };
  harness: string;
  machine?: string;
}

const TODO_STATUS_MAP: Record<string, TaskStatus> = {
  pending: "todo",
  in_progress: "doing",
  completed: "done",
  todo: "todo",
  doing: "doing",
  blocked: "blocked",
  done: "done",
  failed: "failed",
};

interface TodoEntry {
  content?: string;
  subject?: string;
  activeForm?: string;
  status?: string;
}

function sessionTaskId(ctx: HookContext, sessionId: unknown): string | null {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const suffix = sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(-8).toLowerCase();
  return `${ctx.project.slug}:session-${suffix || "unknown"}`;
}

function makeTask(
  ctx: HookContext,
  taskId: string,
  title: string,
  status: TaskStatus,
  progress?: string,
): TaskItem {
  return {
    v: 1,
    taskId,
    project: ctx.project,
    title: clampText(title, 120)!,
    status,
    ...(progress !== undefined ? { progress: clampText(progress, 80) } : {}),
    agent: { harness: ctx.harness, ...(ctx.machine ? { machine: ctx.machine } : {}) },
    source: "hook",
  };
}

function todosToTasks(ctx: HookContext, toolInput: unknown): TaskItem[] {
  if (typeof toolInput !== "object" || toolInput === null) return [];
  const input = toolInput as { content?: unknown; todos?: unknown; tasks?: unknown };
  const list = input.content ?? input.todos ?? input.tasks;
  if (!Array.isArray(list)) return [];
  const out: TaskItem[] = [];
  for (const entry of list as TodoEntry[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const title = entry.content ?? entry.subject;
    const status = TODO_STATUS_MAP[entry.status ?? ""];
    if (typeof title !== "string" || title.length === 0 || status === undefined) continue;
    const taskId = `${ctx.project.slug}:${slugify(title)}`;
    out.push(makeTask(ctx, taskId, title, status, entry.activeForm));
  }
  return out;
}

// Claude Code（适配层单文件隔离；Task 工具负载形态 TODO(T1) 实测后校准）
function claudeCodeToTasks(event: string, payload: Record<string, unknown>, ctx: HookContext): TaskItem[] {
  switch (event) {
    case "PostToolUse": {
      const toolName = payload.tool_name;
      if (toolName === "TodoWrite" || toolName === "Task" || toolName === "TaskWrite") {
        return todosToTasks(ctx, payload.tool_input);
      }
      return [];
    }
    case "Stop": {
      const taskId = sessionTaskId(ctx, payload.session_id);
      if (!taskId) return [];
      return [makeTask(ctx, taskId, `session ${String(payload.session_id).slice(-8)}`, "done")];
    }
    case "Notification": {
      const taskId = sessionTaskId(ctx, payload.session_id);
      if (!taskId) return [];
      // 不透传 message 原文（隐私保守），统一记「等待输入」
      return [makeTask(ctx, taskId, `session ${String(payload.session_id).slice(-8)}`, "blocked", "awaiting input")];
    }
    default:
      return [];
  }
}

// ZCode：事件名与负载形态 TODO(T1) 摸底；先按 Claude Code 兼容形状尽力解析，解析不出静默忽略
function zcodeToTasks(event: string, payload: Record<string, unknown>, ctx: HookContext): TaskItem[] {
  return claudeCodeToTasks(event, payload, ctx);
}

export function toTaskItems(
  harness: string,
  event: string,
  payload: unknown,
  ctx: HookContext,
): TaskItem[] {
  if (typeof payload !== "object" || payload === null) return [];
  const record = payload as Record<string, unknown>;
  switch (harness) {
    case "claude-code":
      return claudeCodeToTasks(event, record, ctx);
    case "zcode":
      return zcodeToTasks(event, record, ctx);
    default:
      return [];
  }
}
