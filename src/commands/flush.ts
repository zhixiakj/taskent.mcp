import { flushOnce } from "../core/forward.js";

export async function runFlush(): Promise<void> {
  const result = await flushOnce();
  console.log(JSON.stringify(result));
  if (result.status === "error" || result.status === "unauthorized") {
    process.exitCode = 1;
  }
}
