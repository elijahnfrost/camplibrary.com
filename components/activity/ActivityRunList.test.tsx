// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ActivityRunList } from "./ActivityRunList";
import type { RunChild, RunDoc } from "@/lib/activity/runList";
import type { Activity } from "@/lib/types";

afterEach(cleanup);

const activity = { id: "a1", title: "Beanbag Toss", type: "Game" } as Activity;
const step = (id: string, text: string, children: RunChild[] = []) =>
  ({ id, type: "step" as const, text, children });
const note = (id: string, text: string): RunChild => ({ id, type: "note", text });

const makeDoc = (): RunDoc => ({
  blocks: [step("s1", "Set up the cones"), step("s2", "Explain the rules", [note("n1", "keep teams even")])],
});

const base = { activity, kitStock: {}, onSetStockState: vi.fn() };
const committedIds = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls[0][0].blocks.map((b: { id: string }) => b.id);

describe("ActivityRunList (read mode)", () => {
  it("renders each step's text and its attached detail from the run doc", () => {
    render(<ActivityRunList doc={makeDoc()} editable={false} {...base} />);
    expect(screen.getByText("Set up the cones")).toBeTruthy();
    expect(screen.getByText("Explain the rules")).toBeTruthy();
    expect(screen.getByText("keep teams even")).toBeTruthy();
  });
});

describe("ActivityRunList (edit mode) — block ops wire to runDocOps", () => {
  it("'Move block down' on the first step commits the reordered doc", () => {
    const onChange = vi.fn();
    render(<ActivityRunList doc={makeDoc()} editable onChange={onChange} {...base} />);
    fireEvent.click(screen.getAllByLabelText("Move block down")[0]);
    expect(committedIds(onChange)).toEqual(["s2", "s1"]);
  });

  it("'Remove block' commits the doc without that block", () => {
    const onChange = vi.fn();
    render(<ActivityRunList doc={makeDoc()} editable onChange={onChange} {...base} />);
    fireEvent.click(screen.getAllByLabelText("Remove block")[0]);
    expect(committedIds(onChange)).toEqual(["s2"]);
  });
});

describe("ActivityRunList (edit mode) — detail ops wire to runDocOps", () => {
  it("'Remove detail' drops the attached child from its step", () => {
    const onChange = vi.fn();
    render(<ActivityRunList doc={makeDoc()} editable onChange={onChange} {...base} />);
    fireEvent.click(screen.getByLabelText("Remove detail"));
    const s2 = onChange.mock.calls[0][0].blocks.find((b: { id: string }) => b.id === "s2");
    expect(s2.children).toEqual([]);
  });

  it("'Move detail down' reorders the details under a step", () => {
    const onChange = vi.fn();
    const doc: RunDoc = { blocks: [step("s1", "Do it", [note("n1", "first"), note("n2", "second")])] };
    render(<ActivityRunList doc={doc} editable onChange={onChange} {...base} />);
    fireEvent.click(screen.getAllByLabelText("Move detail down")[0]);
    const kids = onChange.mock.calls[0][0].blocks[0].children.map((c: { id: string }) => c.id);
    expect(kids).toEqual(["n2", "n1"]);
  });

  it("'Attach detail' → 'Note' appends a fresh note child to that step", () => {
    const onChange = vi.fn();
    const doc: RunDoc = { blocks: [step("s1", "Do it")] };
    render(<ActivityRunList doc={doc} editable onChange={onChange} {...base} />);
    fireEvent.click(screen.getByLabelText("Attach detail"));
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    const s1 = onChange.mock.calls[0][0].blocks[0];
    expect(s1.children).toHaveLength(1);
    expect(s1.children[0].type).toBe("note");
  });
});
