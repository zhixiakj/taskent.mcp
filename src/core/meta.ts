import fs from "node:fs";

// Read package.json at runtime as the single version source. Both src and dist
// resolve ../../package.json to the package root.
export const VERSION: string = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version as string;
