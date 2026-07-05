// The ONE run-sheet renderer, shared by the Print tab's PrintRunSheet (the
// `pd-` class vocabulary, styled on screen AND print) and the public token-gated
// RunSheetView (`runsheet__` classes, runsheet.css). They used to be two parallel
// walks of the RunDoc that drifted (different facts, diagram clamp); this is the
// single source so a new block type or fact lands in both at once. The SVG
// diagram (ActivityPlaybook) was already shared; now the whole body is.
//
// This is also the READ path's content model: it now renders the SAME resolved
// RunDoc the in-app read view (ActivityRunList editable={false}) shows — the
// `details` block's tags (falling back to detailTagsForActivity only when the
// block carries none), field notes, and per-block icon/colour — so a hand-edit
// made in the editor (a detail tag, a field note, a recoloured block) actually
// reaches print and the public link instead of being silently regenerated away.

import type { CSSProperties, ElementType, FC, ReactNode } from "react";
import { ageSpan, code, durLabel, ENERGY, groupLabel } from "@/lib/content/data";
import { coverage, materialNeedsForActivity } from "@/lib/materials/materials";
import { catalogNameFor, type Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import {
  defaultRunIcon,
  detailTagsForActivity,
  RUN_COLOR_TOKEN,
  type RunBlock,
  type RunChild,
  type RunColor,
  type RunDetailTag,
  type RunDoc,
  type RunIcon,
} from "@/lib/activity/runList";
import type { Activity } from "@/lib/types";
import { CampIcon } from "../ui/icons";
import { ActivityPlaybook } from "./ActivityPlaybook";

export type RunSheetVariant = "print" | "web";

const CHILD_LABEL: Record<RunChild["type"], string> = {
  note: "Note",
  safety: "Safety",
  video: "Media",
  variation: "Variation",
  fieldnote: "Field note",
  substep: "Sub-step",
  diagram: "Diagram",
  materials: "Materials",
};

type IconCmp = FC<{ className?: string }>;

// The glyph a block/child wears — mirrors ActivityRunList's decoNode: an
// explicit icon override wins, else the type's default glyph.
const RUN_ICON_CMP: Record<RunIcon, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  tip: CampIcon.Variation,
  bell: CampIcon.Bell,
  star: CampIcon.Star,
  flag: CampIcon.Flag,
};
const NODE_ICON: Record<string, IconCmp> = {
  note: CampIcon.Note,
  safety: CampIcon.Shield,
  video: CampIcon.Video,
  variation: CampIcon.Variation,
  fieldnote: CampIcon.Flag,
  substep: CampIcon.SubStep,
  diagram: CampIcon.Deck,
  materials: CampIcon.Card,
  details: CampIcon.Card,
};
const DETAIL_TAG_ICON: Record<string, IconCmp> = {
  pin: CampIcon.Pin,
  users: CampIcon.Users,
  clock: CampIcon.Clock,
  type: CampIcon.Tag,
  energy: CampIcon.Bolt,
  prep: CampIcon.Tool,
  rating: CampIcon.Star,
};

// The two presentational vocabularies. Structure is identical; only class names,
// the title/heading element levels, and whether media links are anchors differ.
const VARIANTS = {
  print: {
    root: "pd-runsheet",
    head: "pd-runsheet__head",
    kicker: "pd-kicker",
    title: "pd-runsheet__title",
    titleTag: "h2" as ElementType,
    blurb: "pd-runsheet__blurb",
    aka: "pd-runsheet__aka",
    facts: "pd-facts pd-facts--grid",
    fact: "pd-fact",
    list: "pd-run-list",
    heading: "pd-run-heading",
    headingTag: "h3" as ElementType,
    step: "pd-step",
    stepMain: "pd-step__main",
    cue: "pd-step__cue",
    noteBase: "pd-run-note",
    childBase: "pd-child",
    diagramChild: "pd-child pd-playbook",
    chips: "pd-chips",
    muted: "",
    empty: "pd-empty",
    detailtags: "rl-detailtags",
    detailtag: "rl-detailtag",
    fndate: "rl-fndate",
    linkVideos: false,
  },
  web: {
    root: "runsheet",
    head: "runsheet__header",
    kicker: "runsheet__kicker",
    title: "runsheet__title",
    titleTag: "h1" as ElementType,
    blurb: "runsheet__blurb",
    aka: "runsheet__aka",
    facts: "runsheet__facts",
    fact: "runsheet__fact",
    list: "runsheet__list",
    heading: "runsheet__heading",
    headingTag: "h2" as ElementType,
    step: "runsheet__step",
    stepMain: "runsheet__step-main",
    cue: "runsheet__cue",
    noteBase: "runsheet__block",
    childBase: "runsheet__detail",
    diagramChild: "runsheet__detail runsheet__detail--diagram",
    chips: "runsheet__chips",
    muted: "runsheet__muted",
    empty: "runsheet__muted",
    detailtags: "rl-detailtags",
    detailtag: "rl-detailtag",
    fndate: "rl-fndate",
    linkVideos: true,
  },
} as const;

type Vars = (typeof VARIANTS)[RunSheetVariant];

// "Jun 23 · 2:05 PM" from a local "YYYY-MM-DDTHH:mm" (mirrors ActivityRunList's
// formatStamp — kept local since this module has no other date-formatting need).
function formatStamp(at: string): string {
  const [datePart, timePart] = at.split("T");
  const d = new Date(datePart + "T00:00:00");
  if (Number.isNaN(d.getTime())) return at;
  const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!timePart) return dateLabel;
  const [h, m] = timePart.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return dateLabel;
  const t = new Date();
  t.setHours(h, m, 0, 0);
  const timeLabel = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return dateLabel + " · " + timeLabel;
}

// The presentation node (icon + optional colour tint) a text-ish block/child
// wears — matches ActivityRunList's decoNode look, minus the click-to-pick
// interaction (this is a read-only renderer). Falls back to the type's default
// icon (note/safety/tip) exactly like defaultRunIcon.
function DecoIcon({ type, icon, color }: { type: string; icon?: RunIcon; color?: RunColor }) {
  const Glyph =
    RUN_ICON_CMP[icon ?? defaultRunIcon(type as Parameters<typeof defaultRunIcon>[0])] ??
    NODE_ICON[type] ??
    CampIcon.Note;
  const tinted = !!color && color !== "none";
  const style = tinted ? ({ color: RUN_COLOR_TOKEN[color] } as CSSProperties) : undefined;
  return (
    <span className="rl-node--type rl-node--mini" style={style} aria-hidden="true">
      <Glyph />
    </span>
  );
}

// ---- Materials — a STATIC read of the same 3-state stock lens the in-app
// checklist uses (MaterialChecklist in ActivityRunList.tsx), without its bloom
// dot (a printed or public page can't act on stock). Renders the coverage pill
// and per-row have/low/out state, so a printed sheet or shared link shows the
// SAME availability signal staff see in-app, not just bare item names.
// `kitStock` is optional: a caller that hasn't threaded it through just gets
// the canonical, un-decorated list. (Per-day materialSubs decoration was
// removed with the Swap/Skip feature — the event field is legacy, see
// lib/calendar/types.ts.)
function MaterialsList({
  activity,
  c,
  kitStock,
  materialCatalog,
}: {
  activity: Activity;
  c: Vars;
  kitStock?: Record<string, StockState>;
  materialCatalog?: Material[];
}) {
  const needs = materialNeedsForActivity(activity, materialCatalog);
  if (!needs.length) return <p className={c.muted || undefined}>None needed.</p>;

  const stock = kitStock ?? {};
  const unset = Object.keys(stock).length === 0;
  const cov = unset
    ? null
    : coverage(
        { materialRefs: needs.map((n) => ({ id: n.id })) } as Activity,
        stock,
        materialCatalog
      );
  const viaById = new Map<string, string>();
  cov?.substituted.forEach((s) => viaById.set(s.id, s.viaId));

  const pill = unset
    ? null
    : cov!.state === "ready"
      ? "Ready"
      : cov!.missing.length + " missing";

  return (
    <div className="matkit matkit--static">
      {pill && (
        <div className="matkit__bar">
          <span
            className={
              "matkit__pill" +
              (cov!.state === "ready"
                ? " matkit__pill--ready" + (cov!.lowCount ? " matkit__pill--low" : "")
                : cov!.state === "almost"
                  ? " matkit__pill--almost"
                  : " matkit__pill--cant")
            }
          >
            {pill}
          </span>
        </div>
      )}
      <div className="matkit__list">
        {needs.map((n) => {
          const viaId = viaById.get(n.id);
          const own = stock[n.id];
          const state: StockState | "via" = viaId ? "via" : own ?? "out";
          const viaName = viaId ? catalogNameFor(materialCatalog, viaId) : "";
          const rowClass = unset
            ? ""
            : state === "have" || state === "via"
              ? " is-have"
              : state === "low"
                ? " is-low"
                : " is-out";
          return (
            <div key={n.id} className="matkit__rowline">
              <div className={"matkit__item" + rowClass} aria-hidden={false}>
                <span className="matkit__check" aria-hidden="true">
                  {!unset && (state === "have" || state === "via") && <CampIcon.Check />}
                  {!unset && state === "low" && <CampIcon.Minus />}
                  {!unset && state === "out" && <CampIcon.Close />}
                </span>
                <span className="matkit__name">{n.label}</span>
                {!unset && state === "via" && (
                  <span className="matkit__via">
                    <CampIcon.Repeat />
                    via {viaName}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailTags({ tags, c }: { tags: RunDetailTag[]; c: Vars }) {
  if (!tags.length) return null;
  return (
    <div className={c.detailtags}>
      {tags.map((tag) => {
        const Icon = tag.icon ? DETAIL_TAG_ICON[tag.icon] : null;
        return (
          <span className={c.detailtag} key={tag.id}>
            {Icon ? <Icon /> : null}
            {tag.label}
          </span>
        );
      })}
    </div>
  );
}

function RunChildView({
  child,
  activity,
  c,
  kitStock,
  materialCatalog,
}: {
  child: RunChild;
  activity: Activity;
  c: Vars;
  kitStock?: Record<string, StockState>;
  materialCatalog?: Material[];
}) {
  if (child.type === "materials") {
    return (
      <div className={c.childBase}>
        <h4>Materials</h4>
        <MaterialsList
          activity={activity}
          c={c}
          kitStock={kitStock}
          materialCatalog={materialCatalog}
        />
      </div>
    );
  }
  if (child.type === "diagram" && child.diagram) {
    return (
      <div className={c.diagramChild}>
        <h4>Diagram</h4>
        <ActivityPlaybook playbook={child.diagram} />
      </div>
    );
  }
  if (child.type === "video") {
    return (
      <div className={c.childBase}>
        <h4>Media</h4>
        {c.linkVideos && child.url ? (
          <a href={child.url} target="_blank" rel="noopener noreferrer">
            {child.title || child.url}
          </a>
        ) : (
          <>
            <p>{child.title || child.url || "Linked media"}</p>
            {child.url ? <small>{child.url}</small> : null}
          </>
        )}
      </div>
    );
  }
  if (child.type === "fieldnote") {
    // A dated log entry — the stamp reads as the header (mirrors
    // ActivityRunList's renderChild: the "Field note" type label is suppressed
    // when a stamp is present since the parent already says "Field notes").
    return (
      <div className={c.childBase + " " + c.childBase + "--fieldnote"}>
        <h4>{child.at ? formatStamp(child.at) : "Field note"}</h4>
        <p>{child.text}</p>
      </div>
    );
  }
  return (
    <div className={c.childBase + " " + c.childBase + "--" + child.type}>
      <h4>
        <DecoIcon type={child.type} icon={child.icon} color={child.color} />
        {CHILD_LABEL[child.type]}
      </h4>
      <p>{child.text}</p>
    </div>
  );
}

function RunBlockView({
  block,
  activity,
  c,
  kitStock,
  materialCatalog,
}: {
  block: RunBlock;
  activity: Activity;
  c: Vars;
  kitStock?: Record<string, StockState>;
  materialCatalog?: Material[];
}) {
  const Heading = c.headingTag;
  if (block.type === "heading") {
    return <Heading className={c.heading}>{block.text}</Heading>;
  }

  // The resolved `details` block IS the truth once hand-edited (the same
  // override philosophy as steps/notes/safety) — render its tags, falling back
  // to the live activity's derived facts only when the block carries none yet
  // (a doc that predates the details block, or one that was never touched).
  if (block.type === "details") {
    const tags = block.tags && block.tags.length ? block.tags : detailTagsForActivity(activity);
    if (!tags.length) return null;
    return (
      <section className={c.noteBase + " " + c.noteBase + "--details"}>
        <h3>Specific details</h3>
        <DetailTags tags={tags} c={c} />
      </section>
    );
  }

  // Field notes: the counselor's dated "change this later" log. Staff content,
  // not a secret — it belongs on the printed sheet and the public link exactly
  // as it reads in the app (the share token already exposes the whole sheet).
  if (block.type === "fieldnote") {
    const notes = (block.children || []).filter((child) => child.type === "fieldnote");
    if (!notes.length) return null;
    return (
      <section className={c.noteBase + " " + c.noteBase + "--fieldnote"}>
        <h3>Field notes</h3>
        <div className={c.list}>
          {notes.map((note) => (
            <RunChildView key={note.id} child={note} activity={activity} c={c} />
          ))}
        </div>
      </section>
    );
  }

  if (block.type === "materials") {
    return (
      <section className={c.noteBase + " " + c.noteBase + "--materials"}>
        <h3>Materials</h3>
        <MaterialsList
          activity={activity}
          c={c}
          kitStock={kitStock}
          materialCatalog={materialCatalog}
        />
      </section>
    );
  }

  if (block.type === "step") {
    return (
      <section className={c.step}>
        <div className={c.stepMain}>
          {block.time ? <span className={c.cue}>{block.time}</span> : null}
          <p>{block.text}</p>
        </div>
        {(block.children || []).map((child) => (
          <RunChildView
            key={child.id}
            child={child}
            activity={activity}
            c={c}
            kitStock={kitStock}
            materialCatalog={materialCatalog}
          />
        ))}
      </section>
    );
  }

  if (block.type === "playbook") {
    return (
      <section className={c.noteBase + " " + c.noteBase + "--note"}>
        <h3>{block.title || "Playbook"}</h3>
        {block.meta ? <p>{block.meta}</p> : null}
      </section>
    );
  }

  // note / safety / variation
  return (
    <section className={c.noteBase + " " + c.noteBase + "--" + block.type}>
      <h3>
        <DecoIcon type={block.type} icon={block.icon} color={block.color} />
        {block.type === "note" ? "Note" : block.type === "safety" ? "Safety" : "Variation"}
      </h3>
      <p>{block.text}</p>
    </section>
  );
}

export function RunSheetBody({
  activity,
  runDoc,
  variant,
  kitStock,
  materialCatalog,
}: {
  activity: Activity;
  runDoc: RunDoc;
  variant: RunSheetVariant;
  // Kit stock + catalog power the SAME have/low/out/substituted lens the in-app
  // read view shows (see MaterialsList). Optional: a caller that hasn't threaded
  // them through just gets the canonical, un-decorated materials list.
  kitStock?: Record<string, StockState>;
  materialCatalog?: Material[];
  // Per-PLACEMENT substitutions (Swap.../Skip today, set from a calendar event).
  // Only meaningful when this run sheet is being rendered FOR a specific
  // scheduled occurrence — the public /run page has no event in its URL (just a
  // feed token + activity id), so it can't resolve these; see that route's
  // comment for the documented limitation.
}) {
  const c = VARIANTS[variant];
  const Title = c.titleTag;
  return (
    <article className={c.root} aria-label={"Run sheet for " + activity.title}>
      <header className={c.head}>
        <span className={c.kicker}>
          {code(activity)} · {activity.type}
        </span>
        <Title className={c.title}>{activity.title}</Title>
        {activity.altNames && activity.altNames.length ? (
          <p className={c.aka}>Also called {activity.altNames.join(" · ")}</p>
        ) : null}
        {activity.blurb ? <p className={c.blurb}>{activity.blurb}</p> : null}
      </header>

      {/* The reconciled 6-fact set (Approval/rating dropped — a run sheet is for
          running the activity, not ranking it). Same six on print and web. */}
      <section className={c.facts} aria-label="Activity facts">
        <div className={c.fact}><span>Ages</span><strong>{ageSpan(activity)}</strong></div>
        <div className={c.fact}><span>Group</span><strong>{groupLabel(activity)}</strong></div>
        <div className={c.fact}><span>Time</span><strong>{durLabel(activity)}</strong></div>
        <div className={c.fact}><span>Energy</span><strong>{ENERGY[activity.energy] || "—"}</strong></div>
        <div className={c.fact}><span>Place</span><strong>{activity.place}</strong></div>
        <div className={c.fact}><span>Prep</span><strong>{activity.prep}</strong></div>
      </section>

      {runDoc.blocks.length === 0 ? (
        <p className={c.empty}>This run sheet is empty.</p>
      ) : (
        <div className={c.list}>
          {runDoc.blocks.map((block) => (
            <RunBlockView
              key={block.id}
              block={block}
              activity={activity}
              c={c}
              kitStock={kitStock}
              materialCatalog={materialCatalog}
            />
          ))}
        </div>
      )}
    </article>
  );
}
