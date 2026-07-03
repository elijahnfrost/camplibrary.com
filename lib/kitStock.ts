// Camp Library — the kit stock store.
//
// A synced user doc that records, per material id, whether the camp has that
// item on hand: "have" (plenty in the cupboard), "low" (running out, plan a
// refill), or "out" (none — this need is uncovered). It's a SPARSE map: an
// absent key means the item was never reviewed, and an EMPTY map ({}) is the
// first-class UNSET state that keeps the whole coverage lens inert (a fresh
// account never gets a blanked library or a wall of red run sheets).
//
// The keys are the SAME frozen materialTagId slugs that tie the catalog, the
// refs on an activity, the run-sheet checklist, and the library kit filter
// together. Values are a closed 3-state whitelist.
//
// Legacy fold (read-side): before this doc existed, "on hand" was one flat
// `availableMaterials: string[]` boolean set. effectiveKitStock folds that old
// set in as "have" UNDER any real kitStock entry (kitStock wins per key), so an
// account that never touched the new UI still reads its old on-hand items as
// covered — WITHOUT the fold ever downgrading a state the user has since set.
// The write helper (foldStockWrite) migrates the old set add-only on first
// touch: it never overwrites an existing kitStock key, so a race between two
// devices can't resurrect a stale "have" over a fresh "out".
//
// No "use client" directive — this module is isomorphic. The validator runs on
// the client (hydrating localStorage) AND on the server (validating API
// payloads before Postgres), exactly like every other synced doc.

export type StockState = "have" | "low" | "out";

// The closed value whitelist. A stored value outside this set is dropped (the
// key becomes "never reviewed" again), so renderers only ever see clean states.
const STOCK_STATES: readonly StockState[] = ["have", "low", "out"];

// A covered state satisfies a need in the coverage lens: the item is present
// (plenty) or present-but-thin (low). "out" and absent are uncovered.
export function isStocked(state: StockState | undefined): boolean {
  return state === "have" || state === "low";
}

function isStockState(value: unknown): value is StockState {
  return typeof value === "string" && (STOCK_STATES as readonly string[]).includes(value);
}

// Key hygiene mirrors the material id contract: a trimmed, non-empty slug no
// longer than the catalog's name clamp. Ids ARE slugs, so this only guards
// against corrupt payloads, never reshapes a real id.
const MAX_KEY = 80;
// Generous cap: a real camp owns dozens of kinds of things. Bounded so a
// corrupt payload can't balloon the doc (mirrors the catalog's own cap).
const MAX_ENTRIES = 400;

// Isomorphic validator: keep only well-formed { slug -> state } pairs, trimming
// keys, whitelisting values, and capping size. Deterministic — the same input
// always yields the same output, so client and server agree. An empty or
// malformed payload collapses to {} (the UNSET state), never a throw.
export function normalizeKitStock(value: unknown): Record<string, StockState> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, StockState> = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_ENTRIES) break;
    const key = typeof rawKey === "string" ? rawKey.trim().slice(0, MAX_KEY) : "";
    if (!key) continue;
    if (!isStockState(rawValue)) continue;
    if (out[key] !== undefined) continue;
    out[key] = rawValue;
    count += 1;
  }
  return out;
}

// The effective stock the coverage lens reads. Folds the legacy availableMaterials
// boolean set in as "have", but ONLY under real kitStock entries — kitStock wins
// per key, so a fresh "out" is never masked by a stale legacy "have". When BOTH
// are empty the result is {} (the UNSET state the lens treats as inert). When
// kitStock is empty but the legacy set has ids, those ids read as "have" (the old
// behavior, un-migrated). Pure and read-only: nothing is written here.
export function effectiveKitStock(
  kitStock: Record<string, StockState>,
  availableMaterials: string[]
): Record<string, StockState> {
  const hasStock = Object.keys(kitStock).length > 0;
  const hasLegacy = availableMaterials.length > 0;
  if (!hasStock && !hasLegacy) return {};
  const out: Record<string, StockState> = {};
  // Legacy ids first as "have"…
  for (const id of availableMaterials) {
    if (id) out[id] = "have";
  }
  // …then kitStock overrides per key (a real state always wins over the fold).
  for (const [id, state] of Object.entries(kitStock)) {
    out[id] = state;
  }
  return out;
}

// The add-only write helper every kitStock mutation goes through. Sets ONE id to
// a new state while migrating the legacy availableMaterials set in as "have" —
// but only for ids not ALREADY in kitStock, so an existing state (including a
// deliberate "out") is never downgraded by the fold. The result is the merged
// map to persist; the caller writes it back through setDoc.
export function foldStockWrite(
  kitStock: Record<string, StockState>,
  availableMaterials: string[],
  id: string,
  state: StockState
): Record<string, StockState> {
  const next: Record<string, StockState> = {};
  // Fold legacy ids as "have" first — they're the lowest-priority layer…
  for (const legacyId of availableMaterials) {
    if (legacyId) next[legacyId] = "have";
  }
  // …existing kitStock states override the fold (never downgraded)…
  for (const [existingId, existingState] of Object.entries(kitStock)) {
    next[existingId] = existingState;
  }
  // …and the explicit edit wins over everything.
  if (id) next[id] = state;
  return next;
}

// Cycle a need through the 3 states in a fixed, predictable order:
// have → low → out → have. Absent (never reviewed) enters the cycle at "have"
// on first tap, so a single tap on a fresh row marks it present.
export function nextStockState(current: StockState | undefined): StockState {
  if (current === "have") return "low";
  if (current === "low") return "out";
  return "have";
}
