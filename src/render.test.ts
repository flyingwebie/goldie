import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { loadConfig } from "./config.ts";
import { pngInfo } from "./image.ts";
import { renderScreenshots } from "./render.ts";

/** A temp app dir with a synthetic capture, one art PNG and a config using every layer kind. */
function fixture(extra = "") {
  const root = mkdtempSync(join(tmpdir(), "goldie-render-"));
  const raw = join(root, "out", "raw", "iphone-6.9");
  mkdirSync(raw, { recursive: true });
  const shot = createCanvas(1320, 2868);
  const c = shot.getContext("2d");
  c.fillStyle = "#f4f4f4";
  c.fillRect(0, 0, 1320, 2868);
  c.fillStyle = "#2a7";
  c.fillRect(60, 1200, 1200, 300);
  writeFileSync(join(raw, "shot.png"), shot.toBuffer("image/png"));
  const art = createCanvas(200, 200);
  art.getContext("2d").fillRect(50, 50, 100, 100);
  writeFileSync(join(root, "sticker.png"), art.toBuffer("image/png"));
  writeFileSync(
    join(raw, "manifest.json"),
    JSON.stringify({
      device: "iphone-6.9",
      udid: "x",
      capturedAt: "",
      preview: null,
      screenshots: ["a", "b"].map((id) => ({ sceneId: id, file: join(raw, "shot.png") })),
    }),
  );
  writeFileSync(
    join(root, "goldie.config.ts"),
    `export default {
      appRoot: ${JSON.stringify(root)}, appPath: "/x.app", bundleId: "x",
      devices: ["iphone-6.9"], locales: ["en-US"], appearance: "light",
      frame: { variant: "17-pro-silver" },
      theme: { background: "#ffffff", headlineColor: "#111111", subheadColor: "#555555",
        fontFamily: '"Bricolage Grotesque", sans-serif', copyHeightRatio: 0.24, deviceWidthRatio: 0.84,
        accentColor: "#e44b2a", emphasis: "circle", backdrop: "sticker.png",
        headline: { scale: 1.2, uppercase: true, stroke: { color: "#000", width: 0.004 } } ${extra} },
      store: { name: "X", subtitle: {}, developer: "", category: "", rating: 5, ratingCount: "", ageRating: "", price: "", description: {} },
      scenes: [
        { kind: "screenshot", id: "a", flow: "a", layout: "hero", kicker: { "en-US": "for rescuers" },
          headline: { "en-US": "Every animal *counts*" },
          decorations: [
            { kind: "image", src: "sticker.png", x: 0.6, y: 0.6, width: 0.3, layer: "front", flip: true, shadow: true },
            { kind: "callout", from: { x: 0.05, y: 0.4, width: 0.9, height: 0.12 }, x: 0.04, y: 0.55, width: 0.92, rotate: -3, border: "#fff" },
            { kind: "bubble", text: { "en-US": "I found a hurt hedgehog!" }, x: 0.1, y: 0.3, width: 0.6, font: "script", tail: "bottom-right" },
            { kind: "rating", value: "4.9", label: { "en-US": "Loved by 40+ centres" }, x: 0.25, y: 0.85, width: 0.5, background: "#fff" },
            { kind: "badge", text: { "en-US": "New" }, position: "top-right" },
          ] },
        { kind: "screenshot", id: "b", flow: "b", layout: "poster", headline: { "en-US": "A *poster* tile" } },
      ],
    };`,
  );
  return root;
}

describe("renderScreenshots with emotional layers", () => {
  test("draws every layer kind to store-sized opaque tiles", async () => {
    const root = fixture();
    const cfg = await loadConfig(join(root, "goldie.config.ts"));
    const files = await renderScreenshots(cfg, "iphone-6.9", "en-US");
    expect(files.map((f) => f.split("/").pop())).toEqual(["01-a.png", "02-b.png"]);
    for (const f of files) {
      const info = await pngInfo(f);
      expect([info.width, info.height, info.hasAlpha]).toEqual([1320, 2868, false]);
    }
  }, 30000);

  test("rejects a callout region outside the capture", async () => {
    const root = fixture(
      `, decorations: [{ kind: "callout", from: { x: 0.5, y: 0.5, width: 0.8, height: 0.1 }, x: 0, y: 0, width: 1 }]`,
    );
    await expect(loadConfig(join(root, "goldie.config.ts"))).rejects.toThrow(/inside the capture/);
  });

  test("rejects an unknown emphasis style", async () => {
    // The fixture already sets emphasis; a later key wins in an object literal.
    const root = fixture(`, emphasis: "sparkle"`);
    await expect(loadConfig(join(root, "goldie.config.ts"))).rejects.toThrow(/theme.emphasis/);
  });
});

describe("studio art settings", () => {
  test("create an art block when the config has none", async () => {
    const { applyDesign } = await import("./config.ts");
    const root = fixture();
    const cfg = await loadConfig(join(root, "goldie.config.ts"));
    expect(cfg.art).toBeUndefined();
    applyDesign(cfg, { art: { provider: "openai", model: "gpt-image-1.5", style: "clay-3d" } });
    expect(cfg.art).toEqual({
      provider: "openai",
      style: "clay-3d",
      assets: [],
      model: "gpt-image-1.5",
    });
  });
});
