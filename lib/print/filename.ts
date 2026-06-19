// Camp Library — derive a download-friendly name for the exported PDF.
//
// Pure + unit-tested. The Print tab's "Export PDF" action sets document.title to
// this value before window.print(), so the browser's "Save as PDF" destination
// defaults to a sensible filename (Chrome/Edge/Safari seed the save name from the
// document title). DateKeys are already YYYY-MM-DD (filesystem-safe), so only the
// free-text title / camp name need slugging.

import type { PrintOptions } from "./options";

// A conservative, cross-platform-safe slug: ASCII words joined by single dashes,
// no punctuation, no leading/trailing/double dashes.
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritic marks (é → e)
    .replace(/[^A-Za-z0-9]+/g, "-") // any run of separators/punctuation → one dash
    .replace(/^-+|-+$/g, ""); // trim stray edge dashes
}

// e.g. "Camp-Library_Ocean-Week_2026-06-16_2026-06-18" (no extension — the
// browser appends ".pdf"). A custom cover title wins over the camp name; a
// single-day range omits the redundant end.
export function exportFilename(options: PrintOptions, campName: string | null): string {
  const label = slugify(options.title) || slugify(campName ?? "");
  const parts = ["Camp-Library", label, options.start];
  if (options.end !== options.start) parts.push(options.end);
  return parts.filter(Boolean).join("_");
}
