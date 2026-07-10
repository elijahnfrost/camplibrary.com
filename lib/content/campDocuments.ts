// Camp Library — downloadable camp documents.
//
// A synced list of prepared documents the office can download from the Print
// head: the built-in seed PDFs shipped in /public/documents, plus any files the
// user uploads. Both live in one ordered list so the whole set renames, reorders
// (implicitly, by list order), deletes, and downloads uniformly. Uploaded files
// carry their bytes inline as a base64 data URL; the seeds just reference the
// static path. No "use client" — this module stays isomorphic so the same
// validator runs on the client (hydrating localStorage) and the server
// (validating the API payload before Postgres).

export type CampDocument = {
  id: string;
  /** Editable display name shown in the menu and the manager. */
  name: string;
  /** The filename the browser saves as on download. */
  fileName: string;
  mime: string;
  /** Built-in seed: a static path under /public/documents (no inline bytes). */
  href?: string;
  /** Uploaded file: its bytes as a `data:` base64 URL. */
  data?: string;
};

// The whole `documents` doc rides the same synced JSON round-trip as every other
// user doc, capped server-side at 2 MB (see the docs API route). Uploaded bytes
// live inline as base64 (~1.37× the raw size), so we keep each file modest and
// guard the combined total below that ceiling with headroom for JSON overhead.
export const MAX_DOCUMENT_BYTES = 1_200_000; // ~1.2 MB per uploaded file (raw)
export const MAX_DOCUMENTS_TOTAL_BYTES = 1_900_000; // ~1.9 MB for the serialized doc

// The prepared PDFs shipped with the app. A fresh account sees these; once the
// list is edited (renamed, reordered, a file added or removed) the stored list
// wins — the same "default then stored overrides" contract locations/camps use.
export const DEFAULT_CAMP_DOCUMENTS: CampDocument[] = [
  {
    id: "builtin-activities-schedule",
    name: "Activities schedule",
    fileName: "SPARK Camp — Activities schedule.pdf",
    mime: "application/pdf",
    href: "/documents/spark-camp-activities-schedule.pdf",
  },
  {
    id: "builtin-grades-4-6-room-schedule",
    name: "Grades 4–6 room schedule",
    fileName: "SPARK Camp — Grades 4-6 room schedule.pdf",
    mime: "application/pdf",
    href: "/documents/spark-camp-grades-4-6-room-schedule.pdf",
  },
  {
    id: "builtin-preschool-room-schedule",
    name: "Preschool room schedule",
    fileName: "SPARK Camp — Preschool room schedule.pdf",
    mime: "application/pdf",
    href: "/documents/spark-camp-preschool-room-schedule.pdf",
  },
  {
    id: "builtin-staff-planner-template",
    name: "Staff planner template",
    fileName: "SPARK Camp — Staff planner template.pdf",
    mime: "application/pdf",
    href: "/documents/spark-camp-staff-planner-template.pdf",
  },
  {
    id: "builtin-rules-poster",
    name: "Rules poster",
    fileName: "SPARK Camp — Rules poster.pdf",
    mime: "application/pdf",
    href: "/documents/spark-camp-rules-poster.pdf",
  },
];

/** The URL to open/download for a document — the inline upload bytes when
 *  present, otherwise the built-in static path. */
export function campDocumentUrl(doc: CampDocument): string {
  return doc.data ?? doc.href ?? "";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Validate an arbitrary stored/posted value into a clean CampDocument[] — drops
// malformed rows, keeps only ids that carry either a static href or a `data:`
// URL, dedupes by id, and fills sensible fallbacks. Runs client + server.
export function normalizeCampDocuments(value: unknown, fallback: CampDocument[]): CampDocument[] {
  if (!Array.isArray(value)) return fallback;
  const out: CampDocument[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (!isNonEmptyString(item.id) || seen.has(item.id)) continue;
    const href = isNonEmptyString(item.href) ? item.href : undefined;
    const data = isNonEmptyString(item.data) && item.data.startsWith("data:") ? item.data : undefined;
    if (!href && !data) continue; // a document with no source is not renderable
    const name = isNonEmptyString(item.name) ? item.name : "Untitled document";
    const fileName = isNonEmptyString(item.fileName) ? item.fileName : name;
    const mime = isNonEmptyString(item.mime) ? item.mime : "application/octet-stream";
    seen.add(item.id);
    out.push(data ? { id: item.id, name, fileName, mime, data } : { id: item.id, name, fileName, mime, href });
  }
  return out;
}

let documentIdCounter = 0;

export function createDocumentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "doc-" + crypto.randomUUID();
  }
  documentIdCounter += 1;
  return "doc-" + Date.now().toString(36) + "-" + documentIdCounter.toString(36);
}
