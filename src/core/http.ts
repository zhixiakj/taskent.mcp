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

// Attach hard timeouts at the fetch boundary with AbortController, without wrapper chains.
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

/**
 * POST /heartbeat presence data. Callers may ignore failures without retrying or
 * queueing because the next interval automatically restores presence.
 */
export async function postHeartbeat(
  serverUrl: string,
  token: string,
  payload: { machine: string; harness?: string; clientVersion?: string },
  timeoutMs = 10_000,
): Promise<void> {
  const res = await request(
    joinUrl(serverUrl, "/heartbeat"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
  if (res.status !== 200) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, `heartbeat ${res.status}: ${text.slice(0, 200)}`);
  }
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
  /** Optional passphrase hint (plaintext on the server); only present when set. */
  hint?: string;
}

/** /kdf returns a per-user salt with a token, or the legacy global salt without one. */
export async function getKdf(serverUrl: string, token?: string, timeoutMs = 5_000): Promise<KdfConfig> {
  const res = await request(
    joinUrl(serverUrl, "/kdf"),
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
    timeoutMs,
  );
  if (res.status !== 200) throw new ApiError(res.status, `kdf ${res.status}`);
  return (await res.json()) as KdfConfig;
}

/** PUT /kdf sets (non-empty) or clears (empty string) the passphrase hint. Throws on failure;
 * callers treat this as a peripheral step — degrade with a warning, never abort encryption. */
export async function setKdfHint(
  serverUrl: string,
  token: string,
  hint: string | null,
  timeoutMs = 5_000,
): Promise<void> {
  const res = await request(
    joinUrl(serverUrl, "/kdf"),
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ hint: hint ?? "" }),
    },
    timeoutMs,
  );
  if (res.status !== 200) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, `kdf put ${res.status}: ${text.slice(0, 200)}`);
  }
}

export interface Whoami {
  uid: string;
  via: "pat" | "jwt" | "legacy";
  login?: string;
  name?: string;
  admin?: boolean;
}

/** Authenticated /whoami probe used by doctor to distinguish 401 from network errors. */
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
