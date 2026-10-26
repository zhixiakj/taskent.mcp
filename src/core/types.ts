export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "failed";
export type TaskSource = "mcp" | "hook";

export interface TaskItem {
  v: number;
  taskId: string;
  project: { slug: string; name: string };
  title: string;
  status: TaskStatus;
  progress?: string;
  agent: { harness: string; model?: string; machine?: string };
  source: TaskSource;
}

export interface QueueLine {
  v: number;
  ts: string;
  item: TaskItem;
}

export function clampText(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
