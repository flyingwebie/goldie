import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A per-user credentials file for AI art API keys, so a user never has to
 * paste a key into the app repo's `.env`: written from the studio's Settings
 * view, read by `src/art/keys.ts` as one of the places a key can live.
 *
 * `$XDG_CONFIG_HOME/goldie/credentials.json` (default `~/.config/goldie`),
 * or `%APPDATA%\goldie\credentials.json` on Windows. The directory is
 * created mode 0700 and the file mode 0600 - best effort; some filesystems
 * (notably Windows) ignore POSIX modes. Values are never logged.
 */
export type CredentialsKey = "OPENAI_API_KEY" | "FAL_KEY";

export type Credentials = Partial<Record<CredentialsKey, string>>;

export function credentialsPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "goldie", "credentials.json");
  }
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "goldie", "credentials.json");
}

/** Reads the credentials file; an absent or unreadable/malformed file reads as empty. */
export async function readCredentials(path: string = credentialsPath()): Promise<Credentials> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Credentials) : {};
  } catch {
    return {};
  }
}

async function writeCredentials(path: string, creds: Credentials): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {}); // mkdir's mode is masked by umask; force it
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  await rename(tmp, path);
}

/** Sets one key's value, leaving the others (and the rest of the file) alone. */
export async function setCredential(
  key: CredentialsKey,
  value: string,
  path: string = credentialsPath(),
): Promise<void> {
  const current = await readCredentials(path);
  await writeCredentials(path, { ...current, [key]: value });
}

/** Removes one key; deletes the file entirely once it would be empty. */
export async function deleteCredential(
  key: CredentialsKey,
  path: string = credentialsPath(),
): Promise<void> {
  const current = await readCredentials(path);
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  if (Object.keys(next).length === 0) {
    await rm(path, { force: true });
    return;
  }
  await writeCredentials(path, next);
}

/** The last 4 characters of a key, for a status chip; never the full value. */
export function last4(value: string): string {
  return value.slice(-4);
}
