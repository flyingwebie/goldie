import { describe, expect, test } from "bun:test";
import {
  centerGuides,
  clamp,
  fromFraction,
  nudgeStep,
  snapBoxDelta,
  snapRotation,
  snapToGuides,
  toFraction,
} from "./editor-geom.ts";

describe("snapToGuides", () => {
  test("snaps to the nearest guide within the threshold", () => {
    const hit = snapToGuides(103, [0, 100, 200], 10);
    expect(hit).toEqual({ value: 100, snapped: true, guide: 100 });
  });

  test("passes the value through when nothing is close enough", () => {
    const hit = snapToGuides(140, [0, 100, 200], 10);
    expect(hit).toEqual({ value: 140, snapped: false, guide: null });
  });

  test("picks the closest guide, not just the first in range", () => {
    const hit = snapToGuides(96, [0, 100], 10);
    expect(hit.guide).toBe(100);
  });

  test("an empty guide list never snaps", () => {
    expect(snapToGuides(5, [], 10)).toEqual({ value: 5, snapped: false, guide: null });
  });
});

describe("snapBoxDelta", () => {
  test("snaps the box's centre to a guide", () => {
    // box centred at 55, nearest guide 50 within 10px -> shift left by 5
    const { delta, guide } = snapBoxDelta(10, 90, [50], 10);
    expect(guide).toBe(50);
    expect(delta).toBeCloseTo(-5);
  });

  test("snaps the left edge when it is the closest candidate", () => {
    const { delta, guide } = snapBoxDelta(8, 200, [10], 10);
    expect(guide).toBe(10);
    expect(delta).toBeCloseTo(2);
  });

  test("snaps the right edge when it is the closest candidate", () => {
    const { delta, guide } = snapBoxDelta(0, 98, [100], 10);
    expect(guide).toBe(100);
    expect(delta).toBeCloseTo(2);
  });

  test("no snap when every candidate is out of range", () => {
    expect(snapBoxDelta(0, 10, [1000], 10)).toEqual({ delta: 0, guide: null });
  });

  test("prefers whichever candidate lands closest to its guide", () => {
    // left edge at 0 is 5 from guide 5; centre at 50 is 45 from guide 95 (out of range)
    const { guide } = snapBoxDelta(0, 100, [5, 95], 10);
    expect(guide).toBe(5);
  });
});

describe("centerGuides", () => {
  test("a single tile gives its edges and centre lines", () => {
    const g = centerGuides(100, 200, 1, []);
    expect(g.x).toEqual([0, 100, 50]);
    expect(g.y).toEqual([0, 100, 200]);
  });

  test("a two-tile span adds the seam and each tile's own centre", () => {
    const g = centerGuides(100, 200, 2, []);
    expect(g.x).toEqual(expect.arrayContaining([0, 100, 200, 50, 150]));
  });

  test("other boxes contribute their edges and centre", () => {
    const g = centerGuides(100, 200, 1, [{ left: 10, top: 20, width: 30, height: 40 }]);
    expect(g.x).toEqual(expect.arrayContaining([10, 25, 40]));
    expect(g.y).toEqual(expect.arrayContaining([20, 40, 60]));
  });
});

describe("snapRotation", () => {
  test("snaps to the nearest 15° step when enabled", () => {
    expect(snapRotation(8, true)).toBe(15);
    expect(snapRotation(7, true)).toBe(0);
    expect(snapRotation(-22, true)).toBe(-15);
  });

  test("passes the angle through when disabled", () => {
    expect(snapRotation(8, false)).toBe(8);
  });

  test("honours a custom step", () => {
    expect(snapRotation(40, true, 45)).toBe(45);
  });
});

describe("nudgeStep", () => {
  test("the shifted step is larger", () => {
    expect(nudgeStep(true)).toBeGreaterThan(nudgeStep(false));
  });
});

describe("clamp", () => {
  test("keeps a value inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("fraction conversions", () => {
  test("round-trip through a size", () => {
    expect(toFraction(50, 200)).toBeCloseTo(0.25);
    expect(fromFraction(0.25, 200)).toBeCloseTo(50);
  });

  test("toFraction of a zero size is zero, not NaN", () => {
    expect(toFraction(50, 0)).toBe(0);
  });
});
