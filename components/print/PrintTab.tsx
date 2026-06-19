"use client";

// The Print tab: a console of options on the left, a live letter-page preview on
// the right. Format preferences persist (local view preference); the date range
// and camp are session state.
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
import { useLocalStorage } from "@/lib/store";
import { DEFAULT_PRINT_FORMAT, printFormatStorage, type PrintFormat, type PrintOptions } from "@/lib/print/options";
import { selectEvents } from "@/lib/print/schedule";
import { exportFilename } from "@/lib/print/filename";
import { CampIcon } from "../icons";
import { PrintControls } from "./PrintControls";
import { PagedPreview } from "./PagedPreview";
import { SchedulePrintDocument, type SchedulePrintData } from "./SchedulePrintDocument";

type Patch = Partial<PrintOptions>;
const FORMAT_KEYS: (keyof PrintFormat)[] = [
  "color",
  "style",
  "scheduleDetail",
  "appendRunSheets",
  "includeAllDay",
  "includeEmptyDays",
  "pageBreakPerDay",
  "materialsRollup",
  "showThemes",
];

// Letter-page width in CSS px (8.5in × 96dpi) — drives zoom-to-fit so the page
// always fits the preview pane instead of overflowing on a laptop / phone.
const PAGE_W = 8.5 * 96;
const PANE_PAD = 32; // matches the --s-6 inline padding on .print-preview, both sides

export function PrintTab({
  data,
  activeCampId,
  printHost,
  announce,
}: {
  data: SchedulePrintData;
  activeCampId: string | null;
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

  const options: PrintOptions = useMemo(
    () => ({ ...format, start, end, campId, title }),
    [format, start, end, campId, title]
  );

  const onChange = useCallback(
    (patch: Patch) => {
      if (patch.start !== undefined) setStart(patch.start);
      if (patch.end !== undefined) setEnd(patch.end);
      if (patch.campId !== undefined) setCampId(patch.campId);
      if (patch.title !== undefined) setTitle(patch.title);
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

  return (
    <div className="print-tab">
      <div className="print-tab__console">
        <header className="print-tab__head">
          <div className="print-tab__heading">
            <h1 className="print-tab__title">Print</h1>
            <p className="print-tab__sub">
              {eventCount} {eventCount === 1 ? "activity" : "activities"} across {dayCount}{" "}
              {dayCount === 1 ? "day" : "days"}
            </p>
          </div>
          <div className="print-tab__actions">
            <button
              type="button"
              className="btn btn--primary print-tab__action"
              onClick={handleExportPdf}
              disabled={empty}
              title={empty ? "Nothing scheduled in this range" : "Save this schedule as a PDF"}
            >
              <CampIcon.Export />
              Export PDF
            </button>
            <button
              type="button"
              className="btn btn--ghost print-tab__action"
              onClick={handlePrint}
              disabled={empty}
              title={empty ? "Nothing scheduled in this range" : "Open the print dialog"}
            >
              <CampIcon.Print />
              Print
            </button>
          </div>
        </header>
        <PrintControls options={options} onChange={onChange} camps={data.camps} />
      </div>

      <div className="print-tab__preview" aria-label="Print preview" ref={previewRef}>
        <PagedPreview options={options} data={data} zoom={zoom} />
      </div>

      {/* The actual print artifact: hidden on screen, the only thing that prints
          (and what Export-PDF saves). Renders the committed snapshot. */}
      {printHost && createPortal(<SchedulePrintDocument options={printOptions} data={data} wrap="root" />, printHost)}
    </div>
  );
}
