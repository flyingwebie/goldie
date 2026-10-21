import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type CaptureManifest,
  captureLocales,
  capturesPerLocale,
  mergeCaptureManifest,
  rawDirFor,
} from "./capture.ts";
import { selectLocales } from "./config.ts";

const outDir = "/tmp/app/goldie/out";
const locales = ["pt-PT", "en-US"];

describe("localizedCaptures", () => {
  test("off: one shared capture, in the first locale, for every locale", () => {
    const cfg = { outDir, locales, localizedCaptures: false };
    expect(capturesPerLocale(cfg, "iphone-6.9")).toBe(false);
    expect(rawDirFor(cfg, "iphone-6.9", "en-US")).toBe(join(outDir, "raw", "iphone-6.9"));
    expect(captureLocales(cfg, "iphone-6.9")).toEqual(["pt-PT"]);
  });

  test("on: iOS devices capture each locale into its own raw dir", () => {
    const cfg = { outDir, locales, localizedCaptures: true };
    expect(capturesPerLocale(cfg, "ipad-13")).toBe(true);
    expect(rawDirFor(cfg, "ipad-13", "en-US")).toBe(join(outDir, "raw", "ipad-13", "en-US"));
    expect(captureLocales(cfg, "iphone-6.9")).toEqual(locales);
    // --locale narrows a per-locale run to the requested locale.
    expect(captureLocales(cfg, "iphone-6.9", ["en-US"])).toEqual(["en-US"]);
  });

  test("on: android keeps one shared capture, since emulators are not locale-pinned", () => {
    const cfg = { outDir, locales, localizedCaptures: true };
    expect(capturesPerLocale(cfg, "pixel-10-pro")).toBe(false);
    expect(rawDirFor(cfg, "pixel-10-pro", "en-US")).toBe(join(outDir, "raw", "pixel-10-pro"));
    expect(captureLocales(cfg, "pixel-10-pro", ["en-US"])).toEqual(["pt-PT"]);
  });
});

describe("--locale", () => {
  test("runs every configured locale, or the one requested", () => {
    expect(selectLocales(locales)).toEqual(locales);
    expect(selectLocales(locales, "en-US")).toEqual(["en-US"]);
  });

  test("rejects a locale outside the config, so it never becomes a path", () => {
    expect(() => selectLocales(locales, "en-us")).toThrow('Unknown locale "en-us"');
    expect(() => selectLocales(locales, "../../outside")).toThrow("Unknown locale");
  });
});

describe("mergeCaptureManifest (--scene)", () => {
  const base: CaptureManifest = {
    device: "iphone-6.9",
    udid: "udid-1",
    capturedAt: "2024-01-01T00:00:00.000Z",
    screenshots: [
      { sceneId: "home", file: "/raw/home.png" },
      { sceneId: "search", file: "/raw/search.png" },
      { sceneId: "settings", file: "/raw/settings.png" },
    ],
    preview: {
      sceneId: "preview",
      clips: [{ segmentId: "intro", file: "/raw/preview-intro.mp4", durationSeconds: 3 }],
    },
  };

  test("with no previous manifest, the fresh (scene-limited) capture stands alone", () => {
    const fresh: CaptureManifest = {
      ...base,
      capturedAt: "2024-02-02T00:00:00.000Z",
      screenshots: [{ sceneId: "home", file: "/raw/home.png" }],
      preview: null,
    };
    expect(mergeCaptureManifest(null, fresh)).toEqual(fresh);
  });

  test("replaces only the recaptured scene's screenshot, keeping the rest untouched", () => {
    const fresh: CaptureManifest = {
      ...base,
      capturedAt: "2024-02-02T00:00:00.000Z",
      screenshots: [{ sceneId: "search", file: "/raw/search-2.png" }],
      preview: null,
    };
    const merged = mergeCaptureManifest(base, fresh);
    expect(merged.screenshots).toEqual([
      { sceneId: "home", file: "/raw/home.png" },
      { sceneId: "search", file: "/raw/search-2.png" },
      { sceneId: "settings", file: "/raw/settings.png" },
    ]);
    // Metadata (capturedAt, udid) comes from the fresh run.
    expect(merged.capturedAt).toBe("2024-02-02T00:00:00.000Z");
    // The preview was not asked for, so the existing one survives.
    expect(merged.preview).toEqual(base.preview);
  });

  test("appends a scene the previous manifest never had", () => {
    const fresh: CaptureManifest = {
      ...base,
      screenshots: [{ sceneId: "onboarding", file: "/raw/onboarding.png" }],
      preview: null,
    };
    const merged = mergeCaptureManifest(base, fresh);
    expect(merged.screenshots.map((s) => s.sceneId)).toEqual([
      "home",
      "search",
      "settings",
      "onboarding",
    ]);
  });

  test("a fresh preview (the preview scene was named) replaces the old one wholesale", () => {
    const fresh: CaptureManifest = {
      ...base,
      screenshots: [],
      preview: {
        sceneId: "preview",
        clips: [{ segmentId: "intro", file: "/raw/preview-intro-2.mp4", durationSeconds: 4 }],
      },
    };
    const merged = mergeCaptureManifest(base, fresh);
    expect(merged.preview).toEqual(fresh.preview);
  });
});
