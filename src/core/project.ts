import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "project";
}

export function parseRepoName(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const scpLike = trimmed.match(/^[\w.-]+@[\w.-]+:(.+?)(?:\.git)?$/);
  const urlLike = trimmed.match(/^[\w+.-]+:\/\/.*\/([^/]+?)(?:\.git)?$/);
  const name = scpLike?.[1] ?? urlLike?.[1] ?? null;
  if (!name) return null;
  const base = name.split("/").pop() ?? name;
  return base.length > 0 ? base : null;
}

function findGitRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function gitRemoteName(gitRoot: string): string | null {
  try {
    const url = execSync("git remote get-url origin", {
      cwd: gitRoot,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseRepoName(url);
  } catch {
    return null;
  }
}

// 归组规则（architecture.md §5）：只上报仓库名/目录名，绝不带本地绝对路径
export function resolveProject(cwd: string): { slug: string; name: string } {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) {
    const name = path.basename(path.resolve(cwd));
    return { slug: slugify(name), name };
  }
  const name = gitRemoteName(gitRoot) ?? path.basename(gitRoot);
  return { slug: slugify(name), name };
}
