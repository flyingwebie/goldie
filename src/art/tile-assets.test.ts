import { describe, expect, test } from "bun:test";
import type { ArtAsset, ArtConfig, LoadedConfig, ScreenshotScene } from "../config.ts";
import { assetsForScene } from "./tile-assets.ts";

const root = "/tmp/app/goldie";

function asset(id: string, overrides: Partial<ArtAsset> = {}): ArtAsset {
  return { id, kind: "background", prompt: "a nook", ...overrides };
}

function art(assets: ArtAsset[]): ArtConfig {
  return { provider: "openai", style: "flat-illustration", assets };
}

function scene(id: string, overrides: Partial<ScreenshotScene> = {}): ScreenshotScene {
  return { kind: "screenshot", id, flow: id, headline: { en: "Hi" }, ...overrides };
}

function cfg(overrides: Partial<LoadedConfig>): LoadedConfig {
  return {
    root,
    theme: { background: "#fff", headlineColor: "#000", subheadColor: "#333" },
    scenes: [],
    ...overrides,
  } as unknown as LoadedConfig;
}

describe("assetsForScene", () => {
  test("throws for an id that is not a screenshot scene", () => {
    const c = cfg({ scenes: [{ kind: "preview", id: "preview", segments: [] }] });
    expect(() => assetsForScene(c, "preview")).toThrow('"preview" is not a screenshot scene');
    expect(() => assetsForScene(c, "missing")).toThrow('"missing" is not a screenshot scene');
  });

  test("finds the scene's own backgroundImage, as a config-relative art/<id>.png path", () => {
    const c = cfg({
      art: art([asset("hero-bg")]),
      scenes: [scene("home", { backgroundImage: "art/hero-bg.png" })],
    });
    expect(assetsForScene(c, "home")).toEqual([
      { id: "hero-bg", kind: "background", shared: false, label: "hero-bg" },
    ]);
  });

  test("ignores an image that is not one of cfg.art.assets (hand-placed, or outside the art dir)", () => {
    const c = cfg({
      art: art([asset("hero-bg")]),
      scenes: [scene("home", { backgroundImage: "assets/hand-drawn.png" })],
    });
    expect(assetsForScene(c, "home")).toEqual([]);
  });

  test("ignores 'none' and a tile with no art config at all", () => {
    const c1 = cfg({
      art: art([asset("hero-bg")]),
      scenes: [scene("home", { backgroundImage: "none" })],
    });
    expect(assetsForScene(c1, "home")).toEqual([]);
    const c2 = cfg({ scenes: [scene("home", { backgroundImage: "art/hero-bg.png" })] });
    expect(assetsForScene(c2, "home")).toEqual([]);
  });

  test("collects image decorations on the scene", () => {
    const c = cfg({
      art: art([asset("mascot", { kind: "character" })]),
      scenes: [
        scene("home", {
          decorations: [{ kind: "image", src: "art/mascot.png", x: 0.1, y: 0.1, width: 0.3 }],
        }),
      ],
    });
    expect(assetsForScene(c, "home")).toEqual([
      { id: "mascot", kind: "character", shared: false, label: "mascot" },
    ]);
  });

  test("marks the theme's backgroundImage, backdrop and decorations as shared", () => {
    const c = cfg({
      art: art([
        asset("bg"),
        asset("strip", { aspect: "strip" }),
        asset("sticker-1", { kind: "sticker" }),
      ]),
      theme: {
        background: "#fff",
        headlineColor: "#000",
        subheadColor: "#333",
        fontFamily: "sans-serif",
        copyHeightRatio: 0.3,
        deviceWidthRatio: 0.8,
        backgroundImage: "art/bg.png",
        backdrop: "art/strip.png",
        decorations: [{ kind: "image", src: "art/sticker-1.png", x: 0, y: 0, width: 0.2 }],
      },
      scenes: [scene("home")],
    });
    const found = assetsForScene(c, "home");
    expect(found).toHaveLength(3);
    expect(found).toContainEqual({
      id: "bg",
      kind: "background",
      shared: true,
      label: "Background (all tiles)",
    });
    expect(found).toContainEqual({
      id: "strip",
      kind: "background",
      shared: true,
      label: "Backdrop (all tiles)",
    });
    expect(found).toContainEqual({
      id: "sticker-1",
      kind: "sticker",
      shared: true,
      label: "sticker-1",
    });
  });

  test("deduplicates an asset referenced more than once (e.g. scene backgroundImage and a theme image)", () => {
    const c = cfg({
      art: art([asset("bg")]),
      theme: {
        background: "#fff",
        headlineColor: "#000",
        subheadColor: "#333",
        fontFamily: "sans-serif",
        copyHeightRatio: 0.3,
        deviceWidthRatio: 0.8,
        backgroundImage: "art/bg.png",
      },
      scenes: [scene("home", { backgroundImage: "art/bg.png" })],
    });
    expect(assetsForScene(c, "home")).toHaveLength(1);
  });
});
