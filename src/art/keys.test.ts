import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveApiKey, tryResolveApiKey } from "./keys.ts";

async function tmpDirs() {
  const root = await mkdtemp(join(tmpdir(), "goldie-art-root-"));
  const appRoot = await mkdtemp(join(tmpdir(), "goldie-art-app-"));
  return { root, appRoot };
}

const KEY_NAMES = ["OPENAI_API_KEY", "FAL_KEY", "FAL_API_KEY"];

/**
 * Isolates both the env-var keys and XDG_CONFIG_HOME for the duration of
 * `fn`, so these tests never read (or could write) the real user's
 * ~/.config/goldie/credentials.json. A fresh empty tmp dir stands in for it
 * on every call unless the test itself seeds one.
 */
async function withoutEnvKeys<T>(fn: (credentialsDir: string) => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const name of [...KEY_NAMES, "XDG_CONFIG_HOME"]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  try {
    const credentialsDir = await mkdtemp(join(tmpdir(), "goldie-art-xdg-"));
    process.env.XDG_CONFIG_HOME = credentialsDir;
    return await fn(credentialsDir);
  } finally {
    for (const name of [...KEY_NAMES, "XDG_CONFIG_HOME"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

describe("resolveApiKey", () => {
  test("prefers the process environment", async () => {
    await withoutEnvKeys(async () => {
      process.env.OPENAI_API_KEY = "sk-from-env";
      const { root, appRoot } = await tmpDirs();
      expect(await resolveApiKey({ root, appRoot }, "openai")).toBe("sk-from-env");
    });
  });

  test("falls back to a .env next to the config", async () => {
    await withoutEnvKeys(async () => {
      const { root, appRoot } = await tmpDirs();
      await writeFile(join(root, ".env"), "OPENAI_API_KEY=sk-from-config-env\n");
      expect(await resolveApiKey({ root, appRoot }, "openai")).toBe("sk-from-config-env");
    });
  });

  test("then the user's credentials file", async () => {
    await withoutEnvKeys(async (credentialsDir) => {
      const { root, appRoot } = await tmpDirs();
      await mkdir(join(credentialsDir, "goldie"), { recursive: true });
      await writeFile(
        join(credentialsDir, "goldie", "credentials.json"),
        JSON.stringify({ FAL_KEY: "fal-from-credentials" }),
      );
      expect(await resolveApiKey({ root, appRoot }, "fal")).toBe("fal-from-credentials");
    });
  });

  test("the credentials file outranks the app repo's .env.local", async () => {
    await withoutEnvKeys(async (credentialsDir) => {
      const { root, appRoot } = await tmpDirs();
      await mkdir(join(credentialsDir, "goldie"), { recursive: true });
      await writeFile(
        join(credentialsDir, "goldie", "credentials.json"),
        JSON.stringify({ FAL_KEY: "fal-from-credentials" }),
      );
      await writeFile(join(appRoot, ".env.local"), 'FAL_KEY="fal-from-env-local"\n');
      expect(await resolveApiKey({ root, appRoot }, "fal")).toBe("fal-from-credentials");
    });
  });

  test("then the app repo's .env.local", async () => {
    await withoutEnvKeys(async () => {
      const { root, appRoot } = await tmpDirs();
      await writeFile(join(appRoot, ".env.local"), 'FAL_KEY="fal-from-env-local"\n');
      expect(await resolveApiKey({ root, appRoot }, "fal")).toBe("fal-from-env-local");
    });
  });

  test("then the app repo's .env, and accepts FAL_API_KEY as an alias for FAL_KEY", async () => {
    await withoutEnvKeys(async () => {
      const { root, appRoot } = await tmpDirs();
      await writeFile(join(appRoot, ".env"), "# a comment\nFAL_API_KEY=fal-from-dot-env\n");
      expect(await resolveApiKey({ root, appRoot }, "fal")).toBe("fal-from-dot-env");
    });
  });

  test("throws a clear error naming where it looked, when nothing provides the key", async () => {
    await withoutEnvKeys(async () => {
      const { root, appRoot } = await tmpDirs();
      await expect(resolveApiKey({ root, appRoot }, "openai")).rejects.toThrow("OPENAI_API_KEY");
      await expect(resolveApiKey({ root, appRoot }, "openai")).rejects.toThrow(root);
      await expect(resolveApiKey({ root, appRoot }, "openai")).rejects.toThrow("Settings");
    });
  });
});

describe("tryResolveApiKey", () => {
  test("returns undefined instead of throwing when the key is missing", async () => {
    await withoutEnvKeys(async () => {
      const { root, appRoot } = await tmpDirs();
      expect(await tryResolveApiKey({ root, appRoot }, "fal")).toBeUndefined();
    });
  });
});
