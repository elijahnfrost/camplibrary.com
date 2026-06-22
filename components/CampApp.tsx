"use client";

// The app shell: two surfaces (Library, Calendar) plus the admin tab.
// Navigation, auth, the activity viewer, and the add/edit sheet live here;
// activity-domain state is in useActivityLibrary and persistence in
// lib/cloudStore (localStorage for anon, cloud-synced once signed in).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Activity, LibraryView, TabId } from "@/lib/types";
import { usePrintIntent } from "@/lib/print/usePrintIntent";
import { ADMIN_EMAIL, isAdminEmail, staffActionGate, type StaffActionGate } from "@/lib/auth";
import { matchesActivityFilters, type AgeFilter, type CatFilter, type PlaceFilter, type ThemeFilter } from "@/lib/activityFilters";
import type { AgeUnit } from "@/lib/data";
import { useLocalStorage } from "@/lib/store";
import { AgeUnitProvider } from "./ageUnit";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatClock, formatRangeLabel } from "@/lib/calendar/time";
import { campDayWindow, hourOptionMinutes } from "@/lib/camps";
import type { CalendarEvent } from "@/lib/calendar/types";
import { useCloudUserData } from "@/lib/cloudStore";
import { migrateAnonScopeKeys, migrateLegacyStorageKeys } from "@/lib/storageScope";
import type { RunDoc } from "@/lib/runList";
import { BrandMark, CampIcon } from "./icons";
import { ContextMenu } from "./floating/ContextMenu";
import { useContextMenu } from "./floating/useContextMenu";
import { ActivityBookPrint } from "./ActivityBookPrint";
import { ActivityEditorSheet } from "./ActivityEditorSheet";
import { AdminInviteCodes } from "./AdminInviteCodes";
import { usePreviewAuth } from "./AuthControls";
import { SubscribeFeedButton } from "./calendar/SubscribeFeedButton";
import { DetailSheet } from "./DetailSheet";
import { Filters } from "./Filters";
import { HomeTab } from "./HomeTab";
import { LibraryTab } from "./LibraryTab";
import { ListManagerModal } from "./ListManagerModal";
import { Modal } from "./Modal";
import { LoadingVeil } from "./primitives";
import type { SchedulePrintData } from "./print/SchedulePrintDocument";
import { StaffSignIn } from "./StaffSignIn";
import { StaffTab, type StaffTabMode } from "./StaffTab";
import { useActivityLibrary } from "./useActivityLibrary";
import { useCamps } from "./useCamps";

// Code-split the two heavy surfaces (FullCalendar + its plugins; Paged.js) out of
// the first hydration bundle — they load on first visit to their tab, behind the
// loading veil. Client-only (both are "use client" components).
const CalendarShell = dynamic(() => import("./calendar/CalendarShell").then((m) => m.CalendarShell), {
  ssr: false,
});
const PrintTab = dynamic(() => import("./print/PrintTab").then((m) => m.PrintTab), { ssr: false });

type NavTab = { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] };

// Calendar + Library are the working surfaces. Home is a dashboard reached from
// the sidebar brand mark (>=768px) — it's a tab on neither the sidebar nor the
// phone bar. Phones land on Library (see the redirect effect in CampApp).
const TABS: NavTab[] = [
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "calendar", label: "Calendar", icon: CampIcon.Calendar },
  { id: "print", label: "Print", icon: CampIcon.Print },
];
// The single intentional sign-in / account surface. Shown to everyone (signed
// out it's "Sign in"; signed in it's the account panel) — it replaces the old
// top-right auth pill and the sidebar identity line.
const STAFF_TAB: NavTab = { id: "staff", label: "Staff", icon: CampIcon.Users };
const ADMIN_TAB: NavTab = {
  id: "admin",
  label: "Invite Codes",
  icon: CampIcon.Tool,
};

type StaffPrompt = Extract<StaffActionGate, { allowed: false }> & {
  mode: "sign-in" | "sign-up";
  returnTo: string;
};

function currentReturnPath() {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search + window.location.hash || "/";
}

function cleanAuthRouteUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth");
  url.searchParams.delete("next");
  url.searchParams.delete("redirect_url");
  const next = url.pathname + (url.search ? url.search : "") + url.hash;
  window.history.replaceState(null, "", next || "/");
}

// The only remaining modal in the auth flow: a quick sign-in popped when an
// edit action is attempted signed-out, so the user keeps their place mid-edit.
// Every other entry (the Staff tab, "create an account") is a full page.
function StaffPromptModal({
  prompt,
  authEnabled,
  onClose,
  onRequestSignUp,
}: {
  prompt: StaffPrompt;
  authEnabled: boolean;
  onClose: () => void;
  onRequestSignUp: () => void;
}) {
  return (
    <Modal label="Staff sign-in" onClose={onClose} overlayProps={{ className: "overlay--auth" }}>
      {authEnabled ? (
        <StaffSignIn
          returnTo={prompt.returnTo}
          message={prompt.message}
          onComplete={onClose}
          onRequestSignUp={onRequestSignUp}
        />
      ) : (
        <div className="auth-form auth-form--prompt">
          <div className="auth-form__section">Staff access</div>
          <p className="auth-form__copy">{prompt.message}</p>
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            Back to browsing
          </button>
        </div>
      )}
    </Modal>
  );
}

export function CampApp({ initialTab = "home" }: { initialTab?: TabId } = {}) {
  const [tab, setTabRaw] = useState<TabId>(initialTab);
  // A brief, branded veil over the main pane while a new tab mounts — heavy
  // surfaces (FullCalendar, the Paged.js preview) jank on first paint, so we
  // fade them in behind a clean loading screen instead of flashing. The veil is
  // started in the SAME render as the tab change (so it paints over the mount),
  // then cleared on a short timer. Wrapping setTab means every nav path — the
  // sidebar, the phone tabbar, and programmatic jumps — gets the transition.
  const [tabLoading, setTabLoading] = useState(false);
  const setTab = useCallback((value: TabId | ((prev: TabId) => TabId)) => {
    // Only the heavy surfaces (FullCalendar, the Paged.js preview) jank on first
    // paint and need the veil; instant surfaces (Library/Home/Staff) switch with
    // no veil. Functional updaters are programmatic jumps (the phone redirect) and
    // skip it. The veil now also code-loads the dynamic chunk on first visit.
    if (typeof value !== "function") setTabLoading(value === "calendar" || value === "print");
    setTabRaw(value);
  }, []);
  useEffect(() => {
    if (!tabLoading) return;
    const id = window.setTimeout(() => setTabLoading(false), 300);
    return () => window.clearTimeout(id);
  }, [tabLoading, tab]);
  const auth = usePreviewAuth();
  const signedInUserId = auth.session.status === "authenticated" ? auth.session.user?.id ?? null : null;
  const isSignedIn = signedInUserId != null;
  const storageScope = signedInUserId ? "user:" + signedInUserId : "anon";

  useLayoutEffect(() => {
    try {
      migrateLegacyStorageKeys(window.localStorage, storageScope);
      // First sign-in: carry anything created while signed-out into the account
      // scope, so the calendar/library aren't empty after signing in. No-op for
      // the anon scope and for a returning user whose scope already has data.
      migrateAnonScopeKeys(window.localStorage, storageScope);
    } catch {
      /* private mode / quota — scoped storage starts fresh */
    }
  }, [storageScope]);

  // The desktop sidebar holds the calendar / print rail portals. On phones the
  // sidebar is display:none but its nodes still exist, so an ungated portal would
  // ALSO mount into the hidden rail (two PrintControls fighting over one title).
  // Gate the rail nodes to desktop so the ref is null on phones. useLayoutEffect
  // resolves the match before paint, so there's no flash.
  const [isDesktop, setIsDesktop] = useState(true);
  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const [liveMsg, setLiveMsg] = useState("");
  const [staffPrompt, setStaffPrompt] = useState<StaffPrompt | null>(null);
  // Which form the Staff tab shows when reached signed-out (sign-in vs the
  // invite sign-up). Account state on that tab is driven by the session itself.
  const [staffTabMode, setStaffTabMode] = useState<StaffTabMode>("sign-in");

  // Intentional sign-in / sign-up entry points open the dedicated Staff tab
  // (not a modal). The inline modal is reserved for interrupted edit actions.
  const openSignUpPrompt = useCallback(() => {
    setStaffTabMode("sign-up");
    setTab("staff");
  }, []);

  const openSignInPrompt = useCallback(() => {
    setStaffTabMode("sign-in");
    setTab("staff");
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const mode = url.searchParams.get("auth");
    if (mode !== "sign-in" && mode !== "sign-up") return;
    if (auth.enabled && !auth.ready) return;

    cleanAuthRouteUrl();
    if (auth.signedIn || auth.providerSignedIn) return;
    // A ?auth= deep link is an intentional ask — land on the Staff tab.
    setStaffTabMode(mode);
    setTab("staff");
  }, [auth.enabled, auth.providerSignedIn, auth.ready, auth.signedIn]);

  // Phones have no Home tab and no sidebar brand mark, so an initial "home"
  // landing would be a dead end. Send phone-width sessions to Library instead.
  // The auth/activity deep-links still win: they set the tab first, and the
  // functional updater leaves any non-"home" tab untouched.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") || params.get("activity")) return;
    setTab((t) => (t === "home" ? "library" : t));
  }, []);

  const requireStaff = useCallback(
    (action: string) => {
      const returnTo = currentReturnPath();
      const gate = staffActionGate(auth.session, action, {
        authEnabled: auth.enabled,
        returnTo,
        origin: typeof window === "undefined" ? undefined : window.location.origin,
      });
      if (gate.allowed) return true;
      // The one exception to "sign-in lives on the Staff tab": an interrupted
      // edit action pops a quick modal so the user keeps their place mid-edit.
      setStaffPrompt({ ...gate, mode: "sign-in", returnTo });
      setLiveMsg(gate.message);
      return false;
    },
    [auth.enabled, auth.session]
  );

  // Synced user data: localStorage-backed for anon visitors, cloud-synced
  // (optimistic writes + offline outbox) once signed in.
  const cloud = useCloudUserData(signedInUserId);
  // Surface a failed save to the user instead of letting it drop silently.
  useEffect(() => {
    if (cloud.syncError) setLiveMsg(cloud.syncError);
  }, [cloud.syncError]);
  const lib = useActivityLibrary({ cloud, requireStaff, announce: setLiveMsg });
  // Multiple camps: filters the calendar's event set + stamps new events. The
  // shared library and every other surface are camp-agnostic.
  const campKit = useCamps({ cloud, announce: setLiveMsg });
  // Depend on the stable filterEvents callback, not the whole campKit object
  // (rebuilt every render), so the calendar event set memo doesn't recompute on
  // every render.
  const calendarEvents = useMemo(
    () => campKit.filterEvents(cloud.events),
    [campKit.filterEvents, cloud.events]
  );
  // The calendar's visible window follows the ACTIVE camp's hours (drop-off →
  // pickup, now stored on the synced camp object), or the classic 8:00–18:00 band
  // when no camp is active. The 15-min clock options feed the camp manager's
  // per-camp Open–Close editor.
  const calendarDayWindow = useMemo(() => campDayWindow(campKit.activeCamp), [campKit.activeCamp]);
  const campHourOptions = useMemo(
    () => hourOptionMinutes().map((m) => ({ value: m, label: formatClock(m) })),
    []
  );
  // The camp manager (add / switch / rename / delete) — reached from the calendar
  // view dropdown's "Manage camps…" entry. Camps are a rarely-used option, so
  // they no longer occupy a permanent header pill. Opening is ungated (switching
  // is a local view pref); create/rename/delete stay staff-gated below.
  const [campsManagerOpen, setCampsManagerOpen] = useState(false);

  // Library filters. State lives here because the desktop filter rail
  // renders inside the sidenav, outside LibraryTab.
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [theme, setTheme] = useState<ThemeFilter>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  const [query, setQuery] = useState("");
  // Grades⇄Ages caption unit — a library-wide display preference (per device).
  // Read by the cells/home via context; toggled from the filter and the editor.
  const [ageUnit, setAgeUnit] = useLocalStorage<AgeUnit>(
    "ageUnit",
    "grades",
    (v, fallback) => (v === "grades" || v === "ages" ? v : fallback)
  );
  // The Themes manager (create/rename/delete the vocabulary), reached from the
  // library filter's "Manage themes…" footer.
  const [themesManagerOpen, setThemesManagerOpen] = useState(false);
  const openThemesManager = useCallback(() => {
    if (requireStaff("manage themes")) setThemesManagerOpen(true);
  }, [requireStaff]);

  // The search query persists across tab switches — a quick Calendar
  // round-trip shouldn't cost you your search.

  const filtered = useMemo(
    () =>
      lib.all.filter((a) =>
        matchesActivityFilters(a, {
          cat,
          place,
          age,
          theme,
          themeAssignments: lib.themeAssignments,
          query,
          availableMaterialTags: lib.activeAvailableMaterials,
        })
      ),
    [lib.all, lib.activeAvailableMaterials, lib.themeAssignments, cat, place, age, theme, query]
  );
  // Starred is a library-only lens; matchesActivityFilters stays fav-agnostic.
  const libraryItems = useMemo(
    () => (starredOnly ? filtered.filter((a) => lib.favSet.has(a.id)) : filtered),
    [filtered, starredOnly, lib.favSet]
  );

  // If the active theme filter points at a theme that was deleted (here or on
  // another device), fall back to "All" so the filter never strands the list.
  useEffect(() => {
    if (theme !== "All" && !lib.themes.some((t) => t.id === theme)) setTheme("All");
  }, [theme, lib.themes]);

  // Announce the filtered result count to assistive tech when a filter or search
  // changes it. Skips the initial render and tab arrivals (prev = null) so only a
  // real change while viewing the library speaks; the count itself is visible.
  const prevLibCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (tab !== "library") {
      prevLibCountRef.current = null;
      return;
    }
    const count = libraryItems.length;
    if (prevLibCountRef.current !== null && prevLibCountRef.current !== count) {
      setLiveMsg(count + (count === 1 ? " activity" : " activities"));
    }
    prevLibCountRef.current = count;
  }, [libraryItems.length, tab]);

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

  // Home's "Browse by type" tiles jump into the Library pre-filtered to one
  // category (or "All" for the catch-all links).
  const goLibrary = useCallback((nextCat: CatFilter) => {
    setCat(nextCat);
    setTab("library");
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
  // The Print tab shares the same sidebar: PrintTab portals its schedule controls
  // into this slot (no second sidebar) — the same node-state pattern as the
  // calendar rail above.
  const [printRail, setPrintRail] = useState<HTMLDivElement | null>(null);
  const printRailRef = useCallback((node: HTMLDivElement | null) => setPrintRail(node), []);

  function openAddActivity() {
    if (!requireStaff("add activities")) return;
    setEditorSheet({ activity: null });
  }

  function editActivity(activity: Activity) {
    if (!requireStaff("edit activities")) return;
    setDetail(null);
    setEditorSheet({ activity });
  }

  function submitEditorSheet(activity: Activity, runDoc?: RunDoc, themeId?: string | null) {
    const isEditing = Boolean(editorSheet?.activity);
    const ok = isEditing ? lib.updateActivity(activity, runDoc) : lib.addActivity(activity, runDoc);
    if (!ok) return;
    lib.assignTheme(activity.id, themeId ?? null);
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

  function duplicateActivity(activity: Activity) {
    const copy = lib.duplicateActivity(activity);
    if (!copy) return;
    // Surface the copy where the user is looking: jump to the catalog so the
    // new "(copy)" row is visible at the top.
    setCat("All");
    lib.setView("catalog");
    setTab("library");
  }

  // Right-click on any library activity (shelf spine, deck card, catalog row).
  // Pointer-fine only; touch users reach the same actions through the detail
  // sheet (which also carries Edit/Delete/Duplicate in its header).
  const libMenu = useContextMenu<Activity>();

  // Print: the activity book (from the viewer) and the schedule range (from the
  // Print tab) are the two print artifacts. Both mount a hidden `.print-root`
  // sheet and fire the dialog through the shared usePrintIntent hook.
  const [printActivityId, setPrintActivityId] = useState<string | null>(null);
  const printActivity = printActivityId ? lib.byId[printActivityId] ?? null : null;
  const clearPrintActivity = useCallback(() => setPrintActivityId(null), []);
  usePrintIntent(Boolean(printActivity), clearPrintActivity);

  function requestPrint(activity: Activity) {
    setPrintActivityId(activity.id);
    setLiveMsg("Preparing " + activity.title + " for print");
  }

  // The Print tab portals its hidden `.print-root` schedule sheet into this slot
  // (a direct child of `.app`, a sibling of <main> — the same DOM position the
  // activity book uses, so the existing `.app:has(.print-root)` chrome-hiding
  // print rules apply). Mirrors the calendar rail's node-state pattern.
  const [printHost, setPrintHost] = useState<HTMLDivElement | null>(null);
  const printHostRef = useCallback((node: HTMLDivElement | null) => setPrintHost(node), []);

  const printData: SchedulePrintData = useMemo(
    () => ({
      events: cloud.events,
      byId: lib.byId,
      resolveRunDoc: lib.resolveRunDoc,
      themeOf: lib.themeOf,
      camps: campKit.camps,
    }),
    [cloud.events, lib.byId, lib.resolveRunDoc, lib.themeOf, campKit.camps]
  );

  const isAdmin = auth.session.status === "authenticated" && isAdminEmail(auth.session.user.email);
  // Desktop sidebar omits Home (the brand mark is Home). The mobile tab bar
  // keeps Home, since mobile has no persistent brand mark to tap.
  const navTabs = useMemo(
    () => (isAdmin || tab === "admin" ? [...TABS, STAFF_TAB, ADMIN_TAB] : [...TABS, STAFF_TAB]),
    [isAdmin, tab]
  );
  // The phone tab bar is the three working surfaces: Library / Calendar / Staff.
  // Home (a dashboard) and Admin are omitted — Home is reached via the sidebar
  // brand mark at >=768px, and phones land on Library (see the redirect effect).
  const mobileNavTabs = useMemo(() => [...TABS, STAFF_TAB], []);

  return (
    <AgeUnitProvider value={ageUnit}>
    <div className="stage">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="app">
        <nav className="sidenav" aria-label="Primary">
          <button
            type="button"
            className="sidenav__brand"
            onClick={() => setTab("home")}
            aria-label="Camp Library — go home"
          >
            <BrandMark className="sidenav__logo" />
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
              ageUnit={ageUnit}
              onAgeUnit={setAgeUnit}
              theme={theme}
              themes={lib.themes}
              starredOnly={starredOnly}
              materialOptions={lib.materialOptions}
              availableMaterials={lib.activeAvailableMaterials}
              onCat={setCat}
              onPlace={setPlace}
              onAge={setAge}
              onTheme={setTheme}
              onManageThemes={openThemesManager}
              onStarredOnly={setStarredOnly}
              onToggleMaterial={lib.toggleAvailableMaterial}
              onClearMaterials={lib.clearAvailableMaterials}
            />
          )}
          {tab === "calendar" && isDesktop && <div className="sidenav__calrail" ref={calRailRef} />}
          {tab === "print" && isDesktop && <div className="sidenav__printrail" ref={printRailRef} />}
        </nav>

        <main className="app__main" id="main">
          {tabLoading && <LoadingVeil className="app__veil" label="One moment…" decorative />}
          {tab === "calendar" && <h1 className="sr-only">Calendar</h1>}
          {tab === "library" && <h1 className="sr-only">Library</h1>}

          {tab === "home" && (
            <HomeTab
              activities={lib.all}
              byId={lib.byId}
              favs={lib.favs}
              isFav={lib.isFav}
              onToggleFav={lib.toggleFav}
              events={cloud.events}
              onOpenActivity={openDetail}
              onOpenEventActivity={openDetailFromEvent}
              onGoCalendar={() => setTab("calendar")}
              onGoLibrary={goLibrary}
              onContextMenu={(activity, e) => libMenu.open(e, activity)}
              isSignedIn={isSignedIn}
              authEnabled={auth.enabled}
              adminEmail={ADMIN_EMAIL}
              onStaffSignIn={openSignInPrompt}
              onStaffSignUp={openSignUpPrompt}
              onOpenAccount={() => setTab("staff")}
            />
          )}

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
              ageUnit={ageUnit}
              onAgeUnit={setAgeUnit}
              theme={theme}
              themes={lib.themes}
              themeOf={lib.themeOf}
              starredOnly={starredOnly}
              materialOptions={lib.materialOptions}
              availableMaterials={lib.activeAvailableMaterials}
              onCat={setCat}
              onPlace={setPlace}
              onAge={setAge}
              onTheme={setTheme}
              onManageThemes={openThemesManager}
              onStarredOnly={setStarredOnly}
              onToggleMaterial={lib.toggleAvailableMaterial}
              onClearMaterials={lib.clearAvailableMaterials}
              onOpen={openDetail}
              isFav={lib.isFav}
              onToggleFav={lib.toggleFav}
              onContextMenu={(activity, e) => libMenu.open(e, activity)}
              onAdd={openAddActivity}
            />
          )}

          {tab === "calendar" && (
            <div className="app__scroll">
              <CalendarShell
                events={calendarEvents}
                upsertEvent={campKit.upsertEvent}
                removeEvent={cloud.removeEvent}
                upsertEvents={campKit.upsertEvents}
                removeEvents={cloud.removeEvents}
                commitEvents={campKit.commitEvents}
                undo={cloud.undo}
                redo={cloud.redo}
                activities={lib.all}
                byId={lib.byId}
                canEdit={isSignedIn}
                requireStaff={requireStaff}
                onOpenActivity={openDetailFromEvent}
                announce={setLiveMsg}
                railSlot={calRail}
                themeOf={lib.themeOf}
                onOpenCamps={() => setCampsManagerOpen(true)}
                dayWindow={calendarDayWindow}
                headerActions={
                  <SubscribeFeedButton
                    activeCampId={campKit.activeCampId}
                    activeCampName={campKit.activeCamp?.name ?? null}
                    canEdit={isSignedIn}
                  />
                }
              />
            </div>
          )}

          {tab === "print" && (
            <PrintTab
              data={printData}
              activeCampId={campKit.activeCampId}
              railSlot={printRail}
              printHost={printHost}
              announce={setLiveMsg}
            />
          )}

          {tab === "admin" && (
            <div className="app__scroll">
              <div className="admin-tab">
                <div className="admin-tab__head">
                  <h1 className="admin-tab__title">Invite codes</h1>
                </div>
                {isAdmin ? (
                  <AdminInviteCodes />
                ) : (
                  <div className="admin-panel">
                    <span className="admin-panel__kicker">Admin only</span>
                    <h2 className="admin-panel__title">Invite-code management</h2>
                    <p className="auth-form__copy">
                      Sign in as {ADMIN_EMAIL} to generate and manage staff account codes.
                    </p>
                    <button
                      type="button"
                      className="btn btn--primary btn--block"
                      onClick={() => requireStaff("manage invite codes")}
                    >
                      <CampIcon.User />
                      Sign in as admin
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "staff" && (
            <StaffTab
              session={auth.session}
              authEnabled={auth.enabled}
              mode={staffTabMode}
              onMode={setStaffTabMode}
              onSwitchAccount={() => auth.signOut("/?auth=sign-in")}
              onSignOut={() => auth.signOut("/")}
            />
          )}
        </main>

        <nav className="tabbar" aria-label="Sections">
          {mobileNavTabs.map((t) => (
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

        {themesManagerOpen && (
          <ListManagerModal
            title="Themes"
            intro="Themes group your activities — like Ocean Week or Jungle Week. Assign one to an activity from its editor; here you can add, rename, and remove them."
            items={lib.themes.map((t) => ({ id: t.id, label: t.label, tint: t.tint }))}
            createPlaceholder="e.g. Ocean Week"
            createLabel="Add theme"
            emptyHint="No themes yet. Add one, then tag activities with it from the activity editor."
            onCreate={(name) => lib.createTheme(name)}
            onRename={lib.renameTheme}
            onDelete={(item) => {
              if (window.confirm("Delete the “" + item.label + "” theme? It is removed from any activities using it.")) {
                lib.deleteTheme(item.id);
              }
            }}
            onClose={() => setThemesManagerOpen(false)}
          />
        )}
        {campsManagerOpen && (
          <ListManagerModal
            title="Camps"
            intro="Each camp keeps its own schedule and its own viewing hours (drop-off → pickup). Your activity library is shared across all of them."
            items={campKit.camps.map((c) => ({
              id: c.id,
              label: c.name,
              openMin: c.openMin,
              closeMin: c.closeMin,
            }))}
            activeId={campKit.activeCampId}
            createPlaceholder="e.g. Summer Day Camp"
            createLabel="Add camp"
            emptyHint="No camps yet. Add one to keep its schedule separate from the rest."
            hourOptions={campHourOptions}
            onChangeHours={(id, field, value) => {
              if (requireStaff("manage camps")) campKit.adjustCampHours(id, field, value);
            }}
            onSelect={(id) => {
              campKit.switchCamp(id);
              setCampsManagerOpen(false);
            }}
            onCreate={(name) => {
              if (requireStaff("manage camps")) campKit.createCamp(name);
            }}
            onRename={(id, name) => {
              if (requireStaff("manage camps")) campKit.renameCamp(id, name);
            }}
            onDelete={(item) => {
              if (!requireStaff("manage camps")) return;
              if (window.confirm("Delete the “" + item.label + "” camp? Its events stay on the calendar but are no longer grouped.")) {
                campKit.deleteCamp(item.id);
              }
            }}
            onClose={() => setCampsManagerOpen(false)}
          />
        )}
        {editorSheet && (
          <ActivityEditorSheet
            editing={editorSheet.activity}
            initialRunDoc={editorSheet.activity ? lib.resolveRunDoc(editorSheet.activity) : null}
            onClose={() => setEditorSheet(null)}
            onSubmit={submitEditorSheet}
            ageUnit={ageUnit}
            onAgeUnit={setAgeUnit}
            themeKit={{
              themes: lib.themes,
              initialThemeId: editorSheet.activity ? lib.themeAssignments[editorSheet.activity.id] ?? "" : "",
              onCreate: lib.createTheme,
            }}
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
            isCustom={lib.isCustomActivity(detailActivity.id)}
            onEdit={editActivity}
            onDuplicate={duplicateActivity}
            onDelete={deleteActivity}
            onPrint={requestPrint}
            availableMaterials={lib.activeAvailableMaterials}
            onToggleMaterial={lib.toggleAvailableMaterial}
            runDoc={lib.resolveRunDoc(detailActivity)}
            onSetRating={isSignedIn ? lib.setRating : undefined}
            onSaveRunDoc={isSignedIn ? lib.saveRunDoc : undefined}
            eventContext={detailEventContext ?? undefined}
            backLabel={navTabs.find((t) => t.id === tab)?.label ?? "Library"}
            theme={lib.themeOf(detailActivity.id)}
          />
        )}
        {libMenu.state && (() => {
          const target = libMenu.state.target;
          return (
            <ContextMenu
              point={libMenu.state.point}
              ariaLabel={target.title}
              onClose={libMenu.close}
              items={[
                { label: "Open", icon: <CampIcon.BookOpen />, onSelect: () => openDetail(target) },
                {
                  label: lib.isFav(target.id) ? "Unsave" : "Save",
                  icon: <CampIcon.Bookmark />,
                  onSelect: () => lib.toggleFav(target.id),
                },
                {
                  label: "Edit",
                  icon: <CampIcon.Pencil />,
                  separatorBefore: true,
                  onSelect: () => editActivity(target),
                },
                { label: "Duplicate", icon: <CampIcon.Copy />, onSelect: () => duplicateActivity(target) },
                {
                  label: "Delete",
                  icon: <CampIcon.Trash />,
                  danger: true,
                  disabled: !lib.isCustomActivity(target.id),
                  onSelect: () => deleteActivity(target),
                },
              ]}
            />
          );
        })()}
        {printActivity && <ActivityBookPrint activity={printActivity} runDoc={lib.resolveRunDoc(printActivity)} />}
        <div ref={printHostRef} className="print-host" />
        {staffPrompt && (
          <StaffPromptModal
            prompt={staffPrompt}
            authEnabled={auth.enabled}
            onClose={() => setStaffPrompt(null)}
            onRequestSignUp={() => {
              // "Create an account" from the inline gate redirects to the full
              // Staff page rather than swapping the modal to a sign-up form.
              setStaffPrompt(null);
              openSignUpPrompt();
            }}
          />
        )}
      </div>
    </div>
    </AgeUnitProvider>
  );
}
