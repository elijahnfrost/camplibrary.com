"use client";

// Per-camp editor — a centered popup scoped to ONE camp, opened from the desktop
// sidebar's Camps rail (the per-row Edit pencil) or right after creating a camp.
// It replaces the old all-camps ListManagerModal on desktop: the rail is the
// selector + add, and each camp's schedule is edited here in its own popup.
//
// A purpose-built FLAT editor (not the boxed CampDayStructure): an editable
// title, default hours, per-weekday rows that show each day's effective window
// at a glance, holidays/special days, snap grid, and delete. It reuses the real
// Modal + Select + MiniSeg + DatePopover so the controls stay faithful. Opens
// calm — a focus guard keeps the cursor out of the name field, but the first Tab
// still lands on it.

import { useState, type CSSProperties, type ReactNode } from "react";
import { CampIcon } from "./icons";
import { Modal } from "./Modal";
import { Select } from "./floating/Select";
import { DatePopover } from "./floating/DatePopover";
import { MiniSeg } from "./primitives";
import { MAX_CAMP_NAME, type Camp, type CampSnapMin, type Weekday } from "@/lib/camps";
import { formatClock } from "@/lib/calendar/time";
import { fromDateKey, todayKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type HourOpts = { value: number; label: string }[];

const friendlyDate = (key: DateKey) =>
  fromDateKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

export function CampEditorPopup({
  camp,
  tint,
  hourOptions,
  overrideHourOptions,
  onRename,
  onSetOpen,
  onSetClose,
  onSetWeekday,
  onSetDate,
  onSetSnap,
  onDelete,
  onClose,
}: {
  camp: Camp;
  /** The camp's derived identity tint (campTint), for the title dot. */
  tint: string;
  /** Base 6:00–20:00 clock options for the default open/close. */
  hourOptions: HourOpts;
  /** Wider 5:00–22:00 clock options for the per-weekday / dated overrides. */
  overrideHourOptions: HourOpts;
  onRename: (name: string) => void;
  onSetOpen: (v: number) => void;
  onSetClose: (v: number) => void;
  onSetWeekday: (dow: Weekday, val: "default" | "closed" | { openMin: number; closeMin: number }) => void;
  onSetDate: (date: DateKey, val: "closed" | { openMin: number; closeMin: number } | null) => void;
  onSetSnap: (s: CampSnapMin) => void;
  /** Confirm + delete this camp (the host owns the confirm dialog). */
  onDelete: () => void;
  onClose: () => void;
}) {
  const [newDate, setNewDate] = useState<DateKey>(todayKey());

  const overrideCount = Object.keys(camp.weekdayHours ?? {}).length;
  const weekSummary = overrideCount
    ? overrideCount + (overrideCount === 1 ? " day differs" : " days differ")
    : "same all week";
  const dateEntries = Object.entries(camp.dateHours ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const excSummary = dateEntries.length ? dateEntries.length + " set" : "none yet";

  return (
    <Modal
      label={"Edit " + camp.name}
      onClose={onClose}
      overlayProps={{ className: "overlay--card overlay--manager" }}
    >
      {/* Focus guard — useDialogFocus prefers a [data-autofocus] target, so the
          dialog opens calm (focus rests here, NOT in the name field). It's
          tabindex -1 so it's out of the Tab cycle; the first Tab still lands on
          the name input. */}
      <span data-autofocus tabIndex={-1} aria-hidden="true" className="campedit__focusguard" />

      <div className="overlay__bar campedit__bar">
        <div className="campedit__titlewrap">
          <span
            className="camprail__dot campedit__titledot"
            style={{ "--camp-tint": tint } as CSSProperties}
            aria-hidden="true"
          />
          <input
            className="campedit__titleinput"
            value={camp.name}
            aria-label="Camp name"
            maxLength={MAX_CAMP_NAME}
            spellCheck={false}
            onChange={(e) => onRename(e.target.value)}
          />
          <CampIcon.Pencil className="campedit__titlepen" aria-hidden="true" />
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>

      <div className="overlay__body">
        <div className="campedit">
          <p className="campedit__intro">
            Set this camp&apos;s hours and days off. Your activity library is shared across every camp.
          </p>

          {/* default hours ------------------------------------------------ */}
          <div className="campedit__baserow">
            <div className="campedit__baselabels">
              <span className="campedit__grouplabel">Default hours</span>
              <span className="campedit__hint">Drop-off → pickup, every day a weekday below doesn&apos;t override.</span>
            </div>
            <div className="campedit__pills">
              <Select value={camp.openMin} options={hourOptions} onChange={onSetOpen} ariaLabel="Default drop-off time" />
              <span className="campedit__dash" aria-hidden="true">–</span>
              <Select value={camp.closeMin} options={hourOptions} onChange={onSetClose} ariaLabel="Default pickup time" />
            </div>
          </div>

          {/* weekly hours ------------------------------------------------- */}
          <Disclosure label="Weekly hours" summary={weekSummary} defaultOpen>
            <div className="campedit__week">
              {WEEKDAYS.map((label, dow) => {
                const raw = camp.weekdayHours?.[dow as Weekday];
                const mode = raw === undefined ? "default" : raw === null ? "closed" : "custom";
                const win = raw && raw !== null ? raw : { startMin: camp.openMin, endMin: camp.closeMin };
                return (
                  <div key={dow} className={"campedit__day is-" + mode}>
                    <div className="campedit__dayline">
                      <span className="campedit__dayname">{label}</span>
                      <span className="campedit__dayeff">
                        {mode === "closed"
                          ? "Closed"
                          : mode === "default"
                            ? formatClock(camp.openMin) + " – " + formatClock(camp.closeMin)
                            : ""}
                      </span>
                      <MiniSeg
                        className="campedit__dayseg"
                        options={[
                          { id: "default", label: "Default" },
                          { id: "closed", label: "Closed" },
                          { id: "custom", label: "Custom" },
                        ]}
                        value={mode}
                        onChange={(next) => {
                          if (next === "default") onSetWeekday(dow as Weekday, "default");
                          else if (next === "closed") onSetWeekday(dow as Weekday, "closed");
                          else onSetWeekday(dow as Weekday, { openMin: win.startMin, closeMin: win.endMin });
                        }}
                        ariaLabel={label + " hours"}
                      />
                    </div>
                    {mode === "custom" && (
                      <div className="campedit__pills campedit__pills--indent">
                        <Select
                          value={win.startMin}
                          options={overrideHourOptions}
                          onChange={(v) => onSetWeekday(dow as Weekday, { openMin: v, closeMin: win.endMin })}
                          ariaLabel={label + " open"}
                        />
                        <span className="campedit__dash" aria-hidden="true">–</span>
                        <Select
                          value={win.endMin}
                          options={overrideHourOptions}
                          onChange={(v) => onSetWeekday(dow as Weekday, { openMin: win.startMin, closeMin: v })}
                          ariaLabel={label + " close"}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Disclosure>

          {/* holidays & special days -------------------------------------- */}
          <Disclosure label="Holidays & special days" summary={excSummary}>
            {dateEntries.length > 0 && (
              <ul className="campedit__exclist">
                {dateEntries.map(([date, win]) => (
                  <li key={date} className="campedit__exc">
                    <span className="campedit__excdate">{friendlyDate(date)}</span>
                    {win === null ? (
                      <span className="campedit__excstate campedit__excstate--closed">Closed</span>
                    ) : (
                      <span className="campedit__excstate">
                        {formatClock(win.startMin) + " – " + formatClock(win.endMin)}
                      </span>
                    )}
                    <button
                      type="button"
                      className="icon-btn campedit__excbtn"
                      title={win === null ? "Switch to custom hours" : "Switch to closed"}
                      aria-label={
                        win === null ? "Set custom hours on " + friendlyDate(date) : "Set closed on " + friendlyDate(date)
                      }
                      onClick={() =>
                        onSetDate(date, win === null ? { openMin: camp.openMin, closeMin: camp.closeMin } : "closed")
                      }
                    >
                      {win === null ? <CampIcon.Clock /> : <CampIcon.Calendar />}
                    </button>
                    <button
                      type="button"
                      className="icon-btn campedit__excbtn campedit__excbtn--danger"
                      aria-label={"Remove " + friendlyDate(date)}
                      onClick={() => onSetDate(date, null)}
                    >
                      <CampIcon.Trash />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="campedit__excadd">
              <DatePopover value={newDate} onChange={setNewDate} ariaLabel="Exception date" />
              <div className="campedit__excaddbtns">
                <button type="button" className="campedit__addbtn" onClick={() => onSetDate(newDate, "closed")}>
                  Closed
                </button>
                <button
                  type="button"
                  className="campedit__addbtn"
                  onClick={() => onSetDate(newDate, { openMin: camp.openMin, closeMin: camp.closeMin })}
                >
                  Custom hours
                </button>
              </div>
            </div>
          </Disclosure>

          {/* snap grid ---------------------------------------------------- */}
          <div className="campedit__snap">
            <span className="campedit__grouplabel">Snap grid</span>
            <MiniSeg
              options={[
                { id: "5", label: "5m" },
                { id: "10", label: "10m" },
                { id: "15", label: "15m" },
                { id: "30", label: "30m" },
              ]}
              value={String(camp.snapMin ?? 15)}
              onChange={(v) => onSetSnap(Number(v) as CampSnapMin)}
              ariaLabel="Snap grid"
            />
          </div>

          {/* actions ------------------------------------------------------ */}
          <div className="campedit__foot">
            <button type="button" className="campedit__del" onClick={onDelete}>
              <CampIcon.Trash />
              Delete camp
            </button>
            <button type="button" className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// A flat disclosure (chevron + label + summary) — no boxed card, just a thin
// rule, so the popup reads calm. Distinct from the manager's boxed Collapsible
// on purpose; matches the sidebar's own disclosure affordance.
function Disclosure({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"campedit__disc" + (open ? " is-open" : "")}>
      <button type="button" className="campedit__dischead" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CampIcon.ChevronRight className="campedit__discchev" />
        <span className="campedit__grouplabel">{label}</span>
        {summary && <span className="campedit__discsum">{summary}</span>}
      </button>
      {open && <div className="campedit__discbody">{children}</div>}
    </div>
  );
}
