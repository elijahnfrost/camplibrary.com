// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { DetailSheet } from "./DetailSheet";
import { quickActivity } from "@/lib/activity/activityForm";
import type { RunDoc } from "@/lib/activity/runList";

afterEach(cleanup);

const activity = quickActivity("Beanbag Toss", "a1", 30);
const runDoc: RunDoc = { blocks: [{ id: "s1", type: "step", text: "Set up the buckets", children: [] }] };

const handlers = () => ({
  isFav: () => false,
  onToggleFav: vi.fn(),
  onClose: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onPrint: vi.fn(),
  onSetStockState: vi.fn(),
  onSaveRunDoc: vi.fn(),
  onSubmit: vi.fn(), // presence enables editing (canEdit = Boolean(onSubmit))
});

const mount = (props: Partial<Parameters<typeof DetailSheet>[0]> = {}, on = handlers()) => {
  render(
    <DetailSheet
      activity={activity}
      kitStock={{}}
      runDoc={runDoc}
      libraryActivities={[]}
      {...on}
      {...props}
    />
  );
  return on;
};

describe("DetailSheet (view mode)", () => {
  it("renders the activity title and its run doc", () => {
    mount();
    expect(screen.getByText("Beanbag Toss")).toBeTruthy();
    expect(screen.getByText("Set up the buckets")).toBeTruthy();
  });

  it("'Edit activity' reveals the editable name field", () => {
    mount();
    expect(screen.queryByLabelText("Activity name")).toBeNull();
    fireEvent.click(screen.getByLabelText("Edit activity"));
    expect(screen.getByLabelText("Activity name")).toBeTruthy();
  });
});

describe("DetailSheet (editing) — owner actions", () => {
  it("'Delete activity' calls onDelete with the activity", () => {
    const on = mount({ startEditing: true });
    fireEvent.click(screen.getByLabelText("Delete activity"));
    expect(on.onDelete).toHaveBeenCalledWith(activity);
  });

  it("'Duplicate in library' calls onDuplicate with the activity", () => {
    const on = mount({ startEditing: true });
    fireEvent.click(screen.getByLabelText("Duplicate in library"));
    expect(on.onDuplicate).toHaveBeenCalledWith(activity);
  });
});
