import fs from "node:fs";

// 单一版本源：运行时读 package.json（npm 元数据），发版只改一处；
// src 与 dist 布局下 ../../package.json 均指向包根
export const VERSION: string = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version as string;
