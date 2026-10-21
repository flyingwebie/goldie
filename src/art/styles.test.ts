import { describe, expect, test } from "bun:test";
import { ART_STYLE_KEYS, ART_STYLES, isArtStyleKey, stylePrompt } from "./styles.ts";

describe("ART_STYLES", () => {
  test("has every style the brief asks for", () => {
    for (const key of [
      "3d-inflated",
      "clay-3d",
      "hand-drawn",
      "comic-ink",
      "flat-illustration",
      "photo-real",
      "editorial-collage",
      "notebook-doodle",
    ]) {
      expect(isArtStyleKey(key)).toBe(true);
    }
  });

  test("every preset carries a full set of fields", () => {
    for (const key of ART_STYLE_KEYS) {
      const style = ART_STYLES[key];
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.prompt.length).toBeGreaterThan(0);
      expect(style.avoid.length).toBeGreaterThan(0);
      expect(style.transparentHint.length).toBeGreaterThan(0);
      expect(style.fonts.length).toBeGreaterThan(0);
      expect(style.bestFor.length).toBeGreaterThan(0);
    }
  });
});

describe("stylePrompt", () => {
  test("resolves a preset key to its prompt fragment", () => {
    expect(stylePrompt("clay-3d")).toBe(ART_STYLES["clay-3d"].prompt);
  });

  test("passes free text straight through", () => {
    expect(stylePrompt("a watercolor sunset")).toBe("a watercolor sunset");
  });
});
