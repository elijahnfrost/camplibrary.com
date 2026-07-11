"use client";

import { useEffect, useRef, useState } from "react";
import {
  locationShort,
  searchLocations,
  locationLabel,
  type WeatherLocation,
} from "@/lib/weather";
import { CampIcon } from "../ui/icons";
import { FloatingLayer } from "../floating/FloatingLayer";

// The "Location" row in the calendar's View ledger. The trigger reads the chosen
// place (or "Set location"); clicking opens a small search popover backed by
// Open-Meteo's geocoder. A weather location is device-local (a view pref), so it
// lives in localStorage alongside the other calendar settings — never synced.
export function WeatherLocationField({
  value,
  onChange,
}: {
  value: WeatherLocation | null;
  onChange: (location: WeatherLocation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function openMenu() {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    setOpen(true);
  }

  return (
    <div className="ledger__row">
      <span className="ledger__label"><CampIcon.Pin className="ledger__ic" />Location</span>
      <button
        ref={triggerRef}
        type="button"
        className={"cal-wx-loc__trigger" + (value ? "" : " is-empty") + (open ? " is-open" : "")}
        onClick={openMenu}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={value ? locationLabel(value) : "Set a location for the forecast"}
      >
        <span className="cal-wx-loc__name">{value ? locationShort(value) : "Set location"}</span>
        <CampIcon.ChevronRight className="cal-wx-loc__chev" />
      </button>
      {open && rect && (
        <FloatingLayer
          anchor={{ kind: "rect", rect, matchWidth: false }}
          onClose={() => setOpen(false)}
          className="cal-wx-loc__menu"
          role="dialog"
          ariaLabel="Search for a location"
          initialFocus={false}
        >
          <LocationSearch
            current={value}
            onPick={(loc) => {
              onChange(loc);
              setOpen(false);
            }}
          />
        </FloatingLayer>
      )}
    </div>
  );
}

function LocationSearch({
  current,
  onPick,
}: {
  current: WeatherLocation | null;
  onPick: (location: WeatherLocation) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherLocation[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce the geocoder so we search on a settled query, and abort the prior
  // request so results can't land out of order.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const id = window.setTimeout(async () => {
      try {
        const found = await searchLocations(trimmed, controller.signal);
        setResults(found);
        setStatus(found.length ? "idle" : "empty");
      } catch (err) {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(id);
    };
  }, [query]);

  return (
    <div className="cal-wx-loc__search">
      <div className="cal-wx-loc__field">
        <CampIcon.Search className="cal-wx-loc__searchicon" />
        <input
          ref={inputRef}
          type="text"
          className="cal-wx-loc__input"
          placeholder="Search city or town…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {status === "loading" && <p className="cal-wx-loc__hint">Searching…</p>}
      {status === "empty" && <p className="cal-wx-loc__hint">No matches.</p>}
      {status === "error" && <p className="cal-wx-loc__hint">Couldn’t reach the search.</p>}
      {results.length > 0 && (
        <ul className="cal-wx-loc__results">
          {results.map((loc, i) => {
            const isCurrent =
              current &&
              Math.abs(current.latitude - loc.latitude) < 0.01 &&
              Math.abs(current.longitude - loc.longitude) < 0.01;
            return (
              <li key={`${loc.latitude},${loc.longitude},${i}`}>
                <button
                  type="button"
                  className={"cal-wx-loc__result" + (isCurrent ? " is-current" : "")}
                  onClick={() => onPick(loc)}
                >
                  <span className="cal-wx-loc__resultname">{loc.name}</span>
                  <span className="cal-wx-loc__resultmeta">
                    {[loc.admin1, loc.country].filter(Boolean).join(", ")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
