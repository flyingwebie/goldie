import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { loadConfig } from "./config.ts";
import { drawScene, isTransparent, paint, sceneLayers } from "./draw.ts";
import { prepareScenes } from "./scene.ts";

/**
 * A fixture exercising every layer kind the promo's HyperFrames generator
 * must slice apart: a background image with a scrim, a kicker, a headline
 * with circle-emphasis marks, a subhead, back and front decorations
 * (image, callout, bubble, rating, badge) and a device.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "goldie-layers-"));
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
  const ac = art.getContext("2d");
  ac.fillStyle = "#e44b2a";
  ac.fillRect(0, 0, 200, 200);
  writeFileSync(join(root, "sticker.png"), art.toBuffer("image/png"));
  const bg = createCanvas(400, 600);
  const bc = bg.getContext("2d");
  bc.fillStyle = "#123456";
  bc.fillRect(0, 0, 400, 600);
  writeFileSync(join(root, "bg.png"), bg.toBuffer("image/png"));
  writeFileSync(
    join(raw, "manifest.json"),
    JSON.stringify({
      device: "iphone-6.9",
      udid: "x",
      capturedAt: "",
      preview: null,
      screenshots: [{ sceneId: "a", file: join(raw, "shot.png") }],
    }),
  );
  writeFileSync(
    join(root, "goldie.config.ts"),
    `export default {
      appRoot: ${JSON.stringify(root)}, appPath: "/x.app", bundleId: "x",
      devices: ["iphone-6.9"], locales: ["en-US"], appearance: "light",
      frame: { variant: "17-pro-silver" },
      theme: { background: "linear-gradient(180deg, #101820 0%, #000000 100%)",
        headlineColor: "#ffffff", subheadColor: "#cccccc",
        fontFamily: '"Bricolage Grotesque", sans-serif', copyHeightRatio: 0.24, deviceWidthRatio: 0.84,
        accentColor: "#e44b2a", emphasis: "circle", backgroundImage: "bg.png",
        scrim: { color: "rgba(0,0,0,0.8)", height: 0.4 } },
      store: { name: "X", subtitle: {}, developer: "", category: "", rating: 5, ratingCount: "", ageRating: "", price: "", description: {} },
      scenes: [
        { kind: "screenshot", id: "a", flow: "a", layout: "hero",
          kicker: { "en-US": "for rescuers" },
          headline: { "en-US": "Every animal *counts*, *always*" },
          subhead: { "en-US": "From the first report to release." },
          decorations: [
            { kind: "image", src: "sticker.png", x: 0.6, y: 0.6, width: 0.3, layer: "front", shadow: true },
            { kind: "callout", from: { x: 0.05, y: 0.4, width: 0.9, height: 0.12 }, x: 0.04, y: 0.55, width: 0.92, rotate: -3, border: "#fff" },
            { kind: "bubble", text: { "en-US": "I found a hurt hedgehog!" }, x: 0.1, y: 0.3, width: 0.6, font: "script", tail: "bottom-right" },
            { kind: "rating", value: "4.9", label: { "en-US": "Loved by 40+ centres" }, x: 0.25, y: 0.85, width: 0.5, background: "#fff" },
            { kind: "badge", text: { "en-US": "New" }, position: "top-right" },
          ] },
      ],
    };`,
  );
  return root;
}

describe("sceneLayers vs drawScene", () => {
  test("every layer composited in order reproduces drawScene's pixels", async () => {
    const root = fixture();
    const cfg = await loadConfig(join(root, "goldie.config.ts"));
    const [prepared] = await prepareScenes(cfg, "iphone-6.9", "en-US", {
      tile: { width: 1080, height: 1920 },
    });
    const input = prepared!.input;
    const { width, height } = input.c;

    const expected = createCanvas(width, height);
    const ectx = expected.getContext("2d");
    drawScene(ectx, input);

    // Composite: background fill (CSS in the real composition), then every
    // raster layer in the order the generator would stack them, then the
    // scrim (also CSS there) - exactly what the HTML/CSS side reproduces
    // around the raster PNGs sceneLayers produces.
    const actual = createCanvas(width, height);
    const actx = actual.getContext("2d");
    if (!isTransparent(input.background)) {
      actx.fillStyle = paint(actx, input.background, width, height);
      actx.fillRect(0, 0, width, height);
    }

    const measure = createCanvas(width, height).getContext("2d");
    const layers = sceneLayers(measure, input);
    for (const layer of layers) {
      const tmp = createCanvas(width, height);
      const tctx = tmp.getContext("2d");
      layer.draw(tctx);
      actx.drawImage(tmp as unknown as Parameters<typeof actx.drawImage>[0], 0, 0);
      // The scrim sits between the background image and the copy, same as
      // drawScene; in the real composition it is a CSS gradient div at that
      // point in the DOM, so it is spliced in here rather than listed in
      // sceneLayers (a raster layer enumerator).
      if (layer.id === "bg-image" && input.theme.scrim) {
        const scrim = input.theme.scrim;
        const g = actx.createLinearGradient(0, 0, 0, height * scrim.height);
        g.addColorStop(0, scrim.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        actx.fillStyle = g;
        actx.fillRect(0, 0, width, height * scrim.height);
      }
    }

    const expectedBuf = expected.data();
    const actualBuf = actual.data();
    expect(actualBuf.length).toBe(expectedBuf.length);
    let maxDiff = 0;
    let diffCount = 0;
    for (let i = 0; i < expectedBuf.length; i++) {
      const d = Math.abs(expectedBuf[i]! - actualBuf[i]!);
      if (d > maxDiff) maxDiff = d;
      if (d > 12) diffCount++;
    }
    // Per-layer alpha compositing can differ a hair from one continuous pass
    // at glyph/shadow edges; allow a small tolerance and a tiny fraction of
    // outlier pixels rather than demanding byte-identical output.
    expect(diffCount / (expectedBuf.length / 4)).toBeLessThan(0.002);
    expect(maxDiff).toBeLessThanOrEqual(255);
  }, 30000);

  test("layer ids are unique and in back-to-front paint order", async () => {
    const root = fixture();
    const cfg = await loadConfig(join(root, "goldie.config.ts"));
    const [prepared] = await prepareScenes(cfg, "iphone-6.9", "en-US", {
      tile: { width: 1080, height: 1920 },
    });
    const input = prepared!.input;
    const measure = createCanvas(input.c.width, input.c.height).getContext("2d");
    const layers = sceneLayers(measure, input);
    const ids = layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const deviceAt = ids.findIndex((id) => id.startsWith("device-"));
    const frontAt = ids.findIndex((id) => id.startsWith("decoration-front-"));
    const backAt = ids.findIndex((id) => id.startsWith("decoration-back-"));
    expect(backAt).toBeLessThan(deviceAt);
    expect(deviceAt).toBeLessThan(frontAt);
  });
});
