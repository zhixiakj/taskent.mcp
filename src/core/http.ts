import type { TaskItem } from "./types.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function joinUrl(base: string, p: string): string {
  return base.replace(/\/+$/, "") + p;
}

// 硬超时一律挂在「同步返回 Promise」的调用边界（AbortController + fetch），
// 不给库调用链套任何包装（全局异步规则）
async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function postIngest(
  serverUrl: string,
  token: string,
  items: TaskItem[],
  timeoutMs = 10_000,
): Promise<{ ok: true; pushed: number }> {
  const res = await request(
    joinUrl(serverUrl, "/ingest"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items }),
    },
    timeoutMs,
  );
  if (res.status === 200) {
    const body = (await res.json()) as { pushed?: number };
    return { ok: true, pushed: body.pushed ?? 0 };
  }
  const text = await res.text().catch(() => "");
  throw new ApiError(res.status, `ingest ${res.status}: ${text.slice(0, 200)}`);
}

export interface ServerTask extends TaskItem {
  createdAt?: string;
  updatedAt?: string;
}

export interface OverviewProject {
  slug: string;
  name?: string;
  tasks: ServerTask[];
}

export async function getOverview(
  serverUrl: string,
  token: string,
  timeoutMs = 10_000,
): Promise<OverviewProject[]> {
  const res = await request(
    joinUrl(serverUrl, "/overview?group=project"),
    { headers: { authorization: `Bearer ${token}` } },
    timeoutMs,
  );
  if (res.status !== 200) throw new ApiError(res.status, `overview ${res.status}`);
  const body = (await res.json()) as { projects?: OverviewProject[] };
  return body.projects ?? [];
}

export async function getHealthz(
  serverUrl: string,
  timeoutMs = 5_000,
): Promise<{ version?: string }> {
  const res = await request(joinUrl(serverUrl, "/healthz"), {}, timeoutMs);
  if (res.status !== 200) throw new ApiError(res.status, `healthz ${res.status}`);
  return (await res.json()) as { version?: string };
}
