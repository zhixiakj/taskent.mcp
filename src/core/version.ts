import { loadState, saveState } from "./config.js";

export const DEFAULT_REGISTRY = process.env.TASKENT_REGISTRY ?? "https://registry.npmjs.org";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function cmpSemver(a: string, b: string): number {
  const va = (a.replace(/^v/, "").split("-")[0] ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const vb = (b.replace(/^v/, "").split("-")[0] ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface UpdateCheckResult {
  latestVersion?: string;
  hasUpdate: boolean;
  checkedAt: string;
}

// 每日最多一次实查 npm registry（3s 超时挂在调用边界）；结果缓存 state.json。
// 只提示不自动装；hook 路径永不调用本函数（写队列即退出）。
export async function checkForUpdate(
  currentVersion: string,
  opts: { registry?: string; force?: boolean } = {},
): Promise<UpdateCheckResult> {
  const state = loadState();
  const now = Date.now();
  const last = state.lastVersionCheck ? Date.parse(state.lastVersionCheck) : 0;
  if (!opts.force && now - last < CHECK_INTERVAL_MS && state.latestVersion) {
    return {
      latestVersion: state.latestVersion,
      hasUpdate: cmpSemver(state.latestVersion, currentVersion) > 0,
      checkedAt: state.lastVersionCheck!,
    };
  }

  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3_000);
  try {
    const res = await fetch(`${registry}/taskent/latest`, { signal: ac.signal });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    const body = (await res.json()) as { version?: string };
    if (typeof body.version !== "string") throw new Error("no version field");
    state.latestVersion = body.version;
    state.lastVersionCheck = new Date().toISOString();
    saveState(state);
    return {
      latestVersion: body.version,
      hasUpdate: cmpSemver(body.version, currentVersion) > 0,
      checkedAt: state.lastVersionCheck,
    };
  } catch {
    // 查询失败静默保留旧缓存；doctor --force 可重试
    return {
      latestVersion: state.latestVersion,
      hasUpdate: false,
      checkedAt: state.lastVersionCheck ?? new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
