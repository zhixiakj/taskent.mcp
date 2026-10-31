import { VERSION } from "./meta.js";
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

// 硬超时一律挂在「同步返回 Future」的调用边界（AbortController + fetch），
// 不给库调用链套任何包装（全局异步规则）
async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { "x-taskent-client": `mcp/${VERSION}`, ...(init.headers as Record<string, string> | undefined) },
      signal: ac.signal,
    });
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
  slug?: string;
  name?: string;
  blindId?: string;
  alias?: string;
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
  const res = await request(joinUrl(serverUrl, "/health"), {}, timeoutMs);
  if (res.status !== 200) throw new ApiError(res.status, `health ${res.status}`);
  return (await res.json()) as { version?: string };
}

export interface KdfConfig {
  v: number;
  alg: string;
  iter: number;
  salt: string;
}

/** /kdf：带令牌返回该用户盐（多用户 per-user 盐）；无令牌回落全局盐（旧服务端兼容）。 */
export async function getKdf(serverUrl: string, token?: string, timeoutMs = 5_000): Promise<KdfConfig> {
  const res = await request(
    joinUrl(serverUrl, "/kdf"),
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
    timeoutMs,
  );
  if (res.status !== 200) throw new ApiError(res.status, `kdf ${res.status}`);
  return (await res.json()) as KdfConfig;
}

export interface Whoami {
  uid: string;
  via: "pat" | "jwt" | "legacy";
  login?: string;
  name?: string;
  admin?: boolean;
}

/** /whoami：带鉴权探针（doctor 区分令牌失效 401 与网络错误）。 */
export async function getWhoami(
  serverUrl: string,
  token: string,
  timeoutMs = 5_000,
): Promise<Whoami> {
  const res = await request(
    joinUrl(serverUrl, "/whoami"),
    { headers: { authorization: `Bearer ${token}` } },
    timeoutMs,
  );
  if (res.status !== 200) throw new ApiError(res.status, `whoami ${res.status}`);
  return (await res.json()) as Whoami;
}
