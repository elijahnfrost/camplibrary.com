// Camp Library — themes.
//
// A theme ("Ocean Week", "Jungle Week") is a user-definable tagging axis that
// runs parallel to the FIVE FIXED category Types. Where CATEGORIES is a
// hardcoded const, the theme vocabulary is user-editable and synced as its own
// document; a per-activity assignment map (mirroring `ratings`) records which
// theme each activity carries, so themes ride existing zero-DDL round-trips
// and never touch the Activity/CalendarEvent allowlist normalizers.
//
// Each theme picks a swatch from a fixed earthy palette (no free color), so
// theme color stays coherent with categoryTint and adds no hex to CSS. This
// module is isomorphic — its validators run on the client (hydrate) AND on the
// server (validating API payloads), so it carries no "use client" directive.

export interface Theme {
  id: string;
  label: string;
  tint: string;
}

// The fixed palette themes draw from, assigned round-robin on create. Distinct
// enough to tell weeks apart at a glance, and harmonious with the category
// tints in lib/data.ts.
export const THEME_PALETTE = [
  "#4d7a86", // river
  "#5f8a52", // fern
  "#c77d3a", // marigold
  "#b3603f", // clay
  "#6f6aa0", // dusk violet
  "#4f8a7b", // lagoon
  "#a8743f", // bark
  "#9a5b6e", // berry
] as const;

const PALETTE_SET = new Set<string>(THEME_PALETTE);

export const MAX_THEME_LABEL = 40;

// The swatch for the Nth theme — wraps the palette so creation never runs out.
export function nextPaletteTint(count: number): string {
  const n = THEME_PALETTE.length;
  return THEME_PALETTE[((count % n) + n) % n];
}

function clampTint(value: unknown, fallback: string): string {
  return typeof value === "string" && PALETTE_SET.has(value) ? value : fallback;
}

function normalizeTheme(value: unknown, index: number): Theme | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  const label = typeof v.label === "string" ? v.label.trim().slice(0, MAX_THEME_LABEL) : "";
  if (!id || !label) return null;
  return { id, label, tint: clampTint(v.tint, nextPaletteTint(index)) };
}

// The themes vocabulary doc: a list of unique-id themes. Deterministic so the
// client hydrate and the server store always agree on the same shape.
export function normalizeThemes(value: unknown, fallback: Theme[]): Theme[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const out: Theme[] = [];
  value.forEach((item, i) => {
    const theme = normalizeTheme(item, i);
    if (theme && !seen.has(theme.id)) {
      seen.add(theme.id);
      out.push(theme);
    }
  });
  return out;
}

// The per-activity assignment doc: activityId -> themeId. Mirrors the ratings
// map. Soft-keeps ids whose theme may since have been deleted — renderers and
// filters degrade gracefully (no badge / no match) rather than crash.
export function normalizeThemeAssignments(
  value: unknown,
  fallback: Record<string, string>
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key && typeof raw === "string" && raw.trim()) out[key] = raw.trim();
  }
  return out;
}

let themeIdCounter = 0;

export function createThemeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "theme-" + crypto.randomUUID();
  }
  themeIdCounter += 1;
  return "theme-" + Date.now().toString(36) + "-" + themeIdCounter.toString(36);
}
