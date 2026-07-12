// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { QuickAdd } from "./QuickAdd";
import type { EditorDraft } from "@/lib/calendar/editorDraft";

afterEach(cleanup);

// QuickAdd takes ~20 handlers; the tests only care about a few, so the rest are
// inert spies supplied through one spread.
const handlers = () => ({
  onManageLocations: vi.fn(),
  onPickActivity: vi.fn(),
  onCreateActivity: vi.fn(),
  onSave: vi.fn(),
  onDelete: vi.fn(),
  onDeleteSeries: vi.fn(),
  onDuplicate: vi.fn(),
  onOpenActivity: vi.fn(),
  onTogglePin: vi.fn(),
  onApplyAll: vi.fn(),
  onApplyFollowing: vi.fn(),
  onResetOccurrence: vi.fn(),
  onRestoreSkip: vi.fn(),
  onRecoverTime: vi.fn(),
  onSwapBackup: vi.fn(),
  onEditBackups: vi.fn(),
  onClearBackups: vi.fn(),
  onClose: vi.fn(),
});

const mount = (draft: EditorDraft, on = handlers()) => {
  render(
    <QuickAdd
      draft={draft}
      pickTime
      activities={[]}
      window={{ startMin: 480, endMin: 1080 }}
      locationOptions={[]}
      {...on}
    />
  );
  return on;
};

const createDraft = (over: Partial<EditorDraft> = {}): EditorDraft =>
  ({ date: "2026-07-15", startMin: 540, durationMin: 30, allDay: false, title: "", ...over });

describe("QuickAdd — primary action reflects the mode", () => {
  it("reads 'Add to calendar' for a new timed event", () => {
    mount(createDraft());
    expect(screen.getByRole("button", { name: /Add to calendar/ })).toBeTruthy();
  });

  it("reads 'Add reminder' for a new 0-minute event", () => {
    mount(createDraft({ durationMin: 0 }));
    expect(screen.getByRole("button", { name: /Add reminder/ })).toBeTruthy();
  });

  it("typing a name then confirming 'Add' saves a calendar-only custom draft", () => {
    const on = mount(createDraft());
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Story time" } });
    fireEvent.click(screen.getByRole("button", { name: /Story time/ }));
    expect(on.onSave).toHaveBeenCalledTimes(1);
    expect(on.onSave.mock.calls[0][0].title).toBe("Story time");
    expect(on.onSave.mock.calls[0][0].activityId).toBeUndefined();
  });
});

describe("QuickAdd — editing an existing custom event", () => {
  const editDraft = (): EditorDraft => ({
    id: "e1",
    date: "2026-07-15",
    startMin: 540,
    durationMin: 30,
    allDay: false,
    title: "Old name",
  });

  it("seeds the name field from the draft and saves the edited title", () => {
    const on = mount(editDraft());
    const input = screen.getByLabelText("Event name") as HTMLInputElement;
    expect(input.value).toBe("Old name");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(on.onSave).toHaveBeenCalledTimes(1);
    expect(on.onSave.mock.calls[0][0].title).toBe("New name");
  });

  it("wires the Delete affordance", () => {
    const on = mount(editDraft());
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(on.onDelete).toHaveBeenCalledTimes(1);
  });
});
