// One-off audit of the generated seed library. Run: npx tsx scripts/audit-seed.ts
import { SEED_ACTIVITIES } from "../lib/seed";
import type { Activity } from "../lib/types";

const A = SEED_ACTIVITIES;
const CATS = ["Game", "Craft", "Song", "Water", "Quiet"];
const BANDS = ["pre", "g13", "g46", "g79", "g1012"];

// Specialty items the camp does NOT stock (task constraint).
const BANNED = [
  "birdhouse", "wood slab", "wood cookie", "wood slice", "wood round", "tote bag",
  "canvas bag", "lego", "mason jar", "solar oven", "pizza box", "borax", "sewing machine",
  "power drill", "wood burning", "hot glue gun", "popsicle stick kit",
];
const WEATHER = ["overnight", "after dark", "nighttime", "campfire", "bonfire", "snow", "winter", "cold-weather"];

function txt(a: Activity): string {
  return [a.title, a.blurb, a.notes, a.safety, ...(a.materials || []), ...(a.materialTags || []),
    ...(a.steps || []), ...(a.variations || [])].join("  ").toLowerCase();
}

const ids = new Set<string>();
const titles = new Set<string>();
const issues: string[] = [];
const tagCounts = new Map<string, number>();
const catBand: Record<string, Record<string, number>> = {};
for (const c of CATS) { catBand[c] = {}; for (const b of BANDS) catBand[c][b] = 0; }
const catTotal: Record<string, number> = {};
const bandTotal: Record<string, number> = {};
let withMedia = 0, withLinks = 0, withVar = 0, withSub = 0, withAlt = 0, sourceCited = 0;
let youtubeOk = 0, youtubeBad = 0, linkOk = 0, linkBad = 0;
const SOURCE_HOSTS = ["ourdaysoutside.com", "ssww.com", "littlebinsforlittlehands.com", "rusticpathways.com", "campminder.com"];

for (const a of A) {
  if (ids.has(a.id)) issues.push(`dup id: ${a.id}`); ids.add(a.id);
  const tk = a.title.toLowerCase();
  if (titles.has(tk)) issues.push(`dup title: ${a.title}`); titles.add(tk);
  if (a.durationMin % 15 !== 0 || a.durationMin < 15 || a.durationMin > 120) issues.push(`bad duration ${a.durationMin}: ${a.id}`);
  if (a.groupMin != null && a.groupMax != null && a.groupMin > a.groupMax) issues.push(`group min>max: ${a.id}`);
  if (a.energy < 1 || a.energy > 3) issues.push(`bad energy: ${a.id}`);
  if (a.rating < 0 || a.rating > 5) issues.push(`bad rating: ${a.id}`);
  if (!a.ages.length) issues.push(`no ages: ${a.id}`);
  if (!a.steps.length) issues.push(`no steps: ${a.id}`);
  if (!a.blurb) issues.push(`no blurb: ${a.id}`);
  if (!a.safety) issues.push(`no safety: ${a.id}`);
  const body = txt(a);
  for (const w of BANNED) if (body.includes(w)) issues.push(`BANNED "${w}": ${a.id}`);
  for (const w of WEATHER) if (body.includes(w)) issues.push(`WEATHER "${w}": ${a.id}`);

  catTotal[a.type] = (catTotal[a.type] || 0) + 1;
  for (const b of a.ages) { bandTotal[b] = (bandTotal[b] || 0) + 1; if (catBand[a.type]) catBand[a.type][b] = (catBand[a.type][b] || 0) + 1; }
  for (const t of a.materialTags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  if (a.altNames?.length) withAlt++;
  if (a.media?.length) withMedia++;
  if (a.links?.length) withLinks++;
  if (a.variations?.length) withVar++;
  if (a.subsets?.length) withSub++;
  for (const m of a.media || []) {
    // Search pages must never ship; a specific video/tutorial URL is good.
    if (/youtube\.com\/results|google\.com\/search/.test(m.url)) { youtubeBad++; issues.push(`SEARCH media url: ${a.id}`); }
    else if (/^https?:\/\//.test(m.url)) youtubeOk++;
    else { youtubeBad++; issues.push(`non-http media url: ${a.id}`); }
  }
  for (const l of a.links || []) {
    if (/google\.com\/search|youtube\.com\/results/.test(l.url)) { linkBad++; issues.push(`SEARCH link url: ${a.id}`); }
    else if (SOURCE_HOSTS.some((h) => l.url.includes(h))) { linkOk++; sourceCited++; }
    else if (/^https?:\/\//.test(l.url)) linkOk++;
    else { linkBad++; issues.push(`non-http link url: ${a.id}`); }
  }
}

console.log("TOTAL ACTIVITIES:", A.length);
console.log("\nBY CATEGORY:", JSON.stringify(catTotal));
console.log("BY AGE BAND (tags, multi-count):", JSON.stringify(bandTotal));
console.log("\nCATEGORY x BAND matrix:");
console.log(["cat".padEnd(7), ...BANDS.map((b) => b.padStart(6))].join(" "));
for (const c of CATS) console.log([c.padEnd(7), ...BANDS.map((b) => String(catBand[c][b]).padStart(6))].join(" "));
console.log("\nFIELD COVERAGE:");
console.log(`  altNames: ${withAlt}/${A.length}  media: ${withMedia}  links: ${withLinks}  variations: ${withVar}  subsets: ${withSub}`);
console.log(`  director-source citations: ${sourceCited}`);
console.log(`  specific media (video/tutorial) urls: ${youtubeOk}  search/bad media urls (BAD): ${youtubeBad}`);
console.log(`  specific link urls: ${linkOk}  search/bad links (BAD): ${linkBad}`);
console.log(`\nDISTINCT materialTags: ${tagCounts.size}`);
const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log("  top tags:", topTags.map(([t, n]) => `${t}(${n})`).join(", "));
const rareTags = [...tagCounts.entries()].filter(([, n]) => n === 1).map(([t]) => t);
console.log(`  one-off tags (${rareTags.length}):`, rareTags.slice(0, 40).join(", "));
console.log(`\nISSUES (${issues.length}):`);
issues.forEach((i) => console.log("  -", i));
