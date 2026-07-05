#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
// All CSS files the token gate covers. Originally globals.css only; extended
// (2026-07-03 sweep, css-system-2) to calendar.css and the public run-sheet
// share page's stylesheet so hardcoded values there stop drifting silently.
// The former globals.css was split into per-domain stylesheets (Phase 2). The
// gate covers every one of them plus calendar/sidebar and the public run-sheet
// share page, so hardcoded values can't drift silently in any surface.
const CSS_FILES = [
  "app/tokens.css",
  "app/base.css",
  "app/shell.css",
  "app/components.css",
  "app/responsive.css",
  "app/animations.css",
  "app/run-sheet.css",
  "app/motion.css",
  "app/floating.css",
  "app/print.css",
  "app/calendar.css",
  "app/run/[token]/[activityId]/runsheet.css",
  "app/sidebar.css",
];
const BASELINE_FILE = "scripts/design-token-baseline.json";
const baselinePath = path.join(ROOT, BASELINE_FILE);

const CHECKED_PROPS = new Set([
  "border-radius",
  "box-shadow",
  "font-size",
  "gap",
  "row-gap",
  "column-gap",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
]);

const ALLOWED_MEDIA = new Set([
  "(max-width: 420px)",
  "(max-width: 640px)",
  "(max-width: 767px)",
  "(min-width: 768px)",
  // Tablet tier (iPad portrait) ↔ desk seam. The shell switches to the sidebar
  // "desk" at 1024 (DESKTOP_MIN); 768–1023 is the roomy touch-shell tablet tier.
  "(max-width: 1023px)",
  "(min-width: 768px) and (max-width: 1023px)",
  "(min-width: 1024px)",
  "(min-width: 1320px)",
  "(hover: none)",
  "(pointer: coarse)",
  "print",
  "(prefers-reduced-motion: reduce)",
]);

const SPACE_TOKEN = "var\\(--s-[0-8]\\)";
const PADDING_PART = `(?:${SPACE_TOKEN}|var\\(--page-x\\)|var\\(--tap\\)|var\\(--control-sm\\)|var\\(--control-md\\)|0)`;

const RULES = {
  "border-radius": [
    /^var\(--r-[^)]+\)$/,
    /^inherit$/,
    /^0$/,
    /^50%$/,
  ],
  "box-shadow": [
    /^var\(--e[0-4]\)$/,
    /^none$/,
  ],
  "font-size": [
    /^var\(--fs-[^)]+\)$/,
    /^clamp\(var\(--fs-[^)]+\).+\)$/,
  ],
  gap: [
    new RegExp(`^${SPACE_TOKEN}$`),
    new RegExp(`^${SPACE_TOKEN} ${SPACE_TOKEN}$`),
  ],
  "row-gap": [
    new RegExp(`^${SPACE_TOKEN}$`),
  ],
  "column-gap": [
    new RegExp(`^${SPACE_TOKEN}$`),
  ],
  padding: [
    /^0$/,
    new RegExp(`^${PADDING_PART}$`),
    new RegExp(`^${PADDING_PART}( ${PADDING_PART}){1,3}$`),
  ],
};

const PROP_MESSAGES = {
  "border-radius": "Use --r-* radius tokens.",
  "box-shadow": "Use --e0..--e4 elevation tokens.",
  "font-size": "Use --fs-* font-size tokens; pt is print-only.",
  gap: "Use --s-* spacing tokens for gap.",
  "row-gap": "Use --s-* spacing tokens for row-gap.",
  "column-gap": "Use --s-* spacing tokens for column-gap.",
  padding: "Use --s-* spacing tokens and semantic layout tokens for padding.",
};

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeValue(value) {
  return normalizeWhitespace(value.replace(/\s*!important\s*$/i, ""));
}

function baseProperty(property) {
  return property.startsWith("padding-") ? "padding" : property;
}

function selectorFromStack(stack) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].type === "rule") {
      return stack[i].prelude;
    }
  }
  return "<root>";
}

function mediaContext(stack) {
  return stack
    .filter((entry) => entry.type === "media")
    .map((entry) => entry.prelude);
}

function hasAllowedUnitEscape(value, inPrint) {
  if (/\b(?:calc|clamp|env)\(/i.test(value)) return true;
  if (/(^|[\s,(])-?\d*\.?\d+(%|fr|in)\b/i.test(value)) return true;
  if (inPrint && /(^|[\s,(])-?\d*\.?\d+pt\b/i.test(value)) return true;
  // The print document (`.print-doc` / `pd-*`) is sized off a small set of
  // PRINT-SCOPED custom props (`--pd-fs-*`, `--pd-pad`, `--pd-radius`, …) defined
  // once on `.print-doc` and derived from the app scale via calc(pt). Referencing
  // those vars is the intended, de-duplicated way to size print type/spacing/
  // radius — bless it the same way --r-*/--s-*/--fs- tokens are blessed, so the
  // pd- rules read as variables instead of scattered calc(pt)/in literals.
  if (/\bvar\(--pd-[\w-]+\b/i.test(value)) return true;
  return false;
}

function isAllowedDeclaration(property, value, inPrint) {
  const normalized = normalizeValue(value);
  if (hasAllowedUnitEscape(normalized, inPrint)) return true;

  const ruleKey = baseProperty(property);
  const rules = RULES[ruleKey] ?? [];
  return rules.some((rule) => rule.test(normalized));
}

function parseCss(css, cssFile) {
  const violations = [];
  const stack = [];
  let pendingPrelude = [];
  let exemptNext = false;

  const lines = css.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const hasTokenExempt = rawLine.includes("token-exempt");
    let line = rawLine.replace(/\/\*.*?\*\//g, "");
    const trimmed = line.trim();

    if (hasTokenExempt && !trimmed.includes(":")) {
      exemptNext = true;
      return;
    }

    if (trimmed === "") return;

    const closeCount = (line.match(/}/g) ?? []).length;
    const lineBeforeFirstClose = line.split("}")[0].trim();

    if (lineBeforeFirstClose !== "") {
      const mediaMatch = lineBeforeFirstClose.match(/^@media\s+(.+?)\s*\{$/);
      if (mediaMatch) {
        const query = normalizeWhitespace(mediaMatch[1]);
        stack.push({ type: "media", prelude: query });
        pendingPrelude = [];

        if (!ALLOWED_MEDIA.has(query) && !hasTokenExempt && !exemptNext) {
          violations.push({
            file: cssFile,
            id: [cssFile, "@media", "media", query, "screen"].join("|"),
            kind: "media",
            line: lineNumber,
            selector: "@media",
            property: "media",
            value: query,
            context: "screen",
            message: "Use one of the named breakpoint media queries.",
          });
        }
        exemptNext = false;
      } else if (lineBeforeFirstClose.endsWith("{")) {
        const prelude = normalizeWhitespace(
          [...pendingPrelude, lineBeforeFirstClose.slice(0, -1)].join(" "),
        );
        const type = prelude.startsWith("@") ? "at-rule" : "rule";
        stack.push({ type, prelude });
        pendingPrelude = [];
        exemptNext = false;
      } else {
        const declarationMatch = lineBeforeFirstClose.match(/^([-\w]+)\s*:\s*(.+);$/);
        if (declarationMatch) {
          const property = declarationMatch[1].toLowerCase();
          const value = normalizeValue(declarationMatch[2]);
          if (CHECKED_PROPS.has(property) && !hasTokenExempt && !exemptNext) {
            const media = mediaContext(stack);
            const inPrint = media.includes("print");
            if (!isAllowedDeclaration(property, value, inPrint)) {
              const selector = selectorFromStack(stack);
              const context = inPrint ? "print" : "screen";
              violations.push({
                file: cssFile,
                id: [cssFile, selector, property, value, context].join("|"),
                kind: "declaration",
                line: lineNumber,
                selector,
                property,
                value,
                context,
                message: PROP_MESSAGES[baseProperty(property)],
              });
            }
          }
          exemptNext = false;
        } else if (lineBeforeFirstClose.endsWith(",")) {
          pendingPrelude.push(lineBeforeFirstClose);
        } else if (pendingPrelude.length > 0) {
          pendingPrelude.push(lineBeforeFirstClose);
        } else {
          exemptNext = false;
        }
      }
    }

    for (let i = 0; i < closeCount; i += 1) {
      stack.pop();
    }
  });

  const seen = new Set();
  return violations.filter((violation) => {
    if (seen.has(violation.id)) return false;
    seen.add(violation.id);
    return true;
  });
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null;

  const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const entries = Array.isArray(parsed) ? parsed : parsed.violations;
  if (!Array.isArray(entries)) {
    throw new Error(`${BASELINE_FILE} must contain a violations array.`);
  }
  return entries;
}

function writeBaseline(violations) {
  const baseline = {
    schema: "camplibrary-design-token-baseline-v1",
    generatedFrom: CSS_FILES,
    note: "Existing off-scale CSS values. The checker fails only for new IDs not listed here.",
    violations: violations.map((violation) => ({
      id: violation.id,
      file: violation.file,
      kind: violation.kind,
      selector: violation.selector,
      property: violation.property,
      value: violation.value,
      context: violation.context,
    })),
  };

  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

const violations = CSS_FILES.flatMap((cssFile) => {
  const css = fs.readFileSync(path.join(ROOT, cssFile), "utf8");
  return parseCss(css, cssFile);
});
const baseline = readBaseline();

if (baseline === null) {
  writeBaseline(violations);
  console.log(`Design token baseline remaining: ${violations.length}/${violations.length}`);
  console.log(`Created ${BASELINE_FILE}`);
  process.exit(0);
}

const baselineIds = new Set(baseline.map((entry) => (typeof entry === "string" ? entry : entry.id)));
const currentIds = new Set(violations.map((violation) => violation.id));
const newViolations = violations.filter((violation) => !baselineIds.has(violation.id));
const remainingBaselineCount = [...baselineIds].filter((id) => currentIds.has(id)).length;

console.log(`Design token baseline remaining: ${remainingBaselineCount}/${baselineIds.size}`);

if (newViolations.length > 0) {
  console.error(`New design token violations: ${newViolations.length}`);
  for (const violation of newViolations.slice(0, 25)) {
    console.error(
      `${violation.file}:${violation.line} ${violation.selector} { ${violation.property}: ${violation.value}; } ${violation.message}`,
    );
  }
  if (newViolations.length > 25) {
    console.error(`...and ${newViolations.length - 25} more`);
  }
  process.exit(1);
}
