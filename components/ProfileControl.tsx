"use client";

import { useRef, useState, type RefObject } from "react";
import type { AuthSession } from "@/lib/auth";
import type { SyncStatus } from "@/lib/cloudStore";
import { CampIcon } from "./icons";
import { FloatingLayer } from "./floating/FloatingLayer";

// The common "bottom-left profile control" app pattern — replaces the old
// dedicated Staff tab. One row anchored in the sidebar foot (below the sync
// pill): avatar + display name + chevron, opening a popover that carries
// everything the Staff tab used to (account identity, sync health, admin
// entry, auth actions). Signed out it reads "Sign in"; local/preview mode it
// reads "Local staff". The popover reuses the app's one floating-menu recipe
// (FloatingLayer + the .typepick__option / .cmenu__item row vocabulary), so it
// docks as a bottom sheet below the desk breakpoint like every other menu.

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

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export function ProfileControl({
  session,
  authEnabled,
  syncStatus = "local",
  pendingCount = 0,
  syncError = null,
  isAdmin = false,
  onOpenInvites,
  onSignIn,
  onSwitchAccount,
  onSignOut,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  externalTriggerRef,
}: {
  session: AuthSession;
  /** Whether Clerk (hosted auth) is configured; false = local preview mode. */
  authEnabled: boolean;
  syncStatus?: SyncStatus;
  pendingCount?: number;
  /** A write the server refused — surfaces as "Some changes didn't save". */
  syncError?: string | null;
  isAdmin?: boolean;
  /** Jump to the admin invite-codes surface (admin only). */
  onOpenInvites?: () => void;
  /** Open the shared sign-in surface (Clerk configured, signed out). */
  onSignIn: () => void;
  onSwitchAccount: () => void;
  onSignOut: () => void;
  /** Controlled open state — lets a sibling (the sync pill, the mobile tab
   *  bar's Profile item) open the SAME popover instead of owning its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Skip rendering the row trigger — used on the mobile tab bar, where its
   *  own Profile button is the anchor (see externalTriggerRef). */
  hideTrigger?: boolean;
  /** The anchor to open against when hideTrigger is set. */
  externalTriggerRef?: RefObject<HTMLElement | null>;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const ownTriggerRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = hideTrigger ? externalTriggerRef ?? ownTriggerRef : ownTriggerRef;

  const signedIn = session.status === "authenticated";
  const displayName = signedIn ? session.user.name : authEnabled ? "Sign in" : "Local staff";
  const avatarLetter = signedIn ? initialOf(session.user.name) : null;

  const dotClass =
    "profilemenu__dot profilemenu__dot--" + (syncError ? "error" : pendingCount > 0 ? "pending" : syncStatus);
  const syncText = syncError ? "Some changes didn't save" : syncLine(syncStatus, pendingCount);

  return (
    <>
      {!hideTrigger && (
        <button
          ref={ownTriggerRef}
          type="button"
          className="profilerow"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="profilerow__avatar" aria-hidden="true">
            {avatarLetter ?? <CampIcon.User />}
          </span>
          <span className="profilerow__name">{displayName}</span>
          <CampIcon.ChevronUp className="profilerow__chev" />
        </button>
      )}
      {open && triggerRef.current && (
        <FloatingLayer
          anchor={{ kind: "rect", rect: triggerRef.current.getBoundingClientRect(), matchWidth: true }}
          onClose={() => setOpen(false)}
          className="profilemenu"
          role="dialog"
          ariaLabel="Account"
        >
          <div className="profilemenu__head">
            <span className="profilemenu__avatar" aria-hidden="true">
              {avatarLetter ?? <CampIcon.User />}
            </span>
            <span className="profilemenu__id">
              <span className="profilemenu__name">{displayName}</span>
              {signedIn && <span className="profilemenu__email">{session.user.email}</span>}
            </span>
          </div>
          {signedIn && (
            <div className="profilemenu__tags">
              <span className="profilemenu__tag">{session.user.role === "admin" ? "Admin" : "Editor"}</span>
              <span className="profilemenu__tag profilemenu__tag--quiet">
                {session.mode === "preview" ? "Preview" : "Signed in"}
              </span>
            </div>
          )}

          <div className="profilemenu__sync">
            <span className={dotClass} aria-hidden="true" />
            {syncText}
          </div>

          <div className="profilemenu__div" role="separator" aria-hidden="true" />

          {isAdmin && onOpenInvites && (
            <button
              type="button"
              className="typepick__option"
              onClick={() => {
                setOpen(false);
                onOpenInvites();
              }}
            >
              <CampIcon.Tool />
              Manage invite codes
            </button>
          )}

          {!authEnabled ? (
            <p className="profilemenu__muted">Local preview — accounts unavailable</p>
          ) : signedIn ? (
            <>
              <button
                type="button"
                className="typepick__option"
                onClick={() => {
                  setOpen(false);
                  onSwitchAccount();
                }}
              >
                <CampIcon.User />
                Switch account
              </button>
              <button
                type="button"
                className="typepick__option"
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              className="typepick__option"
              onClick={() => {
                setOpen(false);
                onSignIn();
              }}
            >
              <CampIcon.User />
              Sign in
            </button>
          )}
        </FloatingLayer>
      )}
    </>
  );
}
