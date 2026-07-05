#!/usr/bin/env node
/**
 * Report-only CSS unused-selector detector (Phase 0 tooling).
 *
 * Extracts every class selector from the project stylesheets, tokenizes the
 * TS/TSX/JS code corpus, and classifies each class as:
 *   - referenced : exact class token found in code (alive)
 *   - dynamic    : only a dynamic prefix found (template literal / concat /
 *                  clsx object key) — alive via runtime construction. This is
 *                  the dynamic-className allowlist the brief asks for.
 *   - library    : matches a known third-party prefix applied by a library
 *                  (FullCalendar, Paged.js, Clerk) — alive, never in our code.
 *   - unreferenced : no exact, dynamic, or library match — DEAD CANDIDATE.
 *
 * This script only reports. Phases 1 and 2 act on its output. It is
 * intentionally conservative: when in doubt a class is kept alive, so the
 * "unreferenced" list under-reports rather than risking a bad deletion.
 *
 * Usage:
 *   node scripts/report-unused-css.mjs            # human summary
 *   node scripts/report-unused-css.mjs --json     # machine-readable JSON
 *   node scripts/report-unused-css.mjs --write     # also write the JSON artifact
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const AS_JSON = args.has("--json");
const WRITE_ARTIFACT = args.has("--write");

// Directories to walk for the code corpus and the stylesheets.
const SCAN_DIRS = ["app", "components", "lib", "types"];
const ROOT_FILES = ["proxy.ts"];
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "tools", "dist", "build"]);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// Third-party class prefixes applied by libraries, never authored in our JSX.
// A class matching one of these is alive even with zero code references.
const LIBRARY_PREFIXES = [
  "fc-", "fc", // FullCalendar theme/grid
  "pagedjs", "pagedjs-", // Paged.js print engine
  "cl-", "cl_", // Clerk components
  "ProseMirror", // (defensive) rich-text if present
];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

// ---- collect files -------------------------------------------------------
const allFiles = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), allFiles);
for (const f of ROOT_FILES) allFiles.push(join(ROOT, f));

const cssFiles = allFiles.filter((f) => extname(f) === ".css");
const codeFiles = allFiles.filter((f) => CODE_EXT.has(extname(f)));

// ---- strip CSS comments so class extraction ignores commented selectors --
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// ---- extract class selectors from CSS -----------------------------------
// `.` followed by a name that starts with a letter/underscore/hyphen (never a
// digit, so decimals like 1.5px / .5em are skipped). Captures the full class.
const CLASS_RE = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g;

/** class -> Set of files that define it */
const classDefs = new Map();
for (const file of cssFiles) {
  const css = stripCssComments(readFileSync(file, "utf8"));
  let m;
  while ((m = CLASS_RE.exec(css)) !== null) {
    const cls = m[1];
    if (!classDefs.has(cls)) classDefs.set(cls, new Set());
    classDefs.get(cls).add(rel(file));
  }
}

// ---- tokenize the code corpus -------------------------------------------
// Any maximal run of class-name characters becomes a token. Static uses like
// "foo bar-baz" tokenize to foo / bar-baz (exact). Dynamic uses like
// `cal-view__${x}` tokenize to cal-view__ (a dynamic prefix ending in a
// delimiter); 'foo--' + v tokenizes to foo--.
const TOKEN_RE = /[A-Za-z0-9_-]+/g;
const codeTokens = new Set();
for (const file of codeFiles) {
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = TOKEN_RE.exec(src)) !== null) codeTokens.add(m[0]);
}

// Dynamic prefixes = tokens that end in a delimiter (- _ ) — these are the
// left side of a template interpolation or concatenation.
function isDynamicPrefixOf(cls) {
  // Generate every prefix of `cls` that ends right after a delimiter and check
  // whether it exists verbatim as a code token.
  for (let i = 1; i < cls.length; i++) {
    const ch = cls[i - 1];
    if (ch === "-" || ch === "_") {
      const prefix = cls.slice(0, i);
      if (codeTokens.has(prefix)) return prefix;
    }
  }
  return null;
}

function matchesLibraryPrefix(cls) {
  return LIBRARY_PREFIXES.find(
    (p) => cls === p || cls.startsWith(p),
  );
}

function rel(p) {
  return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p;
}

// ---- classify ------------------------------------------------------------
const referenced = [];
const dynamic = []; // {cls, prefix, files}
const library = []; // {cls, prefix, files}
const unreferenced = []; // {cls, files}

for (const [cls, files] of [...classDefs.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  const fileList = [...files];
  if (codeTokens.has(cls)) {
    referenced.push(cls);
    continue;
  }
  const dyn = isDynamicPrefixOf(cls);
  if (dyn) {
    dynamic.push({ cls, prefix: dyn, files: fileList });
    continue;
  }
  const lib = matchesLibraryPrefix(cls);
  if (lib) {
    library.push({ cls, prefix: lib, files: fileList });
    continue;
  }
  unreferenced.push({ cls, files: fileList });
}

const report = {
  generatedBy: "scripts/report-unused-css.mjs",
  cssFiles: cssFiles.map(rel).sort(),
  codeFileCount: codeFiles.length,
  totals: {
    classes: classDefs.size,
    referenced: referenced.length,
    dynamic: dynamic.length,
    library: library.length,
    unreferenced: unreferenced.length,
  },
  dynamicAllowlist: dynamic
    .map((d) => d.prefix)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort(),
  unreferenced,
  dynamic,
  library,
};

if (AS_JSON) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  const t = report.totals;
  console.log("CSS unused-selector report (report-only)");
  console.log("=".repeat(48));
  console.log(`Stylesheets scanned : ${report.cssFiles.length}`);
  report.cssFiles.forEach((f) => console.log(`   - ${f}`));
  console.log(`Code files scanned  : ${t ? report.codeFileCount : 0}`);
  console.log("");
  console.log(`Total class selectors : ${t.classes}`);
  console.log(`  referenced (exact)  : ${t.referenced}`);
  console.log(`  dynamic (allowlist) : ${t.dynamic}`);
  console.log(`  library (external)  : ${t.library}`);
  console.log(`  UNREFERENCED (dead) : ${t.unreferenced}`);
  console.log("");
  console.log(`Dynamic prefixes (allowlist): ${report.dynamicAllowlist.length}`);
  report.dynamicAllowlist.forEach((p) => console.log(`   ${p}…`));
  console.log("");
  console.log("Dead candidates (defined, never referenced):");
  if (unreferenced.length === 0) {
    console.log("   (none)");
  } else {
    for (const u of unreferenced) {
      console.log(`   .${u.cls}   [${u.files.join(", ")}]`);
    }
  }
}

if (WRITE_ARTIFACT) {
  const out = join(ROOT, "docs", "css-unused-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  if (!AS_JSON) console.log(`\nWrote ${rel(out)}`);
}
