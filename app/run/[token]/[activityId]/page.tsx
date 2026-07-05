import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunShareButton } from "@/components/activity/RunShareButton";
import { RunSheetView } from "@/components/activity/RunSheetView";
import { ACTIVITIES } from "@/lib/content/data";
import type { Material } from "@/lib/materials/materialCatalog";
import type { StockState } from "@/lib/materials/kitStock";
import type { ActivityPlaybookData } from "@/lib/activity/playbooks";
import { resolveRunDoc } from "@/lib/activity/runListResolve";
import type { RunDoc } from "@/lib/activity/runList";
import type { Activity } from "@/lib/types";
import { resolveCalendarFeedToken } from "@/lib/server/calendarFeeds";
import { getBackendEnvStatus } from "@/lib/server/env";
import { getUserDocs } from "@/lib/server/userData";
import "./runsheet.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  // The root layout's title template already appends "· Camp Library" — a
  // literal suffix here doubled it (R1: "Run sheet · Camp Library · Camp
  // Library"). Matches this route's own not-found.tsx sibling.
  title: "Run sheet",
  robots: { index: false, follow: false }, // a secret-token page; keep it out of search.
};

type Params = { params: Promise<{ token: string; activityId: string }> };

// Public, read-only run sheet reached from a subscribed calendar event. The feed
// token in the path identifies the OWNER (no session needed); we resolve that
// owner's activity + run-list overrides exactly as the app does, then render
// read-only. Any unresolvable case is a flat 404 (never reveals token state).
export default async function RunSheetPage({ params }: Params) {
  const { token, activityId: rawActivityId } = await params;
  if (!getBackendEnvStatus().capabilities.database) notFound();

  const resolved = await resolveCalendarFeedToken(token);
  if (!resolved) notFound();

  const activityId = decodeURIComponent(rawActivityId);
  const docs = await getUserDocs(resolved.clerkUserId);
  const extra = (docs.extra as Activity[] | undefined) ?? [];
  const ratings = (docs.ratings as Record<string, number> | undefined) ?? {};
  const runListOverrides = (docs.runLists as Record<string, RunDoc> | undefined) ?? {};
  const playbookOverrides = (docs.playbookOverrides as Record<string, ActivityPlaybookData> | undefined) ?? {};
  // Kit stock + catalog are plain synced user docs (same shape the app reads
  // client-side via useActivityLibrary), so the public materials list can show
  // the SAME have/low/out lens the in-app read view does.
  const kitStock = (docs.kitStock as Record<string, StockState> | undefined) ?? {};
  const materialCatalog = (docs.materialCatalog as Material[] | undefined) ?? [];
  // The materials list below renders the library-canonical state (kit stock
  // only) — the same thing the in-app checklist shows everywhere since the
  // per-day Swap/Skip feature was removed (events' materialSubs is a legacy
  // field, see lib/calendar/types.ts).

  const found = [...extra, ...ACTIVITIES].find((a) => a.id === activityId);
  if (!found) notFound();

  const activity = ratings[found.id] != null ? { ...found, rating: ratings[found.id] } : found;
  const runDoc = resolveRunDoc(activity, runListOverrides, playbookOverrides);

  return (
    <main className="runsheet-page">
      <div className="runsheet-page__bar">
        <span className="runsheet-page__brand">Camp Library</span>
        <div className="runsheet-page__bar-right">
          <span className="runsheet-page__eyebrow">Run sheet</span>
          <RunShareButton title={activity.title + " · Run sheet"} />
        </div>
      </div>
      <RunSheetView activity={activity} runDoc={runDoc} kitStock={kitStock} materialCatalog={materialCatalog} />
    </main>
  );
}
