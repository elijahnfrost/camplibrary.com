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

## Phase 1 worklist (dead-code candidates, all report-derived)

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

## Phase 2 inputs (CSS consolidation — captured now, acted on later)

- **78 class selectors are defined in more than one stylesheet** across
  `globals.css` / `calendar.css` / `sidebar.css` — the override-stacking /
  duplicate-definition smell. Examples: `.is-on` (3 files), `.ledger__label`
  (3), `.prop-row` (3), `.is-open` (3), `.cselect`, `.typepick*`, `.manager__*`,
  `.matkit__*`, `.material-filter__*`, `.sidesection__title`. These are the
  "one source of truth per concern" violations to fold into base rules.
- Regenerate the current cross-file duplicate list with the snippet in the
  Phase 0 log (extend `report:css` with a `--dupes` mode when Phase 2 starts).

---

## Deferred items

_(none yet — append here with a reason whenever a split/decouple is left intact
per the stop-when-risky rule.)_
