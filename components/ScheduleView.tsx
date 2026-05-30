"use client";

import { useState, type CSSProperties, type DragEvent } from "react";
import type { Activity, DaySchedule, ScheduleBlock, ScheduleBlockKind } from "@/lib/types";
import { DAYS, durLabel } from "@/lib/data";
import { CampIcon } from "./icons";

type DraftBlock = {
  kind: ScheduleBlockKind;
  start: string;
  end: string;
  label: string;
};

type DragPayload = {
  activityId: string;
  sourceDayIndex: number;
  sourceBlockId: string;
};

const PX_PER_MINUTE = 1.05;
const MIN_DAY_START = 9 * 60;
const MIN_DAY_END = 17 * 60;

const emptyDraft: DraftBlock = {
  kind: "activity",
  start: "",
  end: "",
  label: "",
};

function cloneBlocks(blocks: DaySchedule): DaySchedule {
  return blocks.map((block) => ({ ...block }));
}

function timeRange(block: ScheduleBlock): string {
  if (block.start && block.end) return block.start + "-" + block.end;
  return block.start || block.end || "Flex";
}

function minutesFromTime(time: string): number | null {
  const match = time.trim().match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  if (hour > 0 && hour < 6) hour += 12;
  return hour * 60 + minute;
}

function formatHour(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const displayHour = ((hour + 11) % 12) + 1;
  return displayHour + ":00";
}

function durationMinutes(block: ScheduleBlock): number {
  const start = minutesFromTime(block.start);
  const end = minutesFromTime(block.end);
  if (start == null || end == null) return 45;
  const duration = end - start;
  return duration > 0 ? duration : 45;
}

function visibleDayIndexes(dayIndex: number): number[] {
  if (dayIndex <= 0) return [0, 1, 2];
  if (dayIndex >= DAYS.length - 1) return [DAYS.length - 3, DAYS.length - 2, DAYS.length - 1];
  return [dayIndex - 1, dayIndex, dayIndex + 1];
}

function calendarBounds(days: DaySchedule[]): { start: number; end: number; hours: number[]; height: number } {
  const starts = days.flatMap((blocks) => blocks.map((block) => minutesFromTime(block.start))).filter((n): n is number => n != null);
  const ends = days.flatMap((blocks) => blocks.map((block) => minutesFromTime(block.end))).filter((n): n is number => n != null);
  const start = Math.min(MIN_DAY_START, starts.length ? Math.min(...starts) : MIN_DAY_START);
  const end = Math.max(MIN_DAY_END, ends.length ? Math.max(...ends) : MIN_DAY_END);
  const hourStart = Math.floor(start / 60) * 60;
  const hourEnd = Math.ceil(end / 60) * 60;
  const hours: number[] = [];
  for (let minute = hourStart; minute <= hourEnd; minute += 60) {
    hours.push(minute);
  }
  return { start: hourStart, end: hourEnd, hours, height: (hourEnd - hourStart) * PX_PER_MINUTE };
}

function eventStyle(block: ScheduleBlock, baseMinute: number): CSSProperties {
  const start = minutesFromTime(block.start) ?? baseMinute;
  return {
    "--event-top": String(Math.max(0, (start - baseMinute) * PX_PER_MINUTE)),
    "--event-height": String(durationMinutes(block) * PX_PER_MINUTE),
  } as CSSProperties;
}

function axisStyle(minute: number, baseMinute: number): CSSProperties {
  return { "--time-top": String((minute - baseMinute) * PX_PER_MINUTE) } as CSSProperties;
}

function readDragPayload(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData("application/x-camp-activity");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DragPayload>;
    if (
      typeof parsed.activityId === "string" &&
      typeof parsed.sourceDayIndex === "number" &&
      typeof parsed.sourceBlockId === "string"
    ) {
      return {
        activityId: parsed.activityId,
        sourceDayIndex: parsed.sourceDayIndex,
        sourceBlockId: parsed.sourceBlockId,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function ScheduleView({
  dayIndex,
  onDayChange,
  blocks,
  weekBlocks,
  onOpenBlock,
  onClearActivity,
  onMoveActivity,
  onReplaceDayBlocks,
  onOpenActivity,
  byId,
}: {
  dayIndex: number;
  onDayChange: (d: number) => void;
  blocks: DaySchedule;
  weekBlocks: Record<number, DaySchedule>;
  onOpenBlock: (block: ScheduleBlock, targetDayIndex: number) => void;
  onClearActivity: (targetDayIndex: number, blockId: string) => void;
  onMoveActivity: (fromDayIndex: number, fromBlockId: string, toDayIndex: number, toBlockId: string) => void;
  onReplaceDayBlocks: (targetDayIndex: number, nextBlocks: DaySchedule) => void;
  onOpenActivity: (a: Activity) => void;
  byId: Record<string, Activity>;
}) {
  const [editingSlots, setEditingSlots] = useState(false);
  const [slotDrafts, setSlotDrafts] = useState<DaySchedule>(() => cloneBlocks(blocks));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftBlock>(emptyDraft);
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);

  const filled = blocks.filter((block) => block.kind === "activity" && block.activityId).length;
  const visibleDays = visibleDayIndexes(dayIndex);
  const bounds = calendarBounds(visibleDays.map((index) => weekBlocks[index] || []));
  const calendarHeightStyle = { "--calendar-height": String(bounds.height) } as CSSProperties;

  function startEditingSlots() {
    setSlotDrafts(cloneBlocks(blocks));
    setAdding(false);
    setDraft(emptyDraft);
    setEditingSlots(true);
  }

  function updateSlot(blockId: string, patch: Partial<ScheduleBlock>) {
    setSlotDrafts((current) =>
      current.map((block) => {
        if (block.id !== blockId) return block;
        const next = { ...block, ...patch };
        if (patch.kind === "label") {
          const { activityId, ...labelBlock } = next;
          return labelBlock;
        }
        return next;
      })
    );
  }

  function moveSlot(blockId: string, direction: -1 | 1) {
    setSlotDrafts((current) => {
      const index = current.findIndex((block) => block.id === blockId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [block] = next.splice(index, 1);
      next.splice(nextIndex, 0, block);
      return next;
    });
  }

  function dropSlot(targetBlockId: string) {
    if (!draggedSlotId || draggedSlotId === targetBlockId) return;
    setSlotDrafts((current) => {
      const fromIndex = current.findIndex((block) => block.id === draggedSlotId);
      const toIndex = current.findIndex((block) => block.id === targetBlockId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const next = [...current];
      const [block] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, block);
      return next;
    });
    setDraggedSlotId(null);
  }

  function submitDraft() {
    const label = draft.label.trim() || (draft.kind === "activity" ? "Activity block" : "Set block");
    setSlotDrafts((current) => [
      ...current,
      {
        id: "custom-" + draft.kind + "-" + Date.now().toString(36),
        kind: draft.kind,
        start: draft.start.trim(),
        end: draft.end.trim(),
        label,
      },
    ]);
    setDraft(emptyDraft);
    setAdding(false);
  }

  function saveSlots() {
    onReplaceDayBlocks(dayIndex, slotDrafts);
    setEditingSlots(false);
  }

  function handleActivityDrop(event: DragEvent, targetDayIndex: number, targetBlock: ScheduleBlock) {
    if (targetBlock.kind !== "activity") return;
    const payload = readDragPayload(event);
    if (!payload) return;
    event.preventDefault();
    onMoveActivity(payload.sourceDayIndex, payload.sourceBlockId, targetDayIndex, targetBlock.id);
  }

  function renderCalendarEvent(block: ScheduleBlock, targetDayIndex: number) {
    const act = block.activityId ? byId[block.activityId] : null;
    const baseClass =
      "calendar-event" +
      (block.kind === "label" ? " calendar-event--label" : "") +
      (act ? " calendar-event--activity" : "") +
      (!act && block.kind === "activity" ? " calendar-event--empty" : "");

    if (block.kind === "label") {
      return (
        <div className={baseClass} key={block.id} style={eventStyle(block, bounds.start)}>
          <span className="calendar-event__time">{timeRange(block)}</span>
          <span className="calendar-event__title">{block.label}</span>
          <span className="calendar-event__meta">Set block</span>
        </div>
      );
    }

    if (!act) {
      return (
        <button
          type="button"
          className={baseClass}
          key={block.id}
          style={eventStyle(block, bounds.start)}
          onClick={() => onOpenBlock(block, targetDayIndex)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleActivityDrop(event, targetDayIndex, block)}
          aria-label={"Add activity at " + timeRange(block)}
        >
          <span className="calendar-event__time">{timeRange(block)}</span>
          <span className="calendar-event__title">{block.label}</span>
          <span className="calendar-event__meta">Add activity</span>
        </button>
      );
    }

    return (
      <div
        className={baseClass}
        key={block.id}
        style={eventStyle(block, bounds.start)}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(
            "application/x-camp-activity",
            JSON.stringify({ activityId: act.id, sourceDayIndex: targetDayIndex, sourceBlockId: block.id })
          );
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleActivityDrop(event, targetDayIndex, block)}
      >
        <button type="button" className="calendar-event__main" onClick={() => onOpenActivity(act)}>
          <span className="calendar-event__time">{timeRange(block)}</span>
          <span className="calendar-event__title">{act.title}</span>
          <span className="calendar-event__meta">
            {act.type} · {durLabel(act)} · {act.place}
          </span>
        </button>
        <button
          type="button"
          className="calendar-event__clear"
          onClick={() => onClearActivity(targetDayIndex, block.id)}
          aria-label={"Clear " + act.title}
        >
          <CampIcon.Trash />
        </button>
      </div>
    );
  }

  if (editingSlots) {
    return (
      <div className="planner planner--editor fadein">
        <div className="dayhead">
          <div className="dayhead__copy">
            <span className="dayhead__kicker">Time slots</span>
            <h1 className="dayhead__title">{DAYS[dayIndex]}</h1>
            <div className="dayhead__sub">Edit the day template, then return to the planner.</div>
          </div>
          <div className="dayhead__tools">
            <button type="button" className="btn btn--ghost" onClick={() => setEditingSlots(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary planner-add-btn" onClick={saveSlots}>
              <CampIcon.Check />
              Save slots
            </button>
          </div>
        </div>

        <div className="slot-editor" aria-label="Edit time slots">
          {slotDrafts.map((block, index) => (
            <div
              className="slot-editor__row"
              key={block.id}
              draggable
              onDragStart={() => setDraggedSlotId(block.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropSlot(block.id)}
              onDragEnd={() => setDraggedSlotId(null)}
            >
              <div className="slot-editor__grab" aria-hidden="true">
                <CampIcon.Shuffle />
              </div>
              <div className="slot-editor__fields">
                <div className="row2">
                  <div className="field">
                    <label className="field__label" htmlFor={"slot-start-" + block.id}>
                      Start
                    </label>
                    <input
                      id={"slot-start-" + block.id}
                      className="input"
                      value={block.start}
                      onChange={(event) => updateSlot(block.id, { start: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={"slot-end-" + block.id}>
                      End
                    </label>
                    <input
                      id={"slot-end-" + block.id}
                      className="input"
                      value={block.end}
                      onChange={(event) => updateSlot(block.id, { end: event.target.value })}
                    />
                  </div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={"slot-label-" + block.id}>
                    Slot label
                  </label>
                  <input
                    id={"slot-label-" + block.id}
                    className="input"
                    value={block.label}
                    onChange={(event) => updateSlot(block.id, { label: event.target.value })}
                  />
                </div>
                <div className="seg">
                  {(["activity", "label"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={block.kind === kind ? "is-on" : ""}
                      onClick={() => updateSlot(block.id, { kind })}
                    >
                      {kind === "activity" ? "Activity slot" : "Set block"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="slot-editor__tools">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => moveSlot(block.id, -1)}
                  aria-label={"Move " + block.label + " earlier"}
                  disabled={index === 0}
                >
                  <CampIcon.ChevronUp />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => moveSlot(block.id, 1)}
                  aria-label={"Move " + block.label + " later"}
                  disabled={index === slotDrafts.length - 1}
                >
                  <CampIcon.ChevronDown />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setSlotDrafts((current) => current.filter((item) => item.id !== block.id))}
                  aria-label={"Delete " + block.label}
                >
                  <CampIcon.Trash />
                </button>
              </div>
            </div>
          ))}

          <div className="schedule-add">
            {adding ? (
              <div className="schedule-add__form">
                <div className="seg">
                  {(["activity", "label"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={draft.kind === kind ? "is-on" : ""}
                      onClick={() => setDraft((p) => ({ ...p, kind }))}
                    >
                      {kind === "activity" ? "Activity slot" : "Set block"}
                    </button>
                  ))}
                </div>
                <div className="row2">
                  <div className="field">
                    <label className="field__label" htmlFor="schedule-block-start">
                      Start
                    </label>
                    <input
                      id="schedule-block-start"
                      className="input"
                      placeholder="10:30"
                      value={draft.start}
                      onChange={(e) => setDraft((p) => ({ ...p, start: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor="schedule-block-end">
                      End
                    </label>
                    <input
                      id="schedule-block-end"
                      className="input"
                      placeholder="10:35"
                      value={draft.end}
                      onChange={(e) => setDraft((p) => ({ ...p, end: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="schedule-block-label">
                    Label
                  </label>
                  <input
                    id="schedule-block-label"
                    className="input"
                    placeholder={draft.kind === "activity" ? "Activity 2" : "Transition"}
                    value={draft.label}
                    onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
                  />
                </div>
                <div className="schedule-add__footer">
                  <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn--primary" onClick={submitDraft}>
                    <CampIcon.Check />
                    Add slot
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn--quiet btn--block" onClick={() => setAdding(true)}>
                <CampIcon.Plus />
                New time slot
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="planner fadein">
      <div className="dayhead">
        <div className="dayhead__copy">
          <span className="dayhead__kicker">Calendar planner</span>
          <h1 className="dayhead__title">{DAYS[dayIndex]}</h1>
          <div className="dayhead__sub">
            {filled} {filled === 1 ? "activity" : "activities"} planned · {blocks.length} slots
          </div>
        </div>
        <div className="dayhead__tools">
          <div className="daynav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDayChange(-1)}
              aria-label="Previous day"
              disabled={dayIndex === 0}
            >
              <CampIcon.ChevronLeft />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onDayChange(1)}
              aria-label="Next day"
              disabled={dayIndex === DAYS.length - 1}
            >
              <CampIcon.ChevronRight />
            </button>
          </div>
          <button type="button" className="btn btn--quiet planner-add-btn" onClick={startEditingSlots}>
            <CampIcon.Tool />
            Edit time slots
          </button>
        </div>
      </div>

      <div className="day-carousel" aria-label="Week days">
        {DAYS.map((day, index) => {
          const planned = (weekBlocks[index] || []).filter((block) => block.kind === "activity" && block.activityId).length;
          return (
            <button
              type="button"
              key={day}
              className={"day-chip" + (index === dayIndex ? " is-active" : "")}
              onClick={() => onDayChange(index - dayIndex)}
              aria-current={index === dayIndex ? "date" : undefined}
            >
              <span>{day.slice(0, 3)}</span>
              <strong>{index + 1}</strong>
              <small>{planned || "-"}</small>
            </button>
          );
        })}
      </div>

      <div className="calendar-grid" style={calendarHeightStyle}>
        <div className="calendar-axis">
          <div className="calendar-axis__head">Time</div>
          <div className="calendar-axis__body">
            {bounds.hours.map((hour) => (
              <span className="calendar-time" style={axisStyle(hour, bounds.start)} key={hour}>
                {formatHour(hour)}
              </span>
            ))}
          </div>
        </div>

        {visibleDays.map((targetDayIndex) => {
          const dayBlocks = weekBlocks[targetDayIndex] || [];
          return (
            <section
              className={"calendar-day" + (targetDayIndex === dayIndex ? " is-active" : " is-adjacent")}
              key={DAYS[targetDayIndex]}
              aria-label={DAYS[targetDayIndex]}
            >
              <button
                type="button"
                className="calendar-day__head"
                onClick={() => onDayChange(targetDayIndex - dayIndex)}
              >
                <span>{DAYS[targetDayIndex].slice(0, 3)}</span>
                <strong>{targetDayIndex + 1}</strong>
              </button>
              <div className="calendar-day__body">
                {bounds.hours.map((hour) => (
                  <span className="calendar-line" style={axisStyle(hour, bounds.start)} key={hour} />
                ))}
                {dayBlocks.map((block) => renderCalendarEvent(block, targetDayIndex))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
