"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { AuthSession } from "@/lib/auth";
import type { CalendarEvent } from "@/lib/calendar/types";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { categoryTint, monogram } from "@/lib/data";
import type { RunDoc } from "@/lib/runList";
import type { Activity } from "@/lib/types";
import type { Camp } from "@/lib/camps";
import type { SyncStatus } from "@/lib/cloudStore";
import {
  activitiesWithNotes,
  fieldNotesFromRunLists,
  recentActivity,
  relativeTime,
  totalPlacements,
  usageByActivity,
} from "@/lib/staffStats";
import { CampIcon } from "./icons";
import { InviteSignUp } from "./InviteSignUp";
import { MiniSeg } from "./primitives";
import { StaffSignIn } from "./StaffSignIn";

export type StaffTabMode = "sign-in" | "sign-up";

// How many rows each ranked card shows before it stops — enough to be useful on
// a phone without turning a card into an endless scroll.
const USAGE_LIMIT = 6;
const NOTES_LIMIT = 5;
const RECENT_LIMIT = 6;

type ScopeId = "camp" | "all";

// Human-readable sync line from the cloud store's status + pending count.
function syncLine(status: SyncStatus, pendingCount: number): string {
  if (pendingCount > 0) {
    return pendingCount + (pendingCount === 1 ? " change pending" : " changes pending");
  }
  switch (status) {
    case "synced":
      return "All changes saved";
    case "syncing":
      return "Syncing…";
    case "offline":
      return "Offline — changes will sync when you reconnect";
    default:
      return "Saved on this device";
  }
}

// A small empty-state, in the home-empty idiom, reused inside each dashboard card.
function CardEmpty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="home-empty staff-stat__empty">
      <span className="home-empty__mark" aria-hidden="true">
        {icon}
      </span>
      <p className="home-empty__title">{title}</p>
      {hint && <p className="home-empty__hint">{hint}</p>}
    </div>
  );
}

// A calm loading line so a cold signed-in load doesn't read as "empty".
function CardLoading({ label }: { label: string }) {
  return <p className="staff-stat__loading">{label}</p>;
}

/**
 * The dedicated staff surface (a sidebar nav item, not a modal). Signed out it
 * hosts the full sign-in / invite sign-up flow (unchanged); signed in it is a
 * usage dashboard — account + sync health, how often activities get scheduled,
 * the field notes counselors have captured, and a recent-activity feed — built
 * from the same data the rest of the app already syncs, read-only. This is the
 * single intentional auth entry point — the old top-right pill and sidebar
 * identity line were removed in favour of it. The only place that still opens a
 * quick inline modal is an interrupted edit action, so the user doesn't lose
 * their place mid-edit.
 */
export function StaffTab({
  session,
  authEnabled,
  mode,
  message,
  returnTo,
  onMode,
  onSwitchAccount,
  onSignOut,
  // Dashboard data — all read-only. `events` is already scoped to the active
  // camp; `allEvents` is the full set for the all-camps toggle.
  events,
  allEvents,
  runLists,
  byId,
  hasLoaded = true,
  syncStatus = "local",
  pendingCount = 0,
  isAdmin = false,
  onOpenInvites,
  activeCamp = null,
  campCount = 0,
}: {
  session: AuthSession;
  authEnabled: boolean;
  mode: StaffTabMode;
  /** Optional context line (e.g. why sign-in was requested) above the form. */
  message?: string;
  /** Where StaffSignIn sends the user after a successful sign-in. */
  returnTo?: string;
  onMode: (mode: StaffTabMode) => void;
  onSwitchAccount: () => void;
  onSignOut: () => void;
  /** Calendar events scoped to the active camp (the default dashboard scope). */
  events?: Record<string, CalendarEvent>;
  /** Every calendar event (the all-camps toggle scope). */
  allEvents?: Record<string, CalendarEvent>;
  /** Saved Run List overrides — the only place captured field notes persist. */
  runLists?: Record<string, RunDoc>;
  /** Activity lookup for resolving titles/tints. */
  byId?: Record<string, Activity>;
  /** First-load readiness; while false, stat cards show "loading", not "empty". */
  hasLoaded?: boolean;
  /** Cloud sync health for the account card's status line. */
  syncStatus?: SyncStatus;
  pendingCount?: number;
  /** Whether the signed-in user is the admin (gates the invite-codes link). */
  isAdmin?: boolean;
  /** Jump to the Invite-codes tab (admin only). */
  onOpenInvites?: () => void;
  /** The active camp, for the scope toggle label. */
  activeCamp?: Camp | null;
  /** How many camps exist; the toggle only shows when there's more than one. */
  campCount?: number;
}) {
  const signedIn = session.status === "authenticated";
  const [scope, setScope] = useState<ScopeId>("camp");

  // The events the stats run over: the active-camp set by default, the full set
  // when toggled. A user with 0–1 camps never sees a difference (and the toggle
  // is hidden), so the default is always the most relevant view.
  const scopedEvents = useMemo(() => {
    const all = allEvents ?? events ?? {};
    const camp = events ?? all;
    return scope === "all" ? all : camp;
  }, [scope, events, allEvents]);

  const usage = useMemo(() => usageByActivity(scopedEvents, byId ?? {}), [scopedEvents, byId]);
  const placements = totalPlacements(usage);

  // Field notes are camp-agnostic (they live on the activity, not the calendar),
  // so they always read across the full library regardless of scope.
  const notes = useMemo(() => fieldNotesFromRunLists(runLists ?? {}, byId ?? {}), [runLists, byId]);
  const noteActivityCount = activitiesWithNotes(notes);

  const recent = useMemo(() => recentActivity(scopedEvents, notes, RECENT_LIMIT), [scopedEvents, notes]);

  const showScopeToggle = campCount > 1;
  const scopeOptions = useMemo(
    () => [
      { id: "camp" as ScopeId, label: activeCamp?.name ? activeCamp.name : "This camp" },
      { id: "all" as ScopeId, label: "All camps" },
    ],
    [activeCamp]
  );

  return (
    <div className="app__scroll">
      <div className={signedIn ? "staff-tab staff-tab--dash" : "staff-tab"}>
        <div className="staff-tab__head">
          <h1 className="staff-tab__title">{signedIn ? "Your account" : "Staff sign in"}</h1>
          {signedIn && showScopeToggle && (
            <MiniSeg
              ariaLabel="Stat scope"
              options={scopeOptions}
              value={scope}
              onChange={setScope}
            />
          )}
        </div>

        {signedIn ? (
          <div className="staff-grid">
            {/* ---- account + sync health ---- */}
            <section className="staff-stat" aria-labelledby="staff-account-title">
              <div className="staff-stat__head">
                <span className="staff-stat__title" id="staff-account-title">
                  Account
                </span>
              </div>
              <div className="staff-stat__card staff-account">
                <p className="staff-account__name">{session.user.name}</p>
                <p className="staff-account__email">{session.user.email}</p>
                <div className="staff-account__meta">
                  <span className="staff-tag">
                    {session.user.role === "admin" ? "Admin" : "Editor"}
                  </span>
                  <span className="staff-tag staff-tag--quiet">
                    {session.mode === "preview" ? "Preview" : "Signed in"}
                  </span>
                </div>
                <p className="staff-account__sync">
                  <span
                    className={
                      "staff-account__dot staff-account__dot--" +
                      (pendingCount > 0 ? "pending" : syncStatus)
                    }
                    aria-hidden="true"
                  />
                  {syncLine(syncStatus, pendingCount)}
                </p>
                {isAdmin && onOpenInvites && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm btn--block"
                    onClick={onOpenInvites}
                  >
                    <CampIcon.User />
                    Manage invite codes
                  </button>
                )}
                <div className="staff-account__actions">
                  <button type="button" className="btn btn--primary btn--sm" onClick={onSwitchAccount}>
                    <CampIcon.User />
                    Switch account
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={onSignOut}>
                    Sign out
                  </button>
                </div>
              </div>
            </section>

            {/* ---- usage frequency ---- */}
            <section className="staff-stat" aria-labelledby="staff-usage-title">
              <div className="staff-stat__head">
                <span className="staff-stat__title" id="staff-usage-title">
                  Most scheduled
                </span>
                {placements > 0 && (
                  <span className="staff-stat__sub">
                    {placements} placement{placements === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div className="staff-stat__card">
                {usage.length > 0 ? (
                  <ul className="staff-rank">
                    {usage.slice(0, USAGE_LIMIT).map((row) => (
                      <li
                        key={row.activityId}
                        className="staff-rank__row"
                        style={{ "--cal-tint": categoryTint(row.type ?? undefined) } as CSSProperties}
                      >
                        <span className="staff-rank__mono" aria-hidden="true">
                          {monogram(row.title)}
                        </span>
                        <span className="staff-rank__title">{row.title}</span>
                        <span className="staff-rank__count" title={row.count + " times scheduled"}>
                          {row.count}
                          <span className="staff-rank__unit">×</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : !hasLoaded ? (
                  <CardLoading label="Loading usage…" />
                ) : (
                  <CardEmpty
                    icon={<CampIcon.Calendar />}
                    title="No activities scheduled yet."
                    hint="Place activities on the calendar and they'll be ranked here by how often they're scheduled."
                  />
                )}
              </div>
            </section>

            {/* ---- notes made ---- */}
            <section className="staff-stat" aria-labelledby="staff-notes-title">
              <div className="staff-stat__head">
                <span className="staff-stat__title" id="staff-notes-title">
                  Field notes
                </span>
                {notes.length > 0 && (
                  <span className="staff-stat__sub">
                    {notes.length} note{notes.length === 1 ? "" : "s"} · {noteActivityCount} activit
                    {noteActivityCount === 1 ? "y" : "ies"}
                  </span>
                )}
              </div>
              <div className="staff-stat__card">
                {notes.length > 0 ? (
                  <ul className="staff-notes">
                    {notes.slice(0, NOTES_LIMIT).map((note, i) => (
                      <li key={note.activityId + "-" + i} className="staff-notes__row">
                        <div className="staff-notes__head">
                          <span className="staff-notes__activity">{note.activityTitle}</span>
                          {note.at && <span className="staff-notes__date">{formatEventDateLabel(note.at)}</span>}
                        </div>
                        <p className="staff-notes__text">{note.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : !hasLoaded ? (
                  <CardLoading label="Loading notes…" />
                ) : (
                  <CardEmpty
                    icon={<CampIcon.Flag />}
                    title="No field notes captured yet."
                    hint="Open an activity's run sheet and jot a dated field note — anything to remember for next time shows up here."
                  />
                )}
              </div>
            </section>

            {/* ---- recently edited / recent activity ---- */}
            <section className="staff-stat" aria-labelledby="staff-recent-title">
              <div className="staff-stat__head">
                <span className="staff-stat__title" id="staff-recent-title">
                  Recent activity
                </span>
              </div>
              <div className="staff-stat__card">
                {recent.length > 0 ? (
                  <ul className="staff-recent">
                    {recent.map((item, i) => (
                      <li key={item.kind + "-" + i} className="staff-recent__row">
                        <span className={"staff-recent__icon staff-recent__icon--" + item.kind} aria-hidden="true">
                          {item.kind === "note" ? <CampIcon.Flag /> : <CampIcon.Calendar />}
                        </span>
                        <span className="staff-recent__main">
                          <span className="staff-recent__title">{item.title}</span>
                          <span className="staff-recent__detail">
                            {item.kind === "note" ? item.detail : "Scheduled " + formatEventDateLabel(item.detail)}
                          </span>
                        </span>
                        <span className="staff-recent__when">{relativeTime(item.ts)}</span>
                      </li>
                    ))}
                  </ul>
                ) : !hasLoaded ? (
                  <CardLoading label="Loading activity…" />
                ) : (
                  <CardEmpty
                    icon={<CampIcon.Clock />}
                    title="Nothing edited recently."
                    hint="As you place events and capture notes, your most recent changes appear here."
                  />
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="staff-tab__body">
            {!authEnabled ? (
              <div className="auth-form auth-form--prompt">
                <div className="auth-form__section">Staff access</div>
                <p className="auth-form__copy">
                  Staff accounts aren&rsquo;t configured in this workspace yet, so editing tools are
                  unavailable — but everything is fully browsable.
                </p>
              </div>
            ) : mode === "sign-up" ? (
              <>
                <InviteSignUp />
                <p className="auth-form__hint staff-tab__switch">
                  Already have an account?{" "}
                  <button type="button" className="auth-form__link" onClick={() => onMode("sign-in")}>
                    Sign in
                  </button>
                </p>
              </>
            ) : (
              <StaffSignIn
                returnTo={returnTo}
                message={message}
                onRequestSignUp={() => onMode("sign-up")}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
