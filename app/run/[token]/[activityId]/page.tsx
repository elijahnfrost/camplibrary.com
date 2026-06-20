import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunSheetView } from "@/components/RunSheetView";
import { ACTIVITIES } from "@/lib/data";
import type { ActivityPlaybookData } from "@/lib/playbooks";
import { resolveRunDoc } from "@/lib/runListResolve";
import type { RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import { resolveCalendarFeedToken } from "@/lib/server/calendarFeeds";
import { getBackendEnvStatus } from "@/lib/server/env";
import { getUserDocs } from "@/lib/server/userData";
import "./runsheet.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Run sheet · Camp Library",
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

  const found = [...extra, ...ACTIVITIES].find((a) => a.id === activityId);
  if (!found) notFound();

  const activity = ratings[found.id] != null ? { ...found, rating: ratings[found.id] } : found;
  const runDoc = resolveRunDoc(activity, runListOverrides, playbookOverrides);

  return (
    <main className="runsheet-page">
      <div className="runsheet-page__bar">
        <span className="runsheet-page__brand">Camp Library</span>
        <span className="runsheet-page__eyebrow">Run sheet</span>
      </div>
      <RunSheetView activity={activity} runDoc={runDoc} />
    </main>
  );
}
