import { describe, expect, test } from "bun:test";
import {
  bubblePath,
  calloutGeometry,
  circleMarkPath,
  laurelPath,
  pathLength,
  ratingGeometry,
  starPath,
  underlineMarkPath,
} from "./marks.ts";

const box = { left: 100, top: 50, width: 200, height: 80 };
const finite = (d: string) =>
  (d.match(/-?\d*\.?\d+/g) ?? []).every((n) => Number.isFinite(Number(n)));

describe("marks", () => {
  test("hand-drawn marks are deterministic and finite", () => {
    expect(circleMarkPath(box, 7)).toBe(circleMarkPath(box, 7));
    expect(circleMarkPath(box, 7)).not.toBe(circleMarkPath(box, 8));
    for (const d of [circleMarkPath(box), underlineMarkPath(box), starPath(10, 10, 5)])
      expect(finite(d)).toBe(true);
  });

  test("the circle hugs the word rather than the full line", () => {
    const xs = (circleMarkPath(box).match(/[ML](-?[\d.]+)/g) ?? []).map((m) => Number(m.slice(1)));
    expect(Math.min(...xs)).toBeGreaterThan(box.left - box.height * 0.5);
    expect(Math.max(...xs)).toBeLessThan(box.left + box.width + box.height * 0.5);
  });

  test("pathLength measures lines and curves", () => {
    expect(pathLength("M0 0 L30 40")).toBeCloseTo(50, 6);
    expect(pathLength("M0 0 L10 0 L10 10 Z")).toBeCloseTo(10 + 10 + Math.SQRT2 * 10, 6);
    expect(pathLength("M0 0 Q50 0 100 0")).toBeCloseTo(100, 1);
  });

  test("laurel branches mirror each other", () => {
    const l = laurelPath(box, false);
    const r = laurelPath(box, true);
    expect(finite(l.leaves) && finite(r.leaves) && finite(r.stem)).toBe(true);
    expect(l.leaves).not.toBe(r.leaves);
  });

  test("rating geometry grows with a label", () => {
    const a = ratingGeometry({ ...box, height: 0 }, false);
    const b = ratingGeometry({ ...box, height: 0 }, true);
    expect(b.height).toBeGreaterThan(a.height);
    expect(a.stars).toHaveLength(5);
    expect(a.label).toBeNull();
  });

  test("bubble outline closes and carries its tail outside the body", () => {
    const d = bubblePath(box, 20, "bottom-left", 16);
    expect(d.endsWith("Z")).toBe(true);
    const ys = (d.match(/[MLQ](-?[\d.]+) (-?[\d.]+)/g) ?? []).map((m) => Number(m.split(" ")[1]));
    expect(Math.max(...ys)).toBeCloseTo(box.top + box.height + 16, 1);
  });
});

describe("calloutGeometry", () => {
  test("enlarges the region to the card width and keeps its aspect", () => {
    const g = calloutGeometry(
      { from: { x: 0.1, y: 0.5, width: 0.8, height: 0.1 }, x: 0.05, y: 0.4, width: 0.9 },
      { width: 1000, height: 2000 },
      { width: 500, height: 1000 },
    );
    expect(g.box).toEqual({ left: 50, top: 800, width: 900, height: 225 });
    // The region's top-left lands on the card's top-left.
    expect(g.image.left + 0.1 * g.image.width).toBeCloseTo(50, 6);
    expect(g.image.top + 0.5 * g.image.height).toBeCloseTo(800, 6);
  });
});
