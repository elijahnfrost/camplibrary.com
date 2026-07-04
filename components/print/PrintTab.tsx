"use client";

// The Print tab: the schedule controls live in the app's PRIMARY sidebar (a
// portal into the same rail slot the Library filters and Calendar settings use —
// no second sidebar), and the main pane is a header + a live letter-page preview.
// Export PDF / Print sit at the top-right of the header, the way the Calendar
// keeps its actions. Format preferences persist (a local view preference); the
// date range and camp are session state.
//
// Two print actions share one pipeline: "Export PDF" (the headline feature) sets
// a sensible document.title and fires the dialog so the browser's "Save as PDF"
// downloads a crisp, vector, brand-font document; "Print" fires the same dialog
// for paper. Both print the hidden `.print-root` artifact — the same intent
// pattern the activity-book print uses, so chrome-hiding is shared, not re-built.
//
// The hidden artifact renders a COMMITTED snapshot (`printOptions`) that syncs to
// the live `options` only on `beforeprint` — so toggling a control re-renders
// just the (light) preview, never the (heavier) print sheet, and Cmd+P prints
// exactly what's on screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { addDays, fromDateKey, todayKey } from "@/lib/calendar/dates";
import type { Activity } from "@/lib/types";
import { useLocalStorage } from "@/lib/store";
import { DEFAULT_PRINT_FORMAT, printFormatStorage, type PrintFormat, type PrintOptions } from "@/lib/print/options";
import { buildScheduleDays, selectEvents } from "@/lib/print/schedule";
import { exportFilename } from "@/lib/print/filename";
import { CampIcon } from "../icons";
import { Modal } from "../Modal";
import { PrintControls } from "./PrintControls";
import { PagedPreview } from "./PagedPreview";
import { SchedulePrintDocument, type SchedulePrintData } from "./SchedulePrintDocument";

type Patch = Partial<PrintOptions>;
const FORMAT_KEYS: (keyof PrintFormat)[] = [
  "color",
  "style",
  "layout",
  "scheduleDetail",
  "appendRunSheets",
  "includeAllDay",
  "includeEmptyDays",
  "pageBreakPerDay",
  "materialsRollup",
  "shoppingListOnly",
  "showThemes",
  "showCover",
  "fontScale",
  "density",
  "sectionOrder",
];

// Letter-page width in CSS px (8.5in × 96dpi) — drives zoom-to-fit so the page
// always fits the preview pane instead of overflowing on a laptop / phone.
const PAGE_W = 8.5 * 96;
const PANE_PAD = 32; // matches the --s-6 inline padding on .print-tab__preview, both sides

export function PrintTab({
  data,
  activeCampId,
  railSlot,
  printHost,
  announce,
}: {
  data: SchedulePrintData;
  activeCampId: string | null;
  // The primary-sidebar slot the schedule controls portal into (the same rail
  // the Library filters / Calendar settings use). Null on mobile, where the
  // controls open in a sheet instead — see `optionsOpen`.
  railSlot: HTMLElement | null;
  // A DOM node (a direct child of `.app`, sibling of <main>) the hidden print
  // sheet portals into, so it sits where the print CSS expects it.
  printHost: HTMLElement | null;
  announce: (message: string) => void;
}) {
  const [format, setFormat] = useLocalStorage<PrintFormat>("printFormat", DEFAULT_PRINT_FORMAT, printFormatStorage);
  const [start, setStart] = useState(() => todayKey());
  const [end, setEnd] = useState(() => addDays(todayKey(), 6));
  const [campId, setCampId] = useState<string | null>(activeCampId);
  const [title, setTitle] = useState("");
  // Individually-picked run sheets (additive to "Full run sheets"). Ephemeral.
  const [runSheetIds, setRunSheetIds] = useState<string[]>([]);
  // Per-print content trims: days / individual events to leave OUT. Ephemeral —
  // a persisted exclusion would silently drop content from a later range.
  const [excludedDays, setExcludedDays] = useState<string[]>([]);
  const [excludedEventIds, setExcludedEventIds] = useState<string[]>([]);
  // Mobile only: the controls open in a sheet (the sidebar rail is desktop-only,
  // mirroring the Calendar's view-settings sheet).
  const [optionsOpen, setOptionsOpen] = useState(false);

  const options: PrintOptions = useMemo(
    () => ({ ...format, start, end, campId, title, runSheetIds, excludedDays, excludedEventIds }),
    [format, start, end, campId, title, runSheetIds, excludedDays, excludedEventIds]
  );

  const onChange = useCallback(
    (patch: Patch) => {
      if (patch.start !== undefined) setStart(patch.start);
      if (patch.end !== undefined) setEnd(patch.end);
      if (patch.campId !== undefined) setCampId(patch.campId);
      if (patch.title !== undefined) setTitle(patch.title);
      if (patch.runSheetIds !== undefined) setRunSheetIds(patch.runSheetIds);
      if (patch.excludedDays !== undefined) setExcludedDays(patch.excludedDays);
      if (patch.excludedEventIds !== undefined) setExcludedEventIds(patch.excludedEventIds);
      const formatPatch: Partial<PrintFormat> = {};
      for (const key of FORMAT_KEYS) {
        if (patch[key] !== undefined) (formatPatch as Record<string, unknown>)[key] = patch[key];
      }
      if (Object.keys(formatPatch).length) setFormat((prev) => ({ ...prev, ...formatPatch }));
    },
    [setFormat]
  );

  // Committed snapshot for the hidden print artifact. A ref keeps the listener
  // stable while always reading the latest options.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [printOptions, setPrintOptions] = useState(options);
  useEffect(() => {
    const commit = () => flushSync(() => setPrintOptions(optionsRef.current));
    window.addEventListener("beforeprint", commit);
    return () => window.removeEventListener("beforeprint", commit);
  }, []);

  const campIds = useMemo(() => new Set(data.camps.map((c) => c.id)), [data.camps]);
  const eventCount = useMemo(
    () =>
      selectEvents(data.events, {
        start,
        end,
        campId,
        campIds,
        includeAllDay: options.includeAllDay,
      }).length,
    [data.events, start, end, campId, campIds, options.includeAllDay]
  );
  const empty = eventCount === 0;

  // The distinct activities scheduled in the current range/camp — the pool the
  // individual run-sheet picker searches over.
  const scheduledActivities = useMemo(() => {
    const events = selectEvents(data.events, {
      start,
      end,
      campId,
      campIds,
      includeAllDay: options.includeAllDay,
    });
    const seen = new Set<string>();
    const out: Activity[] = [];
    for (const event of events) {
      const activity = event.activityId ? data.byId[event.activityId] : undefined;
      if (activity && !seen.has(activity.id)) {
        seen.add(activity.id);
        out.push(activity);
      }
    }
    return out;
  }, [data.events, data.byId, start, end, campId, campIds, options.includeAllDay]);

  // The full day-by-day list (events sorted), BEFORE the per-print exclusion sets
  // — so the content picker can show every day/event as a toggle. Mirrors the
  // selection the document builds, minus exclusions.
  const scheduleDays = useMemo(() => {
    const selected = selectEvents(data.events, {
      start,
      end,
      campId,
      campIds,
      includeAllDay: options.includeAllDay,
    });
    return buildScheduleDays(selected, start, end, options.includeEmptyDays);
  }, [data.events, start, end, campId, campIds, options.includeAllDay, options.includeEmptyDays]);

  const campName = campId ? data.camps.find((c) => c.id === campId)?.name ?? null : null;

  const handlePrint = useCallback(() => {
    announce("Opening the print dialog");
    window.print();
  }, [announce]);

  // Export PDF: name the document so the browser's "Save as PDF" pre-fills a
  // sensible filename, fire the dialog, then restore the page title. afterprint
  // is unreliable on some browsers, so a short timeout backstops the restore.
  const handleExportPdf = useCallback(() => {
    const prevTitle = document.title;
    document.title = exportFilename(optionsRef.current, campName);
    announce("Opening the print dialog — choose “Save as PDF” to download");
    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      document.title = prevTitle;
    };
    window.addEventListener("afterprint", restore, { once: true });
    window.setTimeout(restore, 1500);
    window.print();
  }, [announce, campName]);

  // Zoom-to-fit: scale the page so it fills (never overflows) the preview pane.
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const pane = previewRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const avail = pane.clientWidth - PANE_PAD;
      setZoom(Math.min(1, Math.max(0.25, avail / PAGE_W)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => ro.disconnect();
  }, []);

  const dayCount = Math.round(Math.abs(fromDateKey(end).getTime() - fromDateKey(start).getTime()) / 86_400_000) + 1;
  // The scope line doubles as the inline reason: when the range is empty it says
  // so plainly (rather than the print buttons silently disabling with only a
  // hover tooltip — invisible on touch). The buttons stay clickable.
  const scope = empty
    ? "Nothing scheduled in this range" + (campName ? " · " + campName : "")
    : `${eventCount} ${eventCount === 1 ? "activity" : "activities"} · ${dayCount} ${dayCount === 1 ? "day" : "days"}` +
      (campName ? " · " + campName : "");

  const controls = (
    <PrintControls
      options={options}
      onChange={onChange}
      camps={data.camps}
      scheduledActivities={scheduledActivities}
      scheduleDays={scheduleDays}
      byId={data.byId}
      announce={announce}
    />
  );
  return (
    <div className="print-tab">
      <header className="printhead">
        <div className="printhead__heading">
          <h1 className="printhead__title">Print</h1>
          <p className="printhead__scope">{scope}</p>
        </div>
        <div className="printhead__actions">
          {/* Mobile-only entry to the schedule controls (desktop surfaces them in
              the sidebar rail). Hidden from the sidebar breakpoint up. The
              "Break sheet" download moved OUT of the head into the controls rail
              (a quiet row at the bottom) so the head keeps one primary action. */}
          <button
            type="button"
            className="printhead__options"
            onClick={() => setOptionsOpen(true)}
            aria-label="Print options"
            title="Print options"
          >
            <CampIcon.More />
          </button>
          {/* Never silently disabled: the range may simply be empty, or the
              schedule may still be loading. The header scope shows the reason and
              the buttons stay clickable (an empty range just prints the cover). */}
          <button
            type="button"
            className="btn btn--ghost printhead__btn"
            onClick={handlePrint}
            aria-disabled={empty}
            title={empty ? "Nothing scheduled in this range" : "Open the print dialog"}
          >
            <CampIcon.Print />
            <span>Print</span>
          </button>
          <button
            type="button"
            className="btn btn--primary printhead__btn"
            onClick={handleExportPdf}
            aria-disabled={empty}
            title={empty ? "Nothing scheduled in this range" : "Save this schedule as a PDF"}
          >
            <CampIcon.Export />
            <span>Export PDF</span>
          </button>
        </div>
      </header>

      <div className="print-tab__preview" aria-label="Print preview" ref={previewRef}>
        <PagedPreview options={options} data={data} zoom={zoom} />
      </div>

      {/* Desktop: the schedule controls render into the primary sidebar's print
          rail (the same slot the Library filters / Calendar settings use). */}
      {railSlot && createPortal(controls, railSlot)}

      {/* Mobile: the same controls in a sheet, opened from the header. The
          .filtersheet wrapper gives the shared touch-tuned ledger metrics. */}
      {optionsOpen && (
        <Modal label="Print options" onClose={() => setOptionsOpen(false)} overlayProps={{ className: "overlay--card" }}>
          <div className="overlay__bar">
            <h2 className="filtersheet__title">Print options</h2>
          </div>
          <div className="overlay__body filtersheet">{controls}</div>
          <button
            type="button"
            className="btn btn--primary filtersheet__done"
            onClick={() => setOptionsOpen(false)}
          >
            Done
          </button>
        </Modal>
      )}

      {/* The actual print artifact: hidden on screen, the only thing that prints
          (and what Export-PDF saves). Renders the committed snapshot. */}
      {printHost && createPortal(<SchedulePrintDocument options={printOptions} data={data} wrap="root" />, printHost)}
    </div>
  );
}
