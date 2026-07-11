// The material slug: a stable id derived from a material's display label, shared
// by the catalog and the needs/stock logic. It lives in its own leaf module so
// `materialCatalog` and `materials` can both use it without importing each other
// (which would form a cycle).

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function materialTagId(label: string): string {
  return compact(label)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
