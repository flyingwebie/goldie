import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { ArtConfig, LoadedConfig } from "../config.ts";
import { runArt } from "./index.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
});

async function tmpDir() {
  return mkdtemp(join(tmpdir(), "goldie-art-index-"));
}

function minimalConfig(root: string, art: ArtConfig): LoadedConfig {
  return {
    appRoot: root,
    appPath: "/tmp/app.app",
    bundleId: "com.example.app",
    devices: ["iphone-6.9"],
    locales: ["en-US"],
    appearance: "light",
    frame: { variant: "17-pro-silver" },
    theme: {
      background: "#ffffff",
      headlineColor: "#000000",
      subheadColor: "#333333",
      fontFamily: "system",
      copyHeightRatio: 0.3,
      deviceWidthRatio: 0.7,
    },
    store: {
      name: "Testy",
      subtitle: { "en-US": "Test" },
      developer: "Dev",
      category: "Productivity",
      rating: 4.8,
      ratingCount: "1k",
      ageRating: "4+",
      price: "Free",
      description: { "en-US": "desc" },
    },
    scenes: [],
    art,
    root,
    configPath: resolve(root, "goldie.config.ts"),
    flowsDir: resolve(root, ".argent/flows"),
    outDir: resolve(root, "out"),
  };
}

async function tinyPngBase64(): Promise<string> {
  return (await createCanvas(2, 2).encode("png")).toString("base64");
}

type Call = { url: string; init?: RequestInit };

function mockOpenAI(calls: Call[], b64: string) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
  }) as typeof fetch;
}

describe("runArt", () => {
  test("dryRun plans every asset and calls no provider", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const art: ArtConfig = {
      provider: "openai",
      style: "flat-illustration",
      assets: [{ id: "hero-bg", kind: "background", prompt: "a cozy reading nook" }],
    };
    const results = await runArt(minimalConfig(root, art), { dryRun: true });

    expect(results).toEqual([
      {
        id: "hero-bg",
        file: resolve(root, "art", "hero-bg.png"),
        status: "planned",
        estimatedUsd: 0.2,
      },
    ]);
    expect(calls).toHaveLength(0);
  });

  test("generates once, then reuses the cache on the next run", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const art: ArtConfig = {
      provider: "openai",
      style: "flat-illustration",
      assets: [{ id: "hero-bg", kind: "background", prompt: "a cozy reading nook" }],
    };
    const cfg = minimalConfig(root, art);

    const first = await runArt(cfg, {});
    expect(first).toEqual([
      {
        id: "hero-bg",
        file: resolve(root, "art", "hero-bg.png"),
        status: "generated",
        estimatedUsd: 0.2,
      },
    ]);
    expect(calls).toHaveLength(1);

    const second = await runArt(cfg, {});
    expect(second[0]!.status).toBe("cached");
    expect(second[0]!.estimatedUsd).toBe(0);
    expect(calls).toHaveLength(1); // no new network call
  });

  test("force regenerates even a fresh, cached asset", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const art: ArtConfig = {
      provider: "openai",
      style: "flat-illustration",
      assets: [{ id: "hero-bg", kind: "background", prompt: "a cozy reading nook" }],
    };
    const cfg = minimalConfig(root, art);

    await runArt(cfg, {});
    expect(calls).toHaveLength(1);

    const forced = await runArt(cfg, { force: true });
    expect(forced[0]!.status).toBe("generated");
    expect(calls).toHaveLength(2);
  });

  test("a changed prompt busts the cache even without --force", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const cfg1 = minimalConfig(root, {
      provider: "openai",
      style: "flat-illustration",
      assets: [{ id: "hero-bg", kind: "background", prompt: "a cozy reading nook" }],
    });
    await runArt(cfg1, {});
    expect(calls).toHaveLength(1);

    const cfg2 = minimalConfig(root, {
      provider: "openai",
      style: "flat-illustration",
      assets: [{ id: "hero-bg", kind: "background", prompt: "a sunny kitchen" }],
    });
    const result = await runArt(cfg2, {});
    expect(result[0]!.status).toBe("generated");
    expect(calls).toHaveLength(2);
  });

  test("refuses to spend past art.budgetUsd without --yes", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const art: ArtConfig = {
      provider: "openai",
      style: "flat-illustration",
      budgetUsd: 0.05, // one final-quality openai image already estimates to $0.20
      assets: [{ id: "hero-bg", kind: "background", prompt: "a cozy reading nook" }],
    };

    await expect(runArt(minimalConfig(root, art), {})).rejects.toThrow("budget");
    expect(calls).toHaveLength(0); // refused before spending anything
  });

  test("--yes proceeds past the budget", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const art: ArtConfig = {
      provider: "openai",
      style: "flat-illustration",
      budgetUsd: 0.05,
      assets: [{ id: "hero-bg", kind: "background", prompt: "a cozy reading nook" }],
    };

    const result = await runArt(minimalConfig(root, art), { yes: true });
    expect(result[0]!.status).toBe("generated");
    expect(calls).toHaveLength(1);
  });

  test("--only narrows the run to the named assets", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const art: ArtConfig = {
      provider: "openai",
      style: "flat-illustration",
      assets: [
        { id: "hero-bg", kind: "background", prompt: "a nook" },
        { id: "mascot", kind: "character", prompt: "a hamster" },
      ],
    };

    const result = await runArt(minimalConfig(root, art), { only: ["hero-bg"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("hero-bg");
    expect(calls).toHaveLength(1);
  });

  test("rejects an unknown id in --only before spending anything", async () => {
    const root = await tmpDir();
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: Call[] = [];
    mockOpenAI(calls, await tinyPngBase64());

    const art: ArtConfig = {
      provider: "openai",
      style: "flat-illustration",
      assets: [{ id: "hero-bg", kind: "background", prompt: "a nook" }],
    };

    await expect(runArt(minimalConfig(root, art), { only: ["does-not-exist"] })).rejects.toThrow(
      "does-not-exist",
    );
    expect(calls).toHaveLength(0);
  });
});
