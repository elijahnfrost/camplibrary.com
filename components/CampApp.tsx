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
import { matchesActivityFilters, sortActivities, isLibrarySort, type AgeFilter, type CatFilter, type KitFilter, type LibrarySort, type PlaceFilter, type ThemeFilter } from "@/lib/activityFilters";
import { ALL_CATEGORY_IDS, locationColor, type AgeUnit } from "@/lib/data";
import { readStored, useLocalStorage, writeStored, type StorageValidator } from "@/lib/store";
import { AgeUnitProvider } from "./ageUnit";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatClock, formatRangeLabel } from "@/lib/calendar/time";
import { campDayWindow, hourOptionMinutes } from "@/lib/camps";
import type { CalendarEvent } from "@/lib/calendar/types";
import { useCloudUserData } from "@/lib/cloudStore";
import { migrateAnonScopeKeys, migrateLegacyStorageKeys } from "@/lib/storageScope";
import type { RunDoc } from "@/lib/runList";
import { activityFromForm, BLANK_FORM, newActivityId, quickActivity } from "@/lib/activityForm";
import { BrandMark, CampIcon } from "./icons";
import { ContextMenu } from "./floating/ContextMenu";
import { useContextMenu } from "./floating/useContextMenu";
import { ActivityBookPrint } from "./ActivityBookPrint";
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
import { useDeviceShape, DESKTOP_MIN } from "./useDeviceShape";

// Code-split the two heavy surfaces (FullCalendar + its plugins; Paged.js) out of
// the first hydration bundle — they load on first visit to their tab, behind the
// loading veil. Client-only (both are "use client" components). The `loading:`
// fallback paints the SAME branded veil while the chunk downloads, so the gap
// before the module arrives is never an empty `app__scroll` frame. It's a static
// (non-auto-fade) variant — once the chunk lands, the host's own readiness veil
// (calendar) or the PagedPreview veil (print) carries the rest of the settle.
const ChunkVeil = () => <LoadingVeil className="app__veil app__veil--static" label="One moment…" decorative />;
const CalendarShell = dynamic(() => import("./calendar/CalendarShell").then((m) => m.CalendarShell), {
  ssr: false,
  loading: ChunkVeil,
});
const PrintTab = dynamic(() => import("./print/PrintTab").then((m) => m.PrintTab), {
  ssr: false,
  loading: ChunkVeil,
});
const MaterialsTab = dynamic(() => import("./materials/MaterialsTab").then((m) => m.MaterialsTab), {
  ssr: false,
  loading: ChunkVeil,
});

type NavTab = { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] };

// Calendar + Library are the working surfaces. Home is a dashboard reached from
// the sidebar brand mark (>=768px) — it's a tab on neither the sidebar nor the
// phone bar. Phones land on Library (see the redirect effect in CampApp).
const TABS: NavTab[] = [
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "calendar", label: "Calendar", icon: CampIcon.Calendar },
  { id: "print", label: "Print", icon: CampIcon.Print },
  { id: "materials", label: "Materials", icon: CampIcon.Box },
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

// The active surface is remembered across a reload (so a refresh — e.g.
// Conductor's preview reloading — lands you back where you were). Only the
// everyday surfaces are restored; "admin" is intentionally absent because it is
// reachable solely via the server-gated /admin route and must never be restored
// onto the main app. Stored unscoped (a per-device UI choice, like the calendar
// view prefs) under the shared "camp:" store.
const STORED_TAB_KEY = "currentTab";
const RESTORABLE_TABS = ["home", "library", "calendar", "print", "materials", "staff"] as const;
const parseStoredTab: StorageValidator<TabId | null> = (value, fallback) =>
  typeof value === "string" && (RESTORABLE_TABS as readonly string[]).includes(value)
    ? (value as TabId)
    : fallback;

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
  // Only the main app entry remembers/restores its tab. The /admin route mounts
  // with initialTab "admin" — a deliberate, server-gated destination that must
  // neither be hijacked by the remembered tab nor overwrite it.
  const persistTab = initialTab === "home";
  // A branded veil over the main pane while a heavy surface mounts + settles —
  // FullCalendar and the Paged.js preview jank on first paint, so we reveal them
  // behind a clean loading screen instead of flashing an empty frame. The veil
  // covers EVERY arrival at those surfaces (sidebar, phone tabbar, programmatic
  // jumps, and the first land), so phone and desktop get the same treatment.
  //
  // `veil` holds which heavy tab is currently covered (null = no veil). The
  // calendar's veil is dismissed by READINESS — CalendarShell.onReady fires once
  // its view has mounted and the first scroll-to-today realign has run — with a
  // generous max-timeout safety so a hang can never trap the user behind it.
  // Print keeps a short timed cover for the chunk+mount gap; its real settle is
  // carried by PagedPreview's own veil once the module is in.
  const isHeavyTab = (id: TabId) => id === "calendar" || id === "print";
  const [veil, setVeil] = useState<TabId | null>(() => (isHeavyTab(initialTab) ? initialTab : null));
  // onReady has fired for the CURRENT calendar mount (grid laid out + landed on
  // today). Half of the calendar veil's dismissal; the other half is the cloud
  // data being loaded (the combined effect below). Reset SYNCHRONOUSLY the moment
  // we raise the calendar veil — a fresh CalendarShell mount must re-earn its
  // reveal, and resetting in an effect would leave a stale-true render that could
  // dismiss the veil before the new mount paints.
  const [calShellReady, setCalShellReady] = useState(false);
  const onCalendarReady = useCallback(() => setCalShellReady(true), []);
  // A fresh raise of the calendar veil arms a new max-timeout — bump this so the
  // safety effect re-runs on every return, not just the first.
  const [calVeilNonce, setCalVeilNonce] = useState(0);
  const setTab = useCallback((value: TabId | ((prev: TabId) => TabId)) => {
    // Raise the veil in the SAME render as the tab change so it paints over the
    // mount. Functional updaters (the phone redirect / activity deep-link) resolve
    // the next tab so they get the same coverage as a direct tap. Switching AWAY
    // from a heavy tab clears the veil immediately (instant surfaces never wait).
    setTabRaw((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      if (isHeavyTab(next)) {
        setVeil(next);
        if (next === "calendar") {
          setCalShellReady(false);
          setCalVeilNonce((n) => n + 1);
        }
      } else {
        setVeil(null);
      }
      return next;
    });
  }, []);
  // Print veil: a short timed cover for the chunk-download + mount gap. Once the
  // module is in, PagedPreview's own veil carries the pagination settle.
  useEffect(() => {
    if (veil !== "print") return;
    const id = window.setTimeout(() => setVeil((v) => (v === "print" ? null : v)), 300);
    return () => window.clearTimeout(id);
  }, [veil]);
  // Calendar veil safety: a max-timeout so a layout hang (or a never-resolving
  // bootstrap) can't trap the user behind the veil. Re-armed on each raise. Sized
  // to give the weather forecast (folded into CalendarShell.onReady when weather
  // is on) room to land behind the veil, while still capping a stalled signal.
  const CAL_VEIL_MAX_MS = 2500;
  useEffect(() => {
    if (veil !== "calendar") return;
    const id = window.setTimeout(() => {
      setVeil((v) => (v === "calendar" ? null : v));
    }, CAL_VEIL_MAX_MS);
    return () => window.clearTimeout(id);
  }, [veil, calVeilNonce]);
  // Restore the remembered tab before paint, so a reload lands on the last
  // surface with no flash of Home and the heavy-tab veil raised in the same
  // render (setTab handles that). Deep links (?auth=, ?activity=) are explicit
  // intents that win — their own effects set the tab, so skip restore for them.
  useLayoutEffect(() => {
    if (!persistTab) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") || params.get("activity")) return;
    const stored = readStored<TabId | null>(STORED_TAB_KEY, null, parseStoredTab);
    if (stored) setTab(stored);
    // Mount-only: restore once, then let normal navigation drive the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every tab change (runs after the restore layout effect on mount, so
  // it never clobbers the remembered value with the initial "home").
  useEffect(() => {
    if (!persistTab) return;
    writeStored(STORED_TAB_KEY, tab);
  }, [persistTab, tab]);

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

  // The desk sidebar holds the calendar / print rail portals. Below the desk
  // breakpoint the sidebar is display:none but its nodes would still exist, so an
  // ungated portal would ALSO mount into the hidden rail (two PrintControls
  // fighting over one title). Gate the rail nodes to the desk (>=1024) so the ref
  // is null on phone + tablet, where the touch shell uses sheets instead. The
  // hook resolves the match in a layout effect before paint, so there's no flash.
  const { isDesktop } = useDeviceShape();

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

  // The touch shell (phone + tablet) has no Home tab and no sidebar brand mark,
  // so an initial "home" landing would be a dead end. Send touch-shell sessions
  // (<1024) to Library instead. The auth/activity deep-links still win: they set
  // the tab first, and the functional updater leaves any non-"home" tab untouched.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia(`(max-width: ${DESKTOP_MIN - 1}px)`).matches) return;
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
  // Dismiss the calendar veil once BOTH the grid has settled (calShellReady) AND
  // the data is loaded (cloud.hasLoaded — true at once for anon/cached, held for a
  // cold signed-in load until the bootstrap resolves). Revealing only when both
  // are true means the calendar never flashes empty then pops events in. The
  // max-timeout above is the backstop if either signal stalls.
  useEffect(() => {
    if (veil === "calendar" && calShellReady && cloud.hasLoaded) {
      setVeil((v) => (v === "calendar" ? null : v));
    }
  }, [veil, calShellReady, cloud.hasLoaded]);
  const lib = useActivityLibrary({ cloud, requireStaff, announce: setLiveMsg });
  // Multiple camps: filters the calendar's event set + stamps new events. The
  // shared library and every other surface are camp-agnostic.
  const campKit = useCamps({ cloud, announce: setLiveMsg });
  // The calendar's create bar can save a typed name straight into the library as a
  // reusable activity (the "Save to library" path). It lands in the Routine bucket
  // with broad defaults; a 0-min length makes it a reminder. Returns the new
  // activity so the placed event links to it (null if the staff gate blocks it).
  const createCalendarActivity = useCallback(
    (title: string, durationMin: number): Activity | null => {
      const activity = quickActivity(title, newActivityId(title), durationMin);
      return lib.addActivity(activity) ? activity : null;
    },
    [lib]
  );
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
  const [cats, setCats] = useState<CatFilter>(ALL_CATEGORY_IDS);
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [theme, setTheme] = useState<ThemeFilter>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  // The 3-state "can I run this with my kit" lens, shared by the Library list and
  // the Calendar (so the runnable filter reads the same everywhere).
  const [kitFilter, setKitFilter] = useState<KitFilter>("all");
  const [query, setQuery] = useState("");
  // Duration filter. The slider spans the actual range of lengths in the
  // library (snapped out to a 5-minute grid), so the handles never sit past
  // the shortest/longest activity. `minutesRange` is null until the user
  // narrows it — the effective value then falls back to the full span, and the
  // filter only counts as active once it's tighter than that span.
  const MINUTES_STEP = 5;
  const minutesBounds = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const a of lib.all) {
      const d = a.durationMin;
      // 0-min entries are reminders (no-time nudges), not timed blocks — they'd
      // peg the slider floor to 0, so they sit out of the duration spread.
      if (typeof d === "number" && Number.isFinite(d) && d > 0) {
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
    if (lo === Infinity) return { min: 0, max: 0 };
    return {
      min: Math.floor(lo / MINUTES_STEP) * MINUTES_STEP,
      max: Math.ceil(hi / MINUTES_STEP) * MINUTES_STEP,
    };
  }, [lib.all]);
  const [minutesRange, setMinutesRange] = useState<[number, number] | null>(null);
  const minutesValue = useMemo<[number, number]>(() => {
    if (!minutesRange) return [minutesBounds.min, minutesBounds.max];
    return [
      Math.max(minutesBounds.min, Math.min(minutesRange[0], minutesBounds.max)),
      Math.min(minutesBounds.max, Math.max(minutesRange[1], minutesBounds.min)),
    ];
  }, [minutesRange, minutesBounds]);
  const minutesActive = minutesValue[0] > minutesBounds.min || minutesValue[1] < minutesBounds.max;
  // Collapse a full-span selection back to null so it reads as "no filter".
  const handleMinutes = useCallback(
    (v: [number, number]) =>
      setMinutesRange(v[0] <= minutesBounds.min && v[1] >= minutesBounds.max ? null : v),
    [minutesBounds]
  );
  // How the library list is ordered — a per-device preference, like ageUnit.
  const [sort, setSort] = useLocalStorage<LibrarySort>("librarySort", "az", (v, fallback) =>
    isLibrarySort(v) ? v : fallback
  );
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

  // The Locations manager (add/rename/remove the place vocabulary), reached from
  // the calendar Location picker's "Manage locations…" footer.
  const [locationsManagerOpen, setLocationsManagerOpen] = useState(false);
  const openLocationsManager = useCallback(() => {
    if (requireStaff("manage locations")) setLocationsManagerOpen(true);
  }, [requireStaff]);

  // The search query persists across tab switches — a quick Calendar
  // round-trip shouldn't cost you your search.

  const filtered = useMemo(
    () =>
      lib.all.filter((a) =>
        matchesActivityFilters(a, {
          cats,
          place,
          age,
          theme,
          themeAssignments: lib.themeAssignments,
          query,
          kitFilter,
          runnableStateById: lib.runnableStateById,
          minutes: minutesActive ? minutesValue : undefined,
        })
      ),
    [
      lib.all,
      lib.runnableStateById,
      lib.themeAssignments,
      cats,
      place,
      age,
      theme,
      query,
      kitFilter,
      minutesActive,
      minutesValue,
    ]
  );
  // Starred is a library-only lens; matchesActivityFilters stays fav-agnostic.
  const libraryItems = useMemo(() => {
    const list = starredOnly ? filtered.filter((a) => lib.favSet.has(a.id)) : filtered;
    return sortActivities(list, sort);
  }, [filtered, starredOnly, lib.favSet, sort]);

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

  // The ONE activity surface — create, edit, and browse all render through
  // DetailSheet. `detail` is the activity it's showing (a fresh blank one in
  // create mode); `detailMode` picks create vs browse; `detailStartEdit` opens
  // an existing activity straight in edit mode (the "Edit" entry points). The
  // event context is display-only strings from the calendar event it was opened
  // from (never calendar types).
  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailMode, setDetailMode] = useState<"create" | "view">("view");
  const [detailStartEdit, setDetailStartEdit] = useState(false);
  // Bumped on every explicit open/edit/create action so the surface remounts
  // fresh — re-seeding its form/play-doc drafts — even when the same activity
  // is re-opened (e.g. context-menu "Edit" on the already-open activity).
  const [detailNonce, setDetailNonce] = useState(0);
  const [detailEventContext, setDetailEventContext] = useState<{
    dateLabel: string;
    timeLabel: string;
    note?: string;
  } | null>(null);
  // In create mode `detail` is a fresh draft not in the catalog, so it must
  // pass through verbatim; otherwise track the live catalog record by id.
  const detailActivity = detail
    ? detailMode === "create"
      ? detail
      : lib.byId[detail.id] || detail
    : null;
  const activityDeepLinkOpenedRef = useRef(false);

  const closeDetail = useCallback(() => {
    setDetail(null);
    setDetailMode("view");
    setDetailStartEdit(false);
    setDetailEventContext(null);
  }, []);

  useEffect(() => {
    if (activityDeepLinkOpenedRef.current) return;
    const activityId = new URLSearchParams(window.location.search).get("activity");
    if (!activityId || !lib.byId[activityId]) return;
    activityDeepLinkOpenedRef.current = true;
    setTab("library");
    setDetailMode("view");
    setDetailStartEdit(false);
    setDetailEventContext(null);
    setDetailNonce((n) => n + 1);
    setDetail(lib.byId[activityId]);
  }, [lib.byId]);

  const openDetail = useCallback((activity: Activity) => {
    setDetailMode("view");
    setDetailStartEdit(false);
    setDetailEventContext(null);
    setDetailNonce((n) => n + 1);
    setDetail(activity);
  }, []);

  // Home's "Browse by type" tiles jump into the Library pre-filtered to one
  // category (or all categories for the catch-all links).
  const goLibrary = useCallback((nextCats: CatFilter) => {
    setCats(nextCats);
    setTab("library");
  }, []);

  const openDetailFromEvent = useCallback((activity: Activity, calEvent: CalendarEvent) => {
    setDetailMode("view");
    setDetailStartEdit(false);
    setDetailEventContext({
      dateLabel: formatEventDateLabel(calEvent.date),
      timeLabel: calEvent.allDay ? "All day" : formatRangeLabel(calEvent.startMin, calEvent.endMin),
      note: calEvent.note,
    });
    setDetailNonce((n) => n + 1);
    setDetail(activity);
  }, []);

  // The desktop calendar shares the left sidebar: CalendarShell portals its
  // activity library into this slot (the same place the Library filters live).
  const [calRail, setCalRail] = useState<HTMLDivElement | null>(null);
  const calRailRef = useCallback((node: HTMLDivElement | null) => setCalRail(node), []);
  // The Print tab shares the same sidebar: PrintTab portals its schedule controls
  // into this slot (no second sidebar) — the same node-state pattern as the
  // calendar rail above.
  const [printRail, setPrintRail] = useState<HTMLDivElement | null>(null);
  const printRailRef = useCallback((node: HTMLDivElement | null) => setPrintRail(node), []);
  // The Materials tab shares the same sidebar: MaterialsTab portals its lenses
  // into this slot (the same node-state pattern as the calendar / print rails).
  const [matRail, setMatRail] = useState<HTMLDivElement | null>(null);
  const matRailRef = useCallback((node: HTMLDivElement | null) => setMatRail(node), []);

  // Create: open the ONE surface blank, in edit mode, on a fresh draft activity
  // (built from BLANK_FORM so the read-mode preview/tint is coherent before the
  // first keystroke). No separate listed-view form remains.
  function openAddActivity() {
    if (!requireStaff("add activities")) return;
    setDetailEventContext(null);
    setDetailStartEdit(false);
    setDetailMode("create");
    setDetailNonce((n) => n + 1);
    setDetail(activityFromForm(BLANK_FORM, "draft-activity"));
  }

  // Edit: open the SAME surface on the existing activity, straight in edit mode.
  function editActivity(activity: Activity) {
    if (!requireStaff("edit activities")) return;
    setDetailEventContext(null);
    setDetailMode("view");
    setDetailStartEdit(true);
    setDetailNonce((n) => n + 1);
    setDetail(activity);
  }

  // Save from the unified surface. Create adds; edit updates. Theme is assigned
  // off the returned themeId either way (unchanged save contract).
  function submitDetail(activity: Activity, runDoc: RunDoc, themeId: string | null) {
    const isEditing = detailMode !== "create";
    const ok = isEditing ? lib.updateActivity(activity, runDoc) : lib.addActivity(activity, runDoc);
    if (!ok) return;
    lib.assignTheme(activity.id, themeId ?? null);
    if (isEditing) {
      // Stay on the surface in browse mode, now showing the live catalog record.
      setDetailMode("view");
      setDetailStartEdit(false);
      setDetail(activity);
    } else {
      setCats(ALL_CATEGORY_IDS);
      lib.setView("catalog");
      setTab("library");
      closeDetail();
    }
  }

  function deleteActivity(activity: Activity) {
    if (lib.deleteActivity(activity)) closeDetail();
  }

  function duplicateActivity(activity: Activity) {
    const copy = lib.duplicateActivity(activity);
    if (!copy) return;
    // Surface the copy where the user is looking: jump to the catalog so the
    // new "(copy)" row is visible at the top.
    setCats(ALL_CATEGORY_IDS);
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
              sort={sort}
              onSort={setSort}
              cats={cats}
              place={place}
              age={age}
              ageUnit={ageUnit}
              onAgeUnit={setAgeUnit}
              theme={theme}
              themes={lib.themes}
              starredOnly={starredOnly}
              materialOptions={lib.materialOptions}
              availableMaterials={lib.activeAvailableMaterials}
              minutes={minutesValue}
              minutesBounds={minutesBounds}
              onCats={setCats}
              onPlace={setPlace}
              onAge={setAge}
              onTheme={setTheme}
              onManageThemes={openThemesManager}
              onStarredOnly={setStarredOnly}
              onMinutes={handleMinutes}
              onToggleMaterial={lib.toggleAvailableMaterial}
              onClearMaterials={lib.clearAvailableMaterials}
              kitFilter={kitFilter}
              onKitFilter={setKitFilter}
            />
          )}
          {tab === "calendar" && isDesktop && <div className="sidenav__calrail" ref={calRailRef} />}
          {tab === "print" && isDesktop && <div className="sidenav__printrail" ref={printRailRef} />}
          {tab === "materials" && isDesktop && <div className="sidenav__matrail" ref={matRailRef} />}
        </nav>

        <main className="app__main" id="main">
          {veil != null && <LoadingVeil className="app__veil" label="One moment…" decorative />}
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
              hasLoaded={cloud.hasLoaded}
            />
          )}

          {tab === "library" && (
            <LibraryTab
              view={lib.view}
              onView={(view: LibraryView) => lib.setView(view)}
              query={query}
              onQuery={setQuery}
              sort={sort}
              onSort={setSort}
              items={libraryItems}
              cats={cats}
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
              minutes={minutesValue}
              minutesBounds={minutesBounds}
              onCats={setCats}
              onPlace={setPlace}
              onAge={setAge}
              onTheme={setTheme}
              onManageThemes={openThemesManager}
              onStarredOnly={setStarredOnly}
              onMinutes={handleMinutes}
              onToggleMaterial={lib.toggleAvailableMaterial}
              onClearMaterials={lib.clearAvailableMaterials}
              kitFilter={kitFilter}
              onKitFilter={setKitFilter}
              onOpen={openDetail}
              isFav={lib.isFav}
              onToggleFav={lib.toggleFav}
              onContextMenu={(activity, e) => libMenu.open(e, activity)}
              onAdd={openAddActivity}
              hasLoaded={cloud.hasLoaded}
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
                onReady={onCalendarReady}
                kitFilter={kitFilter}
                onKitFilter={setKitFilter}
                runnableStateById={lib.runnableStateById}
                onOpenCamps={() => setCampsManagerOpen(true)}
                locationOptions={lib.locations}
                locationColors={lib.locationColors}
                onManageLocations={openLocationsManager}
                onCreateActivity={createCalendarActivity}
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

          {tab === "materials" && (
            <MaterialsTab
              catalog={lib.materialCatalog}
              activities={lib.activitiesWithRefs}
              onHand={lib.availableMaterials}
              onToggleOnHand={lib.toggleAvailableMaterial}
              canEdit={isSignedIn}
              onSetCategory={lib.setMaterialCategory}
              onAddSubstitute={lib.addSubstitute}
              onRemoveSubstitute={lib.removeSubstitute}
              onAddMaterial={lib.addMaterial}
              onOpenActivity={openDetail}
              railSlot={isDesktop ? matRail : null}
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
              events={calendarEvents}
              allEvents={cloud.events}
              runLists={cloud.docs.runLists}
              byId={lib.byId}
              hasLoaded={cloud.hasLoaded}
              syncStatus={cloud.status}
              pendingCount={cloud.pendingCount}
              isAdmin={isAdmin}
              onOpenInvites={() => setTab("admin")}
              activeCamp={campKit.activeCamp}
              campCount={campKit.camps.length}
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
        {locationsManagerOpen && (
          <ListManagerModal
            title="Locations"
            intro="Locations are the places a block happens — like the Gym, the Pool, or a classroom. Pick one or more on any event from its Location field; here you can add, rename, remove, and recolor them (the color shows when the calendar is set to Color by → Location)."
            items={lib.locations.map((place) => ({
              id: place,
              label: place,
              // The resolved color (override → built-in default) for the static
              // swatch shown while renaming; the picker reads value/fallback.
              tint: locationColor([place], lib.locationColors),
              tintValue: lib.locationColors[place],
              tintFallback: locationColor([place]),
            }))}
            createPlaceholder="e.g. Pool"
            createLabel="Add place"
            emptyHint="No places yet. Add one, then set it on an event from its Location field."
            onCreate={(name) => {
              if (requireStaff("manage locations")) lib.createLocation(name);
            }}
            onRename={(id, name) => {
              if (requireStaff("manage locations")) lib.renameLocation(id, name);
            }}
            onChangeTint={(id, color) => {
              if (requireStaff("manage locations")) lib.setLocationColor(id, color);
            }}
            onDelete={(item) => {
              if (!requireStaff("manage locations")) return;
              if (
                window.confirm(
                  "Remove the “" + item.label + "” location? Events that already use it keep it; it just won’t be offered as a choice."
                )
              ) {
                lib.deleteLocation(item.id);
              }
            }}
            onClose={() => setLocationsManagerOpen(false)}
          />
        )}
        {detailActivity && (
          <DetailSheet
            // Remount per open action so the form/play-doc drafts re-seed
            // cleanly when the surface switches what (or how) it's showing.
            key={"detail-" + detailNonce}
            activity={detailActivity}
            mode={detailMode}
            startEditing={detailStartEdit}
            isFav={lib.isFav}
            onToggleFav={lib.toggleFav}
            onClose={() => {
              closeDetail();
              setPrintActivityId(null); // a stale book never outlives its viewer
            }}
            onSubmit={isSignedIn ? submitDetail : undefined}
            onDuplicate={duplicateActivity}
            onDelete={deleteActivity}
            onPrint={requestPrint}
            availableMaterials={lib.availableMaterials}
            materialCatalog={lib.materialCatalog}
            onToggleMaterial={lib.toggleAvailableMaterial}
            runDoc={lib.resolveRunDoc(detailActivity)}
            onSetRating={isSignedIn ? lib.setRating : undefined}
            onSaveRunDoc={isSignedIn ? lib.saveRunDoc : undefined}
            themeKit={{
              themes: lib.themes,
              initialThemeId: detailMode === "create" ? "" : lib.themeAssignments[detailActivity.id] ?? "",
              onCreate: lib.createTheme,
            }}
            ageUnit={ageUnit}
            onAgeUnit={setAgeUnit}
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
