import { describe, expect, it } from "vitest";
import { yToMinutes } from "./dragTime";

describe("yToMinutes", () => {
  // A 600px frame drawing 8:00 (480) → 18:00 (1080): span 600 min, so 1px ≈ 1 min.
  const H = 600;
  const START = 480;
  const END = 1080;

  it("maps the frame top to gridStart and the bottom to gridEnd", () => {
    expect(yToMinutes(0, H, START, END)).toBe(480);
    expect(yToMinutes(600, H, START, END)).toBe(1080);
  });

  it("snaps to the 15-minute grid", () => {
    expect(yToMinutes(90, H, START, END)).toBe(570); // 9:30, exact
    expect(yToMinutes(8, H, START, END)).toBe(495); // 488 → nearest 15 = 495 (8:15)
    expect(yToMinutes(7, H, START, END)).toBe(480); // 487 → nearest 15 = 480 (8:00)
  });

  it("clamps above the top and below the bottom of the window", () => {
    expect(yToMinutes(-50, H, START, END)).toBe(480);
    expect(yToMinutes(900, H, START, END)).toBe(1080);
  });

  it("is safe on a degenerate frame or window", () => {
    expect(yToMinutes(100, 0, START, END)).toBe(480);
    expect(yToMinutes(100, H, 600, 600)).toBe(600);
  });
});
