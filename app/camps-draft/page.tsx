"use client";

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT / THROWAWAY — "camp management, rolled into the sidebar".
//
// Standalone preview route (unlinked, ungated by proxy.ts). The resting sidebar
// keeps the normal camp selector + inline "Add camp" and reveals a per-row Edit
// pencil on hover; the pencil opens a CENTERED popup scoped to THAT ONE camp.
//
// This iteration polishes the popup: a purpose-built, flat editor (not the boxed
// production day-structure block) — editable title, default hours, per-weekday
// rows that show their effective window at a glance, friendly dated exceptions,
// snap grid, delete — with deliberate hover/focus states on every control. It
// reuses the REAL Modal + Select + MiniSeg + DatePopover primitives, so controls
// are faithful; only the arrangement is bespoke. Local mock state; nothing syncs.
// Delete this file once we've settled the shape.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, type CSSProperties, type ReactNode } from "react";
import { CampIcon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/floating/Select";
import { DatePopover } from "@/components/floating/DatePopover";
import { MiniSeg } from "@/components/primitives";
import {
  type Camp,
  type CampSnapMin,
  type Weekday,
  campTint,
  hourOptionMinutes,
  clampOverrideWindow,
  withCampOpen,
  withCampClose,
  createCampId,
  MAX_CAMP_NAME,
  DEFAULT_OPEN_MIN,
  DEFAULT_CLOSE_MIN,
  OVERRIDE_EARLIEST_OPEN_MIN,
  OVERRIDE_LATEST_CLOSE_MIN,
} from "@/lib/camps";
import { formatClock } from "@/lib/calendar/time";
import { fromDateKey, todayKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const INITIAL_CAMPS: Camp[] = [
  { id: "camp-summer", name: "Summer Day Camp", createdAt: 1, openMin: 7 * 60 + 30, closeMin: 18 * 60 },
  {
    id: "camp-grades",
    name: "Grades 4–6 Adventure",
    createdAt: 2,
    openMin: 8 * 60,
    closeMin: 17 * 60,
    // Wednesday runs late (pool day); the Friday finale is a special date.
    weekdayHours: { 3: { startMin: 8 * 60, endMin: 19 * 60 } },
    dateHours: { "2026-07-03": null },
  },
  { id: "camp-arts", name: "Arts Intensive", createdAt: 3, openMin: 9 * 60, closeMin: 16 * 60 },
];

const friendlyDate = (key: DateKey) =>
  fromDateKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

export default function CampsDraftPage() {
  const [camps, setCamps] = useState<Camp[]>(INITIAL_CAMPS);
  const [activeCampId, setActiveCampId] = useState<string>("camp-summer");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");

  const hourOptions = hourOptionMinutes().map((m) => ({ value: m, label: formatClock(m) }));
  const overrideHourOptions: { value: number; label: string }[] = [];
  for (let m = OVERRIDE_EARLIEST_OPEN_MIN; m <= OVERRIDE_LATEST_CLOSE_MIN; m += 15) {
    overrideHourOptions.push({ value: m, label: formatClock(m) });
  }

  const patch = (id: string, fn: (c: Camp) => Camp) =>
    setCamps((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));

  const rename = (id: string, name: string) => patch(id, (c) => ({ ...c, name }));
  const setOpen = (id: string, v: number) => patch(id, (c) => withCampOpen(c, v));
  const setClose = (id: string, v: number) => patch(id, (c) => withCampClose(c, v));

  const setWeekday = (
    id: string,
    weekday: Weekday,
    value: "default" | "closed" | { openMin: number; closeMin: number }
  ) =>
    patch(id, (c) => {
      const weekdayHours = { ...(c.weekdayHours ?? {}) };
      if (value === "default") delete weekdayHours[weekday];
      else if (value === "closed") weekdayHours[weekday] = null;
      else weekdayHours[weekday] = clampOverrideWindow(value.openMin, value.closeMin);
      const next: Camp = { ...c };
      if (Object.keys(weekdayHours).length) next.weekdayHours = weekdayHours;
      else delete next.weekdayHours;
      return next;
    });

  const setDate = (
    id: string,
    date: DateKey,
    value: "closed" | { openMin: number; closeMin: number } | null
  ) =>
    patch(id, (c) => {
      const dateHours = { ...(c.dateHours ?? {}) };
      if (value === null) delete dateHours[date];
      else if (value === "closed") dateHours[date] = null;
      else dateHours[date] = clampOverrideWindow(value.openMin, value.closeMin);
      const next: Camp = { ...c };
      if (Object.keys(dateHours).length) next.dateHours = dateHours;
      else delete next.dateHours;
      return next;
    });

  const setSnap = (id: string, snapMin: CampSnapMin) => patch(id, (c) => ({ ...c, snapMin }));

  const removeCamp = (id: string) => {
    setCamps((prev) => prev.filter((c) => c.id !== id));
    setEditingId(null);
    if (activeCampId === id) {
      const rest = camps.filter((c) => c.id !== id);
      setActiveCampId(rest[0]?.id ?? "");
    }
  };

  const addCamp = () => {
    const name = draftName.trim();
    if (!name) return;
    const camp: Camp = {
      id: createCampId(),
      name,
      createdAt: Date.now(),
      openMin: DEFAULT_OPEN_MIN,
      closeMin: DEFAULT_CLOSE_MIN,
    };
    setCamps((prev) => [...prev, camp]);
    setDraftName("");
    setAdding(false);
    setEditingId(camp.id);
  };

  const editingCamp = camps.find((c) => c.id === editingId) ?? null;

  return (
    <div className="app">
      <style>{DRAFT_CSS}</style>

      <nav className="sidenav" aria-label="Primary">
        <div className="cr2__brand">
          <span className="cr2__kicker">The counselor&apos;s kit</span>
          <span className="cr2__title">
            Camp <em>Library</em>
          </span>
        </div>
        <div className="cr2__nav">
          <span className="cr2__navitem is-active">
            <CampIcon.Calendar />
            <span>Calendar</span>
          </span>
          <span className="cr2__navitem">
            <CampIcon.Library />
            <span>Library</span>
          </span>
        </div>

        <div className="sidenav__scroll">
          <div className="sidesection sidesection--fixed camprail is-open">
            <div className="sidesection__head">
              <span className="sidesection__title">
                <CampIcon.Home className="camprail__headic" />
                Camps
              </span>
            </div>

            <div className="sidesection__body camprail__body">
              <ul className="camprail__list">
                {camps.map((camp) => {
                  const active = camp.id === activeCampId;
                  const tint = campTint(camp.id, camps);
                  return (
                    <li key={camp.id} className={"camprail__row" + (active ? " is-active" : "")}>
                      <button
                        type="button"
                        className="camprail__pick"
                        onClick={() => setActiveCampId(camp.id)}
                        aria-pressed={active}
                      >
                        <span
                          className="camprail__dot"
                          style={{ "--camp-tint": tint } as CSSProperties}
                          aria-hidden="true"
                        />
                        <span className="camprail__name">{camp.name}</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn cr2__edit"
                        aria-label={"Edit " + camp.name}
                        onClick={() => setEditingId(camp.id)}
                      >
                        <CampIcon.Pencil />
                      </button>
                    </li>
                  );
                })}
              </ul>

              {adding ? (
                <form
                  className="cr2__addform"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addCamp();
                  }}
                >
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input
                    className="input cr2__addinput"
                    value={draftName}
                    autoFocus
                    placeholder="e.g. Summer Day Camp"
                    aria-label="New camp name"
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setAdding(false);
                        setDraftName("");
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="icon-btn"
                    aria-label="Create camp"
                    disabled={!draftName.trim()}
                  >
                    <CampIcon.Check />
                  </button>
                </form>
              ) : (
                <button type="button" className="camprail__new cr2__add" onClick={() => setAdding(true)}>
                  <CampIcon.Plus />
                  Add camp
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="sidenav__foot">
          <div className="cr2__foot-note">Draft · camp management in the sidebar</div>
        </div>
      </nav>

      <main className="app__main">
        <div className="cr2__main">
          <div className="cr2__card">
            <h1>Camps in the sidebar</h1>
            <p>
              No all-camps manager modal. The <b>Camps</b> section of the sidebar
              (left) is the whole thing — each camp&apos;s settings open in their
              own centered popup. This is a draft to react to.
            </p>
            <ol className="cr2__steps">
              <li>
                <b>Pick a camp</b> — click a name to switch (dot + bold = active).
              </li>
              <li>
                <b>Hover a row → click the pencil</b> — a popup opens for <i>that
                camp only</i>: name, default hours, per-weekday hours, holidays,
                snap, delete.
              </li>
              <li>
                <b>Add camp</b> — creates one and opens its popup.
              </li>
            </ol>
            <p className="cr2__note">
              Try the pencil on <b>Grades 4–6 Adventure</b> — it has a late
              Wednesday and a closed July 3rd already set.
            </p>
          </div>
        </div>
      </main>

      {editingCamp && (
        <Modal
          label={"Edit " + editingCamp.name}
          onClose={() => setEditingId(null)}
          overlayProps={{ className: "overlay--card overlay--manager" }}
        >
          <CampPopup
            camp={editingCamp}
            tint={campTint(editingCamp.id, camps)}
            hourOptions={hourOptions}
            overrideHourOptions={overrideHourOptions}
            onRename={(name) => rename(editingCamp.id, name)}
            onSetOpen={(v) => setOpen(editingCamp.id, v)}
            onSetClose={(v) => setClose(editingCamp.id, v)}
            onSetWeekday={(dow, val) => setWeekday(editingCamp.id, dow, val)}
            onSetDate={(date, val) => setDate(editingCamp.id, date, val)}
            onSetSnap={(s) => setSnap(editingCamp.id, s)}
            onDelete={() => removeCamp(editingCamp.id)}
            onClose={() => setEditingId(null)}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── the per-camp popup body ──────────────────────────────────────────────────
type HourOpts = { value: number; label: string }[];

function CampPopup({
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
  tint: string;
  hourOptions: HourOpts;
  overrideHourOptions: HourOpts;
  onRename: (name: string) => void;
  onSetOpen: (v: number) => void;
  onSetClose: (v: number) => void;
  onSetWeekday: (dow: Weekday, val: "default" | "closed" | { openMin: number; closeMin: number }) => void;
  onSetDate: (date: DateKey, val: "closed" | { openMin: number; closeMin: number } | null) => void;
  onSetSnap: (s: CampSnapMin) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [newDate, setNewDate] = useState<DateKey>(todayKey());

  const overrideCount = Object.keys(camp.weekdayHours ?? {}).length;
  const weekSummary = overrideCount ? overrideCount + (overrideCount === 1 ? " day differs" : " days differ") : "same all week";
  const dateEntries = Object.entries(camp.dateHours ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const excSummary = dateEntries.length ? dateEntries.length + " set" : "none yet";

  return (
    <>
      {/* Focus guard — useDialogFocus prefers a [data-autofocus] target, so the
          dialog opens calm (focus rests here, NOT in the name field). It's
          tabindex -1 so it's out of the Tab cycle; the first Tab still lands on
          the name input. */}
      <span data-autofocus tabIndex={-1} aria-hidden="true" className="cr2m__focusguard" />
      <div className="overlay__bar cr2m__bar">
        <div className="cr2m__titlewrap">
          <span
            className="camprail__dot cr2m__titledot"
            style={{ "--camp-tint": tint } as CSSProperties}
            aria-hidden="true"
          />
          <input
            className="cr2m__titleinput"
            value={camp.name}
            aria-label="Camp name"
            maxLength={MAX_CAMP_NAME}
            spellCheck={false}
            onChange={(e) => onRename(e.target.value)}
          />
          <CampIcon.Pencil className="cr2m__titlepen" aria-hidden="true" />
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>

      <div className="overlay__body">
        <div className="cr2m">
          <p className="cr2m__intro">
            Set this camp&apos;s hours and days off. Your activity library is shared across every camp.
          </p>

          {/* default hours ------------------------------------------------ */}
          <div className="cr2m__baserow">
            <div className="cr2m__baselabels">
              <span className="cr2m__grouplabel">Default hours</span>
              <span className="cr2m__hint">Drop-off → pickup, every day a weekday below doesn&apos;t override.</span>
            </div>
            <div className="cr2m__pills">
              <Select
                value={camp.openMin}
                options={hourOptions}
                onChange={onSetOpen}
                ariaLabel="Default drop-off time"
              />
              <span className="cr2m__dash" aria-hidden="true">–</span>
              <Select
                value={camp.closeMin}
                options={hourOptions}
                onChange={onSetClose}
                ariaLabel="Default pickup time"
              />
            </div>
          </div>

          {/* weekly hours ------------------------------------------------- */}
          <Disclosure label="Weekly hours" summary={weekSummary} defaultOpen>
            <div className="cr2m__week">
              {WEEKDAYS.map((label, dow) => {
                const raw = camp.weekdayHours?.[dow as Weekday];
                const mode = raw === undefined ? "default" : raw === null ? "closed" : "custom";
                const win = raw && raw !== null ? raw : { startMin: camp.openMin, endMin: camp.closeMin };
                return (
                  <div key={dow} className={"cr2m__day is-" + mode}>
                    <div className="cr2m__dayline">
                      <span className="cr2m__dayname">{label}</span>
                      <span className="cr2m__dayeff">
                        {mode === "closed"
                          ? "Closed"
                          : mode === "default"
                            ? formatClock(camp.openMin) + " – " + formatClock(camp.closeMin)
                            : ""}
                      </span>
                      <MiniSeg
                        className="cr2m__dayseg"
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
                      <div className="cr2m__pills cr2m__pills--indent">
                        <Select
                          value={win.startMin}
                          options={overrideHourOptions}
                          onChange={(v) => onSetWeekday(dow as Weekday, { openMin: v, closeMin: win.endMin })}
                          ariaLabel={label + " open"}
                        />
                        <span className="cr2m__dash" aria-hidden="true">–</span>
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
          <Disclosure label="Holidays &amp; special days" summary={excSummary}>
            {dateEntries.length > 0 && (
              <ul className="cr2m__exclist">
                {dateEntries.map(([date, win]) => (
                  <li key={date} className="cr2m__exc">
                    <span className="cr2m__excdate">{friendlyDate(date)}</span>
                    {win === null ? (
                      <span className="cr2m__excstate cr2m__excstate--closed">Closed</span>
                    ) : (
                      <span className="cr2m__excstate">
                        {formatClock(win.startMin) + " – " + formatClock(win.endMin)}
                      </span>
                    )}
                    <button
                      type="button"
                      className="icon-btn cr2m__excbtn"
                      title={win === null ? "Switch to custom hours" : "Switch to closed"}
                      aria-label={win === null ? "Set custom hours on " + friendlyDate(date) : "Set closed on " + friendlyDate(date)}
                      onClick={() =>
                        onSetDate(date, win === null ? { openMin: camp.openMin, closeMin: camp.closeMin } : "closed")
                      }
                    >
                      {win === null ? <CampIcon.Clock /> : <CampIcon.Calendar />}
                    </button>
                    <button
                      type="button"
                      className="icon-btn cr2m__excbtn cr2m__excbtn--danger"
                      aria-label={"Remove " + friendlyDate(date)}
                      onClick={() => onSetDate(date, null)}
                    >
                      <CampIcon.Trash />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="cr2m__excadd">
              <DatePopover value={newDate} onChange={setNewDate} ariaLabel="Exception date" />
              <div className="cr2m__excaddbtns">
                <button type="button" className="cr2m__addbtn" onClick={() => onSetDate(newDate, "closed")}>
                  Closed
                </button>
                <button
                  type="button"
                  className="cr2m__addbtn"
                  onClick={() => onSetDate(newDate, { openMin: camp.openMin, closeMin: camp.closeMin })}
                >
                  Custom hours
                </button>
              </div>
            </div>
          </Disclosure>

          {/* snap grid ---------------------------------------------------- */}
          <div className="cr2m__snap">
            <span className="cr2m__grouplabel">Snap grid</span>
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
          <div className="cr2m__foot">
            <button type="button" className="cr2m__del" onClick={onDelete}>
              <CampIcon.Trash />
              Delete camp
            </button>
            <button type="button" className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// A flat disclosure (chevron + label + summary) — no boxed card, just a thin
// rule, so the popup reads calm. Distinct from the production manager's boxed
// Collapsible on purpose.
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
    <div className={"cr2m__disc" + (open ? " is-open" : "")}>
      <button type="button" className="cr2m__dischead" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CampIcon.ChevronRight className="cr2m__discchev" />
        <span className="cr2m__grouplabel">{label}</span>
        {summary && <span className="cr2m__discsum">{summary}</span>}
      </button>
      {open && <div className="cr2m__discbody">{children}</div>}
    </div>
  );
}

const DRAFT_CSS = `
.cr2__brand { display: flex; flex-direction: column; gap: 2px; margin-bottom: 22px; flex: none; }
.cr2__kicker { font-family: var(--hand-sc); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-faint); }
.cr2__title { font-family: var(--hand); font-size: 20px; color: var(--ink); }
.cr2__title em { font-style: italic; color: var(--accent-ink); }
.cr2__nav { display: flex; flex-direction: column; gap: 2px; flex: none; }
.cr2__navitem { display: flex; align-items: center; gap: var(--s-3); min-height: 40px; padding: 0 var(--s-2); border-radius: var(--r-md); font: inherit; color: var(--ink-soft); }
.cr2__navitem svg { width: 19px; height: 19px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.cr2__navitem.is-active { background: var(--card); color: var(--ink); }

.cr2__edit { flex: none; width: 30px; height: 30px; opacity: 0; transition: opacity var(--t-fast) var(--ease), color var(--t-fast) var(--ease); }
.cr2__edit svg { width: 16px; height: 16px; }
.camprail__row:hover .cr2__edit, .cr2__edit:focus-visible { opacity: 1; }
.camprail__row:hover .cr2__edit:hover { color: var(--ink); }

.cr2__addform { display: flex; align-items: center; gap: var(--s-2); margin-top: var(--s-2); }
.cr2__addinput { flex: 1 1 auto; min-width: 0; }
.cr2__add { margin-top: var(--s-2); }
.cr2__foot-note { font-size: var(--fs-meta); color: var(--ink-faint); }
.cr2__main { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 40px; overflow: auto; }
.cr2__card { max-width: 460px; display: flex; flex-direction: column; gap: 14px; background: var(--card); border: 2px solid var(--ink); border-radius: var(--r-md); padding: 28px 30px; }
.cr2__card h1 { margin: 0; font-family: var(--hand); font-size: 24px; color: var(--ink); }
.cr2__card p { margin: 0; font-size: var(--fs-ui); color: var(--ink-soft); line-height: 1.5; }
.cr2__card b { color: var(--ink); }
.cr2__steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 7px; font-size: var(--fs-ui); color: var(--ink-soft); line-height: 1.45; }
.cr2__note { border-top: 1.5px dashed var(--line-soft); padding-top: 12px; }

/* ---- per-camp popup ------------------------------------------------------ */
.cr2m__focusguard { position: absolute; width: 0; height: 0; padding: 0; margin: 0; overflow: hidden; outline: none; }
/* editable title in the bar */
.cr2m__titlewrap { display: flex; align-items: center; gap: var(--s-2); flex: 1 1 auto; min-width: 0; }
.cr2m__titledot { flex: none; width: 11px; height: 11px; }
.cr2m__titleinput {
  flex: 1 1 auto; min-width: 0; border: 1.5px solid transparent; border-radius: var(--r-sm);
  background: transparent; padding: 3px 8px; margin-left: -2px;
  font-family: var(--hand); font-size: var(--fs-title-sm); color: var(--ink);
  transition: background-color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
}
.cr2m__titleinput:hover { background: var(--paper-2); }
.cr2m__titleinput:focus { outline: none; background: var(--card); border-color: var(--accent-ink); }
.cr2m__titlepen { flex: none; width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.7; color: var(--ink-faint); opacity: 0; transition: opacity var(--t-fast) var(--ease); }
.cr2m__titlewrap:hover .cr2m__titlepen { opacity: 1; }
.cr2m__titleinput:focus ~ .cr2m__titlepen { opacity: 0; }

.cr2m { display: flex; flex-direction: column; gap: var(--s-4); padding: 0 var(--s-7) var(--s-7); }
.cr2m__intro { margin: 0; font-size: var(--fs-meta); line-height: 1.5; color: var(--ink-soft); }
.cr2m__grouplabel { font-family: var(--hand-sc); font-size: var(--fs-meta); letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-soft); }
.cr2m__hint { font-size: var(--fs-meta); color: var(--ink-faint); line-height: 1.4; }
.cr2m__dash { color: var(--ink-faint); }
.cr2m__pills { display: flex; align-items: center; justify-content: flex-start; gap: var(--s-2); flex-wrap: nowrap; }
/* .cselect is width:100% by default, so pin each Open/Close pill to a fixed
   width — the pair sits together and both align, Default vs custom rows. */
.cr2m__pills .cselect { flex: 0 0 auto; width: 122px; }
.cr2m__pills--indent { padding: var(--s-1) 0 var(--s-2) calc(3.4ch + var(--s-3)); }

/* default hours row — labels stacked above the Open–Close pair */
.cr2m__baserow { display: flex; flex-direction: column; gap: var(--s-2); }
.cr2m__baselabels { display: flex; flex-direction: column; gap: 3px; }

/* flat disclosure */
.cr2m__disc { border-top: 1.5px dashed var(--line-soft); padding-top: var(--s-3); }
.cr2m__dischead { display: flex; align-items: center; gap: var(--s-2); width: 100%; padding: 2px 0; border: 0; background: transparent; cursor: pointer; text-align: left; color: inherit; }
.cr2m__dischead:hover .cr2m__grouplabel { color: var(--ink); }
.cr2m__dischead:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 3px; border-radius: var(--r-sm); }
.cr2m__discchev { flex: none; width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; color: var(--ink-soft); transition: transform var(--t-fast) var(--ease), color var(--t-fast) var(--ease); }
.cr2m__disc.is-open .cr2m__discchev { transform: rotate(90deg); animation: none; }
.cr2m__dischead:hover .cr2m__discchev { color: var(--ink); }
.cr2m__discsum { margin-left: auto; font-family: var(--hand-sc); font-size: var(--fs-meta); letter-spacing: 0.03em; color: var(--ink-faint); }
.cr2m__discbody { padding-top: var(--s-3); }

/* weekday rows */
.cr2m__week { display: flex; flex-direction: column; gap: 1px; }
.cr2m__day { border-radius: var(--r-sm); padding: 3px var(--s-2); transition: background-color var(--t-fast) var(--ease); }
.cr2m__day:hover { background: var(--paper-2); }
.cr2m__dayline { display: flex; align-items: center; gap: var(--s-3); min-height: 34px; }
.cr2m__dayname { flex: none; width: 3.4ch; font-family: var(--hand-sc); font-size: var(--fs-meta); letter-spacing: 0.02em; color: var(--ink-soft); }
.cr2m__day.is-default .cr2m__dayname { color: var(--ink-faint); }
.cr2m__dayeff { flex: 1 1 auto; min-width: 0; font-size: var(--fs-meta); color: var(--ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr2m__day.is-closed .cr2m__dayeff { color: var(--danger); }
.cr2m__dayseg { flex: none; }

/* exceptions */
.cr2m__exclist { list-style: none; margin: 0 0 var(--s-3); padding: 0; display: flex; flex-direction: column; gap: 1px; }
.cr2m__exc { display: flex; align-items: center; gap: var(--s-2); min-height: 36px; padding: 2px var(--s-2); border-radius: var(--r-sm); transition: background-color var(--t-fast) var(--ease); }
.cr2m__exc:hover { background: var(--paper-2); }
.cr2m__excdate { flex: none; min-width: 8ch; font-family: var(--hand-sc); font-size: var(--fs-meta); color: var(--ink); }
.cr2m__excstate { flex: 1 1 auto; font-size: var(--fs-meta); color: var(--ink-soft); }
.cr2m__excstate--closed { color: var(--danger); }
.cr2m__excbtn { width: 30px; height: 30px; }
.cr2m__excbtn svg { width: 16px; height: 16px; }
.cr2m__excbtn--danger:hover { color: var(--danger); }
.cr2m__excadd { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); flex-wrap: wrap; }
.cr2m__excaddbtns { display: inline-flex; gap: var(--s-2); }
.cr2m__addbtn {
  border: 1.5px solid var(--line); border-radius: var(--r-sm); background: var(--card); cursor: pointer;
  font: inherit; font-size: var(--fs-meta); color: var(--ink-soft); padding: 5px 12px;
  transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
}
.cr2m__addbtn:hover { background: var(--paper-2); color: var(--ink); border-color: var(--ink-soft); }
.cr2m__addbtn:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }

/* snap + actions */
.cr2m__snap { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); border-top: 1.5px dashed var(--line-soft); padding-top: var(--s-3); }
.cr2m__foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); border-top: 1.5px dashed var(--line-soft); padding-top: var(--s-4); }
.cr2m__del { display: inline-flex; align-items: center; gap: var(--s-1); border: 1.5px solid transparent; border-radius: var(--r-sm); background: transparent; cursor: pointer; font: inherit; font-size: var(--fs-meta); color: var(--ink-faint); padding: 5px 10px 5px 6px; transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease); }
.cr2m__del svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.cr2m__del:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); }
.cr2m__del:focus-visible { outline: 2px solid var(--danger); outline-offset: 2px; }
`;
