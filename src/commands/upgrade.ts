import { spawnSync } from "node:child_process";

export function runUpgrade(): void {
  console.log("npm install -g taskent@latest ...");
  const result = spawnSync("npm", ["install", "-g", "taskent@latest"], {
    stdio: "inherit",
  });
  if (result.status === 0) {
    console.log("taskent upgraded. Restart your agent sessions to pick it up.");
  } else {
    console.error(
      "upgrade failed (exit " + result.status + "). If taskent was installed via npx only, install it globally first:\n  npm install -g taskent",
    );
    process.exitCode = 1;
  }
}
