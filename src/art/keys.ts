import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Credentials, readCredentials } from "../credentials.ts";

/** Which of the four places actually supplied a key, for the studio's Settings view. */
export type KeySource = "env" | "project" | "user" | "app";

/**
 * Locates the API key for an art provider, and where it came from. Looked
 * up in order: the process environment, a `.env` next to the config, the
 * user's credentials file (written from the studio's Settings view; see
 * src/credentials.ts), then the app repo's `.env.local` and `.env` - only
 * ever reading the one or two variable names a given provider needs, never
 * logging a value. Returns undefined when nothing provides it.
 */
export async function locateApiKey(
  cfg: { root: string; appRoot: string },
  provider: "openai" | "fal",
): Promise<{ value: string; source: KeySource } | undefined> {
  const names = provider === "openai" ? ["OPENAI_API_KEY"] : ["FAL_KEY", "FAL_API_KEY"];
  for (const name of names) {
    const value = process.env[name];
    if (value) return { value, source: "env" };
  }

  const configVars = await readEnvFile(join(cfg.root, ".env"));
  for (const name of names) {
    const value = configVars[name];
    if (value) return { value, source: "project" };
  }

  const credentials = await readCredentials();
  const fromCredentials = credentialKey(credentials, provider);
  if (fromCredentials) return { value: fromCredentials, source: "user" };

  const appSources = [join(cfg.appRoot, ".env.local"), join(cfg.appRoot, ".env")];
  for (const file of appSources) {
    const vars = await readEnvFile(file);
    for (const name of names) {
      const value = vars[name];
      if (value) return { value, source: "app" };
    }
  }

  return undefined;
}

/**
 * Resolves the API key for an art provider, throwing a message naming
 * every place it looked. See `locateApiKey` for the lookup order.
 */
export async function resolveApiKey(
  cfg: { root: string; appRoot: string },
  provider: "openai" | "fal",
): Promise<string> {
  const located = await locateApiKey(cfg, provider);
  if (located) return located.value;

  const names = provider === "openai" ? ["OPENAI_API_KEY"] : ["FAL_KEY", "FAL_API_KEY"];
  const appSources = [join(cfg.appRoot, ".env.local"), join(cfg.appRoot, ".env")];
  throw new Error(
    `Missing ${names.join(" or ")}. Looked in the environment, ${join(cfg.root, ".env")}, your ` +
      `user settings (add it in the studio's Settings), and: ${appSources.join(", ")}.`,
  );
}

/** The credentials file keys both OpenAI and fal under one name each. */
function credentialKey(creds: Credentials, provider: "openai" | "fal"): string | undefined {
  return provider === "openai" ? creds.OPENAI_API_KEY : creds.FAL_KEY;
}

/** Same lookup, returning undefined instead of throwing when the key is absent. */
export async function tryResolveApiKey(
  cfg: { root: string; appRoot: string },
  provider: "openai" | "fal",
): Promise<string | undefined> {
  return (await locateApiKey(cfg, provider))?.value;
}

/** A minimal `.env` parser: `KEY=VALUE` lines, `#` comments, optional quotes. */
async function readEnvFile(file: string): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return {};
  }
  const vars: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}
