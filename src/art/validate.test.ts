import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtConfig } from "../config.ts";
import { validateArt } from "./validate.ts";

async function tmpDir() {
  return mkdtemp(join(tmpdir(), "goldie-art-validate-"));
}

function art(overrides: Partial<ArtConfig> = {}): ArtConfig {
  return { provider: "openai", style: "flat-illustration", assets: [], ...overrides };
}

describe("validateArt", () => {
  test("passes with no art config at all", () => {
    expect(() => validateArt({ root: "/tmp" })).not.toThrow();
  });

  test("passes a well-formed config", async () => {
    const root = await tmpDir();
    expect(() =>
      validateArt({
        root,
        art: art({ assets: [{ id: "hero-bg", kind: "background", prompt: "a nook" }] }),
      }),
    ).not.toThrow();
  });

  test("rejects an id that is not file-name safe", async () => {
    const root = await tmpDir();
    expect(() =>
      validateArt({
        root,
        art: art({ assets: [{ id: "Hero BG!", kind: "background", prompt: "a nook" }] }),
      }),
    ).toThrow("Hero BG!");
  });

  test("rejects a duplicate id", async () => {
    const root = await tmpDir();
    expect(() =>
      validateArt({
        root,
        art: art({
          assets: [
            { id: "hero", kind: "background", prompt: "a" },
            { id: "hero", kind: "object", prompt: "b" },
          ],
        }),
      }),
    ).toThrow("Duplicate");
  });

  test("rejects an unknown kind", async () => {
    const root = await tmpDir();
    expect(() =>
      validateArt({
        root,
        art: art({
          // @ts-expect-error intentionally invalid at runtime
          assets: [{ id: "hero", kind: "poster", prompt: "a" }],
        }),
      }),
    ).toThrow("unknown kind");
  });

  test("rejects a missing shared reference", async () => {
    const root = await tmpDir();
    expect(() =>
      validateArt({
        root,
        art: art({
          references: ["mascot.png"],
          assets: [{ id: "hero", kind: "background", prompt: "a" }],
        }),
      }),
    ).toThrow("art.references");
  });

  test("rejects a missing per-asset reference, and accepts one that exists", async () => {
    const root = await tmpDir();
    await writeFile(join(root, "logo.png"), "fake-png-bytes");
    expect(() =>
      validateArt({
        root,
        art: art({
          assets: [{ id: "hero", kind: "background", prompt: "a", references: ["missing.png"] }],
        }),
      }),
    ).toThrow("a missing file");

    expect(() =>
      validateArt({
        root,
        art: art({
          assets: [{ id: "hero", kind: "background", prompt: "a", references: ["logo.png"] }],
        }),
      }),
    ).not.toThrow();
  });
});
