import type { ReactNode } from "react";
import type { EventContentArg } from "@fullcalendar/core";
import type { AlternatesGlyph } from "@/lib/calendar/adapter";
import { CampIcon } from "../ui/icons";
import { BackupUmbrellaGlyph, EditedTickGlyph, PinInPlaceIcon } from "./CalendarChrome";

// The card variant is the same glyph — a distinct name at the call site keeps the
// two uses legible (a menu item's icon vs a card affordance).
const CardPinGlyph = PinInPlaceIcon;

// FullCalendar's eventContent generator: a PURE function of the segment's
// extendedProps + module-level glyphs (that's why it never needed a dep array).
// Renders the month chip and the timed card, plus the theme dot, badges, and the
// paint() ref that writes the live tint/spine on each data change. Extracted from
// CalendarShell verbatim.
export function renderEventContent(arg: EventContentArg): ReactNode {
    // Background events (guidance bands + closed-day shading) render through THIS
    // same generator in FC v6 (EventContainer's customGenerator runs for bg segs).
    // A band shows a small, quiet inline label riding on the wash; the closed
    // shade is a plain wash with no content. Both are non-interactive; a click
    // passes through to dateClick (FC excepts .fc-bg-event from its block list).
    const bgKind = arg.event.extendedProps.bgKind;
    if (bgKind === "band") {
      return arg.event.title ? (
        <div className="cal-band__inner" title={arg.event.title}>
          <span className="cal-band__label">{arg.event.title}</span>
        </div>
      ) : null;
    }
    if (bgKind === "closed") return null;

    // A secondary theme dot, drawn only when the event's activity carries a
    // theme. The category color stays the spine (--cal-tint); theme is an
    // accent dot, never a replacement, and is labelled so it never reads as
    // color-alone. Skipped on dense month chips, which already carry a tick.
    const themeLabel = arg.event.extendedProps.themeLabel;
    const dot =
      typeof themeLabel === "string" && themeLabel ? (
        <span className="cal-card__theme" title={"Theme: " + themeLabel} aria-label={"Theme: " + themeLabel} />
      ) : null;
    // A small loop glyph marks a recurring event — the traditional calendar
    // affordance. Only rendered when the event repeats, so non-repeating cards
    // (and the visual baselines) are untouched.
    const repeats = arg.event.extendedProps.repeats === true;
    // A pinned event (held in place when a day-shift moves the rest of the day)
    // carries a small pin glyph beside the recurrence loop. Threaded through the
    // adapter's extendedProps like `repeats`, so it repaints on every data change.
    const pinned = arg.event.extendedProps.pinned === true;
    // A "this"-customized series member carries a small "edited" tick beside the
    // repeat loop — the visible mark of a per-occurrence exception (rule 5).
    const customized = arg.event.extendedProps.customized === true;
    // A split-day leg ("1/2 · 2/2") — one leg of a same-day linked pair (rule 8).
    const legLabelRaw = arg.event.extendedProps.legLabel;
    const legLabel = typeof legLabelRaw === "string" && legLabelRaw ? legLabelRaw : null;
    const tint = arg.event.extendedProps.tint;
    const themeTint = arg.event.extendedProps.themeTint;
    const isCustom = arg.event.extendedProps.kind === "custom";
    // camps-2/J2: a small neutral "shared" badge on any event that shows under
    // EVERY camp (no campId of its own) while a specific camp is active — so
    // switching camps reads as "most of the calendar predates camps" rather
    // than "the switcher does nothing." Quiet by design (a plain glyph, no
    // color), distinct from the backup badge which carries real signal.
    const shared = arg.event.extendedProps.shared === true;
    const sharedBadge = shared ? (
      <span
        className="cal-card__shared"
        title="Shown under every camp (not assigned to one)"
        aria-label="Shared across every camp"
      >
        <CampIcon.Users />
      </span>
    ) : null;
    // Where the block happens (gym, field…), shown under the time on taller
    // cards. The card is a size container, so a short block simply clips it.
    const locationText = arg.event.extendedProps.location;
    const location = typeof locationText === "string" && locationText ? locationText : null;
    // A backup-plan badge: a small corner glyph when this placement resolves to
    // any alternate (event override ?? activity default) — an umbrella when any is
    // a rain plan, else a generic swap; the count rides when more than one.
    const altGlyphRaw = arg.event.extendedProps.alternatesGlyph as AlternatesGlyph | undefined;
    const altBadge = altGlyphRaw ? (
      <span
        className="cal-card__backup"
        title={
          altGlyphRaw.count +
          " backup plan" +
          (altGlyphRaw.count === 1 ? "" : "s") +
          (altGlyphRaw.rain ? " (rain)" : "")
        }
        aria-label={altGlyphRaw.count + " backup plan" + (altGlyphRaw.count === 1 ? "" : "s")}
      >
        {altGlyphRaw.rain ? <BackupUmbrellaGlyph /> : <CampIcon.Repeat />}
        {altGlyphRaw.count > 1 && <span className="cal-card__backup-n">{altGlyphRaw.count}</span>}
      </span>
    ) : null;

    // Repaint + distinction, written from HERE rather than eventDidMount: this
    // content renderer re-runs on every data change (a recolor, or an activity→
    // custom heal), whereas eventDidMount fires once — so the color and the
    // activity/custom spine update immediately instead of waiting for a refresh.
    const paint = (node: HTMLElement | null) => {
      const el = node?.closest(".fc-event") as HTMLElement | null;
      if (!el) return;
      if (typeof tint === "string") el.style.setProperty("--cal-tint", tint);
      if (typeof themeTint === "string") el.style.setProperty("--theme-tint", themeTint);
      // Custom (lunch/assembly/free-play) events wear a hatched spine; activities
      // keep the solid category spine. (CSS in calendar.css §event distinction.)
      el.classList.toggle("cal-event--custom", isCustom);
    };

    if (arg.view.type === "dayGridMonth") {
      // One left spine carries the category colour (the .fc-daygrid-event
      // border-left); no inner tick on top of it.
      return (
        <div className="cal-chip" ref={paint}>
          {!arg.event.allDay && <span className="cal-chip__time">{arg.timeText}</span>}
          <span className="cal-chip__title">{arg.event.title}</span>
          {legLabel && <span className="cal-chip__leg">{legLabel}</span>}
          {altBadge}
          {sharedBadge}
          {pinned && <CardPinGlyph className="cal-chip__pin" />}
          {repeats && <CampIcon.Repeat className="cal-chip__repeat" />}
          {customized && <EditedTickGlyph className="cal-chip__edited" />}
        </div>
      );
    }
    // One structure for every timed block. The card is a size container (see
    // calendar.css), so it recalibrates its own layout from its LIVE rendered
    // height — collapsing a stacked title + time onto one Google-style line the
    // instant a resize makes the block too short, and back — instead of
    // branching here on a stored duration that only updated when the drag dropped.
    // The theme dot rides in .cal-card__line so it stays beside the title in
    // both the stacked and the collapsed layouts.
    return (
      <div className="cal-card" ref={paint}>
        <span className="cal-card__line">
          {dot}
          <span className="cal-card__title">{arg.event.title}</span>
          {legLabel && <span className="cal-card__leg">{legLabel}</span>}
          {altBadge}
          {sharedBadge}
          {pinned && <CardPinGlyph className="cal-card__pin" />}
          {repeats && <CampIcon.Repeat className="cal-card__repeat" />}
          {customized && <EditedTickGlyph className="cal-card__edited" />}
        </span>
        {!arg.event.allDay && <span className="cal-card__time">{arg.timeText}</span>}
        {location && (
          <span className="cal-card__loc">
            <CampIcon.Pin className="cal-card__locpin" />
            <span className="cal-card__loctext">{location}</span>
          </span>
        )}
      </div>
    );
    // Stable: the callback reads only per-event extendedProps and module-level
    // glyphs, so it never needs to re-arm on a state change.
}
