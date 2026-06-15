"use client";

// The app shell: two surfaces (Library, Calendar) plus the admin tab.
// Navigation, auth, the activity viewer, and the add/edit sheet live here;
// activity-domain state is in useActivityLibrary and persistence in
// lib/cloudStore (localStorage for anon, cloud-synced once signed in).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Activity, LibraryView, TabId } from "@/lib/types";
import { ADMIN_EMAIL, isAdminEmail, staffActionGate, type StaffActionGate } from "@/lib/auth";
import { matchesActivityFilters, type AgeFilter, type CatFilter, type PlaceFilter, type ThemeFilter } from "@/lib/activityFilters";
import { formatEventDateLabel } from "@/lib/calendar/dates";
import { formatRangeLabel } from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import { useCloudUserData } from "@/lib/cloudStore";
import { migrateLegacyStorageKeys } from "@/lib/storageScope";
import type { RunDoc } from "@/lib/runList";
import { BrandMark, CampIcon } from "./icons";
import { ContextMenu } from "./floating/ContextMenu";
import { useContextMenu } from "./floating/useContextMenu";
import { ActivityBookPrint } from "./ActivityBookPrint";
import { ActivityEditorSheet } from "./ActivityEditorSheet";
import { AdminInviteCodes } from "./AdminInviteCodes";
import { usePreviewAuth } from "./AuthControls";
import { CalendarShell } from "./calendar/CalendarShell";
import { CampSwitcher } from "./calendar/CampSwitcher";
import { DetailSheet } from "./DetailSheet";
import { Filters } from "./Filters";
import { HomeTab } from "./HomeTab";
import { LibraryTab } from "./LibraryTab";
import { ListManagerModal } from "./ListManagerModal";
import { Modal } from "./Modal";
import { StaffSignIn } from "./StaffSignIn";
import { StaffTab, type StaffTabMode } from "./StaffTab";
import { useActivityLibrary } from "./useActivityLibrary";
import { useCamps } from "./useCamps";

type NavTab = { id: TabId; label: string; icon: (typeof CampIcon)[keyof typeof CampIcon] };

const HOME_TAB: NavTab = { id: "home", label: "Home", icon: CampIcon.Home };
// Calendar + Library are the working surfaces. Home is reached from the brand
// mark on desktop (so it's NOT in the sidebar list); on mobile there's no
// persistent logo, so Home stays in the bottom tab bar (MOBILE_TABS).
const TABS: NavTab[] = [
  { id: "library", label: "Library", icon: CampIcon.Library },
  { id: "calendar", label: "Calendar", icon: CampIcon.Calendar },
];
// The single intentional sign-in / account surface. Shown to everyone (signed
// out it's "Sign in"; signed in it's the account panel) — it replaces the old
// top-right auth pill and the sidebar identity line.
const STAFF_TAB: NavTab = { id: "staff", label: "Staff", icon: CampIcon.Users };
const MOBILE_TABS: NavTab[] = [HOME_TAB, ...TABS];
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
  const [tab, setTab] = useState<TabId>(initialTab);
  const auth = usePreviewAuth();
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
  const lib = useActivityLibrary({ cloud, requireStaff, announce: setLiveMsg });
  // Multiple camps: filters the calendar's event set + stamps new events. The
  // shared library and every other surface are camp-agnostic.
  const campKit = useCamps({ cloud, announce: setLiveMsg });
  const calendarEvents = useMemo(() => campKit.filterEvents(cloud.events), [campKit, cloud.events]);

  // Library filters. State lives here because the desktop filter rail
  // renders inside the sidenav, outside LibraryTab.
  const [cat, setCat] = useState<CatFilter>("All");
  const [place, setPlace] = useState<PlaceFilter>("All");
  const [age, setAge] = useState<AgeFilter>("All");
  const [theme, setTheme] = useState<ThemeFilter>("All");
  const [starredOnly, setStarredOnly] = useState(false);
  const [query, setQuery] = useState("");
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
  // Desktop sidebar omits Home (the brand mark is Home). The mobile tab bar
  // keeps Home, since mobile has no persistent brand mark to tap.
  const navTabs = useMemo(
    () => (isAdmin || tab === "admin" ? [...TABS, STAFF_TAB, ADMIN_TAB] : [...TABS, STAFF_TAB]),
    [isAdmin, tab]
  );
  // The phone tab bar stays lean: Home / Library / Calendar / Staff. Admin
  // (invite codes) is desktop-only chrome — it's reachable from the sidenav on a
  // large screen and via deep link, so it never crowds the four-slot mobile bar.
  const mobileNavTabs = useMemo(() => [...MOBILE_TABS, STAFF_TAB], []);

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
          {tab === "calendar" && <div className="sidenav__calrail" ref={calRailRef} />}
        </nav>

        <main className="app__main" id="main">
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
                activities={lib.all}
                byId={lib.byId}
                canEdit={isSignedIn}
                requireStaff={requireStaff}
                onOpenActivity={openDetailFromEvent}
                announce={setLiveMsg}
                railSlot={calRail}
                themes={lib.themes}
                themeAssignments={lib.themeAssignments}
                themeOf={lib.themeOf}
                headerActions={
                  <CampSwitcher
                    camps={campKit.camps}
                    activeCampId={campKit.activeCampId}
                    onSwitch={campKit.switchCamp}
                    onCreate={(name) => {
                      if (requireStaff("manage camps")) campKit.createCamp(name);
                    }}
                    onRename={(id, name) => {
                      if (requireStaff("manage camps")) campKit.renameCamp(id, name);
                    }}
                    onDelete={(id, name) => {
                      if (!requireStaff("manage camps")) return;
                      if (window.confirm("Delete the “" + name + "” camp? Its events stay on the calendar but are no longer grouped.")) {
                        campKit.deleteCamp(id);
                      }
                    }}
                  />
                }
              />
            </div>
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
        {editorSheet && (
          <ActivityEditorSheet
            editing={editorSheet.activity}
            initialRunDoc={editorSheet.activity ? lib.resolveRunDoc(editorSheet.activity) : null}
            onClose={() => setEditorSheet(null)}
            onSubmit={submitEditorSheet}
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
  );
}
