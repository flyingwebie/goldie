import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { loadConfig } from "../config.ts";
import { prepareScenes } from "../scene.ts";
import { writeComposition } from "./composition.ts";
import { PROMO_FORMATS } from "./timeline.ts";

/** Two screenshot scenes (so the push transition between them is exercised) plus an outro icon. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "goldie-composition-"));
  const raw = join(root, "out", "raw", "iphone-6.9");
  mkdirSync(raw, { recursive: true });
  const shot = createCanvas(1320, 2868);
  const sc = shot.getContext("2d");
  sc.fillStyle = "#f4f4f4";
  sc.fillRect(0, 0, 1320, 2868);
  writeFileSync(join(raw, "shot.png"), shot.toBuffer("image/png"));
  const icon = createCanvas(64, 64);
  icon.getContext("2d").fillRect(0, 0, 64, 64);
  writeFileSync(join(root, "icon.png"), icon.toBuffer("image/png"));
  writeFileSync(
    join(raw, "manifest.json"),
    JSON.stringify({
      device: "iphone-6.9",
      udid: "x",
      capturedAt: "",
      preview: null,
      screenshots: [
        { sceneId: "a", file: join(raw, "shot.png") },
        { sceneId: "b", file: join(raw, "shot.png") },
      ],
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
        accentColor: "#e44b2a", emphasis: "circle" },
      store: { name: "X", subtitle: {}, developer: "", category: "", rating: 5, ratingCount: "", ageRating: "", price: "", description: {} },
      scenes: [
        { kind: "screenshot", id: "a", flow: "a", layout: "hero", kicker: { "en-US": "for rescuers" }, headline: { "en-US": "Every animal *counts*" } },
        { kind: "screenshot", id: "b", flow: "b", layout: "hero", headline: { "en-US": "Segnala *veloce*" } },
      ],
    };`,
  );
  return root;
}

describe("writeComposition", () => {
  test("every <img> src it writes into index.html resolves to a file it actually wrote", async () => {
    const root = fixture();
    const cfg = await loadConfig(join(root, "goldie.config.ts"));
    const size = PROMO_FORMATS["9:16"];
    const scenes = await prepareScenes(cfg, "iphone-6.9", "en-US", { tile: size, copyScale: 1.22 });
    const outDir = join(root, "composition");
    const icon = await loadImage(join(root, "icon.png"));

    const result = await writeComposition({
      cfg,
      scenes,
      size,
      perScene: 2,
      outro: { headline: "Rescue *more animals*", cta: "Download", icon, seconds: 2 },
      introPath: null,
      audioPath: null,
      outDir,
    });

    expect(result.timeline.starts).toEqual([0, 2]);
    expect(result.totalSeconds).toBeGreaterThan(4); // 2 scenes + outro, minus the overlapping push transitions

    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(html).toContain('data-composition-id="promo"');
    expect(html).toContain(`data-width="${size.width}"`);
    expect(html).toContain(`data-height="${size.height}"`);
    expect(html).toContain('data-fps="30"');
    expect(html).toContain("window.__timelines.promo = tl;");
    // Every scene and the outro are their own timed clip.
    expect(html).toContain('id="scene-0"');
    expect(html).toContain('id="scene-1"');
    expect(html).toContain('id="scene-outro"');

    // The regression this guards: an <img src="..."> that does not resolve
    // under outDir fails silently in the browser (HyperFrames reports
    // media_load_failed and renders a blank layer) rather than at generation
    // time, so every src this module writes must exist on disk.
    const srcs = [...html.matchAll(/src="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((src) => !/^https?:/.test(src)); // the GSAP CDN <script>, not a local layer
    expect(srcs.length).toBeGreaterThan(10); // background, copy lines, marks, device x2 scenes, outro layers
    for (const src of srcs) {
      const file = join(outDir, src);
      expect(existsSync(file), `${src} should exist at ${file}`).toBe(true);
    }

    // The tween spec embedded in the script is well-formed JSON with content.
    const specMatch = html.match(/var specs = (\[.*?\]);/s);
    expect(specMatch).not.toBeNull();
    const specs = JSON.parse(specMatch![1]!);
    expect(Array.isArray(specs)).toBe(true);
    expect(specs.length).toBeGreaterThan(10);
    for (const t of specs) {
      expect(typeof t.selector).toBe("string");
      expect(typeof t.position).toBe("number");
    }
  }, 30000);

  test("writes nothing for a scene whose decorations and copy are empty besides the device", async () => {
    const root = mkdtempSync(join(tmpdir(), "goldie-composition-min-"));
    const raw = join(root, "out", "raw", "iphone-6.9");
    mkdirSync(raw, { recursive: true });
    const shot = createCanvas(1320, 2868);
    shot.getContext("2d").fillRect(0, 0, 1320, 2868);
    writeFileSync(join(raw, "shot.png"), shot.toBuffer("image/png"));
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
        theme: { background: "#000000", headlineColor: "#fff", subheadColor: "#ccc",
          fontFamily: "sans-serif", copyHeightRatio: 0.24, deviceWidthRatio: 0.84 },
        store: { name: "X", subtitle: {}, developer: "", category: "", rating: 5, ratingCount: "", ageRating: "", price: "", description: {} },
        scenes: [ { kind: "screenshot", id: "a", flow: "a", layout: "minimal", headline: { "en-US": "Hi" } } ],
      };`,
    );
    const cfg = await loadConfig(join(root, "goldie.config.ts"));
    const size = PROMO_FORMATS["1:1"];
    const scenes = await prepareScenes(cfg, "iphone-6.9", "en-US", { tile: size, copyScale: 1 });
    const outDir = join(root, "composition");
    const result = await writeComposition({
      cfg,
      scenes,
      size,
      perScene: 2,
      outro: null,
      introPath: null,
      audioPath: null,
      outDir,
    });
    expect(result.timeline.outroStart).toBeNull();
    const html = await readFile(join(outDir, "index.html"), "utf8");
    for (const src of [...html.matchAll(/src="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((src) => !/^https?:/.test(src))) {
      expect(existsSync(join(outDir, src))).toBe(true);
    }
  });
});
