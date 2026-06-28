"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Client-side persistence layer.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * BACKEND SWAP POINT
 * ──────────────────────────────────────────────────────────────────────────
 * Today long-lived preferences (favorites, schedules, custom entries, ratings,
 * view) live in `localStorage` — no backend, exactly as scoped for the initial
 * build. Ephemeral per-tab UI choices can use `sessionStorage`. When the
 * Cloudflare backend lands (e.g. Workers + KV/D1 for synced libraries and
 * shared schedules), this is the single module to replace: keep the
 * `useLocalStorage` signature, back it with a fetch to the Worker, and the rest
 * of the app does not change.
 * ──────────────────────────────────────────────────────────────────────────
 */

const PREFIX = "camp:";

export type StorageValidator<T> = (value: unknown, fallback: T) => T;

function read<T>(key: string, fallback: T, validate?: StorageValidator<T>): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return validate ? validate(parsed, fallback) : (parsed as T);
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private-mode — fail silently, in-memory state still works */
  }
}

/**
 * State that persists to localStorage. To avoid SSR hydration mismatches the
 * first paint always uses `initial`; the persisted value is hydrated in an
 * effect immediately after mount.
 */
export function useLocalStorage<T>(key: string, initial: T, validate?: StorageValidator<T>) {
  const [value, setValue] = useState<T>(initial);
  const hydrated = useRef(false);
  const skippedInitialWrite = useRef(false);

  // Hydrate once on the client.
  useLayoutEffect(() => {
    skippedInitialWrite.current = false;
    setValue(read<T>(key, initial, validate));
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist after hydration (never overwrite storage with the SSR default).
  useEffect(() => {
    if (!hydrated.current) return;
    if (!skippedInitialWrite.current) {
      skippedInitialWrite.current = true;
      return;
    }
    write(key, value);
  }, [key, value]);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === "function" ? (next as (p: T) => T)(prev) : next));
  }, []);

  return [value, set] as const;
}

/**
 * One-shot reads/writes for state that is already managed elsewhere (e.g. a
 * useState driven by a wrapper setter) but should still survive a reload. Same
 * `"camp:"`-prefixed store and validator contract as {@link useLocalStorage}.
 */
export function readStored<T>(key: string, fallback: T, validate?: StorageValidator<T>): T {
  return read(key, fallback, validate);
}

export function writeStored<T>(key: string, value: T): void {
  write(key, value);
}
