#!/usr/bin/env node
/**
 * File-size ratchet (Phase 5 / Phase 7). The repo's guideline is 500 lines — a
 * proxy for "no file mixes concerns or needs a full read to change one line."
 *
 * This gate FAILS when a NEW file exceeds the limit, or when an already-oversized
 * file (grandfathered in the baseline) GROWS past its recorded size. Existing
 * large files are allowed to stay — several are cohesive units whose split is a
 * deliberate, CI-validated follow-up (see docs/cleanup-notes.md) — but the set
 * can only shrink, never grow.
 *
 *   node scripts/check-file-size.mjs           # verify against baseline
 *   node scripts/check-file-size.mjs --update    # rewrite the baseline
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LIMIT = 500;
const BASELINE_FILE = "scripts/file-size-baseline.json";
const baselinePath = path.join(ROOT, BASELINE_FILE);
const UPDATE = process.argv.includes("--update");

// Source we hold to the guideline: app/components/lib. Excludes generated seed
// data, the separate camp-mcp tool, and test files (fixtures legitimately vary).
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "tools"]);
function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    if (IGNORE_DIRS.has(n)) continue;
    const f = path.join(dir, n);
    const st = fs.statSync(f);
    if (st.isDirectory()) {
      if (f.includes(path.join("lib", "seed"))) continue;
      walk(f, out);
    } else if (/\.(ts|tsx)$/.test(n) && !/\.(test|spec)\.tsx?$/.test(n)) {
      out.push(path.relative(ROOT, f));
    }
  }
  return out;
}
const files = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d))).sort();

const oversized = {};
for (const f of files) {
  const n = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").length;
  if (n > LIMIT) oversized[f] = n;
}

if (UPDATE || !fs.existsSync(baselinePath)) {
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      { schema: "camplibrary-file-size-baseline-v1", limit: LIMIT, note: "Grandfathered files over the line limit. A file may shrink below its entry but never grow past it, and NEW files must stay under the limit.", files: oversized },
      null,
      2,
    ) + "\n",
  );
  console.log(`File-size baseline written: ${Object.keys(oversized).length} files over ${LIMIT} lines.`);
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")).files;
const problems = [];
for (const [f, n] of Object.entries(oversized)) {
  if (!(f in baseline)) problems.push(`NEW file over ${LIMIT} lines: ${f} (${n})`);
  else if (n > baseline[f]) problems.push(`${f} grew ${baseline[f]} -> ${n} (over ${LIMIT}; split or shrink)`);
}

console.log(`File-size: ${Object.keys(oversized).length} files over ${LIMIT} (baseline ${Object.keys(baseline).length}).`);
if (problems.length) {
  console.error("\nFile-size ratchet violations:");
  problems.forEach((p) => console.error(`  ${p}`));
  console.error(`\nKeep files under ${LIMIT} lines. If a file is a cohesive unit that must stay large, adopt it with: node scripts/check-file-size.mjs --update`);
  process.exit(1);
}
console.log("No new or grown oversized files. ✓");
