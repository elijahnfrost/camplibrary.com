import { describe, expect, it } from "vitest";
import { layoutEvents, pct, type Laid, type LaidInput } from "./layoutEvents";
import { DAY_END_MIN, DAY_START_MIN } from "./scheduleTime";
import type { ScheduleBlock } from "./types";

function min(hour: number, minute = 0): number {
  return hour * 60 + minute;
}

function block(id: string): ScheduleBlock {
  return { id, start: "09:00", end: "09:30", kind: "label", label: id };
}

function item(
  id: string,
  startMin: number,
  endMin: number,
  flags: Partial<Pick<LaidInput, "dragging" | "ghost">> = {}
): LaidInput {
  return { startMin, endMin, block: block(id), ...flags };
}

function idOf(laid: Laid): string | undefined {
  return laid.block?.id;
}

describe("layoutEvents", () => {
  it("clamps visible-day percentages", () => {
    expect(pct(DAY_START_MIN)).toBe(0);
    expect(pct(DAY_END_MIN)).toBe(100);
    expect(pct(DAY_START_MIN - 60)).toBe(0);
    expect(pct(DAY_END_MIN + 60)).toBe(100);
    expect(pct(min(9))).toBe(10);
    expect(pct(min(10)) - pct(min(9))).toBe(10);
  });

  it("does not split touching events into separate columns", () => {
    const laid = layoutEvents([item("a", min(9), min(9, 30)), item("b", min(9, 30), min(10))]);

    expect(laid.map((event) => [idOf(event), event.col, event.cols])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ]);
  });

  it("assigns distinct columns to overlapping events", () => {
    const laid = layoutEvents([item("a", min(9), min(10)), item("b", min(9, 30), min(10, 30))]);

    expect(laid.map((event) => [idOf(event), event.col, event.cols])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
    ]);
  });

  it("keeps bridge groups connected while reusing free columns", () => {
    const laid = layoutEvents([
      item("a", min(9), min(10)),
      item("b", min(9, 30), min(10, 30)),
      item("c", min(10), min(11)),
    ]);

    expect(laid.map((event) => [idOf(event), event.col, event.cols])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
    ]);
  });

  it("clamps events to the visible day and filters empty intervals", () => {
    const laid = layoutEvents([
      item("early", min(7, 30), min(8, 15)),
      item("late", min(17, 45), min(18, 30)),
      item("outside", min(6), min(7)),
      item("zero", min(10), min(10)),
    ]);

    expect(laid.map((event) => [idOf(event), event.startMin, event.endMin])).toEqual([
      ["early", min(8), min(8, 15)],
      ["late", min(17, 45), min(18)],
    ]);
    expect(pct(laid[0].endMin) - pct(laid[0].startMin)).toBe(2.5);
    expect(pct(laid[1].endMin) - pct(laid[1].startMin)).toBe(2.5);
  });

  it("does not collapse when column caps are disabled", () => {
    const inputs = [item("a", min(9), min(10)), item("b", min(9), min(10)), item("c", min(9), min(10))];

    expect(layoutEvents(inputs).map((event) => [idOf(event), event.col, event.cols])).toEqual([
      ["a", 0, 3],
      ["b", 1, 3],
      ["c", 2, 3],
    ]);
    expect(layoutEvents(inputs, 0)).toHaveLength(3);
    expect(layoutEvents(inputs, 1)).toHaveLength(3);
  });

  it("collapses overflow columns into a chip", () => {
    const laid = layoutEvents(
      [item("a", min(9), min(10)), item("b", min(9), min(10)), item("c", min(9), min(10))],
      2
    );
    const chip = laid.find((event) => event.overflow);

    expect(laid).toHaveLength(2);
    expect(laid[0]).toMatchObject({ col: 0, cols: 2 });
    expect(laid[0].overflow).toBeUndefined();
    expect(idOf(laid[0])).toBe("a");
    expect(chip).toMatchObject({ block: null, overflow: true, col: 1, cols: 2, startMin: min(9), endMin: min(10) });
    expect(chip?.hiddenItems?.map(idOf)).toEqual(["b", "c"]);
  });

  it("keeps live dragging and ghost items visible", () => {
    const dragging = layoutEvents(
      [item("a", min(9), min(10)), item("b", min(9), min(10), { dragging: true }), item("c", min(9), min(10))],
      2
    );
    const ghost = layoutEvents(
      [item("a", min(9), min(10)), item("b", min(9), min(10), { ghost: true }), item("c", min(9), min(10))],
      2
    );

    expect(dragging).toHaveLength(3);
    expect(dragging.some((event) => event.overflow)).toBe(false);
    expect(dragging.map((event) => event.cols)).toEqual([3, 3, 3]);
    expect(ghost).toHaveLength(3);
    expect(ghost.some((event) => event.overflow)).toBe(false);
  });

  it("splits overflow chips when hidden clusters do not overlap", () => {
    const laid = layoutEvents(
      [
        item("bridge", min(8, 45), min(12)),
        item("b", min(9), min(10)),
        item("c", min(9, 15), min(9, 45)),
        item("d", min(11), min(12)),
        item("e", min(11, 15), min(11, 45)),
      ],
      2
    );
    const chips = laid.filter((event) => event.overflow);

    expect(laid.filter((event) => !event.overflow).map(idOf)).toEqual(["bridge"]);
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => [chip.startMin, chip.endMin, chip.hiddenItems?.map(idOf)])).toEqual([
      [min(9), min(10), ["b", "c"]],
      [min(11), min(12), ["d", "e"]],
    ]);
  });
});
