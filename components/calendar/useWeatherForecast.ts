"use client";

import { useEffect, useState } from "react";
import {
  fetchForecast,
  type TempUnit,
  type WeatherData,
  type WeatherLocation,
} from "@/lib/weather";

export type WeatherStatus = "idle" | "loading" | "ready" | "error";

// Owns the forecast fetch for the calendar: pulls one ~16-day block for the
// configured location and refreshes it on a slow timer (30 min — the data
// updates hourly at most, and a camp planner isn't watching it tick). Refetches
// when the location or unit changes; clears when weather is off or no location is
// set. Stale in-flight requests are aborted so a fast location switch can't land
// out of order.
const REFRESH_MS = 30 * 60 * 1000;

export function useWeatherForecast(
  location: WeatherLocation | null,
  unit: TempUnit,
  enabled: boolean,
  forecastDays: number,
  pastDays: number
): { data: WeatherData | null; status: WeatherStatus } {
  const [data, setData] = useState<WeatherData | null>(null);
  const [status, setStatus] = useState<WeatherStatus>("idle");

  // Re-fetch only when the meaningful inputs change — coordinates, unit, range,
  // history, on/off — not on every WeatherLocation object identity (the picker
  // may re-create it).
  const lat = location?.latitude ?? null;
  const lon = location?.longitude ?? null;

  useEffect(() => {
    if (!enabled || !location || lat == null || lon == null) {
      setData(null);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      try {
        if (active) setStatus((s) => (s === "ready" ? s : "loading"));
        const next = await fetchForecast(location, unit, {
          forecastDays,
          pastDays,
          signal: controller.signal,
        });
        if (active) {
          setData(next);
          setStatus("ready");
        }
      } catch (err) {
        if (active && !controller.signal.aborted) setStatus("error");
      }
    };

    run();
    timer = setInterval(run, REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
    // location is intentionally read fresh inside run(); the dep list keys on the
    // primitive inputs so an equivalent re-created location object doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lat, lon, unit, forecastDays, pastDays]);

  return { data, status };
}
