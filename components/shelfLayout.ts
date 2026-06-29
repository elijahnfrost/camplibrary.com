// ============================================================================
// SHELF MODEL — the brain behind the leaning-books + stacks shelf look.
//
// The whole thing is three clean passes, in the order the user asked for:
//
//   1. GEOMETRY   — every book gets ONE intrinsic size {thickness, height},
//                   derived from its identity + title. This is the SINGLE
//                   source of truth. A book is the same book whether it
//                   stands, leans, or lies in a stack — only its orientation
//                   changes, never its size.
//
//   2. PLACEMENT  — walk the list and assign each book a ROLE (stand / lean /
//                   stacked) with sensible, deterministic rules (a leaner needs
//                   a taller support; stacks come in runs of 3–5; specials
//                   don't clump). No pixels here — just "what is this book
//                   doing on the shelf".
//
//   3. LAYOUT     — turn roles into exact coordinates. Physics lives here and
//                   is exact BY CONSTRUCTION: we place each book's contact edge
//                   ON its support (overlapping by one stroke so two borders
//                   merge into a single shared line). Nothing is eyeballed or
//                   "measured in the browser" after the fact.
//
// Everything is a pure function of the book id/title, so the shelf is stable
// across reloads. Pure (no React) — rendered by ShelfView in LibraryViews.tsx.
// ============================================================================

import type { Activity } from "@/lib/types";

// --- shared visual constants -------------------------------------------------
// ONE knob for the overall book size. Every size-driving number below (spine
// thickness, book height, title font, headroom, pile/foot caps) is run through
// SCALE, so the whole bookcase grows or shrinks proportionally from here. Stroke,
// radius and the shelf line stay put — a slight size bump shouldn't fatten the
// linework. Bump this to make the shelves read bigger.
export const SCALE = 1.18;
const sc = (n: number) => Math.round(n * SCALE); // scale + round a base px value

export const BW = 2; // stroke width; also the amount touching books overlap so
// their two borders merge into ONE shared line (Figma "centered stroke").
export const RADIUS = 3; // corner softening on all four corners
export const SHELF_LINE = 4; // thickness of the shelf the books rest on (books overlap its top by one stroke)
const OVERLAP = BW; // alias for readability at the call sites

const HEADROOM = sc(34); // empty air above the tallest book in the rail
const END_PAD = sc(14); // a little run-out past the last book

// the gentle wedge a leaning book leaves between its lifted foot and its
// support; we cap the lean angle so this can never blow out.
const MAX_FOOT_GAP = sc(9);

// =============================================================================
// 0. helpers
// =============================================================================

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// a stable 0..1 roll for a book + a named axis ("lean", "deg", …)
const roll = (a: Activity, axis: string) => (hash(a.id + ":" + axis) % 1000) / 1000;
const pick = (a: Activity, axis: string, lo: number, hi: number) => lo + Math.round(roll(a, axis) * (hi - lo));

const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// =============================================================================
// 1. GEOMETRY — one intrinsic size per book, the single source of truth.
// =============================================================================

export interface BookSize {
  thickness: number; // the spine (how wide the book reads when STANDING)
  height: number; // how tall the book is (its long dimension)
}

// Sizing rules, tuned with the user over many rounds:
//  • thickness: slim, cleanly varied — and SKEWED toward the thin end (the roll
//    is raised to a power), so most spines read narrow with the odd chunkier one,
//    never so thin the vertical title is cramped.
//  • height: driven by the TITLE (longer title → taller book, so the words
//    always have breathing room) plus a little deterministic head-room, then
//    clamped to a band with a TALL floor so no book reads stubby.
const MIN_THICK = sc(22);
const MAX_THICK = sc(41);
const THICK_BIAS = 1.7; // >1 pulls the distribution toward thinner spines
const MIN_HEIGHT = sc(104); // tall floor — short titles still stand a respectable height
const MAX_HEIGHT = sc(192);

// Long titles step down a font size so they still fit without a towering book.
// (The vertical handwriting face measures ~0.40·fontPx per character on screen.)
export function titleFontPx(a: Activity): number {
  const len = (a.title || "").trim().length;
  return len > 26 ? sc(11) : len > 20 ? sc(12) : sc(13);
}

export function sizeOf(a: Activity): BookSize {
  const thickness = MIN_THICK + Math.round(Math.pow(roll(a, "thick"), THICK_BIAS) * (MAX_THICK - MIN_THICK));
  const len = (a.title || "").trim().length;
  const font = titleFontPx(a);
  const textRun = len * font * 0.45; // room the vertical title needs (real ≈0.40·font), +breathing
  const headroom = sc(20) + Math.round(roll(a, "head") * sc(22)); // ~24–50px of cover above the words
  const height = clamp(Math.round(textRun + headroom), MIN_HEIGHT, MAX_HEIGHT);
  return { thickness, height };
}

// =============================================================================
// 2. PLACEMENT — assign each book a role. Pixels come later.
// =============================================================================

// A book resting against a pile, on one side of it.
export type StackLean = { book: Activity; side: "left" | "right" };
export type Slot =
  | { kind: "stand"; book: Activity }
  | { kind: "lean"; book: Activity; dir: "left" | "right" } // a lone leaner on a neighbour
  | { kind: "stack"; books: Activity[]; lean?: StackLean }
  // 1–2 flat books used as a BASE, with a small row of books standing/leaning ON
  // TOP that fills its width. leanIdx = which on-book leans right (-1 = none).
  | { kind: "perch"; base: Activity[]; on: Activity[]; leanIdx: number };

// can `b` physically rest against `support`? A leaner only leans on something at
// least as tall as itself — short books lean on tall ones, which reads natural
// and rules out a whole class of "leaning on nothing / clipping" cases up front.
const canSupport = (b: Activity, support: Activity) => sizeOf(support).height >= sizeOf(b).height - 4;

// how tall a pile of these books stands (sum of thicknesses, less the shared lines)
const pileHeightOf = (books: Activity[]) =>
  books.reduce((s, b) => s + sizeOf(b).thickness, 0) - Math.max(0, books.length - 1) * OVERLAP;

const STACK_MIN = 4; // books per pile
const STACK_MAX = 8;
const MAX_PILE_HEIGHT = sc(168); // trim a pile rather than let it tower over the shelf
// after a pile/perch, this many plain books must pass before the next one — so
// "specials" are spread along the shelf instead of clumping side-by-side.
const SPECIAL_GAP = 9;

export function planShelf(books: Activity[]): Slot[] {
  const n = books.length;
  const slots: Slot[] = [];
  let i = 0;
  let cooldown = 0; // run of plain books still owed before the next pile/perch

  while (i < n) {
    const b = books[i];

    // — books-on-a-base: ONE flat book is the platform, with ~3 books standing on
    //   top and ONE leaning on the side. The base book is laid to EXACTLY the width
    //   of that little group (see layout), so it fills cleanly — no odd gap, no
    //   overhang. The group is the SHORTEST book (the side-leaner) + the next few
    //   standing; we add a 4th only if the base's title needs the extra width. —
    if (cooldown === 0 && i >= 1 && roll(b, "perch") < 0.13) {
      // the on-group, shortest book first (it's the leaner).
      const groupFor = (k: number) => {
        const g = books.slice(i + 1, i + 1 + k);
        let minJ = 0;
        g.forEach((x, j) => {
          if (sizeOf(x).height < sizeOf(g[minJ]).height) minJ = j;
        });
        const on = [g[minJ], ...g.filter((_, j) => j !== minJ)];
        const reach = sizeOf(on[0]).height * Math.sin(rad(chooseLeanDeg(on[0])));
        const width = on.reduce((s, x) => s + sizeOf(x).thickness, 0) - (k - 1) * OVERLAP + reach;
        return { on, width };
      };
      const need = (b.title || "").trim().length * sc(6) + sc(10); // the base's own title must fit
      let chosen: { on: Activity[]; width: number } | null = null;
      for (let k = 3; k <= 4 && i + 1 + k <= n; k++) {
        chosen = groupFor(k);
        if (chosen.width >= need) break;
      }
      if (chosen && chosen.width >= need) {
        slots.push({ kind: "perch", base: [b], on: chosen.on, leanIdx: 0 });
        i += 1 + chosen.on.length;
        cooldown = SPECIAL_GAP;
        continue;
      }
      // base title too long for a small perch → fall through to a plain book
    }

    // — a stack of 4–8 of the SAME books, tipped over and piled. Occurrence is
    //   a plain per-book roll; a SPECIAL_GAP run of standing books between piles
    //   keeps spacing random WITHOUT letting stacks clump side-by-side. —
    const canStartStack = cooldown === 0 && i >= 1 && n - i >= STACK_MIN && roll(b, "stk") < 0.072;
    if (canStartStack) {
      let k = Math.min(pick(b, "stkN", STACK_MIN, STACK_MAX), n - i);
      // trim from the top until the pile no longer towers (never below the min)
      while (k > STACK_MIN && pileHeightOf(books.slice(i, i + k)) > MAX_PILE_HEIGHT) k--;
      const stackBooks = books.slice(i, i + k);

      // MOST piles get a book resting against them, on a RANDOM side, so leaning
      // happens "by stacks" often (and lone leaners cover the rest). The leaner is
      // a real neighbouring book (the one before the pile, or the one after it).
      let lean: StackLean | undefined;
      if (roll(b, "stkLean") < 0.75) {
        const ph = pileHeightOf(stackBooks);
        const fits = (x?: Activity) => !!x && ph >= sizeOf(x).height - 4; // pile tall enough to catch it
        const wantRight = roll(b, "stkSide") < 0.5;
        const prev = slots[slots.length - 1];
        const prevBook = prev && prev.kind === "stand" ? prev.book : undefined;
        const after = books[i + k];
        // prefer the rolled side, fall back to the other if it doesn't fit.
        if (!wantRight && fits(prevBook)) {
          lean = { book: prevBook!, side: "left" };
          slots.pop();
        } else if (wantRight && fits(after)) {
          lean = { book: after, side: "right" };
        } else if (fits(prevBook)) {
          lean = { book: prevBook!, side: "left" };
          slots.pop();
        } else if (fits(after)) {
          lean = { book: after, side: "right" };
        }
      }

      slots.push({ kind: "stack", books: stackBooks, lean });
      i += k + (lean && lean.side === "right" ? 1 : 0); // a right-side leaner consumes the next book
      cooldown = SPECIAL_GAP;
      continue;
    }

    // — a lone leaner away from any pile, random direction, only where a real
    //   support exists. Together with the stack-leaners above, leaning happens
    //   both by stacks (more often) and out on the open shelf. —
    if (cooldown === 0 && roll(b, "lean") < 0.16) {
      const wantRight = roll(b, "dir") < 0.5;
      const right = books[i + 1];
      const prevSlot = slots[slots.length - 1];
      if (wantRight && right && canSupport(b, right)) {
        // leans onto the NEXT book; cooldown forces that book to stay a stand.
        slots.push({ kind: "lean", book: b, dir: "right" });
        i += 1;
        cooldown = 2;
        continue;
      }
      if (!wantRight && prevSlot && prevSlot.kind === "stand" && canSupport(b, prevSlot.book)) {
        // leans back onto the book already placed to its left.
        slots.push({ kind: "lean", book: b, dir: "left" });
        i += 1;
        cooldown = 2;
        continue;
      }
      // wanted to lean but no valid support → fall through and just stand.
    }

    slots.push({ kind: "stand", book: b });
    i += 1;
    if (cooldown > 0) cooldown--;
  }

  return slots;
}

// =============================================================================
// 3. LAYOUT — roles → exact coordinates. This is the physics.
// =============================================================================

// A book lying flat in a stack is the SAME book rotated 90°: what was its
// height is now its horizontal LENGTH, what was its thickness is now its
// vertical thickness. Same numbers, just swapped axes.
export interface LaidBook {
  book: Activity;
  x: number; // left edge
  y: number; // how far its underside sits above the shelf line
  len: number; // = sizeOf(book).height
  thick: number; // = sizeOf(book).thickness
}

// `y` is how far a book's underside sits ABOVE the shelf line — 0 for a book on
// the shelf, > 0 for one perched on a base of laid books.
export type Placed =
  | { type: "stand"; book: Activity; x: number; w: number; h: number; y: number }
  | { type: "lean"; book: Activity; x: number; w: number; h: number; dir: "left" | "right"; deg: number; y: number }
  | { type: "laid"; book: Activity; x: number; y: number; w: number; h: number };

export interface ShelfLayout {
  placed: Placed[];
  width: number; // total scroll width
  height: number; // rail height (tallest extent + headroom)
}

// Choose a lean angle: gentle and varied, capped so the foot wedge stays small.
// We only ever lean on a support at least as tall as the book (enforced in the
// plan), so the contact always lands ON the support — no need to steepen, which
// keeps every lean subtle (the user's "less dramatic"). Taller books lean
// shallower so their wedge can't blow out.
function chooseLeanDeg(b: Activity): number {
  const want = pick(b, "deg", 4, 9); // gentle, with per-book variation
  const h = sizeOf(b).height;
  const footCap = Math.asin(clamp(MAX_FOOT_GAP / h, 0, 1)) * (180 / Math.PI); // h·sinθ ≤ MAX_FOOT_GAP
  return clamp(Math.min(want, footCap), 3, 9);
}

// Build a pile of laid books at a base x. A real "piled-on" stack TAPERS: the
// biggest book is the base and the rest sit within its footprint, smaller toward
// the top. So:
//   • The LONGEST book is the bottom — it defines a clean footprint [baseX,
//     baseX+W]. Because it spans the whole width, a neighbour (or trailing book)
//     butts the pile with NO gap at shelf level, and a pile can't look unsteady
//     (nothing overhangs its base).
//   • Every other book is INSET within that footprint by a deterministic, varied
//     amount — so the pile is casually staggered (favouring neither side) but
//     never pokes out past the base. Thicker books settle nearer the bottom.
// Books overlap vertically by one stroke so neighbours share a single line. Each
// laid book is the SAME book tipped 90°: its standing height is now the
// horizontal length, its thickness the vertical thickness.
// Order a pile: the LONGEST book is the base (bottom) so it defines a clean
// footprint, and the rest stack on top with thicker ones lower. Shared by every
// pile builder so they all taper the same way.
type PileItem = { b: Activity; sz: BookSize };
function pileOrder(books: Activity[]): PileItem[] {
  const items = books.map((b) => ({ b, sz: sizeOf(b) }));
  let baseI = 0;
  items.forEach((o, i) => {
    if (o.sz.height > items[baseI].sz.height) baseI = i;
  });
  return [items[baseI], ...items.filter((_, i) => i !== baseI).sort((p, q) => q.sz.thickness - p.sz.thickness)];
}

type Pile = { laid: LaidBook[]; height: number; left: number; right: number };
function buildPile(books: Activity[], baseX: number): Pile {
  const order = pileOrder(books);
  const W = order[0].sz.height; // footprint width = the base book's length
  let y = 0;
  const laid = order.map((o, j) => {
    const len = o.sz.height;
    const slack = Math.max(0, W - len);
    // centre-biased inset (≈18–82% of the slack) so upper books sit WITHIN the
    // base from both sides — a casually staggered pile, never edge-aligned.
    const inset = j === 0 ? 0 : Math.round(slack * (0.18 + roll(o.b, "inset") * 0.64));
    const item: LaidBook = { book: o.b, x: baseX + inset, y, len, thick: o.sz.thickness };
    y += o.sz.thickness - OVERLAP;
    return item;
  });
  return { laid, height: y + OVERLAP, left: baseX, right: baseX + W };
}

// Place ONE slot, starting its left edge at `startCursor`, pushing every book it
// resolves to into `placed`. Returns the cursor for the NEXT slot (already net of
// the shared-stroke overlap) and the tallest extent this slot reached. Pure of any
// absolute origin: place a slot at X and you get the same books as at 0, shifted
// by X — which is what lets wrapShelf measure a slot once and re-seat it per row.
function placeSlot(s: Slot, startCursor: number, placed: Placed[]): { cursor: number; top: number } {
  let cursor = startCursor;
  let maxTop = 0;
  const top = (t: number) => (maxTop = Math.max(maxTop, t));
  const pushPile = (p: Pile) =>
    p.laid.forEach((l) => placed.push({ type: "laid", book: l.book, x: l.x, y: l.y, w: l.len, h: l.thick }));

  {
    // ---- a plain standing book --------------------------------------------
    if (s.kind === "stand") {
      const { thickness: w, height: h } = sizeOf(s.book);
      placed.push({ type: "stand", book: s.book, x: cursor, w, h, y: 0 });
      top(h);
      cursor += w - OVERLAP;
      return { cursor, top: maxTop };
    }

    // ---- ~3 books standing on a flat base, ONE leaning on the side --------
    if (s.kind === "perch") {
      // lay the little group out in local coords (on[0] is the side-leaner).
      let lc = 0;
      let rowW = 0;
      const local = s.on.map((bk, idx) => {
        const { thickness: w, height: h } = sizeOf(bk);
        const lean = idx === s.leanIdx;
        const deg = lean ? chooseLeanDeg(bk) : 0;
        const o = { bk, x: lc, w, h, lean, deg };
        lc += (lean ? w + h * Math.sin(rad(deg)) : w) - OVERLAP; // a leaner pushes its support out by its reach
        rowW = Math.max(rowW, o.x + w);
        return o;
      });

      // lay the 1–2 base books, EACH stretched to the group's width and stacked
      // (overlapping by one stroke). Every base book spans the full width, so the
      // top surface is solid under the group — fills cleanly, nothing floats.
      let by = 0;
      s.base.forEach((bk) => {
        const thick = sizeOf(bk).thickness;
        placed.push({ type: "laid", book: bk, x: cursor, y: by, w: rowW, h: thick });
        by += thick - OVERLAP;
      });
      const elev = by; // top of the base pile, less one stroke = where the group seats
      local.forEach((it) => {
        if (it.lean) {
          // A tilted book seats its low corner ON the base's top line, not one
          // stroke INTO it: a flat book's whole edge merges cleanly, but a tilted
          // one would dip that corner below the line and its FIELD would overlap
          // the base. Lifting it by one stroke keeps the borders sharing the line
          // while no book field crosses into another.
          placed.push({ type: "lean", book: it.bk, x: cursor + it.x, w: it.w, h: it.h, dir: "right", deg: it.deg, y: elev + OVERLAP });
        } else {
          placed.push({ type: "stand", book: it.bk, x: cursor + it.x, w: it.w, h: it.h, y: elev });
        }
        top(elev + it.h);
      });
      cursor = cursor + rowW - OVERLAP;
      return { cursor, top: maxTop };
    }

    // ---- a stack of books laid flat (optionally with a book resting on it) --
    if (s.kind === "stack") {
      const lean = s.lean;

      // A leaner resting against a pile. The pile is built EXACTLY like a plain
      // one — naturally, casually staggered — and the LEANER adapts to it: it tips
      // until its inner face meets the SINGLE most-protruding book on its side,
      // while every other book recesses behind it (a natural gap, never a
      // staircase). So the stack's randomness decides where the leaner comes to
      // rest, not the other way around. The angle stays gentle; only the foot is
      // derived. The contact is seated one stroke deep, so the two borders merge
      // into a single shared line and no book FIELD overlaps another.
      if (lean) {
        const { thickness: lw, height: lh } = sizeOf(lean.book);
        const deg = chooseLeanDeg(lean.book);
        const tan = Math.tan(rad(deg));
        const cosD = Math.cos(rad(deg));
        const hReach = lh * cosD; // the inner face only exists up to here

        if (lean.side === "right") {
          // leaner on the RIGHT, leaning LEFT onto the pile. Build the pile at the
          // cursor; its base's left edge is the slot's left edge. The foot sits
          // just right of the pile and the inner (left) face rises up-left along
          // x = foot − u·tan; seat it so that line meets the book whose top-near
          // corner protrudes furthest along it (max), one stroke deep.
          const pile = buildPile(s.books, cursor);
          pushPile(pile);
          let foot = -Infinity;
          pile.laid.forEach((l) => {
            const u = Math.min(l.y + l.thick, hReach); // corner height, capped to the face
            foot = Math.max(foot, l.x + l.len + u * tan);
          });
          foot -= OVERLAP;
          placed.push({ type: "lean", book: lean.book, x: foot, w: lw, h: lh, dir: "left", deg, y: 0 });
          top(Math.max(lh, pile.height));
          // the next book TOUCHES the leaner's lifted bottom corner (no stroke
          // overlap): a tilted edge can't share a clean line with a straight one,
          // so overlapping would poke the corner past its rounded neighbour.
          cursor = foot + lw * cosD;
          return { cursor, top: maxTop };
        }

        // leaner on the LEFT, leaning RIGHT onto the pile. Build the pile in local
        // coords, derive the foot, then shift the whole unit so the leaner's
        // leftmost painted edge lands on the cursor. The inner (right) face rises
        // up-right along x = foot + u·tan; seat it against the book whose top-near
        // (left) corner is furthest along it (min), one stroke deep.
        const pile = buildPile(s.books, 0);
        let foot = Infinity;
        pile.laid.forEach((l) => {
          const u = Math.min(l.y + l.thick, hReach);
          foot = Math.min(foot, l.x - u * tan);
        });
        foot += OVERLAP;
        // the leaner's lifted bottom corner TOUCHES the previous book (no stroke
        // overlap — its tilted edge would otherwise poke past the neighbour).
        const shift = cursor + OVERLAP - (foot - lw * cosD); // leaner's leftmost edge → prev's right edge
        pile.laid.forEach((l) =>
          placed.push({ type: "laid", book: l.book, x: l.x + shift, y: l.y, w: l.len, h: l.thick })
        );
        placed.push({ type: "lean", book: lean.book, x: foot - lw + shift, w: lw, h: lh, dir: "right", deg, y: 0 });
        top(Math.max(lh, pile.height));
        cursor = pile.right + shift - OVERLAP;
        return { cursor, top: maxTop };
      }

      // a plain pile, no leaner
      const pile = buildPile(s.books, cursor);
      pushPile(pile);
      top(pile.height);
      cursor = pile.right - OVERLAP;
      return { cursor, top: maxTop };
    }

    // ---- a lone leaning book resting on a neighbour ------------------------
    const b = s.book;
    const { thickness: w, height: h } = sizeOf(b);

    if (s.dir === "right") {
      // rests on the NEXT standing book (the plan guarantees one follows, ≥ h tall).
      const deg = chooseLeanDeg(b);
      const reach = h * Math.sin(rad(deg)); // how far the top-right corner extends right
      // foot TOUCHES the previous book (no stroke overlap): the leaner's lifted
      // bottom-left corner would otherwise poke past its straight neighbour.
      const xBox = cursor + OVERLAP;
      placed.push({ type: "lean", book: b, x: xBox, w, h, dir: "right", deg, y: 0 });
      top(h);
      // the support's left edge lands on the leaner's contact, overlapping by one
      // stroke — fine, the support is drawn on top and covers the seam cleanly.
      cursor = xBox + w + reach - OVERLAP;
      return { cursor, top: maxTop };
    }

    // dir === "left": rests BACK onto the book already placed to its left.
    const prev = placed[placed.length - 1];
    const prevRight = prev ? prev.x + prev.w : cursor;
    const deg = chooseLeanDeg(b);
    const reach = h * Math.sin(rad(deg)); // top-left corner extends this far left
    const xBox = prevRight + reach; // top-left contact TOUCHES prev's right edge (point contact, no field poke)
    placed.push({ type: "lean", book: b, x: xBox, w, h, dir: "left", deg, y: 0 });
    top(h);
    // the next book TOUCHES the leaner's lifted bottom-right corner (no overlap).
    cursor = xBox + w * Math.cos(rad(deg));
    return { cursor, top: maxTop };
  }
}

// Walk the slots in ONE row from x = 0, painting each book. The width/height are
// the row's own extent (the rail is sized to its tallest book + headroom).
export function layoutShelf(slots: Slot[]): ShelfLayout {
  const placed: Placed[] = [];
  let cursor = 0; // x where the next slot's left edge goes
  let maxTop = 0;
  for (const s of slots) {
    const r = placeSlot(s, cursor, placed);
    cursor = r.cursor;
    maxTop = Math.max(maxTop, r.top);
  }
  return {
    placed,
    width: Math.ceil(cursor + OVERLAP + END_PAD),
    height: Math.ceil(maxTop + HEADROOM + SHELF_LINE),
  };
}

// =============================================================================
// 4. WRAP — flow the slots across as many shelves as it takes to fit `maxWidth`.
//    The single long rail (which used to scroll horizontally) becomes a stack of
//    full-width shelves, books spilling onto the next plank once a row is full.
// =============================================================================

// A lone leaner rests on a real neighbour, so the two can't be split across a
// row break: bind a right-leaner to the stand that follows it, and a stand to the
// left-leaner that rests back on it. Everything else (stands, stacks, perches —
// which already fold their own leaner inside the slot) is its own atomic unit.
function unitize(slots: Slot[]): Slot[][] {
  const units: Slot[][] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const next = slots[i + 1];
    if (s.kind === "lean" && s.dir === "right" && next) {
      units.push([s, next]); // leaner + the support it tips onto
      i++;
    } else if (next && next.kind === "lean" && next.dir === "left") {
      units.push([s, next]); // support + the leaner resting back on it
      i++;
    } else {
      units.push([s]);
    }
  }
  return units;
}

// Lay a unit at x = 0 in a scratch buffer to learn two numbers, both independent
// of where it actually lands: `advance` (how far it moves the cursor) and `right`
// (its rightmost painted edge). That's all wrapShelf needs to decide row breaks.
function measureUnit(unit: Slot[]): { advance: number; right: number } {
  const scratch: Placed[] = [];
  let cursor = 0;
  for (const s of unit) cursor = placeSlot(s, cursor, scratch).cursor;
  const right = scratch.reduce((m, p) => Math.max(m, p.x + p.w), 0);
  return { advance: cursor, right };
}

// a stack/perch is a "special" — wide, visually heavy. unitize keeps each as its
// own single-slot unit.
const isSpecialUnit = (u: { slots: Slot[] }) => u.slots[0].kind === "stack" || u.slots[0].kind === "perch";
// a stable id for a unit (for deterministic per-unit jitter).
function unitLeadId(u: { slots: Slot[] }): string {
  const s = u.slots[0];
  if (s.kind === "stack") return s.books[0]?.id ?? "";
  if (s.kind === "perch") return s.base[0]?.id ?? "";
  return s.book.id;
}

export function wrapShelf(slots: Slot[], maxWidth: number): ShelfLayout[] {
  // measure every unit once (advance + rightmost edge, both origin-independent).
  const units = unitize(slots).map((u) => ({ slots: u, m: measureUnit(u) }));
  const used: boolean[] = new Array(units.length).fill(false);
  const rowsK: number[][] = []; // each row as a list of unit indices (reordered before paint)
  let remaining = units.length;

  // Pack each shelf END-TO-END. The naïve "break the moment the NEXT unit won't
  // fit" leaves ragged gaps whenever that next unit is a wide one (a stack/perch)
  // — exactly the eyesore we're fixing. Instead: open a row with the earliest
  // unplaced unit, then sweep the REST in order and take every unit that still
  // fits the leftover space. A unit too wide for the tail is simply skipped (it
  // opens a later row); the thinner books behind it slide forward to close the
  // gap, so the shelf fills flush to the end. Only the final shelf is left short.
  while (remaining > 0) {
    const ks: number[] = [];
    let cursor = 0; // x where the next unit would start on this row
    const place = (k: number) => {
      ks.push(k);
      cursor += units[k].m.advance; // advance already nets the shared-stroke overlap
      used[k] = true;
      remaining -= 1;
    };

    // open with the earliest unplaced unit (preserves reading order; an oversize
    // unit still gets its own row to open).
    const start = used.indexOf(false);
    place(start);

    // fill the tail with the earliest-in-order units that still fit.
    for (let j = start + 1; j < units.length; j++) {
      if (used[j]) continue;
      if (cursor + units[j].m.right + END_PAD <= maxWidth) place(j);
    }

    rowsK.push(ks);
  }

  // De-cluster the specials. A stack/perch is wide, so the packer keeps bumping it
  // to the START of the next row (they line up dead at x = 0 down the left edge —
  // "every shelf opens with a stack"), and second stacks tend to settle at one
  // similar mid-row depth too. Fix: keep each special near its NATURAL plain-depth
  // (that natural spread is what varies first-stacks well) but nudge it by a small
  // per-stack hash jitter — so same-depth stacks scatter apart — with a floor of
  // ≥1 plain so a row never opens with a stack. Reordering WITHIN a row preserves
  // its total width, so every unit still fits and the right-edge justify holds.
  for (const ks of rowsK) {
    const plains: number[] = [];
    const specials: { k: number; at: number; depth: number }[] = [];
    for (const k of ks) {
      if (isSpecialUnit(units[k])) specials.push({ k, at: plains.length, depth: 0 });
      else plains.push(k);
    }
    if (!specials.length) continue;
    const taken = new Set<number>();
    for (const sp of specials) {
      const h = hash(unitLeadId(units[sp.k]));
      // A "leader" the packer parked at the row start (natural depth 0) can only
      // move right, so give it a WIDE hash depth (1–8) — otherwise leaders bunch
      // shallow on the left. A stack already mid-row keeps its natural depth ±
      // a small jitter, which scatters same-depth second-stacks apart.
      let d = sp.at === 0 ? 1 + (h % 8) : sp.at + ((h % 6) - 2);
      d = Math.max(1, Math.min(plains.length, d)); // ≥1 plain in front (never opens the row)
      while (taken.has(d) && d < plains.length) d++;
      while (taken.has(d) && d > 1) d--;
      taken.add(d);
      sp.depth = d;
    }
    specials.sort((a, b) => a.depth - b.depth);
    const out: number[] = [];
    let si = 0;
    for (let p = 0; p <= plains.length; p++) {
      while (si < specials.length && specials[si].depth === p) out.push(specials[si++].k);
      if (p < plains.length) out.push(plains[p]);
    }
    while (si < specials.length) out.push(specials[si++].k);
    ks.length = 0;
    ks.push(...out);
  }

  // Justify every full row so its books reach the right edge (no ragged empty
  // run-out). We uniformly scale each book's x AND width by one factor, so the
  // shared-stroke overlaps (and the lean contacts) stay merged exactly — books
  // just read a hair wider on a sparser row. The final short row is left natural.
  return rowsK.map((ks) => justifyRow(layoutShelf(ks.flatMap((k) => units[k].slots)), maxWidth));
}

// rightmost painted edge of a placed book, accounting for a leaner's rotation.
function paintedRight(p: Placed): number {
  if (p.type === "lean") {
    const r = rad(p.deg);
    return p.dir === "right" ? p.x + p.w * Math.cos(r) + p.h * Math.sin(r) : p.x + p.w * Math.cos(r);
  }
  return p.x + p.w;
}

function justifyRow(layout: ShelfLayout, maxWidth: number): ShelfLayout {
  if (!layout.placed.length) return layout;
  const contentRight = Math.max(...layout.placed.map(paintedRight));
  if (contentRight <= 0) return layout;
  const k = (maxWidth - BW) / contentRight; // rightmost book reaches the shelf edge (one stroke shy)
  // only stretch rows that are already near-full: never shrink (k≤1), and never
  // blow up the sparse final row into oversized books (k capped).
  if (k <= 1.001 || k > 1.18) return layout;
  layout.placed.forEach((p) => {
    p.x *= k;
    p.w *= k;
  });
  layout.width = maxWidth;
  return layout;
}
