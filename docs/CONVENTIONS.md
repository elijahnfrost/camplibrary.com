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
