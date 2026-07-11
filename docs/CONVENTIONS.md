# Conventions

How to add code here without re-introducing the mess the structural cleanup
removed. The gates below are enforced in CI — treat them as the spec, not advice.

## Where new code goes

Guess from the domain and you'll be right (see `docs/ARCHITECTURE.md` for the
full map):

- A **component** goes in `components/<feature>/` — `activity`, `library`,
  `materials`, `camps`, `auth`, `calendar`, `print`. A shared primitive
  (Modal, icons, a generic control) goes in `components/ui/`; a shared hook in
  `components/hooks/`; a portaled floating control in `components/floating/`.
- A **utility / model** goes in `lib/<domain>/` — `activity`, `cloud` (storage +
  sync), `content` (data/themes/locations/camps/color), `materials`, `calendar`,
  `print`. Server-only code goes in `lib/server/`. Cross-cutting singletons
  (`auth.ts`, `types.ts`, `weather.ts`) stay at the `lib/` root.
- A **route** is `app/**/{page,layout,route}.tsx`. A new API path must also be
  added to the `clerkMiddleware` matcher in `proxy.ts`.
- Colocate a module's `*.test.ts` next to it. Reserve `index.ts` for a genuinely
  public module surface; **avoid barrel files** (they hide coupling and defeat
  tree-shaking).

## Add a feature without coupling

1. Put the feature's components under its own `components/<feature>/` folder.
2. Depend **downward** only: features may use `ui/`, `hooks/`, `floating/`, and
   `lib/*`. A feature must not import another feature's internals — extract a
   shared piece to `ui/` or `lib/` instead. `dependency-cruiser` enforces this;
   `library` and `calendar` in particular must never import each other, and
   `materials`/`camps`/`auth` are leaf features that import no other feature.
3. Reach cross-cutting concerns through their one home: **storage/sync** through
   `lib/cloud/` (localStorage `store`, `cloudStore`, `cloudOutbox`), **auth** through
   `lib/auth.ts` + Clerk, **server data** through `lib/server/` (never imported by
   a client component's runtime — types only).
4. Run `npm run lint:boundaries` — it must stay green.
5. **Type every cross-boundary data bag at its single source**, so writer and
   readers can't silently drift. A loose `Record`/`extendedProps`/`any` handed
   across a seam is where "I added a field and forgot to wire the other side"
   bugs live. Declare one exported interface next to the writer, verify the
   writer with `satisfies` (zero runtime cost, no widening), and give readers a
   typed accessor. Exemplar: the calendar event contract in
   `lib/calendar/adapter.ts` — `CalEventExtendedProps` + `calEventProps()` /
   `eventBgKind()`. To add a card affordance you add ONE field there; the adapter
   is then compile-forced to produce it and the renderer reads it typed.
6. **Keep decision/transform logic in `lib` (pure + unit-tested); keep the
   component a thin wrapper.** The only behavioral safety net that runs locally is
   the unit suite, and it can only test pure functions — a stateful component is
   covered only by the CI *pixel* oracle, which sees appearance, not behavior. So
   a state mutation belongs in a `(input) => output` function in `lib` with a
   colocated test; the component wrapper just supplies the side effects (commit /
   focus / undo / open-close) around it. Exemplar: `lib/activity/runDocOps.ts`
   (pure `RunDoc` edits, tested) vs. the ActivityRunList wrappers that add the
   undo snapshot and caret focus. This is why `lib/` is the healthy, low-fragility
   layer — grow it, and the components shrink toward wiring.

## CSS

- **Add a rule to the layer that owns the surface; never stack a later override
  to counteract an earlier rule.** If a base rule is wrong, change the base rule.
  Layers load in this cascade order (in `app/layout.tsx`): `tokens → base → shell
  → components → responsive → animations → run-sheet → motion → floating → print
  → calendar → sidebar`. `sidebar.css` is the one sanctioned late layer (its
  selection + popup rules intentionally win).
- **Every color, space, radius, shadow, and size is a token** (`--card`, `--line`,
  `--accent`, `--s-*`, `--r-*`, `--fs-*`, `--e*`). `npm run lint:design-tokens`
  fails on a hardcoded off-scale value.
- **No new `!important`, no new duplicate top-level selector.** `npm run
  lint:css-hygiene` ratchets both down. If you're reaching for `!important`, the
  base rule is in the wrong layer — move it.
- Control chrome (white `--card` fill, 1.5px `--line` border, dark-green
  `--accent` selection, no sage) is shared — reuse the control classes, don't
  restate the chrome per component.

## Naming & size

- Components `PascalCase.tsx`, utilities/hooks `camelCase.ts`, hooks start with
  `use`. Colocate a component's file, styles, tests, and local hooks.
- **500-line guideline.** `npm run lint:file-size` fails on a new file over 500
  lines or a grandfathered one that grows. The number is a proxy for "one file,
  one concern" — a cohesive module may stay large with a recorded reason; never
  split purely to hit the count.

## Dead code

Anything unreachable from a route, component tree, test, or documented public API
is deleted, not commented out (git is the archive). `npm run report:deadcode`
(knip), `report:deps` (depcheck), and `report:css` must report zero. Unused
imports and locals are caught at the file level too: `tsconfig` sets
`noUnusedLocals`, so `npm run typecheck` fails on a dead import or unread local
(prefix an intentionally-unread binding with `_`, or drop the value half of a
set-only `useState`: `const [, setX] = useState(...)`).

## Tests

Three layers, each catching what the others can't:

- **Pure logic → `*.test.ts`, colocated.** Vitest runs these in the fast `node`
  environment (the default). This is where most coverage lives and belongs — see
  point 6 under *Add a feature without coupling*: push logic into `lib` and test
  it here.
- **Component / hook behavior → `*.test.tsx`.** Put `// @vitest-environment
  happy-dom` at the very top of the file (the node suites stay node — they don't
  pay for a DOM) and use `@testing-library/react`: `render(<C .../>)` +
  `container.querySelector`/`screen` for a component, `renderHook(() => useX())` +
  `act` for a hook. Assert *behavior* (what the user sees / the returned state),
  never internals. Exemplars: `components/calendar/EventCardContent.test.tsx`
  (which badges render for which flags) and `components/hooks/useLibraryFilters.test.tsx`
  (the duration-bounds math). Add `@testing-library/user-event` when you need
  real click/type interaction.
- **Appearance → the Playwright visual suite** (below) — the pixel oracle. It
  catches *how it looks*; the `.test.tsx` layer catches *how it behaves*. A
  stateful component with no `.test.tsx` has no behavioral net at all.

## The gates (all run in CI)

```bash
npm run typecheck && npm run test && npm run build
npm run lint:design-tokens && npm run lint:css-hygiene
npm run lint:boundaries && npm run lint:file-size
npm run report:deadcode        # knip: unused files/exports/deps
```

The Playwright visual suite (`npm run test:visual`) is the **pixel oracle** and
runs on the macOS CI runner against committed baselines. It is not meaningful on
a dev machine (font rasterizer differs). A deliberate visual change means
regenerating the baselines on CI — never hand-editing an override to force pixels.
