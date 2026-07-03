"use client";

import { useState, type ReactNode } from "react";
import { CampIcon } from "./icons";
import { requestConfirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { Select } from "./floating/Select";
import { DatePopover } from "./floating/DatePopover";
import { ColorSwatchField } from "./floating/ColorField";
import { MiniSeg } from "./primitives";
import { type Camp, type CampSnapMin, type Weekday } from "@/lib/camps";
import { todayKey } from "@/lib/calendar/dates";
import { GUIDE_LABEL_MAX, type GuideBand } from "@/lib/calendar/guides";
import {
  DIETARY_LABEL_MAX,
  type DietaryEntry,
  type DietarySeverity,
} from "@/lib/meals";
import type { DateKey } from "@/lib/calendar/types";
import type { DayWindow } from "@/lib/calendar/time";

// A clean management screen for a user-definable list (camps, themes, locations).
// Create at the top, then a list of rows — switch (camps), rename, delete, and
// (camps only) edit per-camp viewing hours. One surface so each feature gets the
// same clear, discoverable "screen" instead of a cramped inline dropdown.

export type ManagedItem = {
  id: string;
  label: string;
  tint?: string;
  /** The explicit color override for this item, or undefined when it inherits
   *  its default. With onChangeTint + tintFallback, the row's swatch becomes a
   *  color PICKER seeded from this value (locations). */
  tintValue?: string;
  /** The inherited default color, shown by the picker when no override is set
   *  and used as its "reset to default" target. */
  tintFallback?: string;
  /** Camps carry per-camp viewing hours; present both to render the Open–Close
   *  editor on this row. Themes leave them undefined and get no hours sub-row. */
  openMin?: number;
  closeMin?: number;
};

export function ListManagerModal({
  title,
  intro,
  items,
  activeId,
  createPlaceholder = "Name",
  createLabel = "Add",
  emptyHint,
  onCreate,
  onRename,
  onDelete,
  onChangeTint,
  onSelect,
  hourOptions,
  onChangeHours,
  renderRowExtra,
  footer,
  onClose,
}: {
  title: string;
  intro?: string;
  items: ManagedItem[];
  /** When set with onSelect, the matching row reads as the active selection. */
  activeId?: string | null;
  createPlaceholder?: string;
  createLabel?: string;
  emptyHint?: string;
  onCreate: (label: string) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (item: ManagedItem) => void;
  /** When set (with each item's tintValue/tintFallback), every row's swatch is a
   *  color PICKER — pick a color or reset to the default (locations). Passing
   *  undefined clears the override. Omit for read-only swatches (themes). */
  onChangeTint?: (id: string, color: string | undefined) => void;
  /** Provide to make rows selectable (the camp switcher); omit for themes. */
  onSelect?: (id: string) => void;
  /** 15-min clock options for the per-camp hours editor. With onChangeHours and
   *  an item's openMin/closeMin, the row shows an Open–Close editor. */
  hourOptions?: { value: number; label: string }[];
  onChangeHours?: (id: string, field: "open" | "close", value: number) => void;
  /** Optional per-row extra content rendered UNDER the row's main line (and the
   *  Open–Close editor) — the host composes richer per-item authoring here (the
   *  camp manager's weekday hours / dated exceptions / snap). Collapsed sections
   *  are the host's responsibility so the modal stays calm. */
  renderRowExtra?: (item: ManagedItem) => ReactNode;
  /** Optional content rendered after the whole list — global sections that aren't
   *  per-item (the camp manager's guidance bands + dietary roster). */
  footer?: ReactNode;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  function create() {
    const name = draft.trim();
    if (!name) return;
    onCreate(name);
    setDraft("");
  }

  function commitRename(id: string) {
    const name = editDraft.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  }

  // The leading color chip for a row. With onChangeTint (+ the item's fallback)
  // it's an interactive picker; otherwise it's a static swatch. `interactive`
  // is forced off where the chip would sit inside a <button> (the selectable
  // camp row) — a button can't nest a button.
  function renderSwatch(item: ManagedItem, interactive: boolean) {
    if (interactive && onChangeTint && item.tintFallback) {
      return (
        <ColorSwatchField
          value={item.tintValue}
          fallback={item.tintFallback}
          onChange={(color) => onChangeTint(item.id, color)}
          ariaLabel={"Color for " + item.label}
        />
      );
    }
    if (item.tint) {
      return <span className="manager__swatch" style={{ background: item.tint }} aria-hidden="true" />;
    }
    return null;
  }

  return (
    <Modal label={title} onClose={onClose} overlayProps={{ className: "overlay--card overlay--manager" }}>
      <div className="overlay__bar">
        <h2 className="manager__title">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>
      <div className="overlay__body manager">
        {intro && <p className="manager__intro">{intro}</p>}

        <form
          className="manager__create"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            className="input manager__createinput"
            value={draft}
            autoFocus
            placeholder={createPlaceholder}
            aria-label={createPlaceholder}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn--primary manager__createbtn" disabled={!draft.trim()}>
            <CampIcon.Plus />
            {createLabel}
          </button>
        </form>

        {items.length === 0 ? (
          <p className="manager__empty">{emptyHint}</p>
        ) : (
          <ul className="manager__list">
            {items.map((item) =>
              editingId === item.id ? (
                <li key={item.id} className="manager__row">
                  <form
                    className="manager__rowedit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitRename(item.id);
                    }}
                  >
                    {renderSwatch(item, true)}
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                    <input
                      className="input manager__editinput"
                      value={editDraft}
                      autoFocus
                      aria-label={"Rename " + item.label}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={() => commitRename(item.id)}
                    />
                    <button type="submit" className="icon-btn manager__rowbtn" aria-label="Save name">
                      <CampIcon.Check />
                    </button>
                  </form>
                </li>
              ) : (
                <li
                  key={item.id}
                  className={"manager__row" + (onSelect && item.id === activeId ? " is-active" : "")}
                >
                  <div className="manager__rowmain">
                    {onSelect ? (
                      <button
                        type="button"
                        className="manager__pick"
                        aria-current={item.id === activeId ? "true" : undefined}
                        onClick={() => onSelect(item.id)}
                      >
                        {renderSwatch(item, false)}
                        <span className="manager__label">{item.label}</span>
                        {item.id === activeId && (
                          <span className="manager__active">
                            <CampIcon.Check />
                            Active
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="manager__pick manager__pick--static">
                        {renderSwatch(item, true)}
                        <span className="manager__label">{item.label}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      className="icon-btn manager__rowbtn"
                      aria-label={"Rename " + item.label}
                      onClick={() => {
                        setEditingId(item.id);
                        setEditDraft(item.label);
                      }}
                    >
                      <CampIcon.Pencil />
                    </button>
                    <button
                      type="button"
                      className="icon-btn manager__rowbtn manager__rowbtn--danger"
                      aria-label={"Delete " + item.label}
                      onClick={() => onDelete(item)}
                    >
                      <CampIcon.Trash />
                    </button>
                  </div>
                  {hourOptions && onChangeHours && item.openMin != null && item.closeMin != null && (
                    <div className="manager__rowhours">
                      <div className="manager__hoursfield">
                        <span className="manager__hourslabel">Open</span>
                        <Select
                          value={item.openMin}
                          options={hourOptions}
                          onChange={(value) => onChangeHours(item.id, "open", value)}
                          ariaLabel={item.label + " opening time"}
                        />
                      </div>
                      <span className="manager__hoursdash" aria-hidden="true">
                        &ndash;
                      </span>
                      <div className="manager__hoursfield">
                        <span className="manager__hourslabel">Close</span>
                        <Select
                          value={item.closeMin}
                          options={hourOptions}
                          onChange={(value) => onChangeHours(item.id, "close", value)}
                          ariaLabel={item.label + " pickup time"}
                        />
                      </div>
                    </div>
                  )}
                  {renderRowExtra && renderRowExtra(item)}
                </li>
              )
            )}
          </ul>
        )}
        {footer}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Camp day-structure authoring — composed into the camps manager (renderRowExtra
// + footer). Kept beside ListManagerModal (its home surface) rather than a new
// file: these are the manager's own richer per-item / global sections. Each is
// COLLAPSED by default so the modal stays calm.
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SNAP_OPTIONS: { id: string; label: string }[] = [
  { id: "5", label: "5m" },
  { id: "10", label: "10m" },
  { id: "15", label: "15m" },
  { id: "30", label: "30m" },
];
const MEAL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "breakfast", label: "Breakfast" },
  { value: "am-snack", label: "AM snack" },
  { value: "lunch", label: "Lunch" },
  { value: "pm-snack", label: "PM snack" },
  { value: "other", label: "Meal" },
];

// A collapsible sub-section with a chevron header — the shared shell for every
// day-structure block so they all open/close the same way.
function Collapsible({
  label,
  summary,
  children,
}: {
  label: string;
  summary?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"manager__sect" + (open ? " is-open" : "")}>
      <button type="button" className="manager__sect-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CampIcon.ChevronRight className="manager__sect-chev" />
        <span className="manager__sect-label">{label}</span>
        {summary && <span className="manager__sect-summary">{summary}</span>}
      </button>
      {open && <div className="manager__sect-body">{children}</div>}
    </div>
  );
}

// Two open/close clock pills side by side (the override-window editor), sharing
// the manager's hour options.
function WindowPills({
  window: win,
  hourOptions,
  onChange,
  ariaPrefix,
}: {
  window: DayWindow;
  hourOptions: { value: number; label: string }[];
  onChange: (openMin: number, closeMin: number) => void;
  ariaPrefix: string;
}) {
  return (
    <span className="manager__hoursfield manager__hoursfield--inline">
      <Select
        value={win.startMin}
        options={hourOptions}
        onChange={(v) => onChange(v, win.endMin)}
        ariaLabel={ariaPrefix + " open"}
      />
      <span className="manager__hoursdash" aria-hidden="true">&ndash;</span>
      <Select
        value={win.endMin}
        options={hourOptions}
        onChange={(v) => onChange(win.startMin, v)}
        ariaLabel={ariaPrefix + " close"}
      />
    </span>
  );
}

export function CampDayStructure({
  camp,
  hourOptions,
  onSetWeekday,
  onSetDate,
  onSetSnap,
}: {
  camp: Camp;
  hourOptions: { value: number; label: string }[];
  onSetWeekday: (
    id: string,
    weekday: Weekday,
    value: "default" | "closed" | { openMin: number; closeMin: number }
  ) => void;
  onSetDate: (
    id: string,
    date: DateKey,
    value: "closed" | { openMin: number; closeMin: number } | null
  ) => void;
  onSetSnap: (id: string, snapMin: CampSnapMin) => void;
}) {
  const [newDate, setNewDate] = useState<DateKey>(todayKey());
  const dateEntries = Object.entries(camp.dateHours ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const snapValue = String(camp.snapMin ?? 15);

  return (
    <div className="manager__daystruct">
      <Collapsible label="Weekly hours" summary="per-weekday open · close">
        <ul className="manager__weekdays">
          {WEEKDAY_LABELS.map((label, dow) => {
            const raw = camp.weekdayHours?.[dow as Weekday];
            const mode = raw === undefined ? "default" : raw === null ? "closed" : "custom";
            const win: DayWindow = raw && raw !== null ? raw : { startMin: camp.openMin, endMin: camp.closeMin };
            return (
              <li key={dow} className="manager__weekday">
                <span className="manager__weekday-name">{label}</span>
                <MiniSeg
                  options={[
                    { id: "default", label: "Default" },
                    { id: "closed", label: "Closed" },
                    { id: "custom", label: "Custom" },
                  ]}
                  value={mode}
                  onChange={(next) => {
                    if (next === "default") onSetWeekday(camp.id, dow as Weekday, "default");
                    else if (next === "closed") onSetWeekday(camp.id, dow as Weekday, "closed");
                    else onSetWeekday(camp.id, dow as Weekday, { openMin: win.startMin, closeMin: win.endMin });
                  }}
                  ariaLabel={label + " hours mode"}
                />
                {mode === "custom" && (
                  <WindowPills
                    window={win}
                    hourOptions={hourOptions}
                    onChange={(openMin, closeMin) => onSetWeekday(camp.id, dow as Weekday, { openMin, closeMin })}
                    ariaPrefix={label}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Collapsible>

      <Collapsible
        label="Dated exceptions"
        summary={dateEntries.length ? dateEntries.length + " set" : "holidays · special days"}
      >
        <ul className="manager__dates">
          {dateEntries.map(([date, win]) => (
            <li key={date} className="manager__dateexc">
              <span className="manager__dateexc-date">{date}</span>
              {win === null ? (
                <span className="manager__dateexc-closed">Closed</span>
              ) : (
                <WindowPills
                  window={win}
                  hourOptions={hourOptions}
                  onChange={(openMin, closeMin) => onSetDate(camp.id, date, { openMin, closeMin })}
                  ariaPrefix={date}
                />
              )}
              <button
                type="button"
                className="icon-btn manager__rowbtn"
                aria-label={"Toggle closed on " + date}
                title={win === null ? "Set custom hours" : "Set closed"}
                onClick={() =>
                  onSetDate(
                    camp.id,
                    date,
                    win === null ? { openMin: camp.openMin, closeMin: camp.closeMin } : "closed"
                  )
                }
              >
                <CampIcon.Calendar />
              </button>
              <button
                type="button"
                className="icon-btn manager__rowbtn manager__rowbtn--danger"
                aria-label={"Remove exception on " + date}
                onClick={() => onSetDate(camp.id, date, null)}
              >
                <CampIcon.Trash />
              </button>
            </li>
          ))}
        </ul>
        <div className="manager__dateadd">
          <DatePopover value={newDate} onChange={setNewDate} ariaLabel="Exception date" />
          <button
            type="button"
            className="btn btn--ghost manager__dateadd-btn"
            onClick={() => onSetDate(camp.id, newDate, { openMin: camp.openMin, closeMin: camp.closeMin })}
          >
            Add hours
          </button>
          <button
            type="button"
            className="btn btn--ghost manager__dateadd-btn"
            onClick={() => onSetDate(camp.id, newDate, "closed")}
          >
            Add closed
          </button>
        </div>
      </Collapsible>

      <div className="manager__snaprow">
        <span className="manager__snaplabel">Snap grid</span>
        <MiniSeg
          options={SNAP_OPTIONS}
          value={snapValue}
          onChange={(v) => onSetSnap(camp.id, Number(v) as CampSnapMin)}
          ariaLabel="Camp snap grid"
        />
      </div>
    </div>
  );
}

// House rule for destructive confirms (applied across the app):
//   • UNDOABLE actions never confirm — the calendar's event deletes all fire an
//     Undo toast, so a stray delete is one tap to recover. A confirm there would
//     be noise.
//   • NON-undoable vocabulary deletes confirm via requestConfirm (themed dialog,
//     ConfirmDialog.tsx) — removing a theme / camp / location / guidance band /
//     dietary entry has no undo and can touch every event that used it, so it
//     asks first. (This matches the existing themes / camps / locations delete
//     precedent in CampApp.)
// The guidance-band and dietary-entry row deletes below are non-undoable, so
// they confirm here, at the click site, exactly like the camps/locations rows.
export function GuidesSection({
  guides,
  hourOptions,
  onAdd,
  onUpdate,
  onDelete,
}: {
  guides: GuideBand[];
  hourOptions: { value: number; label: string }[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<GuideBand>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Collapsible label="Guidance bands" summary={guides.length ? guides.length + " band" + (guides.length === 1 ? "" : "s") : "soft day-structure frames"}>
      <ul className="manager__guides">
        {guides.map((band) => (
          <li key={band.id} className="manager__guide">
            <input
              className="input manager__guide-label"
              value={band.label}
              maxLength={GUIDE_LABEL_MAX}
              aria-label="Band label"
              onChange={(e) => onUpdate(band.id, { label: e.target.value })}
            />
            <span className="manager__guide-times">
              <Select
                value={band.startMin}
                options={hourOptions}
                onChange={(v) => onUpdate(band.id, { startMin: v, endMin: Math.max(v + 15, band.endMin) })}
                ariaLabel="Band start"
              />
              <span className="manager__hoursdash" aria-hidden="true">&ndash;</span>
              <Select
                value={band.endMin}
                options={hourOptions.filter((o) => o.value > band.startMin)}
                onChange={(v) => onUpdate(band.id, { endMin: v })}
                ariaLabel="Band end"
              />
            </span>
            <span className="manager__guide-days">
              {WEEKDAY_LABELS.map((label, dow) => {
                const on = band.weekdays.includes(dow);
                return (
                  <button
                    type="button"
                    key={dow}
                    className={"manager__daytog" + (on ? " is-on" : "")}
                    aria-pressed={on}
                    aria-label={label + (on ? " on" : " off")}
                    onClick={() => {
                      const next = on
                        ? band.weekdays.filter((d) => d !== dow)
                        : [...band.weekdays, dow].sort((a, b) => a - b);
                      if (next.length) onUpdate(band.id, { weekdays: next });
                    }}
                  >
                    {label[0]}
                  </button>
                );
              })}
            </span>
            <Select
              value={band.mealKind ?? ""}
              options={MEAL_OPTIONS}
              onChange={(v) => onUpdate(band.id, { mealKind: (v || undefined) as GuideBand["mealKind"] })}
              ariaLabel="Band meal tag"
            />
            <button
              type="button"
              className="icon-btn manager__rowbtn manager__rowbtn--danger"
              aria-label={"Delete band " + band.label}
              onClick={async () => {
                const ok = await requestConfirm({
                  title: "Delete the “" + (band.label || "untitled") + "” guidance band?",
                  body: "This can't be undone.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) onDelete(band.id);
              }}
            >
              <CampIcon.Trash />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--ghost manager__addbtn" onClick={onAdd}>
        <CampIcon.Plus />
        Add band
      </button>
    </Collapsible>
  );
}

export function DietarySection({
  dietary,
  onAdd,
  onUpdate,
  onDelete,
}: {
  dietary: DietaryEntry[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<DietaryEntry>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Collapsible label="Dietary roster" summary={dietary.length ? dietary.length + " entr" + (dietary.length === 1 ? "y" : "ies") : "allergies · avoidances"}>
      <ul className="manager__diet">
        {dietary.map((entry) => (
          <li key={entry.id} className="manager__dietrow">
            <input
              className="input manager__diet-label"
              value={entry.label}
              maxLength={DIETARY_LABEL_MAX}
              aria-label="Dietary label"
              onChange={(e) => onUpdate(entry.id, { label: e.target.value })}
            />
            <MiniSeg
              options={[
                { id: "note", label: "Note" },
                { id: "avoid", label: "Avoid" },
                { id: "severe", label: "Severe" },
              ]}
              value={entry.severity}
              onChange={(v) => onUpdate(entry.id, { severity: v as DietarySeverity })}
              ariaLabel="Severity"
            />
            <input
              className="input manager__diet-detail"
              value={entry.detail ?? ""}
              placeholder="Detail (optional)"
              aria-label="Dietary detail"
              onChange={(e) => onUpdate(entry.id, { detail: e.target.value })}
            />
            <button
              type="button"
              className="icon-btn manager__rowbtn manager__rowbtn--danger"
              aria-label={"Delete " + entry.label}
              onClick={async () => {
                const ok = await requestConfirm({
                  title: "Delete the “" + (entry.label || "untitled") + "” dietary entry?",
                  body: "This can't be undone.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (ok) onDelete(entry.id);
              }}
            >
              <CampIcon.Trash />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--ghost manager__addbtn" onClick={onAdd}>
        <CampIcon.Plus />
        Add entry
      </button>
    </Collapsible>
  );
}
