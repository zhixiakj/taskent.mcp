import readline from "node:readline/promises";
import { loadConfig } from "../core/config.js";
import {
  decryptText,
  deriveKey,
  encryptText,
  MIN_PASSPHRASE_LENGTH,
  saveKeyFile,
} from "../core/crypto.js";
import { getKdf, setKdfHint } from "../core/http.js";
import { keyFile } from "../core/paths.js";

// Enable or reset E2EE. The passphrase derives a key locally and is never uploaded.
// Pass the token to fetch a per-user salt; legacy servers fall back to the global salt.
export async function enableEncryption(
  serverUrl: string,
  passphrase: string,
  token?: string,
): Promise<{ ok: true; salt: string } | { ok: false; error: string }> {
  try {
    const kdf = await getKdf(serverUrl, token);
    const key = await deriveKey(passphrase, kdf.salt, kdf.iter);
    // Verify an encryption/decryption roundtrip before saving the key.
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

/**
 * Ask for an optional passphrase hint and save it to the server (PUT /kdf), so the user can
 * recall a forgotten passphrase where they unlock (web). The hint is a peripheral step:
 * saving it must never fail encryption — on error we warn and keep the exit code at 0.
 * Returns the saved hint, or null when skipped/not saved.
 */
export async function askHintAndSave(
  rl: readline.Interface,
  serverUrl: string,
  token: string,
  passphrase: string,
  opts: { hint?: string; interactive: boolean },
): Promise<string | null> {
  let raw = opts.hint;
  if (raw === undefined) {
    raw = await rl.question(
      "passphrase hint (optional; stored in PLAINTEXT on the server to jog your memory later — never write the passphrase itself; Enter to skip): ",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === passphrase) {
    if (!opts.interactive) {
      console.error("hint equals the passphrase; refusing to store it in plaintext (skipped)");
      return null;
    }
    const yes = (
      await rl.question("hint equals the passphrase and would be stored in plaintext; save anyway? [y/N] ")
    )
      .trim()
      .toLowerCase();
    if (yes !== "y" && yes !== "yes") return null;
  }
  try {
    await setKdfHint(serverUrl, token, trimmed);
    return trimmed;
  } catch (err) {
    // Peripheral step: encryption itself already succeeded — degrade, don't fail.
    console.error(
      `warning: e2ee is enabled, but the hint was not saved: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error("re-run `taskent encrypt` later to save the hint");
    return null;
  }
}

export async function runEncrypt(argv: string[]): Promise<void> {
  const flags: { passphrase?: string; hint?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--passphrase") flags.passphrase = argv[++i];
    else if (argv[i] === "--hint") flags.hint = argv[++i];
  }
  const config = loadConfig();
  if (!config) {
    console.error("taskent is not configured; run `taskent init` first");
    process.exitCode = 1;
    return;
  }

  const interactive = flags.passphrase === undefined;
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
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    console.error(`passphrase too short (min ${MIN_PASSPHRASE_LENGTH} chars); aborted`);
    process.exitCode = 1;
    return;
  }

  const result = await enableEncryption(config.serverUrl, passphrase, config.token);
  if (!result.ok) {
    console.error(`failed to enable e2ee: ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`e2ee enabled; derived key saved to ${keyFile()} (mode 0600)`);
  console.log("new reports will be encrypted; plaintext tasks remain readable");

  // Optional hint, asked only when interactive or explicitly provided via --hint
  // (a scripted --passphrase run without --hint stays prompt-free).
  if (interactive || flags.hint !== undefined) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const saved = await askHintAndSave(rl, config.serverUrl, config.token, passphrase, {
        hint: flags.hint,
        interactive,
      });
      if (saved !== null) console.log("hint saved on the server (plaintext; shown where you unlock)");
    } finally {
      rl.close();
    }
  }
}
