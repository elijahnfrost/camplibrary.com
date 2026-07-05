"use client";

// The per-camp editor popup. Signature is CALM DEPTH: the window opens showing
// only the title, the intro line, DEFAULT HOURS and WEEKLY HOURS; HOLIDAYS &
// SPECIAL DAYS, GUIDANCE BANDS and SNAP GRID rest as collapsed disclosures whose
// summaries carry the state ("2 set", "3 bands", "15m") — nothing important goes
// invisible, opening is only needed to CHANGE something. The title is VISIBLY
// editable (solid underline at rest, focus ring) with a real rename button; each
// holiday row uses an explicit "Closed | Hours" MiniSeg (an icon never changes
// meaning per state); the remove action is danger ink with a tooltip.

import { useRef, useState } from "react";
import { CampIcon } from "./icons";
import { Select } from "./floating/Select";
import { DatePopover } from "./floating/DatePopover";
import { MiniSeg } from "./primitives";
import { MAX_CAMP_NAME, type Camp, type CampSnapMin, type Weekday } from "@/lib/camps";
import { GUIDE_LABEL_MAX, type GuideBand } from "@/lib/calendar/guides";
import { formatClock } from "@/lib/calendar/time";
import { fromDateKey, todayKey } from "@/lib/calendar/dates";
import type { DateKey } from "@/lib/calendar/types";
import { FocusSheet } from "./FocusSheet";
import { Disclosure } from "./Disclosure";

type HourOpts = { value: number; label: string }[];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const friendlyDate = (key: DateKey) =>
  fromDateKey(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

export function CampEditorPopup({
  camp,
  tint,
  hourOptions,
  overrideHourOptions,
  guides,
  canEditGuides,
  onRename,
  onSetOpen,
  onSetClose,
  onSetWeekday,
  onSetDate,
  onSetSnap,
  onAddGuide,
  onUpdateGuide,
  onDeleteGuide,
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
  /** This camp's EFFECTIVE guidance bands — its own if set, else the inherited
   *  legacy shared baseline. Editing forks a per-camp copy (host-side). */
  guides: GuideBand[];
  /** Gate the guides editor like every other staff surface (read-only otherwise). */
  canEditGuides: boolean;
  onRename: (name: string) => void;
  onSetOpen: (v: number) => void;
  onSetClose: (v: number) => void;
  onSetWeekday: (dow: Weekday, val: "default" | "closed" | { openMin: number; closeMin: number }) => void;
  onSetDate: (date: DateKey, val: "closed" | { openMin: number; closeMin: number } | null) => void;
  onSetSnap: (s: CampSnapMin) => void;
  onAddGuide: () => void;
  onUpdateGuide: (id: string, patch: Partial<GuideBand>) => void;
  /** Delete a band (the host owns any confirm dialog). */
  onDeleteGuide: (id: string) => void;
  /** Confirm + delete this camp (the host owns the confirm dialog). */
  onDelete: () => void;
  onClose: () => void;
}) {
  const [newDate, setNewDate] = useState<DateKey>(todayKey());
  const titleRef = useRef<HTMLInputElement | null>(null);

  // The name field runs off a LOCAL draft, not the stored name directly. The
  // store's renameCamp trims and rejects empties, so binding the input straight
  // to camp.name meant clearing the field (or typing a space) snapped the old
  // name right back — pre-existing names felt impossible to change or delete.
  // Now you can freely clear and retype; we persist only a trimmed, non-empty
  // value (a camp always keeps a name). Re-seed when a different camp opens.
  const [nameDraft, setNameDraft] = useState(camp.name);
  const [seededCampId, setSeededCampId] = useState(camp.id);
  if (seededCampId !== camp.id) {
    setSeededCampId(camp.id);
    setNameDraft(camp.name);
  }

  const overrideCount = Object.keys(camp.weekdayHours ?? {}).length;
  const weekSummary = overrideCount
    ? overrideCount + (overrideCount === 1 ? " day differs" : " days differ")
    : "same all week";
  const dateEntries = Object.entries(camp.dateHours ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const excSummary = dateEntries.length ? dateEntries.length + " set" : "none yet";
  const guideSummary = guides.length
    ? guides.length + (guides.length === 1 ? " band" : " bands")
    : "none yet";
  const snapSummary = (camp.snapMin ?? 15) + "m";

  return (
    <FocusSheet
      label={"Edit " + camp.name}
      onClose={onClose}
      overlayClass="overlay--card overlay--manager lc-sheet lc-sheet--camp"
      tint={tint}
      title={
        <>
          <input
            ref={titleRef}
            className="lc-titleinput"
            value={nameDraft}
            aria-label="Camp name"
            maxLength={MAX_CAMP_NAME}
            spellCheck={false}
            onChange={(e) => {
              const next = e.target.value;
              setNameDraft(next);
              const trimmed = next.trim();
              if (trimmed) onRename(trimmed);
            }}
          />
          {/* A REAL rename affordance — focuses the input (and selects the name
              so typing replaces it), instead of a decorative hover pencil. */}
          <button
            type="button"
            className="icon-btn lc-titlepen"
            aria-label="Rename camp"
            title="Rename camp"
            onClick={() => {
              titleRef.current?.focus();
              titleRef.current?.select();
            }}
          >
            <CampIcon.Pencil />
          </button>
        </>
      }
      footStart={
        <button type="button" className="lc-del" onClick={onDelete} title="Delete this camp">
          <CampIcon.Trash />
          Delete camp
        </button>
      }
      footEnd={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {/* Focus guard — useDialogFocus prefers a [data-autofocus] target, so the
          dialog opens calm (focus rests here, NOT in the name field); the first
          Tab still lands on the name input. */}
      <span data-autofocus tabIndex={-1} aria-hidden="true" className="lc-focusguard" />

      <div className="lc-camp">
        <p className="lc-intro">
          Set this camp&apos;s hours and days off. Your activity library is shared across every camp.
        </p>

        {/* default hours ------------------------------------------------ */}
        <div className="lc-group">
          <div className="lc-group__labels">
            <span className="lc-label">Default hours</span>
            <span className="lc-hint">Drop-off → pickup, every day a weekday below doesn&apos;t override.</span>
          </div>
          <div className="campedit__pills">
            <Select value={camp.openMin} options={hourOptions} onChange={onSetOpen} ariaLabel="Default drop-off time" />
            <span className="campedit__dash" aria-hidden="true">–</span>
            <Select value={camp.closeMin} options={hourOptions} onChange={onSetClose} ariaLabel="Default pickup time" />
          </div>
        </div>

        {/* weekly hours (open at rest — the reference face) --------------- */}
        <Disclosure className="lc-rule" title="Weekly hours" summary={weekSummary} defaultOpen>
          <div className="lc-week">
            {WEEKDAYS.map((label, dow) => {
              const raw = camp.weekdayHours?.[dow as Weekday];
              const mode = raw === undefined ? "default" : raw === null ? "closed" : "custom";
              const win = raw && raw !== null ? raw : { startMin: camp.openMin, endMin: camp.closeMin };
              return (
                <div key={dow} className={"lc-day is-" + mode}>
                  <div className="lc-day__line">
                    <span className="lc-day__name">{label}</span>
                    <span className="lc-day__eff">
                      {mode === "closed"
                        ? "Closed"
                        : mode === "default"
                          ? formatClock(camp.openMin) + " – " + formatClock(camp.closeMin)
                          : ""}
                    </span>
                    <MiniSeg
                      className="lc-day__seg"
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
                    <div className="campedit__pills lc-day__pills">
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

        {/* holidays & special days --------------------------------------- */}
        <Disclosure className="lc-rule" title="Holidays & special days" summary={excSummary}>
          {dateEntries.length > 0 && (
            <ul className="lc-exclist">
              {dateEntries.map(([date, win]) => (
                <li key={date} className="lc-exc">
                  <span className="lc-exc__date">{friendlyDate(date)}</span>
                  {/* Explicit state words — the original's Clock/Calendar icon
                      button flipped meaning per state; a segmented pill says
                      both states out loud and marks the current one. */}
                  <MiniSeg
                    className="lc-exc__seg"
                    options={[
                      { id: "closed", label: "Closed" },
                      { id: "hours", label: "Hours" },
                    ]}
                    value={win === null ? "closed" : "hours"}
                    onChange={(next) =>
                      onSetDate(
                        date,
                        next === "closed" ? "closed" : { openMin: camp.openMin, closeMin: camp.closeMin }
                      )
                    }
                    ariaLabel={friendlyDate(date) + " day type"}
                  />
                  <button
                    type="button"
                    className="icon-btn lc-exc__del"
                    title={"Remove " + friendlyDate(date)}
                    aria-label={"Remove " + friendlyDate(date)}
                    onClick={() => onSetDate(date, null)}
                  >
                    <CampIcon.Trash />
                  </button>
                  {win !== null && (
                    <div className="campedit__pills lc-exc__pills">
                      <Select
                        value={win.startMin}
                        options={overrideHourOptions}
                        onChange={(v) => onSetDate(date, { openMin: v, closeMin: win.endMin })}
                        ariaLabel={friendlyDate(date) + " open"}
                      />
                      <span className="campedit__dash" aria-hidden="true">–</span>
                      <Select
                        value={win.endMin}
                        options={overrideHourOptions}
                        onChange={(v) => onSetDate(date, { openMin: win.startMin, closeMin: v })}
                        ariaLabel={friendlyDate(date) + " close"}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="lc-excadd">
            <DatePopover value={newDate} onChange={setNewDate} ariaLabel="Exception date" />
            <div className="lc-excadd__btns">
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

        {/* guidance bands (per-camp) -------------------------------------- */}
        <Disclosure className="lc-rule" title="Guidance bands" summary={guideSummary}>
          {guides.length > 0 && (
            <ul className="manager__guides">
              {guides.map((band) => (
                <li key={band.id} className={"manager__guide" + (canEditGuides ? "" : " is-readonly")}>
                  <input
                    className="input manager__guide-label"
                    value={band.label}
                    maxLength={GUIDE_LABEL_MAX}
                    aria-label="Band label"
                    readOnly={!canEditGuides}
                    disabled={!canEditGuides}
                    onChange={(e) => onUpdateGuide(band.id, { label: e.target.value })}
                  />
                  <span className="manager__hoursfield manager__hoursfield--inline">
                    <Select
                      value={band.startMin}
                      options={overrideHourOptions}
                      onChange={(v) => onUpdateGuide(band.id, { startMin: v, endMin: band.endMin })}
                      ariaLabel={"Band " + (band.label || "untitled") + " start"}
                    />
                    <span className="manager__hoursdash" aria-hidden="true">–</span>
                    <Select
                      value={band.endMin}
                      options={overrideHourOptions}
                      onChange={(v) => onUpdateGuide(band.id, { startMin: band.startMin, endMin: v })}
                      ariaLabel={"Band " + (band.label || "untitled") + " end"}
                    />
                  </span>
                  <span className="manager__guide-days">
                    {WEEKDAYS.map((label, dow) => {
                      const on = band.weekdays.includes(dow);
                      return (
                        <button
                          type="button"
                          key={dow}
                          className={"manager__daytog" + (on ? " is-on" : "")}
                          aria-pressed={on}
                          aria-label={label + (on ? " on" : " off")}
                          disabled={!canEditGuides}
                          onClick={() => {
                            if (!canEditGuides) return;
                            const next = on
                              ? band.weekdays.filter((d) => d !== dow)
                              : [...band.weekdays, dow].sort((a, b) => a - b);
                            if (next.length) onUpdateGuide(band.id, { weekdays: next });
                          }}
                        >
                          {label[0]}
                        </button>
                      );
                    })}
                  </span>
                  {canEditGuides && (
                    <button
                      type="button"
                      className="icon-btn manager__rowbtn manager__rowbtn--danger"
                      title={"Delete band " + (band.label || "untitled")}
                      aria-label={"Delete band " + (band.label || "untitled")}
                      onClick={() => onDeleteGuide(band.id)}
                    >
                      <CampIcon.Trash />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEditGuides && (
            <button type="button" className="btn btn--ghost manager__addbtn" onClick={onAddGuide}>
              <CampIcon.Plus />
              Add band
            </button>
          )}
        </Disclosure>

        {/* snap grid ------------------------------------------------------ */}
        <Disclosure className="lc-rule" title="Snap grid" summary={snapSummary}>
          <div className="lc-snap">
            <span className="lc-hint">Placements and drags land on this grid.</span>
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
        </Disclosure>
      </div>
    </FocusSheet>
  );
}
