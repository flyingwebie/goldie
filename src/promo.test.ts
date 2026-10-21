import { describe, expect, test } from "bun:test";
import { captionFilter } from "./captions.ts";
import { buildTimeline, easeOutBack, easeOutCubic, PROMO } from "./promo.ts";

describe("promo timeline", () => {
  test("scenes follow each other and the outro closes the video", () => {
    const t = buildTimeline(4, 3, 2.5);
    expect(t.starts).toEqual([0, 3, 6, 9]);
    expect(t.outroStart).toBe(12);
    expect(t.total).toBe(14.5);
    expect(t.frames).toBe(Math.round(14.5 * PROMO.fps));
  });

  test("without an outro the last scene holds through one transition", () => {
    const t = buildTimeline(2, 3, 0);
    expect(t.outroStart).toBeNull();
    expect(t.total).toBeCloseTo(6 + PROMO.transition, 6);
  });

  test("easings start at 0, end at 1, and back overshoots", () => {
    for (const ease of [easeOutCubic, easeOutBack]) {
      expect(ease(0)).toBeCloseTo(0, 6);
      expect(ease(1)).toBeCloseTo(1, 6);
    }
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 49)))).toBeGreaterThan(
      1,
    );
  });
});

describe("captionFilter", () => {
  test("chains one timed, faded overlay per caption", () => {
    const { graph, out } = captionFilter("base", [
      { input: 2, start: 0, end: 5 },
      { input: 3, start: 5, end: 9 },
    ]);
    expect(out).toBe("v1");
    expect(graph).toContain("[2:v]format=rgba,fade=t=in:st=0.000");
    expect(graph).toContain("[base][cap0]overlay=0:0:enable='between(t,0.000,5.000)'[v0]");
    expect(graph).toContain("[v0][cap1]overlay");
  });
});
