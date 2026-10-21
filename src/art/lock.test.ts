import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeHash, fileExists, hashParts, isFresh, loadLock, saveLock } from "./lock.ts";

async function tmpDir() {
  return mkdtemp(join(tmpdir(), "goldie-art-lock-"));
}

function hashInput(overrides: Partial<Parameters<typeof computeHash>[0]> = {}) {
  return {
    prompt: "a cozy reading nook",
    provider: "openai",
    model: "gpt-image-1.5",
    aspect: "portrait" as const,
    transparent: false,
    quality: "final" as const,
    references: [] as Buffer[],
    ...overrides,
  };
}

describe("computeHash", () => {
  test("is deterministic", () => {
    expect(computeHash(hashInput())).toBe(computeHash(hashInput()));
  });

  test("changes when the prompt changes", () => {
    expect(computeHash(hashInput())).not.toBe(computeHash(hashInput({ prompt: "different" })));
  });

  test("changes when the provider, model, aspect, transparency or quality changes", () => {
    const base = computeHash(hashInput());
    expect(computeHash(hashInput({ provider: "fal" }))).not.toBe(base);
    expect(computeHash(hashInput({ model: "gpt-image-2" }))).not.toBe(base);
    expect(computeHash(hashInput({ aspect: "square" }))).not.toBe(base);
    expect(computeHash(hashInput({ transparent: true }))).not.toBe(base);
    expect(computeHash(hashInput({ quality: "draft" }))).not.toBe(base);
  });

  test("changes with reference image bytes, including their order", () => {
    const a = Buffer.from("aaa");
    const b = Buffer.from("bbb");
    const base = computeHash(hashInput({ references: [a] }));
    expect(computeHash(hashInput({ references: [a, b] }))).not.toBe(base);
    expect(computeHash(hashInput({ references: [b, a] }))).not.toBe(
      computeHash(hashInput({ references: [a, b] })),
    );
  });
});

describe("hashParts", () => {
  test("hashes an ordered mix of strings and buffers deterministically", () => {
    const h1 = hashParts("a", Buffer.from("b"), "c");
    const h2 = hashParts("a", Buffer.from("b"), "c");
    expect(h1).toBe(h2);
    expect(hashParts("a", Buffer.from("b"), "c")).not.toBe(hashParts("c", Buffer.from("b"), "a"));
  });
});

describe("loadLock / saveLock", () => {
  test("round-trips through disk, and loadLock tolerates a missing file", async () => {
    const dir = await tmpDir();
    expect(await loadLock(dir)).toEqual({});

    const lock = {
      hero: {
        hash: "abc",
        provider: "openai" as const,
        model: "gpt-image-1.5",
        quality: "final" as const,
        prompt: "p",
        file: "hero.png",
        createdAt: new Date().toISOString(),
        estimatedUsd: 0.2,
      },
    };
    await saveLock(dir, lock);
    expect(await loadLock(dir)).toEqual(lock);
  });
});

describe("isFresh", () => {
  test("stale when there is no lock entry", async () => {
    const dir = await tmpDir();
    const file = join(dir, "hero.png");
    expect(await isFresh({}, "hero", file, "hash-1", false)).toBe(false);
  });

  test("stale when the hash no longer matches", async () => {
    const dir = await tmpDir();
    const file = join(dir, "hero.png");
    await writeFile(file, "bytes");
    const lock = {
      hero: {
        hash: "old-hash",
        provider: "openai" as const,
        model: "m",
        quality: "final" as const,
        prompt: "p",
        file: "hero.png",
        createdAt: "now",
        estimatedUsd: 0,
      },
    };
    expect(await isFresh(lock, "hero", file, "new-hash", false)).toBe(false);
  });

  test("stale when the output file was deleted even though the hash matches", async () => {
    const dir = await tmpDir();
    const file = join(dir, "hero.png");
    const lock = {
      hero: {
        hash: "hash-1",
        provider: "openai" as const,
        model: "m",
        quality: "final" as const,
        prompt: "p",
        file: "hero.png",
        createdAt: "now",
        estimatedUsd: 0,
      },
    };
    expect(await fileExists(file)).toBe(false);
    expect(await isFresh(lock, "hero", file, "hash-1", false)).toBe(false);
  });

  test("fresh when the hash matches and the file is on disk", async () => {
    const dir = await tmpDir();
    const file = join(dir, "hero.png");
    await writeFile(file, "bytes");
    const lock = {
      hero: {
        hash: "hash-1",
        provider: "openai" as const,
        model: "m",
        quality: "final" as const,
        prompt: "p",
        file: "hero.png",
        createdAt: "now",
        estimatedUsd: 0,
      },
    };
    expect(await isFresh(lock, "hero", file, "hash-1", false)).toBe(true);
  });

  test("force always counts as stale, even when otherwise fresh", async () => {
    const dir = await tmpDir();
    const file = join(dir, "hero.png");
    await writeFile(file, "bytes");
    const lock = {
      hero: {
        hash: "hash-1",
        provider: "openai" as const,
        model: "m",
        quality: "final" as const,
        prompt: "p",
        file: "hero.png",
        createdAt: "now",
        estimatedUsd: 0,
      },
    };
    expect(await isFresh(lock, "hero", file, "hash-1", true)).toBe(false);
  });
});
