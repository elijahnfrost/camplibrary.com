"use client";

// The app shell: two surfaces (Library, Calendar) plus the admin tab.
// Navigation, auth, the activity viewer, and the add/edit sheet live here;
// activity-domain state is in useActivityLibrary and persistence in
// lib/cloudStore (localStorage for anon, cloud-synced once signed in).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Activity, LibraryView, TabId } from "@/lib/types";
import { ADMIN_EMAIL, isAdminEmail, staffActionGate, type StaffActionGate } from "@/lib/auth";
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
import { InviteSignUp } from "./InviteSignUp";
import { LibraryTab } from "./LibraryTab";
import { Modal } from "./Modal";
import { StaffSignIn } from "./StaffSignIn";
import { useActivityLibrary } from "./useActivityLibrary";

type NavTab = { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] };

const TABS: NavTab[] = [
  { id: "calendar", label: "Calendar", icon: CampIcon.Calendar },
  { id: "library", label: "Library", icon: CampIcon.Library },
];
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

function safeInternalReturnPath(value: string | null) {
  if (!value) return "/";
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  try {
    const url = new URL(value);
    if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    /* fall through */
  }

  return "/";
}

function cleanAuthRouteUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth");
  url.searchParams.delete("next");
  url.searchParams.delete("redirect_url");
  const next = url.pathname + (url.search ? url.search : "") + url.hash;
  window.history.replaceState(null, "", next || "/");
}

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
      {authEnabled && prompt.mode === "sign-in" ? (
        <StaffSignIn
          returnTo={prompt.returnTo}
          message={prompt.message}
          onComplete={onClose}
          onRequestSignUp={onRequestSignUp}
        />
      ) : authEnabled && prompt.mode === "sign-up" ? (
        <InviteSignUp />
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

function AccountPromptModal({
  name,
  email,
  onClose,
  onSwitchAccount,
  onSignOut,
}: {
  name: string;
  email: string;
  onClose: () => void;
  onSwitchAccount: () => void;
  onSignOut: () => void;
}) {
  return (
    <Modal label="Account" onClose={onClose} overlayProps={{ className: "overlay--auth" }}>
      <div className="auth-form auth-form--prompt">
        <div className="auth-form__section">Account</div>
        <p className="auth-form__copy">You&apos;re logged in as {name}.</p>
        <p className="auth-form__account-email">{email}</p>
        <button type="button" className="btn btn--primary btn--block" onClick={onSwitchAccount}>
          <CampIcon.User />
          Switch account
        </button>
        <button type="button" className="btn btn--ghost btn--block" onClick={onSignOut}>
          Sign out
        </button>
        <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
          Stay signed in
        </button>
      </div>
    </Modal>
  );
}

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
  const [staffPrompt, setStaffPrompt] = useState<StaffPrompt | null>(null);
  const [accountPrompt, setAccountPrompt] = useState(false);

  const openStaffPrompt = useCallback(
    (mode: "sign-in" | "sign-up", message: string, returnTo = currentReturnPath()) => {
      setStaffPrompt({
        allowed: false,
        mode,
        message,
        returnTo,
        signInHref: null,
      });
      setLiveMsg(message);
    },
    []
  );

  const openSignUpPrompt = useCallback(() => {
    openStaffPrompt(
      "sign-up",
      auth.enabled
        ? "Create a staff account with an invite code."
        : "Staff account creation is not configured in this workspace.",
      "/"
    );
  }, [auth.enabled, openStaffPrompt]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const mode = url.searchParams.get("auth");
    if (mode !== "sign-in" && mode !== "sign-up") return;
    if (auth.enabled && !auth.ready) return;

    const next = safeInternalReturnPath(url.searchParams.get("next") || url.searchParams.get("redirect_url"));
    cleanAuthRouteUrl();
    if (auth.signedIn || auth.providerSignedIn) return;
    openStaffPrompt(
      mode,
      mode === "sign-up"
        ? auth.enabled
          ? "Create a staff account with an invite code."
          : "Staff account creation is not configured in this workspace."
        : auth.enabled
          ? "Existing staff can sign in with Google or password."
          : "Staff sign-in is not configured in this workspace, so editing tools are unavailable.",
      next
    );
  }, [auth.enabled, auth.providerSignedIn, auth.ready, auth.signedIn, openStaffPrompt]);

  const requireStaff = useCallback(
    (action: string) => {
      const returnTo = currentReturnPath();
      const gate = staffActionGate(auth.session, action, {
        authEnabled: auth.enabled,
        returnTo,
        origin: typeof window === "undefined" ? undefined : window.location.origin,
      });
      if (gate.allowed) return true;
      setStaffPrompt({ ...gate, mode: "sign-in", returnTo });
      setLiveMsg(gate.message);
      return false;
    },
    [auth.enabled, auth.session]
  );

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

  const isAdmin = auth.session.status === "authenticated" && isAdminEmail(auth.session.user.email);
  const navTabs = useMemo(() => (isAdmin || tab === "admin" ? [...TABS, ADMIN_TAB] : TABS), [isAdmin, tab]);

  const savedCount = lib.favSet.size;

  // The auth pill lives inside each surface's own header row — the sidebar/
  // tabbar already names the surface, so there's no separate page-title bar.
  const authControl = (
    <AuthButton
      session={auth.session}
      onOpen={() => requireStaff("make staff changes")}
      onAccount={() => setAccountPrompt(true)}
    />
  );

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
          {tab !== "admin" && (
            <h1 className="sr-only">{tab === "library" ? "Library" : "Calendar"}</h1>
          )}

          {tab === "library" && (
            <LibraryTab
              actions={authControl}
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
                canEdit={isSignedIn}
                requireStaff={requireStaff}
                onOpenActivity={openDetailFromEvent}
                announce={setLiveMsg}
                railSlot={calRail}
                headerActions={authControl}
              />
            </div>
          )}

          {tab === "admin" && (
            <div className="app__scroll">
              <div className="admin-tab">
                <div className="admin-tab__head">
                  <h1 className="admin-tab__title">Invite codes</h1>
                  <div className="admin-tab__actions">{authControl}</div>
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
            isCustom={lib.isCustomActivity(detailActivity.id)}
            onEdit={editActivity}
            onDelete={deleteActivity}
            onPrint={requestPrint}
            availableMaterials={lib.activeAvailableMaterials}
            onToggleMaterial={lib.toggleAvailableMaterial}
            runDoc={lib.resolveRunDoc(detailActivity)}
            onSetRating={isSignedIn ? lib.setRating : undefined}
            onSaveRunDoc={isSignedIn ? lib.saveRunDoc : undefined}
            eventContext={detailEventContext ?? undefined}
            backLabel={navTabs.find((t) => t.id === tab)?.label ?? "Library"}
          />
        )}
        {printActivity && <ActivityBookPrint activity={printActivity} runDoc={lib.resolveRunDoc(printActivity)} />}
        {staffPrompt && (
          <StaffPromptModal
            prompt={staffPrompt}
            authEnabled={auth.enabled}
            onClose={() => setStaffPrompt(null)}
            onRequestSignUp={openSignUpPrompt}
          />
        )}
        {accountPrompt && auth.session.status === "authenticated" && (
          <AccountPromptModal
            name={auth.session.user.name}
            email={auth.session.user.email}
            onClose={() => setAccountPrompt(false)}
            onSwitchAccount={() => {
              setAccountPrompt(false);
              auth.signOut("/?auth=sign-in");
            }}
            onSignOut={() => {
              setAccountPrompt(false);
              auth.signOut("/");
            }}
          />
        )}
      </div>
    </div>
  );
}
