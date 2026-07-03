"use client";

// Bridges the React-rendered schedule document into Paged.js, which fragments it
// into real letter-page boxes — so the preview is paginated exactly like the
// printed sheet, not one long page.
//
// Ownership is split to keep React and Paged.js out of each other's way: React
// owns the hidden SOURCE (`.print-doc`); Paged.js owns the rendered `.pagedjs_*`
// page boxes in the target (which React never reconciles). We always hand Paged.js
// a *clone* of the source — its parser mutates nodes (adds data-ref attrs), so it
// must never touch React's tree.
//
// Resilience: until the first pagination lands (and if it ever fails) we show a
// continuous render of the same source, so the preview is never blank. Printing
// is wholly independent of this — it goes through the separate `.print-root`
// artifact + window.print(), so a pagination failure can't block a print/export.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PrintOptions } from "@/lib/print/options";
import { LoadingVeil } from "../primitives";
import { SchedulePrintDocument, type SchedulePrintData } from "./SchedulePrintDocument";

// Page geometry + the same break rules the printed sheet uses, handed to Paged.js
// so pages match print. The visual pd-* look comes from globals.css (it applies
// to the rendered page boxes — they live in the same document).
const PAGED_BREAKS = `
.pd-day, .pd-event, .pd-step, .pd-child, .pd-rollup, .pd-facts--grid, .pd-playbook .playbook-frame, .pd-runsheet__head { break-inside: avoid; }
.print-doc--paged .pd-day { break-before: page; }
.print-doc--paged .pd-day:first-of-type { break-before: auto; }
.pd-tlday { break-inside: avoid; }
.print-doc--paged .pd-tlday { break-before: page; }
.print-doc--paged .pd-tlday:first-of-type { break-before: auto; }
.pd-runsheets { break-before: page; }
.pd-runsheet + .pd-runsheet { break-before: page; }
.pd-runsheet:has(.pd-playbook) { break-inside: auto; }
`;

// The "Page N of M" footer — a Paged.js @page margin box (browsers don't honor
// margin boxes for window.print(), so the real-print footer is left to the print
// dialog's own headers/footers). This is a permanent feature of the paginated
// WYSIWYG preview itself (there's no user-facing "page numbers" setting — the
// actual printout never shows one, since window.print()'s own header/footer is
// the browser's call), always emitted so the preview always shows how many
// pages the current options will produce.
const PAGED_FOOTER = `
@page { @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: var(--hand-sc); font-size: 8pt; color: #8a7f6a; } }
`;

function pagedCss(): string {
  return `@page { size: 8.5in 11in; margin: 0.45in; }\n${PAGED_BREAKS}${PAGED_FOOTER}`;
}

type Status = "loading" | "paged" | "fallback";

const RE_PAGINATE_MS = 300;

export function PagedPreview({
  options,
  data,
  zoom,
}: {
  options: PrintOptions;
  data: SchedulePrintData;
  zoom: number;
}) {
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef(0);
  // First mount paginates immediately (no 300ms stall on opening Print); only
  // later edits debounce, so rapid option changes don't thrash Paged.js.
  const firstRunRef = useRef(true);
  const [status, setStatus] = useState<Status>("loading");
  const [pageCount, setPageCount] = useState(0);

  // Re-paginate only when the document content actually changes.
  const sig = useMemo(
    () => JSON.stringify(options) + "|" + JSON.stringify(Object.keys(data.events).sort()),
    [options, data]
  );

  useEffect(() => {
    const source = sourceRef.current;
    const target = targetRef.current;
    if (!source || !target) return;

    const runId = ++runIdRef.current;
    let cancelled = false;
    const delay = firstRunRef.current ? 0 : RE_PAGINATE_MS;
    firstRunRef.current = false;

    const timer = window.setTimeout(async () => {
      const doc = source.firstElementChild;
      if (!doc) return;
      try {
        // Fonts MUST be loaded before paginating: if Caveat/Patrick Hand land
        // after layout, the text reflows, Paged.js re-checks underflow against
        // stale tokens, throws, and leaves pages truncated. Awaiting fonts.ready
        // makes pagination measure final metrics.
        if (document.fonts?.ready) await document.fonts.ready;
        // Aliased (next.config turbopack.resolveAlias) to pagedjs's prebuilt ESM
        // bundle (deps inlined + transpiled) — the raw `src` entry trips modern
        // bundlers ("contains.call is not a function").
        const { Previewer } = await import("pagedjs");
        if (cancelled || runId !== runIdRef.current) return;

        // Render into a fresh holder appended below the live pages, then drop the
        // stale holder once the new one is ready — so re-pagination never blanks.
        const holder = document.createElement("div");
        holder.className = "paged-preview__holder";
        target.appendChild(holder);

        const previewer = new Previewer();
        // Clone: Paged.js's parser mutates the nodes it's handed.
        const flow = await previewer.preview(
          doc.cloneNode(true),
          [{ "paged-doc": pagedCss() }],
          holder
        );

        if (cancelled || runId !== runIdRef.current) {
          holder.remove();
          return;
        }
        while (target.firstChild && target.firstChild !== holder) {
          target.removeChild(target.firstChild);
        }
        // Paged.js injects global `@page { margin: 0 }` rules to drive its own
        // page boxes. Those would hijack the REAL print (the .print-root artifact
        // prints via globals.css `@media print`, margin 0.45in) and push content
        // edge-to-edge. The paged view is screen-only, so scope its styles to
        // screen — leaving the actual print/export margins intact.
        document
          .querySelectorAll("style[data-pagedjs-inserted-styles]")
          .forEach((node) => node.setAttribute("media", "screen"));
        setPageCount(flow?.total ?? 0);
        setStatus("paged");
      } catch (err) {
        if (cancelled || runId !== runIdRef.current) return;
        // eslint-disable-next-line no-console
        console.warn("[print] Paged.js pagination failed — showing continuous preview.", err);
        setStatus("fallback");
      }
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sig]);

  // Defensive print guard: if a print/export fires WHILE pagination is mid-flight
  // (before the post-pagination scope runs), Paged.js's globally-injected
  // `@page { margin: 0 }` would still be unscoped and hijack the real print's
  // 0.45in margins. Re-scope any inserted Paged.js styles to screen on every
  // beforeprint, so the .print-root artifact always prints with correct margins.
  useEffect(() => {
    const onBeforePrint = () => {
      document
        .querySelectorAll("style[data-pagedjs-inserted-styles]")
        .forEach((node) => node.setAttribute("media", "screen"));
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);

  // Tidy up Paged.js's globally-inserted <style> tags when the tab closes, so
  // they don't accumulate across visits.
  useEffect(() => {
    return () => {
      document
        .querySelectorAll("style[data-pagedjs-inserted-styles]")
        .forEach((node) => node.remove());
    };
  }, []);

  // Paged.js 0.4.3 has a benign bug: its per-page ResizeObserver re-checks
  // underflow after layout settles and dereferences a token element that's
  // already gone, throwing from checkUnderflowAfterResize/findEndToken. The pages
  // still render correctly — but the uncaught throw spams the console and trips
  // Next's dev error overlay. Swallow ONLY that exact signature, scoped to while
  // this tab is mounted.
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const stack = event.error?.stack ?? "";
      const text = stack + " " + (event.message ?? "");
      if (
        /paged/i.test(text) &&
        /checkUnderflowAfterResize|findEndToken|findElement|nextSignificantNode/.test(text)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    // Capture phase so we run before Next's dev-overlay error listener and can
    // stop it from counting this known-benign throw.
    window.addEventListener("error", onError, true);
    return () => window.removeEventListener("error", onError, true);
  }, []);

  // Paged.js rebuilds the doc's root wrapper per page but DROPS its classes, so
  // the `.print-doc`/`print-doc--*` styling can't be relied on inside the pages.
  // Carry the doc class + variant modifiers on the stable target container so the
  // base typography and the color/style rules cascade into every page.
  const pagesClass =
    "paged-preview__pages print-doc print-doc--" + options.color + " print-doc--" + options.style;

  return (
    <div className="paged-preview" data-status={status} style={{ "--pv-zoom": zoom } as CSSProperties}>
      {status === "loading" && (
        <LoadingVeil
          className="paged-preview__veil"
          label="Setting the pages…"
          sub="Laying out your schedule"
        />
      )}
      <div
        className={pagesClass}
        ref={targetRef}
        aria-label={pageCount ? pageCount + (pageCount === 1 ? " page" : " pages") : "Paginated preview"}
      />
      <div className="paged-preview__source" ref={sourceRef} aria-hidden={status === "paged"}>
        <SchedulePrintDocument options={options} data={data} wrap="preview" />
      </div>
    </div>
  );
}
