"use client";

import { useEffect, useState } from "react";
import { CampIcon } from "./icons";

type InviteCodeRecord = {
  id: string;
  label: string | null;
  invitedEmail: string | null;
  status: "active" | "reserved" | "used" | "revoked";
  createdAt: string;
  expiresAt: string | null;
  reservedUntil: string | null;
  usedAt: string | null;
  usedByClerkUserId: string | null;
};

type InviteForm = {
  label: string;
  invitedEmail: string;
  expiresAt: string;
};

const initialForm: InviteForm = {
  label: "",
  invitedEmail: "",
  expiresAt: "",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AdminInviteCodes() {
  const [invites, setInvites] = useState<InviteCodeRecord[]>([]);
  const [form, setForm] = useState<InviteForm>(initialForm);
  const [createdCode, setCreatedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        }),
      });
      if (!response.ok) throw new Error("Could not create invite code.");
      const body = (await response.json()) as { code: string; record: InviteCodeRecord };
      setCreatedCode(body.code);
      setInvites((current) => [body.record, ...current]);
      setForm(initialForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invite code.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page__grid">
      <section className="admin-panel">
        <div className="admin-panel__head">
          <div>
            <span className="admin-panel__kicker">Invite codes</span>
            <h2 className="admin-panel__title">Create a one-use code</h2>
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

        {createdCode && (
          <div className="admin-code">
            <span className="admin-code__label">New code</span>
            <strong>{createdCode}</strong>
            <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard.writeText(createdCode)}>
              Copy
            </button>
          </div>
        )}

        {error && <div className="auth-form__error">{error}</div>}

        <button type="button" className="btn btn--primary btn--block" disabled={saving} onClick={createInvite}>
          <CampIcon.Plus />
          Generate code
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
              <span>Status</span>
              <span>Expires</span>
            </div>
            {invites.map((invite) => (
              <div className="admin-table__row" key={invite.id}>
                <span>{invite.label || "—"}</span>
                <span>{invite.invitedEmail || "Any email"}</span>
                <span className={"admin-status admin-status--" + invite.status}>{invite.status}</span>
                <span>{formatDate(invite.expiresAt)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No invite codes yet.</div>
        )}
      </section>
    </div>
  );
}
