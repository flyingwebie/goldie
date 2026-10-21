import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Resolves the API key for an art provider. Looked up in order: the process
 * environment, a `.env` next to the config, then the app repo's `.env.local`
 * and `.env` - only ever reading the one or two variable names a given
 * provider needs, never logging a value.
 */
export async function resolveApiKey(
  cfg: { root: string; appRoot: string },
  provider: "openai" | "fal",
): Promise<string> {
  const names = provider === "openai" ? ["OPENAI_API_KEY"] : ["FAL_KEY", "FAL_API_KEY"];
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  const sources = [
    join(cfg.root, ".env"),
    join(cfg.appRoot, ".env.local"),
    join(cfg.appRoot, ".env"),
  ];
  for (const file of sources) {
    const vars = await readEnvFile(file);
    for (const name of names) {
      const value = vars[name];
      if (value) return value;
    }
  }

  throw new Error(
    `Missing ${names.join(" or ")}. Looked in the environment and: ${sources.join(", ")}.`,
  );
}

/** Same lookup, returning undefined instead of throwing when the key is absent. */
export async function tryResolveApiKey(
  cfg: { root: string; appRoot: string },
  provider: "openai" | "fal",
): Promise<string | undefined> {
  try {
    return await resolveApiKey(cfg, provider);
  } catch {
    return undefined;
  }
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
