import { describe, expect, it } from "vitest";
import { parseRepoName, slugify } from "../src/core/project.js";
import { backoffBlocked, nextDelayMs } from "../src/core/forward.js";
import { cmpSemver } from "../src/core/version.js";
import { relativeTime } from "../src/core/time.js";

describe("project grouping", () => {
  it("parses repo names from common remote URL shapes", () => {
    expect(parseRepoName("git@github.com:zhixiakj/taskent.server.git")).toBe("taskent.server");
    expect(parseRepoName("https://github.com/vercel/next.js.git")).toBe("next.js");
    expect(parseRepoName("https://github.com/vercel/next.js")).toBe("next.js");
    expect(parseRepoName("ssh://git@host:2222/owner/repo.git")).toBe("repo");
    expect(parseRepoName("not a url")).toBeNull();
  });

  it("slugifies names", () => {
    expect(slugify("Taskent Server")).toBe("taskent-server");
    expect(slugify("a--b")).toBe("a-b");
    expect(slugify("任务 管理!")).toBe("project");
  });
});

describe("backoff", () => {
  it("schedules 1m / 5m / 30m cap", () => {
    expect(nextDelayMs(1)).toBe(60_000);
    expect(nextDelayMs(2)).toBe(300_000);
    expect(nextDelayMs(3)).toBe(1_800_000);
    expect(nextDelayMs(9)).toBe(1_800_000);
  });

  it("blocks flush until nextAttemptAt passes", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 1_000).toISOString();
    expect(backoffBlocked({ nextAttemptAt: future })).toBe(true);
    expect(backoffBlocked({ nextAttemptAt: past })).toBe(false);
    expect(backoffBlocked({})).toBe(false);
  });
});

describe("semver", () => {
  it("compares numeric triples", () => {
    expect(cmpSemver("0.1.0", "0.1.0")).toBe(0);
    expect(cmpSemver("0.2.0", "0.1.9")).toBe(1);
    expect(cmpSemver("1.0.0", "0.99.99")).toBe(1);
    expect(cmpSemver("v0.1.1", "0.1.0")).toBe(1);
    expect(cmpSemver("0.1.0-beta.1", "0.1.0")).toBe(0);
  });
});

describe("relative time", () => {
  it("formats buckets", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe("刚刚");
    expect(relativeTime(new Date(now - 3 * 60_000).toISOString(), now)).toBe("3 分钟前");
    expect(relativeTime(new Date(now - 2 * 3600_000).toISOString(), now)).toBe("2 小时前");
    expect(relativeTime(new Date(now - 26 * 3600_000).toISOString(), now)).toBe("1 天前");
    expect(relativeTime(undefined)).toBe("");
  });
});
