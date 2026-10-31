import { loadConfig, loadState, saveState, type TaskentConfig } from "./config.js";
import { acquireFlushLock, appendDeadLetters, dropFirstN, readLines } from "./queue.js";
import { ApiError, postIngest } from "./http.js";
import { ensureHome } from "./paths.js";

export type FlushStatus =
  | { status: "no-config" }
  | { status: "backoff"; nextAttemptAt: string }
  | { status: "busy" }
  | { status: "empty" }
  | { status: "ok"; sent: number }
  | { status: "unauthorized" }
  | { status: "error"; error: string };

export const BATCH_SIZE = 50;

export function nextDelayMs(level: number): number {
  if (level <= 1) return 60_000;
  if (level === 2) return 300_000;
  return 1_800_000;
}

export function backoffBlocked(state: { nextAttemptAt?: string }, now = Date.now()): boolean {
  return state.nextAttemptAt !== undefined && Date.parse(state.nextAttemptAt) > now;
}

// flush 全流程：锁互斥 → 批量 POST → 成功删行；失败退避（1m/5m/30m 封顶）。
// at-least-once：重发由服务端 upsert 幂等 + 事件按状态变化派生兜底，无重复副作用。
export async function flushOnce(config: TaskentConfig | null = loadConfig()): Promise<FlushStatus> {
  if (!config) return { status: "no-config" };
  ensureHome();

  const state = loadState();
  if (backoffBlocked(state)) return { status: "backoff", nextAttemptAt: state.nextAttemptAt! };

  const lock = acquireFlushLock();
  if (!lock) return { status: "busy" };

  try {
    let sent = 0;
    for (;;) {
      const valid = readLines().filter((l) => l.line !== null);
      if (valid.length === 0) break;
      const batch = valid.slice(0, BATCH_SIZE);
      const raws = batch.map((l) => l.raw);
      const items = batch.map((l) => l.line!.item);
      try {
        await postIngest(config.serverUrl, config.token, items);
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : null;
        if (apiErr && apiErr.status === 400) {
          // 载荷被拒（白名单越界）：隔离到 dead.jsonl，避免毒丸卡住整个队列
          appendDeadLetters(raws);
          dropFirstN(raws.length);
          continue;
        }
        const level = (state.backoffLevel ?? 0) + 1;
        state.backoffLevel = level;
        state.nextAttemptAt = new Date(Date.now() + nextDelayMs(level)).toISOString();
        saveState(state);
        if (apiErr && apiErr.status === 401) {
          // 401 是凭证问题而非网络抖动：清掉退避，换新令牌后下一次 flush 立即执行
          const s = loadState();
          s.backoffLevel = 0;
          delete s.nextAttemptAt;
          saveState(s);
          return { status: "unauthorized" };
        }
        return { status: "error", error: err instanceof Error ? err.message : String(err) };
      }
      dropFirstN(raws.length);
      sent += items.length;
    }
    state.backoffLevel = 0;
    delete state.nextAttemptAt;
    state.lastFlushAt = new Date().toISOString();
    saveState(state);
    return { status: "ok", sent };
  } finally {
    lock.release();
  }
}
