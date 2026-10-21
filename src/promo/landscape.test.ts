import { describe, expect, test } from "bun:test";
import { fitStage, isLandscape, LANDSCAPE, landscapeStageTile } from "./landscape.ts";

const frame = { width: 1920, height: 1080 };

describe("landscape promo geometry", () => {
  test("only frames wider than tall are landscape", () => {
    expect(isLandscape(frame)).toBe(true);
    expect(isLandscape({ width: 1080, height: 1920 })).toBe(false);
    expect(isLandscape({ width: 1080, height: 1080 })).toBe(false);
  });

  test("the stage composes as a portrait tile taller than the frame", () => {
    const t = landscapeStageTile(frame);
    expect(t.height).toBeGreaterThan(frame.height);
    expect(t.width / t.height).toBeCloseTo(9 / 16, 2);
  });

  test("a contained stage is scaled into the right column and centred", () => {
    const stage = landscapeStageTile(frame);
    const fit = fitStage([{ left: 100, top: 200, width: 600, height: 1000 }], stage, frame);
    const left = 100 * fit.scale + fit.x;
    const right = 700 * fit.scale + fit.x;
    expect(left).toBeGreaterThanOrEqual(frame.width * LANDSCAPE.stageLeft - 0.5);
    expect(right).toBeLessThanOrEqual(frame.width * LANDSCAPE.stageRight + 0.5);
    const top = 200 * fit.scale + fit.y;
    const bottom = 1200 * fit.scale + fit.y;
    expect((top + bottom) / 2).toBeCloseTo(frame.height / 2, 0);
    expect(fit.scale).toBeLessThanOrEqual(1);
  });

  test("a phone bleeding off the tile bottom bleeds off the frame bottom", () => {
    const stage = landscapeStageTile(frame);
    const fit = fitStage([{ left: 50, top: 500, width: 700, height: 2000 }], stage, frame);
    expect(stage.height * fit.scale + fit.y).toBeCloseTo(frame.height, 4);
  });
});

describe("landscape bleed to the right", () => {
  test("a phone cut by the tile's right edge runs off the frame's right edge", () => {
    const stage = landscapeStageTile(frame);
    const fit = fitStage(
      [{ left: stage.width * 0.3, top: 300, width: stage.width, height: 900 }],
      stage,
      frame,
    );
    expect(stage.width * fit.scale + fit.x).toBeCloseTo(frame.width, 4);
  });
});
