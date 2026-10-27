import readline from "node:readline/promises";
import { loadConfig } from "../core/config.js";
import {
  decryptText,
  deriveKey,
  encryptText,
  saveKeyFile,
} from "../core/crypto.js";
import { getKdf } from "../core/http.js";
import { keyFile } from "../core/paths.js";

// 启用/重设端到端加密：口令仅在本地派生密钥，永不上传（architecture §11）
export async function enableEncryption(
  serverUrl: string,
  passphrase: string,
): Promise<{ ok: true; salt: string } | { ok: false; error: string }> {
  try {
    const kdf = await getKdf(serverUrl);
    const key = await deriveKey(passphrase, kdf.salt, kdf.iter);
    // 落盘前自检：加密→解密往返
    const probe = encryptText(key, "taskent-selftest");
    if (decryptText(key, probe) !== "taskent-selftest") {
      return { ok: false, error: "selftest failed" };
    }
    saveKeyFile(kdf.salt, key, kdf.iter);
    return { ok: true, salt: kdf.salt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runEncrypt(argv: string[]): Promise<void> {
  const flags: { passphrase?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--passphrase") flags.passphrase = argv[++i];
  }
  const config = loadConfig();
  if (!config) {
    console.error("taskent is not configured; run `taskent init` first");
    process.exitCode = 1;
    return;
  }

  let passphrase = flags.passphrase;
  if (passphrase === undefined) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      passphrase = await rl.question(
        "encryption passphrase (empty to abort; forgotten = data unrecoverable): ",
      );
    } finally {
      rl.close();
    }
  }
  if (!passphrase || passphrase.length < 6) {
    console.error("passphrase too short (min 6 chars); aborted");
    process.exitCode = 1;
    return;
  }

  const result = await enableEncryption(config.serverUrl, passphrase);
  if (result.ok) {
    console.log(`e2ee enabled; derived key saved to ${keyFile()} (mode 0600)`);
    console.log("new reports will be encrypted; plaintext tasks remain readable");
  } else {
    console.error(`failed to enable e2ee: ${result.error}`);
    process.exitCode = 1;
  }
}
