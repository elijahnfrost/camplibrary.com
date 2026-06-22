// Build the Camp Library seed modules from generated lane JSON.
//
// Reads .context/seed-events.json ({ lanes: [{ lane, title, events: [...] }] }),
// cleans + normalizes every event (duration snap, URL-honesty enforcement,
// group/age/subset normalization, dedup), and emits one typed TS module per lane
// under lib/seed/lanes/<prefix>.ts plus lib/seed/index.ts aggregating them with
// the hand-authored reserved staples. The emitted files are plain Activity[]
// literals, so `tsc` type-checks every event against the schema on build.
//
// Usage: node scripts/build-seed.mjs [path/to/seed-events.json]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INPUT = process.argv[2] || join(ROOT, ".context", "seed-events.json");
const LANES_DIR = join(ROOT, "lib", "seed", "lanes");

const AGE_BANDS = ["pre", "g13", "g46", "g79", "g1012"];
const AGE_RANGE = { pre: [3, 5], g13: [6, 9], g46: [9, 12], g79: [12, 15], g1012: [15, 18] };
const CATEGORIES = ["Game", "Craft", "Song", "Water", "Quiet"];
const PLACES = ["Inside", "Outside", "Both"];
const PREPS = ["None", "Low", "Medium", "High"];
const RESERVED_IDS = new Set(["capture-flag", "gaga-ball", "sharks-minnows"]);

const trim = (s) => (typeof s === "string" ? s.trim() : "");
const strArr = (v) => (Array.isArray(v) ? v.map(trim).filter(Boolean) : []);
const uniq = (a) => [...new Set(a)];

function kebab(s) {
  return trim(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function snapDuration(n) {
  const v = Math.round((Number(n) || 30) / 15) * 15;
  return Math.max(15, Math.min(120, v));
}

function clampInt(n, lo, hi, fallback) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function agesFromRange(lo, hi) {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const ids = AGE_BANDS.filter((id) => a <= AGE_RANGE[id][1] && b > AGE_RANGE[id][0]);
  return ids.length ? ids : ["g46"];
}

// A search-result page is never a resource — "search YouTube/Google for this
// game" is not a demo. We drop every search URL no matter what; the curated,
// author-verified links in lib/seed/links.json are how specific videos/articles
// get in (each one is fetched + relevance-checked at authoring time before it is
// added there — see docs/ai-authoring-guide.md). Unverifiable URLs from the bulk
// generation (which only ever produced searches) therefore fall away on their own.
function isSearchUrl(parsed) {
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "google.com" || host.endsWith(".google.com")) return parsed.pathname.startsWith("/search");
  if (host === "youtube.com" || host === "m.youtube.com") return parsed.pathname.startsWith("/results");
  return false;
}

// Media policy: a specific, real video/tutorial URL (a YouTube watch link plays
// inline; anything else is a link card). Search pages are dropped.
function specificVideoUrl(url) {
  const u = trim(url);
  if (!/^https?:\/\//i.test(u)) return null;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (isSearchUrl(parsed)) return null;
  return u;
}

// Link policy: a specific, real reference URL (a how-to article, the source
// page). Search pages are dropped. The five director-source articles are the
// pre-blessed bulk sources; lib/seed/links.json adds verified per-activity links.
const SOURCE_URLS = new Set([
  "https://ourdaysoutside.com/15-classic-summer-camp-crafts-for-kids/",
  "https://www.ssww.com/blog/top-10-summer-camp-themes-creative-engaging-activity-ideas/",
  "https://littlebinsforlittlehands.com/summer-camp-activities/",
  "https://rusticpathways.com/blog/summer-camp-activities",
  "https://campminder.com/resources/27-summer-camp-activities-to-spice-up-the-summer-camp-atmosphere/",
]);
function specificLinkUrl(url) {
  const u = trim(url);
  if (!/^https?:\/\//i.test(u)) return null;
  if (SOURCE_URLS.has(u)) return u;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (isSearchUrl(parsed)) return null;
  return u;
}

function cleanEvent(raw, prefix, seenIds, curated) {
  const title = trim(raw.title) || "Untitled activity";
  let id = kebab(raw.id) || kebab(prefix + "-" + title);
  if (!id.startsWith(prefix + "-")) id = prefix + "-" + id;
  if (RESERVED_IDS.has(id)) id = prefix + "-" + id;
  while (seenIds.has(id)) id = id + "-x";
  seenIds.add(id);

  // Curated, author-verified per-activity resources (lib/seed/links.json), keyed
  // by this final id. Prepended so the specific tutorial sorts ahead of the
  // generic director-source link.
  const patch = (curated && curated[id]) || {};

  const type = CATEGORIES.includes(raw.type) ? raw.type : "Craft";
  const place = PLACES.includes(raw.place) ? raw.place : "Both";
  const prep = PREPS.includes(raw.prep) ? raw.prep : "Low";

  let ages = uniq(strArr(raw.ages).filter((a) => AGE_BANDS.includes(a)));
  let ageMin = clampInt(raw.ageMin, 3, 18, 9);
  let ageMax = clampInt(raw.ageMax, 3, 18, 12);
  if (ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  if (!ages.length) ages = agesFromRange(ageMin, ageMax);

  let groupMin = Number.isFinite(Number(raw.groupMin)) && raw.groupMin != null ? Math.round(Number(raw.groupMin)) : null;
  let groupMax = Number.isFinite(Number(raw.groupMax)) && raw.groupMax != null ? Math.round(Number(raw.groupMax)) : null;
  if (groupMin != null && groupMin <= 0) groupMin = null;
  if (groupMax != null && groupMax <= 0) groupMax = null;
  if (groupMin != null && groupMax != null && groupMin > groupMax) [groupMin, groupMax] = [groupMax, groupMin];

  const steps = strArr(raw.steps);
  let subsets = Array.isArray(raw.subsets) ? raw.subsets.map((row) => strArr(row)) : [];
  // Align subsets to steps by index.
  subsets = steps.map((_, i) => subsets[i] || []);
  const hasSub = subsets.some((row) => row.length);

  const altNames = uniq(strArr(raw.altNames));

  // Media/links keep only specific, verified URLs. Searches resolve to null and
  // are filtered out — there is no search fallback, so an activity with no real
  // video/source simply ships without that field. Curated links.json entries are
  // merged first, then the bulk-generated ones.
  const mediaIn = [...(Array.isArray(patch.media) ? patch.media : []), ...(Array.isArray(raw.media) ? raw.media : [])];
  let media = mediaIn
    .map((m) => ({ m, url: specificVideoUrl(m && m.url) }))
    .filter((x) => x.url)
    .map((x) => ({ title: trim(x.m.title) || ("Video demos: " + title), url: x.url }));
  // De-dup media by url.
  const seenMedia = new Set();
  media = media.filter((m) => (seenMedia.has(m.url) ? false : (seenMedia.add(m.url), true)));

  const linksIn = [...(Array.isArray(patch.links) ? patch.links : []), ...(Array.isArray(raw.links) ? raw.links : [])];
  let links = linksIn
    .map((l) => ({ l, url: specificLinkUrl(l && l.url) }))
    .filter((x) => x.url)
    .map((x) => ({ label: trim(x.l.label) || ("More ideas: " + title), url: x.url }));
  // De-dup links by url.
  const seenLink = new Set();
  links = links.filter((l) => (seenLink.has(l.url) ? false : (seenLink.add(l.url), true)));

  const variations = strArr(raw.variations);
  const materials = strArr(raw.materials);
  const materialTags = uniq(strArr(raw.materialTags));

  const out = {
    id,
    title,
    ...(altNames.length ? { altNames } : {}),
    type,
    place,
    ageMin,
    ageMax,
    durationMin: snapDuration(raw.durationMin),
    groupMin,
    groupMax,
    energy: clampInt(raw.energy, 1, 3, 2),
    prep,
    blurb: trim(raw.blurb),
    materials,
    ...(materialTags.length ? { materialTags } : {}),
    steps,
    notes: trim(raw.notes),
    safety: trim(raw.safety),
    ages,
    rating: clampInt(raw.rating, 1, 5, 3),
    ...(media.length ? { media } : {}),
    ...(links.length ? { links } : {}),
    ...(variations.length ? { variations } : {}),
    ...(hasSub ? { subsets } : {}),
  };
  return out;
}

function emitLane(prefix, events) {
  // One event per line: keeps each generated module short (well under the
  // 500-line guideline) and makes adding/removing an event a one-line diff.
  const body = events.map((e) => "  " + JSON.stringify(e)).join(",\n");
  const varName = prefix.replace(/[^a-z0-9]/gi, "") + "Activities";
  const file = `// AUTO-GENERATED by scripts/build-seed.mjs — do not edit by hand.\n` +
    `import type { Activity } from "@/lib/types";\n\n` +
    `export const ${varName}: Activity[] = [\n${body},\n];\n`;
  writeFileSync(join(LANES_DIR, prefix + ".ts"), file);
  return varName;
}

function loadCurated() {
  // lib/seed/links.json: { "<final-id>": { media?: [{title,url}], links?: [{label,url}] } }
  // Curated, author-verified per-activity tutorial links (committed, reviewable).
  try {
    return JSON.parse(readFileSync(join(ROOT, "lib", "seed", "links.json"), "utf8"));
  } catch {
    return {};
  }
}

function main() {
  const data = JSON.parse(readFileSync(INPUT, "utf8"));
  const lanes = data.lanes || [];
  const curated = loadCurated();
  mkdirSync(LANES_DIR, { recursive: true });

  const seenIds = new Set([...RESERVED_IDS]);
  const seenTitles = new Set(["capture the flag", "gaga ball", "sharks & minnows"]);
  const laneVars = [];
  let total = 0;
  const perLane = {};

  for (const lane of lanes) {
    const prefix = kebab(lane.lane) || "lane";
    const events = [];
    for (const raw of lane.events || []) {
      const tkey = trim(raw.title).toLowerCase();
      if (tkey && seenTitles.has(tkey)) continue; // drop exact-title duplicates
      const ev = cleanEvent(raw, prefix, seenIds, curated);
      if (tkey) seenTitles.add(tkey);
      events.push(ev);
    }
    if (!events.length) continue;
    const varName = emitLane(prefix, events);
    laneVars.push({ prefix, varName });
    perLane[prefix] = events.length;
    total += events.length;
  }

  // index.ts — aggregate reserved + all lanes.
  const imports = [`import type { Activity } from "@/lib/types";`, `import { reservedActivities } from "./lanes/reserved";`];
  for (const { prefix, varName } of laneVars) imports.push(`import { ${varName} } from "./lanes/${prefix}";`);
  const spread = ["...reservedActivities", ...laneVars.map((l) => "..." + l.varName)];
  const index = `// AUTO-GENERATED by scripts/build-seed.mjs — do not edit by hand.\n` +
    imports.join("\n") + "\n\n" +
    `export const SEED_ACTIVITIES: Activity[] = [\n  ${spread.join(",\n  ")},\n];\n`;
  writeFileSync(join(ROOT, "lib", "seed", "index.ts"), index);

  console.log(JSON.stringify({ total: total + 3, lanes: perLane, files: laneVars.length + 2 }, null, 2));
}

main();
