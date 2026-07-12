// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ActivityRunList } from "./ActivityRunList";
import type { RunDoc } from "@/lib/activity/runList";
import type { Activity } from "@/lib/types";

afterEach(cleanup);

const activity = { id: "a1", title: "Beanbag Toss", type: "Game" } as Activity;

const makeDoc = (): RunDoc => ({
  blocks: [
    { id: "s1", type: "step", text: "Set up the cones", children: [] },
    { id: "s2", type: "step", text: "Explain the rules", children: [{ id: "n1", type: "note", text: "keep teams even" }] },
  ],
});

const base = { activity, kitStock: {}, onSetStockState: vi.fn() };

describe("ActivityRunList (read mode)", () => {
  it("renders each step's text and its attached detail from the run doc", () => {
    render(<ActivityRunList doc={makeDoc()} editable={false} {...base} />);
    expect(screen.getByText("Set up the cones")).toBeTruthy();
    expect(screen.getByText("Explain the rules")).toBeTruthy();
    expect(screen.getByText("keep teams even")).toBeTruthy();
  });
});

describe("ActivityRunList (edit mode) — wiring to the run-doc ops", () => {
  it("'Move block down' on the first step commits the reordered doc", () => {
    const onChange = vi.fn();
    render(<ActivityRunList doc={makeDoc()} editable onChange={onChange} {...base} />);
    fireEvent.click(screen.getAllByLabelText("Move block down")[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].blocks.map((b: { id: string }) => b.id)).toEqual(["s2", "s1"]);
  });

  it("'Remove block' commits the doc without that block", () => {
    const onChange = vi.fn();
    render(<ActivityRunList doc={makeDoc()} editable onChange={onChange} {...base} />);
    fireEvent.click(screen.getAllByLabelText("Remove block")[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].blocks.map((b: { id: string }) => b.id)).toEqual(["s2"]);
  });
});
