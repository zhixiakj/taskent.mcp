export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "failed";
export type TaskSource = "mcp" | "hook";

export interface TaskItem {
  v: number;
  taskId: string;
  // 明文模式用 slug/name；加密模式二者缺席，只有 blindId（architecture §11）
  project: { slug?: string; name?: string; blindId?: string };
  title?: string;
  status: TaskStatus;
  progress?: string;
  enc?: { v: 1; title: string; progress?: string; name?: string };
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
