"use client";

import { useEffect, useState } from "react";
import { CampIcon } from "./icons";
import type { InviteCodeRecord as ServerInviteCodeRecord } from "@/lib/server/inviteCodes";

type InviteStatus = ServerInviteCodeRecord["status"] | "deactivated" | "exhausted";

type InviteCodeRecord = Omit<ServerInviteCodeRecord, "status"> & {
  status: InviteStatus;
  usageLimit?: number | null;
  deactivatedAt?: string | null;
};

type InviteForm = {
  label: string;
  invitedEmail: string;
  expiresAt: string;
  usageLimit: string;
};

const initialForm: InviteForm = {
  label: "",
  invitedEmail: "",
  expiresAt: "",
  usageLimit: "1",
};

type KeyState = "active" | "exhausted" | "deactivated" | "expired";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function coercePositiveNumber(value: number | string | null | undefined) {
  const numberValue = typeof value === "string" ? Number(value) : value;
  return typeof numberValue === "number" && Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function usageFor(invite: InviteCodeRecord) {
  const usageLimit = coercePositiveNumber(invite.usageLimit ?? invite.maxUses) ?? 1;
  const rawUsageCount = coercePositiveNumber(invite.usageCount);
  const usageCount = rawUsageCount ?? (invite.usedAt || invite.status === "used" || invite.status === "exhausted" ? usageLimit : 0);
  return {
    usageCount: Math.min(usageCount, usageLimit),
    usageLimit,
  };
}

function keyStateFor(invite: InviteCodeRecord): { key: KeyState; label: string; detail: string } {
  const { usageCount, usageLimit } = usageFor(invite);
  const expiresAt = invite.expiresAt ? new Date(invite.expiresAt).getTime() : null;

  if (invite.status === "revoked" || invite.status === "deactivated" || invite.revokedAt) {
    return { key: "deactivated", label: "Deactivated", detail: formatDate(invite.revokedAt ?? invite.deactivatedAt ?? null) };
  }

  if (invite.status === "used" || invite.status === "exhausted" || usageCount >= usageLimit) {
    return { key: "exhausted", label: "Exhausted", detail: formatDate(invite.usedAt) };
  }

  if (!invite.active || invite.deactivatedAt) {
    return { key: "deactivated", label: "Deactivated", detail: formatDate(invite.deactivatedAt ?? null) };
  }

  if (expiresAt != null && expiresAt <= Date.now()) {
    return { key: "expired", label: "Expired", detail: formatDate(invite.expiresAt) };
  }

  if (invite.status === "reserved") {
    return { key: "active", label: "Active", detail: invite.reservedUntil ? "Reserved until " + formatDate(invite.reservedUntil) : "Reserved" };
  }

  return { key: "active", label: "Active", detail: "" };
}

function actionLabel(invite: InviteCodeRecord) {
  return invite.label || invite.invitedEmail || "invite " + invite.id;
}

async function parseInviteActionResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const body = parsed as InviteCodeRecord | { invite?: InviteCodeRecord; record?: InviteCodeRecord };
    if ("invite" in body && body.invite) return body.invite;
    if ("record" in body && body.record) return body.record;
    if ("id" in body) return body;
  } catch {
    return null;
  }

  return null;
}

export function AdminInviteCodes() {
  const [invites, setInvites] = useState<InviteCodeRecord[]>([]);
  const [form, setForm] = useState<InviteForm>(initialForm);
  const [createdCode, setCreatedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");

  async function loadInvites() {
    setError("");
    const response = await fetch("/api/invite-codes", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load invite codes.");
    const body = (await response.json()) as { invites: InviteCodeRecord[] };
    setInvites(body.invites);
  }

  useEffect(() => {
    loadInvites()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load invite codes."))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof InviteForm>(key: K, value: InviteForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createInvite() {
    const usageLimit = coercePositiveNumber(form.usageLimit);
    if (!usageLimit) {
      setError("Usage limit must be at least 1.");
      return;
    }

    setSaving(true);
    setCreatedCode("");
    setError("");
    try {
      const response = await fetch("/api/invite-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label || undefined,
          invitedEmail: form.invitedEmail || undefined,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
          maxUses: usageLimit,
          usageLimit,
        }),
      });
      if (!response.ok) throw new Error("Could not create invite key.");
      const body = (await response.json()) as { code: string; record: InviteCodeRecord };
      setCreatedCode(body.code);
      setInvites((current) => [body.record, ...current]);
      setForm(initialForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invite key.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateInvite(invite: InviteCodeRecord) {
    const state = keyStateFor(invite);
    if (state.key === "deactivated" || state.key === "exhausted") return;

    setPendingAction("deactivate:" + invite.id);
    setError("");
    try {
      const response = await fetch("/api/invite-codes/" + encodeURIComponent(invite.id), { method: "DELETE" });
      if (!response.ok) {
        if (response.status === 404) throw new Error("That invite key could not be found.");
        throw new Error("Could not remove invite key.");
      }

      const updated = await parseInviteActionResponse(response);
      setInvites((current) =>
        current.map((item) =>
          item.id === invite.id ? updated ?? { ...item, status: "deactivated", deactivatedAt: new Date().toISOString() } : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove invite key.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <div className="admin-page__grid">
      <section className="admin-panel">
        <div className="admin-panel__head">
          <div>
            <span className="admin-panel__kicker">Invite codes</span>
            <h2 className="admin-panel__title">Create an invite key</h2>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="invite-label">
            Label
          </label>
          <input
            id="invite-label"
            className="input"
            value={form.label}
            onChange={(event) => update("label", event.target.value)}
            placeholder="Jane Counselor"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="invite-email">
            Email
          </label>
          <input
            id="invite-email"
            className="input"
            type="email"
            value={form.invitedEmail}
            onChange={(event) => update("invitedEmail", event.target.value)}
            placeholder="jane@example.com"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="invite-expiry">
            Expires
          </label>
          <input
            id="invite-expiry"
            className="input"
            type="datetime-local"
            value={form.expiresAt}
            onChange={(event) => update("expiresAt", event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="invite-usage-limit">
            Usage limit
          </label>
          <input
            id="invite-usage-limit"
            className="input"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={form.usageLimit}
            onChange={(event) => update("usageLimit", event.target.value)}
            aria-invalid={form.usageLimit.trim() !== "" && !coercePositiveNumber(form.usageLimit)}
          />
        </div>

        {createdCode && (
          <div className="admin-code">
            <span className="admin-code__label">New key</span>
            <strong>{createdCode}</strong>
            <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard.writeText(createdCode)}>
              Copy
            </button>
          </div>
        )}

        {error && <div className="auth-form__error">{error}</div>}

        <button type="button" className="btn btn--primary btn--block" disabled={saving} onClick={createInvite}>
          <CampIcon.Plus />
          Generate key
        </button>
      </section>

      <section className="admin-panel admin-panel--wide">
        <div className="admin-panel__head">
          <div>
            <span className="admin-panel__kicker">Recent</span>
            <h2 className="admin-panel__title">Invite history</h2>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setLoading(true);
              loadInvites()
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load invite codes."))
                .finally(() => setLoading(false));
            }}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="admin-empty">Loading...</div>
        ) : invites.length ? (
          <div className="admin-table">
            <div className="admin-table__row admin-table__row--head">
              <span>Label</span>
              <span>Email</span>
              <span>Key status</span>
              <span>Usage</span>
              <span>Expires</span>
              <span>Controls</span>
            </div>
            {invites.map((invite) => {
              const state = keyStateFor(invite);
              const usage = usageFor(invite);
              const label = actionLabel(invite);
              const deactivatePending = pendingAction === "deactivate:" + invite.id;
              const isActionPending = Boolean(pendingAction);
              const canDeactivate = state.key !== "deactivated" && state.key !== "exhausted";

              return (
                <div className="admin-table__row" key={invite.id}>
                  <span data-label="Label">{invite.label || "—"}</span>
                  <span data-label="Email">{invite.invitedEmail || "Any email"}</span>
                  <span className="admin-table__status" data-label="Key status">
                    <span className={"admin-status admin-status--" + state.key}>{state.label}</span>
                    {state.detail && <span className="admin-table__meta">{state.detail}</span>}
                  </span>
                  <span data-label="Usage">
                    {usage.usageCount} / {usage.usageLimit}
                  </span>
                  <span data-label="Expires">{formatDate(invite.expiresAt)}</span>
                  <span className="admin-table__actions" data-label="Controls">
                    <button
                      type="button"
                      className="admin-action admin-action--danger"
                      disabled={!canDeactivate || isActionPending}
                      onClick={() => void deactivateInvite(invite)}
                      aria-label={"Remove " + label}
                    >
                      <CampIcon.Trash />
                      <span>{deactivatePending ? "..." : "Remove"}</span>
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="admin-empty">No invite codes yet.</div>
        )}
      </section>
    </div>
  );
}
