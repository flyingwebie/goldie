import { describe, expect, test } from "bun:test";
import type { ArtAsset, ArtConfig } from "../config.ts";
import { buildPrompt, defaultAspect, isTransparentKind, styleForKind } from "./prompt.ts";

function art(overrides: Partial<ArtConfig> = {}): ArtConfig {
  return { provider: "openai", style: "flat-illustration", assets: [], ...overrides };
}

function asset(overrides: Partial<ArtAsset> = {}): ArtAsset {
  return { id: "hero", kind: "background", prompt: "a cozy reading nook", ...overrides };
}

describe("isTransparentKind / defaultAspect", () => {
  test("backgrounds and scenes are opaque and default to portrait", () => {
    expect(isTransparentKind("background")).toBe(false);
    expect(isTransparentKind("scene")).toBe(false);
    expect(defaultAspect("background")).toBe("portrait");
    expect(defaultAspect("scene")).toBe("portrait");
  });

  test("characters, objects and stickers are transparent and default to square", () => {
    for (const kind of ["character", "object", "sticker"] as const) {
      expect(isTransparentKind(kind)).toBe(true);
      expect(defaultAspect(kind)).toBe("square");
    }
  });
});

describe("buildPrompt", () => {
  test("includes the asset's own prompt and never asks for a device, UI, logo or text", () => {
    const prompt = buildPrompt(asset(), art());
    expect(prompt).toContain("a cozy reading nook");
    expect(prompt).toContain("never draw a phone, tablet, laptop or any device frame");
    expect(prompt).toContain("never render any text");
  });

  test("a background/scene leaves room for the headline and forbids devices", () => {
    const prompt = buildPrompt(asset({ kind: "background" }), art());
    expect(prompt).toContain("top");
    expect(prompt).toContain("30%");
    expect(prompt).toContain("no phone or device of any kind");
  });

  test("a character asks for a full-body isolated subject", () => {
    const prompt = buildPrompt(asset({ kind: "character", prompt: "a hamster" }), art());
    expect(prompt).toContain("full body in frame");
    expect(prompt).toContain("plain flat background");
  });

  test("resolves a style preset into its rich prompt fragment, avoid and transparent hint", () => {
    const prompt = buildPrompt(
      asset({ kind: "character", prompt: "a hamster" }),
      art({ style: "clay-3d" }),
    );
    expect(prompt).toContain("claymation 3D render");
    expect(prompt).toContain("no photorealism");
    expect(prompt).toContain("so it can be cut out cleanly");
  });

  test("an opaque kind does not get the transparent hint even for a preset style", () => {
    const prompt = buildPrompt(asset({ kind: "background" }), art({ style: "clay-3d" }));
    expect(prompt).not.toContain("so it can be cut out cleanly");
  });

  test("free-text style passes through unchanged", () => {
    const prompt = buildPrompt(asset(), art({ style: "a rainy neon cyberpunk alley" }));
    expect(prompt).toContain("a rainy neon cyberpunk alley");
  });

  test("weaves in the palette and app context when given", () => {
    const prompt = buildPrompt(asset(), art({ palette: ["#ff0000", "#00ff00"] }), {
      storeName: "Ellie",
      storeCategory: "Productivity",
    });
    expect(prompt).toContain("color palette: #ff0000, #00ff00");
    expect(prompt).toContain("Productivity");
    expect(prompt).toContain("Ellie");
  });

  test("omits the palette and context lines when absent", () => {
    const prompt = buildPrompt(asset(), art());
    expect(prompt).not.toContain("color palette");
    expect(prompt).not.toContain("art for the");
  });
});

describe("styleForKind", () => {
  const fragment =
    "flat vector illustration, soft color, isolated subject, centered, generous empty margin";
  test("drops lone-subject clauses from full-frame backgrounds", () => {
    expect(styleForKind(fragment, false)).toBe("flat vector illustration, soft color");
  });
  test("keeps them for cutouts", () => {
    expect(styleForKind(fragment, true)).toBe(fragment);
  });
});
