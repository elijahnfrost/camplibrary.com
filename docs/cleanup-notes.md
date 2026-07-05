# Cleanup notes (scratchpad)

Working notes for the behavior-preserving structural cleanup. **This file is a
scratchpad**: it holds detector baselines, allowlists, and deferred items while
the cleanup runs. Fold the durable parts into `docs/ARCHITECTURE.md` /
`docs/CONVENTIONS.md` (Phase 6) and delete this file at the end.

Standard for every phase: **zero intended runtime or visual change.** The gate
suite below is the oracle. One idea per commit, gate after every commit.

---

## Known-green baseline (Phase 0)

Established on branch `elijahnfrost/hangzhou` from a clean `npm install`.

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | ✅ clean |
| Behavior | `npm run test` | ✅ 644 passed, 5 skipped (649) |
| CSS tokens | `npm run lint:design-tokens` | ✅ baseline 380/380 |
| Build | `npm run build` | ✅ 25 routes compiled |
| Pixels | `npm run test:visual` | ⚠️ **CI-runner only** — see note |

**Visual suite is a CI oracle, not a local one.** Playwright baselines are
generated on the CI (darwin) runner and a dev Mac produces false diffs against
them. Do **not** run or regenerate `test:visual` locally to "prove" a cleanup
step; trust it on CI via the PR. Everything else runs locally.

Local gate suite to run after every commit:

```bash
npm run typecheck && npm run test && npm run lint:design-tokens && npm run build
```

---

## Detectors (report-only, added in Phase 0)

| Script | Tool | Covers | Config |
| --- | --- | --- | --- |
| `npm run report:deadcode` | knip | unused files, exports, types, deps | `knip.json` |
| `npm run report:deps` | depcheck | unused / missing deps | `.depcheckrc.json` |
| `npm run report:exports` | ts-prune | unused exports (2nd opinion) | — |
| `npm run report:css` | `scripts/report-unused-css.mjs` | dead CSS class selectors | in-script |

**knip is authoritative** for TS/deps (its Next/Playwright/Vitest plugins
understand file conventions). **ts-prune is a noisy second opinion** — it flags
Next conventions (`default`, `metadata`, `GET`, `dynamic`, route handlers) as
unused; ignore those, use it only to cross-check knip's real hits.

### Baseline counts (Phase 0 — the numbers Phase 1 drives toward zero)

- **knip**: 1 unused file, 77 unused exports, 26 unused exported types, **0 unused deps**.
  - Unused file: `lib/calendar/nowNext.ts` (export `useTodayNowNext`).
- **depcheck**: 0 unused runtime deps, 0 missing. 2 devDeps flagged = **false
  positives, allowlisted** (see below).
- **ts-prune**: 82 raw findings, ~majority Next-convention false positives.
- **CSS report**: 1433 class selectors → 1177 referenced, 118 dynamic
  (allowlist), 28 library, **110 unreferenced (dead candidates)**.

Re-run any detector for the current exhaustive list; the enumerations are
reproducible and go stale as Phase 1 acts, so they are intentionally not pasted
here in full.

---

## Allowlists (consult before any deletion)

### 1. Dynamic-className allowlist (CSS)

The codebase builds classes with **plain string concatenation and template
literals — no `clsx`/`cx`/`classnames` helper exists.** Patterns found:

- Template literal: `` className={`${a.variable} ${b.variable}`} `` (fonts).
- Concatenation: `"playbook-marker playbook-marker--" + marker.color`,
  `base + " playbook-field__zone--c-" + zone.color`, `" is-" + row.state`,
  helper fns returning class strings (`zoneClass`, `playerClass`, `rowClass`,
  `dotClass`, `docClass`, `pagesClass`).

A class reachable only through such a construction is **alive**. The report
detects this by matching a class's dynamic prefix against a code token. Dynamic
prefixes currently in play (a class starting with one of these is alive):

```
admin-status--   cal-gather__glyph--   cal-kit-chip--   cal-shift__note--
cicon--   fc-day-   is-   pagedjs_   pbe__swatch--   pd-   playbook-
print-   profilemenu__dot--   quickadd__cov--   rl-block--   rl-node--
rl-pill--   rl-row--   runsheet__   star--   stockdot__opt--
```

### 2. Library CSS prefixes (applied by third parties, never in our JSX)

Classes matching these are alive even with zero code references — they are
emitted by libraries and we only theme them:

- `fc-`, `fc` — FullCalendar (grid, timegrid, daygrid, popover, scroller).
- `pagedjs`, `pagedjs_` — Paged.js print engine.
- `cl-`, `cl_` — Clerk components.

Encoded in `LIBRARY_PREFIXES` in `scripts/report-unused-css.mjs`.

### 3. depcheck dependency allowlist

- `@modelcontextprotocol/sdk`, `zod` — declared in **root** devDependencies but
  imported by `tools/camp-mcp/src/server.ts` (a nested package with an empty
  `package.json`). depcheck can't cross the nested-package boundary and reports
  them unused. **Keep them.** Ignored in `.depcheckrc.json`. (knip already sees
  them as used and does not flag them.)

### 4. knip / ts-prune false-positive guards for Phase 1

Before removing anything knip/ts-prune flags, exclude code that is reachable by
a means the tool can't see:

- **Next file conventions** — `default`/`metadata`/`viewport`/`dynamic`/`runtime`
  exports on `page`/`layout`/`route`/`error`/`not-found`; route handlers
  (`GET`/`POST`/…). knip handles these; ts-prune does not.
- **Tests** — symbols imported only by `*.test.ts` / `*.spec.ts`.
- **Dynamic `import()`** and string-referenced modules.
- **Public API by design** — a registry like `DOC_VALIDATORS` /`*Doc` in
  `lib/userDataDocs.ts` may keep exports for symmetry; verify intent, don't
  blindly strip.
- **`tools/camp-mcp/**`** is a separate project (ignored by knip); don't let its
  needs drive root deletions.

---

## Phase 1 — DONE

All detectors clean: `knip` 0 unused files/exports/types/deps; `depcheck` 0
unused (sdk+zod allowlisted) / 0 missing; `report:css` 0 dead selectors. Gates
green at every commit. Commits: dead CSS selectors; 7 scratch PNGs; unused
file + functions + orphaned CSS; unexport in-module symbols + dead re-exports.

Decisions worth remembering:

- **Kept on purpose (NOT dead):** the `schedule` / `schedulePlans` / `meals.v1`
  entries in `SCOPED_STORAGE_KEYS` (`lib/storageScope.ts`) are deliberately
  retained so historical localStorage plans keep following the account scope on
  disk — the code comment says so, and removing them would change migration
  behavior. Left untouched.
- `calendarViewRailOpen` / `calendarWeatherRailOpen` (brief-named) were already
  gone before this effort — nothing to remove.
- **Deferred (uncertain):** `public/documents/summertime-thrills-break-sheet*.pdf`
  have no import/grep reference in app/components/lib, but may be linked via a
  constructed `/documents/...` public path. Not deleted — needs a runtime check
  of the print/share download path before it's safe. See Deferred items.
- One-shot `scripts/remove-dead-css.mjs` (PostCSS rule stripper) was used then
  deleted. `scripts/report-unused-css.mjs` stays as a report-only detector.

## Phase 1 worklist (historical — dead-code candidates, all report-derived)

Verify each with a fresh detector run + grep before deleting; batch by domain,
gate after each batch.

- **Unused file**: `lib/calendar/nowNext.ts`.
- **Unused exports / types**: 77 + 26 from knip (de-export if used in-module;
  delete if fully dead). Cross-check with `npm run report:exports`.
- **Dead CSS clusters** (report-confirmed unreferenced, matching the brief's
  named removals):
  - `.caltoday*` — old Today card (fully dead).
  - `.cal-view*`, `.calhead__viewtrigger*` — removed calendar-rail View toggle.
  - `.campedit__*` **subset** — leftovers from the old inline camp editor;
    `CampEditorPopup.tsx` is alive and still uses `campedit__pills/__dash/__addbtn`
    etc., so delete only the report-flagged subset, not the namespace.
  - `.camprail__*` — old camps rail (verify vs `CampsRail.tsx` usage first).
  - `.material-filter__*` **subset** — old materials filter; `material-filter__clear`
    stays (used in `Filters.tsx`).
  - `.quickadd__more*`, `.quickadd__summary*`, `.quickadd__schedule` — old QuickAdd bits.
  - misc: `.admin-page`, `.sortbtn`, `.rlv-eyebrow`, `.kitlens__hintlink`,
    `.pbe__toggle`, `.pbe__top`, `.cal-chip__backup`, `.calshell__header`, etc.
- **Dead localStorage keys / prefs** from removed UI: `calendarViewRailOpen`,
  `calendarWeatherRailOpen` — grep and remove wherever still referenced.
- **Commented-out code, `if (false)` branches, permanently-on/off flags.**
- **Dead assets** — grep before deleting (some referenced by string / from docs).

---

## Phase 2 — CSS consolidation (split + guardrail done; deep fold DEFERRED)

**Done:**

- **Split the `globals.css` monolith** (10,798 lines) into 10 per-domain
  stylesheets by a pure line-based slice at the file's own section boundaries:
  `tokens · base · shell · components · responsive · animations · run-sheet ·
  motion · floating · print`, imported in that order in `app/layout.tsx`
  (then `calendar`, then `sidebar`). Byte-identical concat + every chunk parses
  = provably zero cascade change; the split script asserted both before writing.
- **Token gate extended** to all 10 files (+ calendar/sidebar/runsheet); baseline
  regenerated (349).
- **CSS-hygiene gate added** (`lint:css-hygiene`, `scripts/check-css-hygiene.mjs`)
  — a ratchet that fails on any NEW `!important` or NEW top-level duplicate
  selector, grandfathering the current 42 `!important` + 93 duplicate selectors.
  Wired into CI in Phase 7.

**CSS layering convention (for CONVENTIONS.md in Phase 6):**

- **Import order = cascade order** (`app/layout.tsx`). Layers, earliest→latest:
  tokens → base → shell → components → responsive → animations → run-sheet →
  motion → floating → print → calendar → sidebar.
- **Add a new rule to the file that owns its surface; never stack an override in
  a later file to counteract an earlier one.** If a base rule is wrong, change
  the base rule. `sidebar.css` loads last by design (its dark-green selection +
  popup layout intentionally win) — that is the one sanctioned late layer.
- **Every new color/space/radius/shadow/size is a token** (`--card`, `--line`,
  `--accent`, `--s-*`, `--r-*`, `--fs-*`, `--e*`). The token gate enforces it.
- Control chrome (white `--card` fill, 1.5px `--line` border, dark-green
  `--accent` selection, no sage) was consolidated in #106 — reuse those classes,
  don't restate the chrome per component.

**DEFERRED with reason — folding the 93 override-stacks + removing the 42
`!important`.** These change specificity/cascade *semantics*, and the only pixel
oracle is CI (no local visual on this Mac). On a 10k-line interleaved stylesheet
that is exactly the "redesign disguised as cleanup" the brief warns against, and
the control-chrome consolidation that motivated it already shipped in #106. The
hygiene gate now prevents the mess from growing; folding the existing stacks is a
safer follow-up done rule-by-rule with CI proving each one invisible. Left intact
per the stop-when-risk-grows rule.

---

## Phases 3–5 — reorg, boundaries, file size

- **Phase 3 (taxonomy) DONE.** `components/` grouped into activity/library/
  materials/camps/auth/ui/hooks (+ existing calendar/floating/print); `lib/`
  into activity/cloud/content/materials (+ existing calendar/print/seed/server).
  CampApp stays at the components root; auth.ts/types.ts/weather.ts at lib root.
  ~337 import specifiers rewritten by a style-preserving move-refactor codemod;
  git tracked every move as a rename. Module map in `docs/ARCHITECTURE.md`.
- **Phase 4 (decoupling) — boundaries DONE, God-object extraction DEFERRED.**
  `dependency-cruiser` (`lint:boundaries`) encodes the graph: no-circular,
  server-only isolation, library↔calendar separation, leaf features
  (materials/camps/auth) import no other feature. Broke the one runtime cycle
  (materialCatalog↔materials, via a `materialTag` leaf module).
- **Phase 5 (file size) — ratchet DONE, splits DEFERRED.** `lint:file-size`
  grandfathers the 20 files over 500 lines; the set can shrink but never grow,
  and new files must stay under 500.

## Deferred items

- **God-object / large-component splits (Phase 4 extraction + Phase 5).** The
  large `.tsx` surfaces — `CalendarShell` (6.3k), `ActivityRunList` (2.8k),
  `CampApp` (1.6k), `QuickAdd`, `PrintControls`, `PlaybookEditor`, `Filters`,
  `DetailSheet`, `ListManagerModal`, `RunSheetBody` — are cohesive feature
  surfaces whose split means extracting rendering/stateful logic. The only pixel
  oracle is CI (no local visual on this Mac), and the brief is explicit: "a
  deferred split with a written reason beats a broken calendar." These are left
  intact and should be split as **dedicated, CI-validated follow-ups**, one
  cohesive unit at a time (for `CalendarShell`: the rail, weather-chip injection,
  drag-create, series-scope dialogs, event-render callbacks). The file-size and
  boundary gates keep them from growing or re-coupling in the meantime.
- Large **pure-logic** files (`recurrence.ts` 1032, `runList.ts`, `inviteCodes.ts`,
  `shelfLayout.ts`, `playbooks.ts`) are cohesive single-purpose modules; per
  "no file gets split purely to satisfy the count," they stay as grandfathered
  exceptions rather than being fragmented.
- **`public/documents/summertime-thrills-break-sheet{,-bw,-color}.pdf`** — no
  static reference found (app/components/lib grep + import search all empty).
  Left in place because a print/share flow may build the URL as a runtime
  string (`/documents/...`). Before deleting, boot the app and check the
  run-sheet/print share download path; if nothing serves them, they are dead.
