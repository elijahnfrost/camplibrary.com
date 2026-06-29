"use client";

import { CampIcon } from "../icons";
import { MiniSeg, ToggleSwitch } from "../primitives";
import { Select } from "../floating/Select";
import {
  WEATHER_RANGE_OPTIONS,
  type TempUnit,
  type WeatherLocation,
  type WeatherMode,
  type WeatherRange,
} from "@/lib/weather";
import type { WeatherStatus } from "./useWeatherForecast";
import { WeatherLocationField } from "./WeatherLocationField";

// Format a YYYY-MM-DD key as a short local date ("Jun 28"). Parsed from parts so
// it lands on the right calendar day regardless of timezone.
function formatCoverageDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The one-line status under the weather controls: how far the forecast reaches
// (and whether it's still loading), so it's clear how far the data spreads.
function weatherCoverageNote(
  status: WeatherStatus,
  hasLocation: boolean,
  coverage: { start: string; end: string } | null
): string | null {
  if (!hasLocation) return "Set a location for the forecast.";
  if (status === "error") return "Couldn’t load the forecast — check the connection.";
  if (coverage) {
    const span = `Forecast: ${formatCoverageDay(coverage.start)} – ${formatCoverageDay(coverage.end)}`;
    return status === "loading" ? `${span} · updating…` : span;
  }
  return status === "loading" ? "Loading forecast…" : null;
}

// The weather settings ledger — Off/Day/Hour plus Location, Units, the forecast
// range, History, and a coverage note. A flat ledger: the disclosure that folds
// it away is supplied by the host (the desktop rail's "Weather" toggle, sibling
// to "View"; the mobile sheet renders it under a heading). Sibling to — not
// nested in — the view settings.
export function WeatherSettings({
  weatherMode,
  onWeatherMode,
  weatherUnit,
  onWeatherUnit,
  weatherLocation,
  onWeatherLocation,
  weatherRange,
  onWeatherRange,
  weatherHistory,
  onWeatherHistory,
  weatherStatus,
  weatherCoverage,
}: {
  weatherMode: WeatherMode;
  onWeatherMode: (mode: WeatherMode) => void;
  weatherUnit: TempUnit;
  onWeatherUnit: (unit: TempUnit) => void;
  weatherLocation: WeatherLocation | null;
  onWeatherLocation: (location: WeatherLocation) => void;
  weatherRange: WeatherRange;
  onWeatherRange: (range: WeatherRange) => void;
  weatherHistory: boolean;
  onWeatherHistory: (on: boolean) => void;
  weatherStatus: WeatherStatus;
  weatherCoverage: { start: string; end: string } | null;
}) {
  const note = weatherCoverageNote(weatherStatus, !!weatherLocation, weatherCoverage);
  return (
    <div className="ledger calset">
      <div className="ledger__row">
        <span className="ledger__label"><CampIcon.Sun className="ledger__ic" />Show</span>
        <MiniSeg
          ariaLabel="Show weather"
          value={weatherMode}
          onChange={(v) => onWeatherMode(v as WeatherMode)}
          options={[
            { id: "off", label: "Off", ariaLabel: "No weather" },
            { id: "day", label: "Day", ariaLabel: "Daily summary in each header" },
            { id: "hour", label: "Hour", ariaLabel: "Hourly in each block" },
          ]}
        />
      </div>
      {weatherMode !== "off" && (
        <>
          <WeatherLocationField value={weatherLocation} onChange={onWeatherLocation} />
          <div className="ledger__row">
            <span className="ledger__label">Units</span>
            <MiniSeg
              ariaLabel="Temperature units"
              value={weatherUnit}
              onChange={(v) => onWeatherUnit(v as TempUnit)}
              options={[
                { id: "f", label: "°F", ariaLabel: "Fahrenheit" },
                { id: "c", label: "°C", ariaLabel: "Celsius" },
              ]}
            />
          </div>
          <div className="ledger__row">
            <span className="ledger__label"><CampIcon.Calendar className="ledger__ic" />Forecast</span>
            <Select
              value={weatherRange}
              options={WEATHER_RANGE_OPTIONS}
              onChange={onWeatherRange}
              ariaLabel="How far ahead to forecast"
            />
          </div>
          <div className="ledger__row">
            <span className="ledger__label"><CampIcon.Clock className="ledger__ic" />History</span>
            <ToggleSwitch
              on={weatherHistory}
              onChange={() => onWeatherHistory(!weatherHistory)}
              ariaLabel="Show past weather"
            />
          </div>
          {note && <p className="calset__wxnote">{note}</p>}
        </>
      )}
    </div>
  );
}
