"use client";

// The app shell: two surfaces (Library, Calendar) plus the admin tab.
// Navigation, auth, the activity viewer, and the add/edit sheet live here;
// activity-domain state is in useActivityLibrary and persistence in
// lib/cloudStore (localStorage for anon, cloud-synced once signed in).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Activity, LibraryView, TabId } from "@/lib/types";
import { matchesActivityFilters, type AgeFilter, type CatFilter, type PlaceFilter } from "@/lib/activityFilters";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatRangeLabel } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import { useCloudUserData } from "@/lib/cloudStore";
import { migrateLegacyStorageKeys } from "@/lib/storageScope";
import type { RunDoc } from "@/lib/runList";
import { CampIcon } from "./icons";
import { ActivityBookPrint } from "./ActivityBookPrint";
import { ActivityEditorSheet } from "./ActivityEditorSheet";
import { AdminInviteCodes } from "./AdminInviteCodes";
import { AuthButton, useAuthLabel, usePreviewAuth } from "./AuthControls";
import { CalendarShell } from "./calendar/CalendarShell";
import { DetailSheet } from "./DetailSheet";
import { Filters } from "./Filters";
import { LibraryTab } from "./LibraryTab";
import { useActivityLibrary } from "./useActivityLibrary";

type NavTab = { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] };

const TABS: NavTab[] = [
  { id: "calendar", label: "Calendar", icon: CampIcon.Calendar },
  { id: "library", label: "Library", icon: CampIcon.Library },
];
const ADMIN_TAB: NavTab = {
  id: "admin",
  label: "Admin",
  icon: CampIcon.Tool,
};

export function CampApp({ initialTab = "calendar" }: { initialTab?: TabId } = {}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const auth = usePreviewAuth();
  const authLabel = useAuthLabel(auth.session);
  const signedInUserId = auth.session.status === "authenticated" ? auth.session.user?.id ?? null : null;
  const isSignedIn = signedInUserId != null;
  const storageScope = signedInUserId ? "user:" + signedInUserId : "anon";

  useLayoutEffect(() => {
    try {
      migrateLegacyStorageKeys(window.localStorage, storageScope);
    } catch {
      /* private mode / quota — scoped storage starts fresh */
    }
  }, [storageScope]);

  const [liveMsg, setLiveMsg] = useState("");
  // Everything works without an account: anonymous edits live in this
  // device's localStorage (lib/cloudStore anon mode). Signing in adds cloud
  // sync across devices — it is never a gate on using the app.
  const requireStaff = useCallback((_action: string) => true, []);

  // Synced user data: localStorage-backed for anon visitors, cloud-synced
  // (optimistic writes + offline outbox) once signed in.
  const cloud = useCloudUserData(signedInUserId);
  const lib = useActivityLibrary({ cloud, requireStaff, announce: setLiveMsg });

  // Library filters. State lives here because the desktop filter rail
  // renders inside the sidenav, outside LibraryTab.
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  const [query, setQuery] = useState("");

  // The search query persists across tab switches — a quick Calendar
  // round-trip shouldn't cost you your search.

  const filtered = useMemo(
    () =>
      lib.all.filter((a) =>
        matchesActivityFilters(a, {
          cat,
          place,
          age,
          query,
          availableMaterialTags: lib.activeAvailableMaterials,
        })
      ),
    [lib.all, lib.activeAvailableMaterials, cat, place, age, query]
  );
  // Starred is a library-only lens; matchesActivityFilters stays fav-agnostic.
  const libraryItems = useMemo(
    () => (starredOnly ? filtered.filter((a) => lib.favSet.has(a.id)) : filtered),
    [filtered, starredOnly, lib.favSet]
  );

  // Activity viewer state. The event context is display-only strings from the
  // calendar event the viewer was opened from (never calendar types).
  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailEventContext, setDetailEventContext] = useState<{ dateLabel: string; timeLabel: string } | null>(
    null
  );
  const detailActivity = detail ? lib.byId[detail.id] || detail : null;
  const activityDeepLinkOpenedRef = useRef(false);

  useEffect(() => {
    if (activityDeepLinkOpenedRef.current) return;
    const activityId = new URLSearchParams(window.location.search).get("activity");
    if (!activityId || !lib.byId[activityId]) return;
    activityDeepLinkOpenedRef.current = true;
    setTab("library");
    setDetail(lib.byId[activityId]);
  }, [lib.byId]);

  const openDetail = useCallback((activity: Activity) => {
    setDetailEventContext(null);
    setDetail(activity);
  }, []);

  const openDetailFromEvent = useCallback((activity: Activity, calEvent: CalendarEvent) => {
    setDetailEventContext({
      dateLabel: formatEventDateLabel(calEvent.date),
      timeLabel: calEvent.allDay ? "All day" : formatRangeLabel(calEvent.startMin, calEvent.endMin),
    });
    setDetail(activity);
  }, []);

  // The in-Library add/edit sheet. null = closed; { activity: null } = adding new.
  const [editorSheet, setEditorSheet] = useState<{ activity: Activity | null } | null>(null);

  // The desktop calendar shares the left sidebar: CalendarShell portals its
  // activity library into this slot (the same place the Library filters live).
  const [calRail, setCalRail] = useState<HTMLDivElement | null>(null);
  const calRailRef = useCallback((node: HTMLDivElement | null) => setCalRail(node), []);

  function openAddActivity() {
    if (!requireStaff("add activities")) return;
    setEditorSheet({ activity: null });
  }

  function editActivity(activity: Activity) {
    if (!requireStaff("edit activities")) return;
    setDetail(null);
    setEditorSheet({ activity });
  }

  function submitEditorSheet(activity: Activity, runDoc?: RunDoc) {
    const isEditing = Boolean(editorSheet?.activity);
    const ok = isEditing ? lib.updateActivity(activity, runDoc) : lib.addActivity(activity, runDoc);
    if (!ok) return;
    if (!isEditing) {
      setCat("All");
      lib.setView("catalog");
      setTab("library");
    }
    setEditorSheet(null);
  }

  function deleteActivity(activity: Activity) {
    if (lib.deleteActivity(activity)) setDetail(null);
  }

  // Print: the activity book is the one surviving print artifact.
  const [printActivityId, setPrintActivityId] = useState<string | null>(null);
  const printActivity = printActivityId ? lib.byId[printActivityId] ?? null : null;

  useEffect(() => {
    if (!printActivity) return;
    const clearPrintIntent = () => setPrintActivityId(null);
    let fallback = 0;
    let secondFrame = 0;
    // iOS Safari fires afterprint unreliably — belt and braces so a stale
    // hidden book can never hijack a later Cmd+P.
    const printMedia = window.matchMedia("print");
    const onPrintMediaChange = (e: MediaQueryListEvent) => {
      if (!e.matches) clearPrintIntent();
    };
    printMedia.addEventListener?.("change", onPrintMediaChange);
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.print();
        // window.print() blocks while the dialog is open in most browsers,
        // so this fires once it's dismissed.
        fallback = window.setTimeout(clearPrintIntent, 1000);
      });
    });
    window.addEventListener("afterprint", clearPrintIntent, { once: true });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (fallback) window.clearTimeout(fallback);
      printMedia.removeEventListener?.("change", onPrintMediaChange);
      window.removeEventListener("afterprint", clearPrintIntent);
    };
  }, [printActivity]);

  function requestPrint(activity: Activity) {
    setPrintActivityId(activity.id);
    setLiveMsg("Preparing " + activity.title + " for print");
  }

  const isAdmin = auth.session.status === "authenticated" && auth.session.user.role === "admin";
  const navTabs = useMemo(() => (isAdmin || tab === "admin" ? [...TABS, ADMIN_TAB] : TABS), [isAdmin, tab]);

  const pageByTab: Record<TabId, { kicker: string; title: string; summary: string }> = {
    library: {
      kicker: "Camp Library · " + libraryItems.length + " activities",
      title: "Library",
      summary: "Browse, filter, rate, and save dependable camp activities.",
    },
    calendar: {
      kicker: "Plan camp",
      title: "Calendar",
      summary:
        Object.keys(cloud.events).length +
        (Object.keys(cloud.events).length === 1 ? " event" : " events") +
        " on the calendar",
    },
    admin: {
      kicker: "Administrator",
      title: "Staff access",
      summary: "Generate and review staff invite keys.",
    },
  };
  const page = pageByTab[tab];
  const savedCount = lib.favSet.size;

  return (
    <div className="stage">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="app">
        <nav className="sidenav" aria-label="Primary">
          <button
            type="button"
            className="sidenav__brand"
            onClick={() => setTab("calendar")}
            aria-label="Camp Library — open the calendar"
          >
            <img className="sidenav__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
            <span className="sidenav__brand-copy">
              <span className="sidenav__kicker">The counselor&rsquo;s kit</span>
              <span className="sidenav__title">
                Camp <em>Library</em>
              </span>
            </span>
          </button>
          <div className="sidenav__nav">
            {navTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={"sidenav__item" + (tab === t.id ? " is-active" : "")}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                <t.icon />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {tab === "library" && (
            <Filters
              variant="rail"
              cat={cat}
              place={place}
              age={age}
              starredOnly={starredOnly}
              materialOptions={lib.materialOptions}
              availableMaterials={lib.activeAvailableMaterials}
              onCat={setCat}
              onPlace={setPlace}
              onAge={setAge}
              onStarredOnly={setStarredOnly}
              onToggleMaterial={lib.toggleAvailableMaterial}
              onClearMaterials={lib.clearAvailableMaterials}
            />
          )}
          {tab === "calendar" && <div className="sidenav__calrail" ref={calRailRef} />}
          <div className="sidenav__foot">
            <span>
              {lib.all.length} in the library · {savedCount} saved
            </span>
            <span>{authLabel}</span>
            {isSignedIn && cloud.status !== "local" && (
              <span>
                {cloud.status === "synced"
                  ? "Synced"
                  : cloud.status === "syncing"
                    ? "Syncing…"
                    : "Offline · " + cloud.pendingCount + " pending"}
              </span>
            )}
          </div>
        </nav>

        <main className="app__main" id="main">
          <div className="topbar" data-export-scope={tab} data-export-format="print-bw" data-export-title={page.title}>
            <div className="topbar__brand">
              <span className="topbar__kicker">{page.kicker}</span>
              <h1 className="topbar__title">{page.title}</h1>
              <span className="topbar__summary">{page.summary}</span>
            </div>
            <div className="topbar__actions">
              {/* No accounts configured → no sign-in entry point at all, so the
                  app reads as the fully-anonymous tool it is (no dead-ends). */}
              {auth.enabled && (
                <AuthButton session={auth.session} onOpen={() => auth.openAuth()} onSignOut={auth.signOut} />
              )}
            </div>
          </div>

          {tab === "library" && (
            <LibraryTab
              view={lib.view}
              onView={(view: LibraryView) => lib.setView(view)}
              query={query}
              onQuery={setQuery}
              items={libraryItems}
              cat={cat}
              place={place}
              age={age}
              starredOnly={starredOnly}
              materialOptions={lib.materialOptions}
              availableMaterials={lib.activeAvailableMaterials}
              onCat={setCat}
              onPlace={setPlace}
              onAge={setAge}
              onStarredOnly={setStarredOnly}
              onToggleMaterial={lib.toggleAvailableMaterial}
              onClearMaterials={lib.clearAvailableMaterials}
              onOpen={openDetail}
              isFav={lib.isFav}
              onToggleFav={lib.toggleFav}
              onAdd={openAddActivity}
            />
          )}

          {tab === "calendar" && (
            <div className="app__scroll">
              <CalendarShell
                events={cloud.events}
                upsertEvent={cloud.upsertEvent}
                removeEvent={cloud.removeEvent}
                activities={lib.all}
                byId={lib.byId}
                requireStaff={requireStaff}
                onOpenActivity={openDetailFromEvent}
                announce={setLiveMsg}
                railSlot={calRail}
              />
            </div>
          )}

          {tab === "admin" && (
            <div className="app__scroll">
              <div className="admin-tab">
                <AdminInviteCodes />
              </div>
            </div>
          )}
        </main>

        <nav className="tabbar" aria-label="Sections">
          {navTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "is-active" : ""}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              aria-label={t.label}
              title={t.label}
            >
              <t.icon />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="sr-only" role="status" aria-live="polite">
          {liveMsg}
        </div>

        {editorSheet && (
          <ActivityEditorSheet
            editing={editorSheet.activity}
            initialRunDoc={editorSheet.activity ? lib.resolveRunDoc(editorSheet.activity) : null}
            onClose={() => setEditorSheet(null)}
            onSubmit={submitEditorSheet}
          />
        )}
        {detailActivity && (
          <DetailSheet
            activity={detailActivity}
            isFav={lib.isFav}
            onToggleFav={lib.toggleFav}
            onClose={() => {
              setDetail(null);
              setDetailEventContext(null);
              setPrintActivityId(null); // a stale book never outlives its viewer
            }}
            onSetRating={lib.setRating}
            isCustom={lib.isCustomActivity(detailActivity.id)}
            onEdit={editActivity}
            onDelete={deleteActivity}
            onPrint={requestPrint}
            availableMaterials={lib.activeAvailableMaterials}
            onToggleMaterial={lib.toggleAvailableMaterial}
            runDoc={lib.resolveRunDoc(detailActivity)}
            onSaveRunDoc={lib.saveRunDoc}
            eventContext={detailEventContext ?? undefined}
            backLabel={navTabs.find((t) => t.id === tab)?.label ?? "Library"}
          />
        )}
        {printActivity && <ActivityBookPrint activity={printActivity} runDoc={lib.resolveRunDoc(printActivity)} />}
      </div>
    </div>
  );
}
