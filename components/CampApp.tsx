"use client";

// The app shell: two surfaces (Library, Calendar) plus the admin tab.
// Navigation, auth, the activity viewer, and the add/edit sheet live here;
// activity-domain state is in useActivityLibrary and persistence in
// lib/cloudStore (localStorage for anon, cloud-synced once signed in).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import type { Activity, LibraryView, TabId } from "@/lib/types";
import { usePrintIntent } from "@/lib/print/usePrintIntent";
import { ADMIN_EMAIL, isAdminEmail, staffActionGate, type StaffActionGate } from "@/lib/auth";
import { matchesActivityFilters, sortActivities, isLibrarySort, type AgeFilter, type CatFilter, type KitLens, type LibrarySort, type PlaceFilter, type ThemeFilter } from "@/lib/activity/activityFilters";
import { ALL_CATEGORY_IDS, locationColor, type AgeUnit } from "@/lib/content/data";
import { catalogNameFor } from "@/lib/materials/materialCatalog";
import { readStored, useLocalStorage, writeStored, type StorageValidator } from "@/lib/cloud/store";
import { AgeUnitProvider } from "./ui/ageUnit";
import { formatEventDateLabel, todayKey } from "@/lib/calendar/dates";
import { formatClock, formatRangeLabel } from "@/lib/calendar/time";
import {
  campDayWindow,
  campTint,
  clampOverrideWindow,
  hourOptionMinutes,
  OVERRIDE_EARLIEST_OPEN_MIN,
  OVERRIDE_LATEST_CLOSE_MIN,
  type Camp,
  type CampSnapMin,
  type Weekday,
} from "@/lib/content/camps";
import { createGuideId, type GuideBand } from "@/lib/calendar/guides";
import type { CalendarEvent, DateKey } from "@/lib/calendar/types";
import { applyCustomStamp } from "@/lib/calendar/recurrence";
import { healEvent } from "@/lib/calendar/adapter";
import { useCloudUserData } from "@/lib/cloud/cloudStore";
import { migrateAnonScopeKeys, migrateLegacyStorageKeys } from "@/lib/cloud/storageScope";
import type { RunDoc } from "@/lib/activity/runList";
import { activityFromForm, BLANK_FORM, newActivityId, quickActivity } from "@/lib/activity/activityForm";
import { BrandMark, CampIcon } from "./ui/icons";
import { ContextMenu } from "./floating/ContextMenu";
import { useContextMenu } from "./floating/useContextMenu";
import { ActivityBookPrint } from "./activity/ActivityBookPrint";
import { AdminInviteCodes } from "./auth/AdminInviteCodes";
import { usePreviewAuth } from "./auth/AuthControls";
import { ConfirmHost, requestConfirm } from "./ui/ConfirmDialog";
import { SubscribeFeedButton } from "./calendar/SubscribeFeedButton";
import { DetailSheet } from "./activity/DetailSheet";
import { Filters } from "./library/Filters";
import { KitModal } from "./materials/KitModal";
import { LibraryTab } from "./library/LibraryTab";
import {
  CampDayStructure,
  GuidesSection,
  ListManagerModal,
} from "./ui/ListManagerModal";
import { CampEditorPopup } from "./camps/CampEditorPopup";
import { CampsRail } from "./camps/CampsRail";
import { Modal } from "./ui/Modal";
import { LoadingVeil, MiniSeg, ToggleSwitch } from "./ui/primitives";
import { Select } from "./floating/Select";
import { DatePopover } from "./floating/DatePopover";
import type { SchedulePrintData } from "./print/SchedulePrintDocument";
import { InviteSignUp } from "./auth/InviteSignUp";
import { ProfileControl } from "./auth/ProfileControl";
import { StaffSignIn } from "./auth/StaffSignIn";
import { TabBoundary } from "./ui/TabBoundary";
import { useActivityLibrary } from "./hooks/useActivityLibrary";
import { useCamps } from "./hooks/useCamps";
import { useDeviceShape } from "./hooks/useDeviceShape";

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

type NavTab = { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] };

// Calendar is now the app's home — the sidebar brand mark goes there, and it's
// where the retired Home tab's Now/Next glance now lives (the calendar rail's
// "Today" card). Materials isn't a tab (or even a Library collection) at all —
// it's the Kit modal, reached from the Library toolbar's Kit dropdown.
const TABS: NavTab[] = [
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "calendar", label: "Calendar", icon: CampIcon.Calendar },
  { id: "print", label: "Print", icon: CampIcon.Print },
];
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
const RESTORABLE_TABS = ["library", "calendar", "print"] as const;
// Legacy stored tabs that no longer exist as surfaces migrate forward: the old
// "home" tab is now the calendar; "materials" was once its own tab (then a
// Library collection) and is now the Kit modal — there's no surface of its own
// to land on any more, so it just restores to the library. "staff" was a
// dedicated tab, now a bottom-left profile popover — there's nothing to land
// on, so it falls back to the calendar. Everything else falls through.
const LEGACY_TAB_MIGRATIONS: Record<string, TabId> = {
  home: "calendar",
  materials: "library",
  staff: "calendar",
};
const parseStoredTab: StorageValidator<TabId | null> = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  if ((RESTORABLE_TABS as readonly string[]).includes(value)) return value as TabId;
  return LEGACY_TAB_MIGRATIONS[value] ?? fallback;
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

// The ONE auth modal: covers both an interrupted edit action (signed-out,
// attempting a staff-gated change) and every intentional sign-in / sign-up
// entry point (the profile popover's "Sign in" row, a ?auth= deep link). It
// replaced the old dedicated Staff tab, which no longer exists as a surface.
function StaffPromptModal({
  prompt,
  authEnabled,
  onClose,
  onRequestSignUp,
  onRequestSignIn,
}: {
  prompt: StaffPrompt;
  authEnabled: boolean;
  onClose: () => void;
  onRequestSignUp: () => void;
  onRequestSignIn: () => void;
}) {
  return (
    <Modal label="Staff sign-in" onClose={onClose} overlayProps={{ className: "overlay--auth" }}>
      {authEnabled ? (
        prompt.mode === "sign-up" ? (
          <>
            <InviteSignUp />
            <p className="auth-form__hint">
              Already have an account?{" "}
              <button type="button" className="auth-form__link" onClick={onRequestSignIn}>
                Sign in
              </button>
            </p>
          </>
        ) : (
          <StaffSignIn
            returnTo={prompt.returnTo}
            message={prompt.message}
            onComplete={onClose}
            onRequestSignUp={onRequestSignUp}
          />
        )
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


export function CampApp({ initialTab = "calendar" }: { initialTab?: TabId } = {}) {
  const [tab, setTabRaw] = useState<TabId>(initialTab);
  // Only the main app entry remembers/restores its tab. The /admin route mounts
  // with initialTab "admin" — a deliberate, server-gated destination that must
  // neither be hijacked by the remembered tab nor overwrite it. Calendar is the
  // default landing (the app's home), so the main app persists its tab.
  const persistTab = initialTab === "calendar";
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
      // Re-selecting the tab you're already on (the nav item, or the brand mark
      // while already on Calendar) is a no-op: no veil, no state churn. Without
      // this guard, CalendarShell never remounts on a same-tab transition (its
      // internal onReady latch has already fired for this mount and won't fire
      // again), so the veil raised below would have nothing to dismiss it except
      // the blunt CAL_VEIL_MAX_MS safety timeout — a ~2.5s cover over nothing.
      if (next === prev) return prev;
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
  // surface with no flash and the heavy-tab veil raised in the same render
  // (setTab handles that). Deep links (?auth=, ?activity=) are explicit intents
  // that win — their own effects set the tab, so skip restore for them. A
  // legacy stored "materials" now just migrates to "library" via
  // parseStoredTab — Materials is a modal, not a landable collection, so there's
  // no second surface to re-select on top of the tab.
  useLayoutEffect(() => {
    if (!persistTab) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") || params.get("activity")) return;
    const rawStored = readStored<string | null>(STORED_TAB_KEY, null, (v, f) =>
      typeof v === "string" ? v : f
    );
    const stored = parseStoredTab(rawStored, null);
    if (stored) setTab(stored);
    // Mount-only: restore once, then let normal navigation drive the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every tab change (runs after the restore layout effect on mount, so
  // it never clobbers the remembered value with the initial default tab).
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
  // The last sync error the user explicitly dismissed — a DIFFERENT error
  // message re-arms the visible banner (see the app-toast below).
  const [dismissedSyncError, setDismissedSyncError] = useState<string | null>(null);
  // The one auth modal, covering interrupted edit actions AND every
  // intentional sign-in / sign-up entry point (the profile popover, a ?auth=
  // deep link) — there is no dedicated Staff tab to land on any more.
  const [staffPrompt, setStaffPrompt] = useState<StaffPrompt | null>(null);
  // Lifted so the sidebar's sync pill AND the sidebar's profile row (and the
  // mobile tab bar's Profile item) all open the exact same popover instance.
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  // The mobile tab bar's Profile button anchors the popover on phone/tablet,
  // where the sidebar (and its own profile row) is display:none.
  const profileTabRef = useRef<HTMLButtonElement | null>(null);

  const openSignUpPrompt = useCallback(() => {
    setStaffPrompt({ allowed: false, message: "Create a staff account.", signInHref: null, mode: "sign-up", returnTo: currentReturnPath() });
  }, []);

  const openSignInPrompt = useCallback(() => {
    setStaffPrompt({
      allowed: false,
      message: "Existing staff can sign in with Google or password.",
      signInHref: null,
      mode: "sign-in",
      returnTo: currentReturnPath(),
    });
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const mode = url.searchParams.get("auth");
    if (mode !== "sign-in" && mode !== "sign-up") return;
    if (auth.enabled && !auth.ready) return;

    cleanAuthRouteUrl();
    if (auth.signedIn || auth.providerSignedIn) return;
    // A ?auth= deep link is an intentional ask — open the auth modal directly.
    if (mode === "sign-up") openSignUpPrompt();
    else openSignInPrompt();
  }, [auth.enabled, auth.providerSignedIn, auth.ready, auth.signedIn, openSignInPrompt, openSignUpPrompt]);

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
  // Mark a material as `plenty` in the catalog — the calendar Gather popover's "We
  // have several" action, resolving a same-day hard conflict (we own enough copies
  // to share across overlapping blocks). Mirrors useActivityLibrary's
  // setMaterialConsumable: mints an entry under the FROZEN id (carrying the display
  // label) when the row is derived-only, else flips the flag on the existing entry.
  // Staff-gated; inert for anonymous / read-only. Ids are frozen forever.
  const markMaterialPlenty = useCallback(
    (id: string, label: string) => {
      if (!requireStaff("edit materials")) return;
      if (!id) return;
      cloud.setDoc("materialCatalog", (previous) => {
        if (previous.some((entry) => entry.id === id)) {
          return previous.map((entry) => (entry.id === id ? { ...entry, plenty: true } : entry));
        }
        return [...previous, { id, name: label.trim() || id, plenty: true }];
      });
    },
    [cloud, requireStaff]
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
  // The WIDER clock options (5:00–22:00, 15-min steps) for the day-structure
  // OVERRIDE editors — weekday hours, dated exceptions, and guidance bands can
  // reach the wider override bounds (a late finale), where the base 6:00–20:00
  // range would clip and the Select couldn't represent a stored 20:30 close.
  const overrideHourOptions = useMemo(() => {
    const out: { value: number; label: string }[] = [];
    for (let m = OVERRIDE_EARLIEST_OPEN_MIN; m <= OVERRIDE_LATEST_CLOSE_MIN; m += 15) {
      out.push({ value: m, label: formatClock(m) });
    }
    return out;
  }, []);

  // ---- Per-camp day-structure mutators (weekday hours / dated exceptions / snap)
  // and the guides doc. All write straight through cloud.setDoc — the
  // camps mutators in useCamps.ts stay lean; these day-structure edits (a rarely
  // touched authoring surface) live with the manager UI that drives them. Every
  // window is forced through clampOverrideWindow so a payload can't escape bounds.
  const setCampWeekdayHours = useCallback(
    (id: string, weekday: Weekday, value: "default" | "closed" | { openMin: number; closeMin: number }) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const weekdayHours = { ...(c.weekdayHours ?? {}) };
          if (value === "default") delete weekdayHours[weekday];
          else if (value === "closed") weekdayHours[weekday] = null;
          else weekdayHours[weekday] = clampOverrideWindow(value.openMin, value.closeMin);
          const next: Camp = { ...c };
          if (Object.keys(weekdayHours).length) next.weekdayHours = weekdayHours;
          else delete next.weekdayHours;
          return next;
        })
      );
    },
    [cloud, requireStaff]
  );
  const setCampDateHours = useCallback(
    (id: string, date: DateKey, value: "closed" | { openMin: number; closeMin: number } | null) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const dateHours = { ...(c.dateHours ?? {}) };
          if (value === null) delete dateHours[date];
          else if (value === "closed") dateHours[date] = null;
          else dateHours[date] = clampOverrideWindow(value.openMin, value.closeMin);
          const next: Camp = { ...c };
          if (Object.keys(dateHours).length) next.dateHours = dateHours;
          else delete next.dateHours;
          return next;
        })
      );
    },
    [cloud, requireStaff]
  );
  const setCampSnap = useCallback(
    (id: string, snapMin: CampSnapMin) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) => prev.map((c) => (c.id === id ? { ...c, snapMin } : c)));
    },
    [cloud, requireStaff]
  );

  // Per-camp guidance-band mutators. Guidance bands are PER-CAMP now — each camp
  // shapes its day differently. A camp that hasn't set its own inherits the
  // legacy shared `guides` doc as a display baseline; the first edit here FORKS
  // that baseline into the camp (c.guides ?? cloud.docs.guides), after which the
  // camp's bands diverge freely and never touch the shared doc again.
  const addCampGuide = useCallback(
    (campId: string) => {
      if (!requireStaff("manage camps")) return;
      const band: GuideBand = {
        id: createGuideId(),
        label: "New band",
        startMin: 9 * 60,
        endMin: 10 * 60,
        weekdays: [1, 2, 3, 4, 5],
      };
      cloud.setDoc("camps", (prev) =>
        prev.map((c) => (c.id === campId ? { ...c, guides: [...(c.guides ?? cloud.docs.guides), band] } : c))
      );
    },
    [cloud, requireStaff]
  );
  const updateCampGuide = useCallback(
    (campId: string, id: string, patch: Partial<GuideBand>) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) =>
          c.id === campId
            ? { ...c, guides: (c.guides ?? cloud.docs.guides).map((b) => (b.id === id ? { ...b, ...patch } : b)) }
            : c
        )
      );
    },
    [cloud, requireStaff]
  );
  const deleteCampGuide = useCallback(
    (campId: string, id: string) => {
      if (!requireStaff("manage camps")) return;
      cloud.setDoc("camps", (prev) =>
        prev.map((c) =>
          c.id === campId ? { ...c, guides: (c.guides ?? cloud.docs.guides).filter((b) => b.id !== id) } : c
        )
      );
    },
    [cloud, requireStaff]
  );

  // The camp manager (add / switch / rename / delete) — reached from the
  // sidebar's "Camps" section (desktop) or the calendar settings sheet
  // (mobile/tablet). Camps are a rarely-used option, so they no longer occupy
  // a permanent header pill. Opening is ungated (switching is a local view
  // pref); create/rename/delete stay staff-gated below.
  const [campsManagerOpen, setCampsManagerOpen] = useState(false);
  // Desktop camp management: which camp's editor popup is open (null = none) and
  // the global day-structure guidance-bands modal. The camps ListManagerModal
  // (campsManagerOpen) now serves ONLY the mobile/tablet settings sheet
  // (onOpenCamps); on desktop the rail edits each camp in CampEditorPopup —
  // including that camp's own guidance bands.
  const [editingCampId, setEditingCampId] = useState<string | null>(null);

  // The Kit availability editor floats over the app as a modal (see KitModal),
  // reached from the filter rail's Kit group ("Edit stock…", see Filters) —
  // there's no toolbar dropdown or Activities|Materials toggle to wire up, and
  // MaterialsTab's own filter state (query/stock/restock/sort/pendingAdd) is
  // owned by the modal itself, not lifted here.
  const [kitModalOpen, setKitModalOpen] = useState(false);

  // Library filters. State lives here because the desktop filter rail
  // renders inside the sidenav, outside LibraryTab.
  const [cats, setCats] = useState<CatFilter>(ALL_CATEGORY_IDS);
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [theme, setTheme] = useState<ThemeFilter>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  // The kit availability lens (All / Ready / +Almost). Inert while the stock map
  // is unset — the Filters row surfaces a hint pointing at the Materials tab.
  const [kitLens, setKitLens] = useState<KitLens>("all");
  // Browse-by-material: set from the Materials tab's "Used by N →" jump. A single
  // material id the Library narrows to, shown as a dismissible chip. Re-homes the
  // browse value the retired uses-ANY kit picker used to carry.
  const [materialId, setMaterialId] = useState<string | null>(null);
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

  // The stock map is UNSET when the effective (fold-aware) map has no entries —
  // the kit lens is inert in that case, so the Filters row shows a hint.
  const kitUnset = useMemo(() => Object.keys(lib.kitStock).length === 0, [lib.kitStock]);

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
          kitLens,
          kitStock: lib.kitStock,
          materialCatalog: lib.materialCatalog,
          materialId: materialId ?? undefined,
          minutes: minutesActive ? minutesValue : undefined,
        })
      ),
    [
      lib.all,
      lib.kitStock,
      lib.materialCatalog,
      lib.themeAssignments,
      cats,
      place,
      age,
      theme,
      query,
      kitLens,
      materialId,
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
  // The id of the calendar event the detail sheet was opened FROM (null when
  // library-opened). Kept SEPARATE from the display-only eventContext so the sheet
  // can patch that specific placement (per-day material subs) without eventContext
  // ever carrying a live calendar type.
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
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
    setDetailEventId(null);
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
    setDetailEventId(null);
    setDetailNonce((n) => n + 1);
    setDetail(lib.byId[activityId]);
  }, [lib.byId]);

  const openDetail = useCallback((activity: Activity) => {
    setDetailMode("view");
    setDetailStartEdit(false);
    setDetailEventContext(null);
    setDetailEventId(null);
    setDetailNonce((n) => n + 1);
    setDetail(activity);
  }, []);

  // The Kit modal's "Used by N activities →" jump: close the modal and narrow
  // the Library to one material. The row promises an EXACT count ("Used by 3
  // →"), so every OTHER filter that could hide some of those activities is
  // cleared too (materials-4) — not just Type, which was the only one reset
  // before. A stale Age/Place/Theme/Starred/Duration/search left on from a
  // prior Library session used to silently shrink the landed list below the
  // promised count with no explanation; now the jump always shows exactly what
  // it promised. The chip in the Filters rail dismisses the material narrowing
  // back to null on its own.
  const browseMaterial = useCallback((id: string) => {
    setMaterialId(id);
    setCats(ALL_CATEGORY_IDS);
    setPlace("All");
    setAge("All");
    setTheme("All");
    setStarredOnly(false);
    setMinutesRange(null);
    setKitLens("all");
    setQuery("");
    setKitModalOpen(false);
    setTab("library");
  }, []);

  // The reverse jump: the filter rail's "Edit stock…" row opens the Kit modal.
  // It floats over whatever surface is showing, so — unlike the old Materials
  // collection — opening it never yanks the user over to the Library tab.
  const openKitSetup = useCallback(() => setKitModalOpen(true), []);
  // The chip label resolves the active material id to its catalog name (or a
  // humanized slug), so the removable "Material: <name> ×" reads for humans.
  const materialLabel = useMemo(
    () => (materialId ? catalogNameFor(lib.materialCatalog, materialId) : null),
    [materialId, lib.materialCatalog]
  );

  const openDetailFromEvent = useCallback((activity: Activity, calEvent: CalendarEvent) => {
    setDetailMode("view");
    setDetailStartEdit(false);
    setDetailEventContext({
      dateLabel: formatEventDateLabel(calEvent.date),
      timeLabel: calEvent.allDay ? "All day" : formatRangeLabel(calEvent.startMin, calEvent.endMin),
      note: calEvent.note,
    });
    setDetailEventId(calEvent.id);
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

  // Create: open the ONE surface blank, in edit mode, on a fresh draft activity
  // (built from BLANK_FORM so the read-mode preview/tint is coherent before the
  // first keystroke). No separate listed-view form remains.
  function openAddActivity() {
    if (!requireStaff("add activities")) return;
    setDetailEventContext(null);
    setDetailEventId(null);
    setDetailStartEdit(false);
    setDetailMode("create");
    setDetailNonce((n) => n + 1);
    setDetail(activityFromForm(BLANK_FORM, "draft-activity"));
  }

  // Edit: open the SAME surface on the existing activity, straight in edit mode.
  function editActivity(activity: Activity) {
    if (!requireStaff("edit activities")) return;
    setDetailEventContext(null);
    setDetailEventId(null);
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

  async function deleteActivity(activity: Activity) {
    if (await lib.deleteActivity(activity)) closeDetail();
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
      // Kit stock + catalog power the print shopping list (missing & low only).
      kitStock: lib.kitStock,
      materialCatalog: lib.materialCatalog,
    }),
    [
      cloud.events,
      lib.byId,
      lib.resolveRunDoc,
      lib.themeOf,
      campKit.camps,
      lib.kitStock,
      lib.materialCatalog,
    ]
  );

  const isAdmin = auth.session.status === "authenticated" && isAdminEmail(auth.session.user.email);
  // The working surfaces are Library / Calendar / Print. Account/auth lives in
  // the bottom-left profile popover now, not a nav tab. ONE in-app path to
  // invite codes (the profile popover's "Manage invite codes" row; /admin
  // stays as the server-gated deep link) — the admin tab only APPEARS while
  // you're actually on the admin surface, so it still has a nav highlight +
  // back target but no longer duplicates the entry point.
  const navTabs = useMemo(() => (tab === "admin" ? [...TABS, ADMIN_TAB] : TABS), [tab]);

  // The camp whose editor popup is open (desktop), resolved from editingCampId.
  // Falls back to null when the id no longer resolves (e.g. just deleted), which
  // unmounts the popup.
  const editingCamp = editingCampId != null ? campKit.camps.find((c) => c.id === editingCampId) ?? null : null;

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
            onClick={() => setTab("calendar")}
            aria-label="Camp Library — go to the calendar"
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
          {/* THE RAIL ZONE — one scroll container for every tab-scoped section
              below the primary nav, so sections can never overlap and a tall
              roster (Camps) or a long control stack (Print) simply scrolls
              instead of overflowing into whatever sits after it. Only one of
              these renders at a time (gated by `tab`), so there's never more
              than one scrollbar. */}
          <div className="sidenav__scroll">
            {/* The Library's filter rail — Materials no longer gets a second
                sidebar ledger here (its own filter state now lives inside the
                Kit modal, see KitModal), so this slot is Activities-only. */}
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
                kitLens={kitLens}
                kitUnset={kitUnset}
                minutes={minutesValue}
                minutesBounds={minutesBounds}
                materialId={materialId}
                materialLabel={materialLabel}
                onCats={setCats}
                onPlace={setPlace}
                onAge={setAge}
                onTheme={setTheme}
                onManageThemes={openThemesManager}
                onStarredOnly={setStarredOnly}
                onMinutes={handleMinutes}
                onKitLens={setKitLens}
                onMaterial={() => setMaterialId(null)}
                onSetupKit={openKitSetup}
              />
            )}
            {tab === "calendar" && isDesktop && <div className="sidenav__calrail" ref={calRailRef} />}
            {/* The ONE entry point into camps on desktop — a collapsed-by-default
                section below the calendar rail. The deep editor (hours, rename,
                delete) still opens as the existing camps modal — guidance bands
                moved OUT of it (see CalendarViewSettings' "Day structure" row);
                this section only picks the active camp or hands off to the hours
                editor. Sits INSIDE the shared scroll zone (not a fixed-to-bottom
                sibling), so a long camp roster scrolls with the rest of the rail
                instead of overlapping it. */}
            {tab === "calendar" && isDesktop && (
              <CampsRail
                camps={campKit.camps}
                activeCampId={campKit.activeCampId}
                onSwitch={campKit.switchCamp}
                onEditCamp={(id) => setEditingCampId(id)}
                onAddCamp={async (name) => {
                  if (!requireStaff("manage camps")) return;
                  const created = await campKit.createCamp(name);
                  if (created) setEditingCampId(created.id);
                }}
              />
            )}
            {tab === "print" && isDesktop && <div className="sidenav__printrail" ref={printRailRef} />}
          </div>
          {/* The sidebar's ONE fixed foot: never scrolls, never overlapped by the
              rail zone above it (a real border-top divider, not a margin-top:auto
              float over shared overflow). Sync state where edits actually happen —
              quiet by default: the sync pill only renders when it carries a signal
              (pending writes, offline, a refused write), and now opens the SAME
              profile popover as the row below it (there's no dedicated Staff tab
              any more). The profile row is the app's one bottom-left account
              control — always visible, avatar + name + chevron, opening account
              identity, sync health, admin entry, and auth actions. */}
          <div className="sidenav__foot">
            {(cloud.pendingCount > 0 || cloud.status === "offline" || cloud.syncError) && (
              <button
                type="button"
                className={"sidenav__sync" + (cloud.syncError ? " is-error" : "")}
                onClick={() => setProfileMenuOpen(true)}
              >
                <span className="sidenav__sync-dot" aria-hidden />
                {cloud.syncError
                  ? "Some changes didn't save"
                  : cloud.pendingCount > 0
                    ? cloud.pendingCount + " pending"
                    : "Offline — will sync"}
              </button>
            )}
            <ProfileControl
              session={auth.session}
              authEnabled={auth.enabled}
              syncStatus={cloud.status}
              pendingCount={cloud.pendingCount}
              syncError={cloud.syncError}
              isAdmin={isAdmin}
              onOpenInvites={() => setTab("admin")}
              onSignIn={openSignInPrompt}
              onSwitchAccount={() => auth.signOut("/?auth=sign-in")}
              onSignOut={() => auth.signOut("/")}
              open={profileMenuOpen}
              onOpenChange={setProfileMenuOpen}
            />
          </div>
        </nav>

        <main className="app__main" id="main">
          {veil != null && <LoadingVeil className="app__veil" label="One moment…" decorative />}
          {tab === "calendar" && <h1 className="sr-only">Calendar</h1>}
          {/* The Library is one surface now — no second collection to name, so
              its sr-only page title is unconditional whenever the tab shows
              (materials-7 predates the Kit modal; kept as a single heading). */}
          {tab === "library" && <h1 className="sr-only">Library</h1>}

          {tab === "library" && (
            <TabBoundary>
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
              kitLens={kitLens}
              kitUnset={kitUnset}
              minutes={minutesValue}
              minutesBounds={minutesBounds}
              materialId={materialId}
              materialLabel={materialLabel}
              onCats={setCats}
              onPlace={setPlace}
              onAge={setAge}
              onTheme={setTheme}
              onManageThemes={openThemesManager}
              onStarredOnly={setStarredOnly}
              onMinutes={handleMinutes}
              onKitLens={setKitLens}
              onMaterial={() => setMaterialId(null)}
              onSetupKit={openKitSetup}
              onOpen={openDetail}
              isFav={lib.isFav}
              onToggleFav={lib.toggleFav}
              onContextMenu={(activity, e) => libMenu.open(e, activity)}
              onAdd={openAddActivity}
              hasLoaded={cloud.hasLoaded}
            />
            </TabBoundary>
          )}

          {tab === "calendar" && (
            <TabBoundary>
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
                kitStock={lib.kitStock}
                materialCatalog={lib.materialCatalog}
                setStockState={lib.setStockState}
                markPlenty={markMaterialPlenty}
                onReady={onCalendarReady}
                onOpenCamps={() => setCampsManagerOpen(true)}
                locationOptions={lib.locations}
                locationColors={lib.locationColors}
                onManageLocations={openLocationsManager}
                onCreateActivity={createCalendarActivity}
                dayWindow={calendarDayWindow}
                activeCamp={campKit.activeCamp}
                // Guidance bands are per-camp: the active camp's own set, or the
                // legacy shared `guides` doc as a baseline (also the source when
                // no camp is active — the single shared-calendar mode).
                guides={campKit.activeCamp?.guides ?? cloud.docs.guides}
                // Only wire the Subscribe control when signed in — anonymous
                // visitors have no feed, and gating here keeps the rail/sheet
                // section wrapper from rendering an empty box.
                subscribeControl={
                  isSignedIn ? (
                    <SubscribeFeedButton
                      activeCampId={campKit.activeCampId}
                      activeCampName={campKit.activeCamp?.name ?? null}
                    />
                  ) : undefined
                }
              />
            </div>
            </TabBoundary>
          )}

          {tab === "print" && (
            <TabBoundary>
            <PrintTab
              data={printData}
              activeCampId={campKit.activeCampId}
              railSlot={printRail}
              printHost={printHost}
              announce={setLiveMsg}
            />
            </TabBoundary>
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
        </main>

        <nav className="tabbar" aria-label="Sections">
          {TABS.map((t) => (
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
          {/* The mobile equivalent of the sidebar's profile row — same popover
              (anchored to THIS button via profileTabRef), opened as a bottom
              sheet (FloatingLayer docks under 1024px). */}
          <button
            ref={profileTabRef}
            type="button"
            className={profileMenuOpen ? "is-active" : ""}
            onClick={() => setProfileMenuOpen(!profileMenuOpen)}
            aria-label="Profile"
            aria-haspopup="dialog"
            aria-expanded={profileMenuOpen}
            title="Profile"
          >
            <CampIcon.User />
            <span>Profile</span>
          </button>
        </nav>
        {/* Mounted once, outside the sidebar-only foot, so the mobile tab bar's
            Profile button can open the exact same popover instance below the
            desk breakpoint (where the sidebar itself is display:none). */}
        {!isDesktop && (
          <ProfileControl
            session={auth.session}
            authEnabled={auth.enabled}
            syncStatus={cloud.status}
            pendingCount={cloud.pendingCount}
            syncError={cloud.syncError}
            isAdmin={isAdmin}
            onOpenInvites={() => setTab("admin")}
            onSignIn={openSignInPrompt}
            onSwitchAccount={() => auth.signOut("/?auth=sign-in")}
            onSignOut={() => auth.signOut("/")}
            open={profileMenuOpen}
            onOpenChange={setProfileMenuOpen}
            hideTrigger
            externalTriggerRef={profileTabRef}
          />
        )}

        <div className="sr-only" role="status" aria-live="polite">
          {liveMsg}
        </div>

        {/* A write the server refused must be VISIBLE, not just announced to
            screen readers — the drop-to-unwedge outbox behavior stays, this is
            purely surfacing. Dismiss is per-message: a new error re-shows. */}
        {cloud.syncError && cloud.syncError !== dismissedSyncError && (
          <div className="app-toast" role="alert">
            <span>{cloud.syncError}</span>
            <button type="button" onClick={() => setDismissedSyncError(cloud.syncError)}>
              Dismiss
            </button>
          </div>
        )}

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
            onDelete={async (item) => {
              const ok = await requestConfirm({
                title: "Delete the “" + item.label + "” theme?",
                body: "It is removed from any activities using it.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) lib.deleteTheme(item.id);
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
              // camps-6: a stable per-camp identity tint (derived, not stored),
              // rendered as the same static swatch dot Themes rows use.
              tint: campTint(c.id, campKit.camps),
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
            onDelete={async (item) => {
              if (!requireStaff("manage camps")) return;
              const ok = await requestConfirm({
                title: "Delete the “" + item.label + "” camp?",
                body: "Its events stay on the calendar but are no longer grouped.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) campKit.deleteCamp(item.id, { announce: true });
            }}
            renderRowExtra={(item) => {
              const camp = campKit.camps.find((c) => c.id === item.id);
              if (!camp) return null;
              // Guidance bands are per-camp now — this camp's own set, or the
              // inherited legacy shared baseline until its first edit forks a copy.
              return (
                <>
                  <CampDayStructure
                    camp={camp}
                    hourOptions={overrideHourOptions}
                    onSetWeekday={setCampWeekdayHours}
                    onSetDate={setCampDateHours}
                    onSetSnap={setCampSnap}
                  />
                  <GuidesSection
                    label="Guidance bands"
                    guides={camp.guides ?? cloud.docs.guides}
                    hourOptions={overrideHourOptions}
                    canEdit={isSignedIn}
                    onAdd={() => addCampGuide(camp.id)}
                    onUpdate={(id, patch) => updateCampGuide(camp.id, id, patch)}
                    onDelete={(id) => deleteCampGuide(camp.id, id)}
                  />
                </>
              );
            }}
            onClose={() => setCampsManagerOpen(false)}
          />
        )}
        {/* Desktop per-camp editor popup — opened from the Camps rail's Edit
            pencil or right after creating a camp. Mobile/tablet still edits camps
            through the ListManagerModal above (its settings sheet). */}
        {editingCamp && (
          <CampEditorPopup
            camp={editingCamp}
            tint={campTint(editingCamp.id, campKit.camps)}
            hourOptions={campHourOptions}
            overrideHourOptions={overrideHourOptions}
            onRename={(name) => {
              if (requireStaff("manage camps")) campKit.renameCamp(editingCamp.id, name);
            }}
            onSetOpen={(v) => {
              if (requireStaff("manage camps")) campKit.adjustCampHours(editingCamp.id, "open", v);
            }}
            onSetClose={(v) => {
              if (requireStaff("manage camps")) campKit.adjustCampHours(editingCamp.id, "close", v);
            }}
            onSetWeekday={(dow, val) => setCampWeekdayHours(editingCamp.id, dow, val)}
            onSetDate={(date, val) => setCampDateHours(editingCamp.id, date, val)}
            onSetSnap={(s) => setCampSnap(editingCamp.id, s)}
            guides={editingCamp.guides ?? cloud.docs.guides}
            canEditGuides={isSignedIn}
            onAddGuide={() => addCampGuide(editingCamp.id)}
            onUpdateGuide={(id, patch) => updateCampGuide(editingCamp.id, id, patch)}
            onDeleteGuide={async (id) => {
              if (!requireStaff("manage camps")) return;
              const ok = await requestConfirm({
                title: "Delete this guidance band?",
                body: "This can't be undone.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) deleteCampGuide(editingCamp.id, id);
            }}
            onDelete={async () => {
              if (!requireStaff("manage camps")) return;
              const ok = await requestConfirm({
                title: "Delete the “" + editingCamp.name + "” camp?",
                body: "Its events stay on the calendar but are no longer grouped.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) {
                campKit.deleteCamp(editingCamp.id, { announce: true });
                setEditingCampId(null);
              }
            }}
            onClose={() => setEditingCampId(null)}
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
            onDelete={async (item) => {
              if (!requireStaff("manage locations")) return;
              const ok = await requestConfirm({
                title: "Remove the “" + item.label + "” location?",
                body: "Events that already use it keep it; it just won’t be offered as a choice.",
                confirmLabel: "Remove",
                danger: true,
              });
              if (ok) lib.deleteLocation(item.id);
            }}
            onClose={() => setLocationsManagerOpen(false)}
          />
        )}
        {kitModalOpen && (
          <KitModal
            activities={lib.all}
            catalog={lib.materialCatalog}
            kitStock={lib.kitStock}
            onSetStockState={lib.setStockState}
            onAddMaterial={lib.addMaterial}
            onRename={lib.renameMaterial}
            onSetConsumable={lib.setMaterialConsumable}
            onSetArchived={lib.setMaterialArchived}
            onBrowseMaterial={browseMaterial}
            canEdit={isSignedIn}
            announce={setLiveMsg}
            onClose={() => setKitModalOpen(false)}
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
            kitStock={lib.kitStock}
            materialCatalog={lib.materialCatalog}
            onSetStockState={lib.setStockState}
            runDoc={lib.resolveRunDoc(detailActivity)}
            onSetRating={isSignedIn ? lib.setRating : undefined}
            onSaveRunDoc={isSignedIn ? lib.saveRunDoc : undefined}
            themeKit={{
              themes: lib.themes,
              initialThemeId: detailMode === "create" ? "" : lib.themeAssignments[detailActivity.id] ?? "",
              onCreate: lib.createTheme,
              onManage: openThemesManager,
            }}
            ageUnit={ageUnit}
            onAgeUnit={setAgeUnit}
            eventContext={detailEventContext ?? undefined}
            libraryActivities={lib.all}
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
        {printActivity && (
          <ActivityBookPrint
            activity={printActivity}
            runDoc={lib.resolveRunDoc(printActivity)}
            kitStock={lib.kitStock}
            materialCatalog={lib.materialCatalog}
          />
        )}
        <div ref={printHostRef} className="print-host" />
        <ConfirmHost />
        {staffPrompt && (
          <StaffPromptModal
            prompt={staffPrompt}
            authEnabled={auth.enabled}
            onClose={() => setStaffPrompt(null)}
            onRequestSignUp={() => {
              // "Create an account" from the inline gate swaps the SAME modal
              // to the invite sign-up form (no dedicated Staff page any more).
              openSignUpPrompt();
            }}
            onRequestSignIn={() => {
              openSignInPrompt();
            }}
          />
        )}
      </div>
    </div>
    </AgeUnitProvider>
  );
}
