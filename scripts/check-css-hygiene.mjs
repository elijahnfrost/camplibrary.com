#!/usr/bin/env node
/**
 * CSS hygiene gate (Phase 2c). Fails when a change introduces a NEW `!important`
 * or a NEW top-level duplicate selector (an override-stack). Existing ones are
 * grandfathered into a baseline so the gate ratchets: the mess can shrink but
 * never grow. Runs over every app stylesheet.
 *
 *   node scripts/check-css-hygiene.mjs           # verify against baseline
 *   node scripts/check-css-hygiene.mjs --update    # rewrite the baseline
 *
 * A legitimately-needed `!important` (documented) or an intentional new duplicate
 * is adopted with --update, exactly like the design-token baseline.
 */
import postcss from "postcss";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASELINE_FILE = "scripts/css-hygiene-baseline.json";
const baselinePath = path.join(ROOT, BASELINE_FILE);
const UPDATE = process.argv.includes("--update");

// Every stylesheet under app/ (recursive). Globbing keeps this in step with
// future splits without editing a hardcoded list.
function findCss(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) findCss(full, out);
    else if (name.endsWith(".css")) out.push(path.relative(ROOT, full));
  }
  return out;
}
const CSS_FILES = findCss(path.join(ROOT, "app")).sort();

const norm = (s) => s.replace(/\s+/g, " ").trim();

// selectorFor: nearest ancestor rule prelude, for labelling !important sites.
function selectorFor(node) {
  let n = node.parent;
  while (n && n.type !== "rule") n = n.parent;
  return n ? norm(n.selector) : "<root>";
}

const importants = []; // {id}
const topSelectorCount = new Map(); // normalized selector -> count (top-level only)

for (const file of CSS_FILES) {
  const css = fs.readFileSync(path.join(ROOT, file), "utf8");
  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (e) {
    console.error(`Parse error in ${file}: ${e.message}`);
    process.exit(1);
  }
  root.walkDecls((decl) => {
    if (decl.important) {
      importants.push({ id: `${file}|${selectorFor(decl)}|${decl.prop}` });
    }
  });
  root.walkRules((rule) => {
    if (rule.parent.type !== "root") return; // top-level only
    if (rule.parent.type === "atrule") return;
    for (const sel of rule.selectors) {
      const key = norm(sel);
      if (!key.includes(".")) continue; // ignore element/keyframe selectors
      topSelectorCount.set(key, (topSelectorCount.get(key) || 0) + 1);
    }
  });
}

const importantIds = [...new Set(importants.map((i) => i.id))].sort();
const duplicateSelectors = [...topSelectorCount.entries()]
  .filter(([, c]) => c > 1)
  .map(([s]) => s)
  .sort();

const current = { importants: importantIds, duplicateSelectors };

if (UPDATE || !fs.existsSync(baselinePath)) {
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        schema: "camplibrary-css-hygiene-baseline-v1",
        note: "Grandfathered !important sites and top-level duplicate selectors. The gate fails only on NEW entries not listed here.",
        counts: { importants: importantIds.length, duplicateSelectors: duplicateSelectors.length },
        ...current,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `CSS hygiene baseline written: ${importantIds.length} !important, ${duplicateSelectors.length} duplicate top-level selectors.`,
  );
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const baseImp = new Set(baseline.importants);
const baseDup = new Set(baseline.duplicateSelectors);
const newImp = importantIds.filter((id) => !baseImp.has(id));
const newDup = duplicateSelectors.filter((s) => !baseDup.has(s));

console.log(
  `CSS hygiene: ${importantIds.length}/${baseImp.size} !important, ${duplicateSelectors.length}/${baseDup.size} duplicate selectors (current/baseline).`,
);

if (newImp.length || newDup.length) {
  if (newImp.length) {
    console.error(`\nNEW !important (${newImp.length}) — fold into the base rule instead:`);
    newImp.slice(0, 20).forEach((id) => console.error(`  ${id}`));
  }
  if (newDup.length) {
    console.error(`\nNEW duplicate top-level selector (${newDup.length}) — an override-stack; edit the base rule:`);
    newDup.slice(0, 20).forEach((s) => console.error(`  ${s}`));
  }
  console.error(`\nIf intentional, adopt with: node scripts/check-css-hygiene.mjs --update`);
  process.exit(1);
}
console.log("No new !important or duplicate selectors. ✓");
