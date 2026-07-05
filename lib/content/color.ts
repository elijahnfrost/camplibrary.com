// Validated hex colors for the per-item color feature: a library activity's
// default color and a calendar event's per-placement override. Kept tiny and
// dependency-free so the isomorphic validators (client hydrate + server payload
// validation) and the color resolvers in lib/data can all share one source of
// truth without pulling the seed catalog into the isomorphic type modules.

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value);
}

// The lowercased hex string when valid, else undefined — the form the
// normalizers' allowlists and the color resolvers expect. Lowercasing keeps the
// stored value stable regardless of how the picker emits it.
export function normalizeHexColor(value: unknown): string | undefined {
  return isHexColor(value) ? value.toLowerCase() : undefined;
}
