"use client";

// The desktop calendar rail holds ONLY what earns its pixels at rest: the
// mini-month (the rail's one dense object), then two flat disclosures — DISPLAY
// and WEATHER — each collapsed by default with a meaningful state echo. There is
// no Today card: the grid's now-line already answers "what's happening now" and
// the mini-month owns the week's shape.
//
// Vertical order (mini-month → CAMPS → DISPLAY → WEATHER) is done with CSS
// `order`: the host renders the Camps section as a SIBLING after this rail's
// portal, so the portal div is display:contents and the zones order themselves
// as flex items of .sidenav__scroll.

import { type ComponentProps } from "react";
import { MiniMonth } from "./MiniMonth";
import { CalendarViewSettings } from "./CalendarViewSettings";
import { WeatherSettings } from "./WeatherSettings";
import { WeatherLocationField } from "./WeatherLocationField";
import type { WeatherStatus } from "./useWeatherForecast";
import { MiniSeg, ToggleSwitch } from "../primitives";
import { Select } from "../floating/Select";
import { CampIcon } from "../icons";
import { WEATHER_RANGE_OPTIONS, type TempUnit, type WeatherMode } from "@/lib/weather";
import type { ColorMode } from "@/lib/data";
import { Disclosure } from "../Disclosure";

export type CalRailProps = {
  month: ComponentProps<typeof MiniMonth>;
  view: ComponentProps<typeof CalendarViewSettings>;
  weather: ComponentProps<typeof WeatherSettings>;
};

// The DISPLAY zone's at-rest echo: the one display choice with real identity
// is how events are colored, so the closed row names it.
const COLOR_SUMMARY: Record<ColorMode, string> = {
  custom: "your colors",
  type: "by type",
  rating: "by rating",
  location: "by location",
  theme: "by theme",
};

// Borrowed verbatim from WeatherSettings (module-private there): format a
// YYYY-MM-DD key as a short local date, parsed from parts so it lands on the
// right calendar day regardless of timezone.
function formatCoverageDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

export function CalendarRail({ month, view, weather }: CalRailProps) {
  const {
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
    rainThreshold,
    onRainThreshold,
    rainThresholdOptions,
    weatherStatus,
    weatherCoverage,
  } = weather;

  const note = weatherCoverageNote(weatherStatus, !!weatherLocation, weatherCoverage);
  const weatherSummary =
    weatherMode === "off" ? "off" : weatherMode === "day" ? "daily" : "hourly";

  return (
    <>
      {/* The rail's only dense object — reused as-is. */}
      <div className="lc-mini">
        <MiniMonth {...month} />
      </div>

      {/* DISPLAY — the View settings ledger behind one honest disclosure. The
          Subscribe control rides in as the ledger's own labeled final row. */}
      <Disclosure
        className="lc-zone lc-zone--display"
        title="Display"
        summary={COLOR_SUMMARY[view.colorMode]}
      >
        <CalendarViewSettings {...view} />
      </Disclosure>

      {/* WEATHER — same flat disclosure. Rows re-rendered in this rail's grammar:
          the 3-way mode is a MiniSeg (one-of-few → segmented pill), the 6-option
          range stays a dropdown, on/off is a real switch. */}
      <Disclosure className="lc-zone lc-zone--weather" title="Weather" summary={weatherSummary}>
        <div className="ledger calset lc-wx">
          <div className="ledger__row">
            <span className="ledger__label">
              <CampIcon.Sun className="ledger__ic" />
              Forecast
            </span>
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
                <span className="ledger__label">
                  <CampIcon.Calendar className="ledger__ic" />
                  Days ahead
                </span>
                <Select
                  value={weatherRange}
                  options={WEATHER_RANGE_OPTIONS}
                  onChange={onWeatherRange}
                  ariaLabel="How far ahead to forecast"
                />
              </div>
              <div className="ledger__row">
                <span className="ledger__label">
                  <CampIcon.Clock className="ledger__ic" />
                  History
                </span>
                <ToggleSwitch
                  on={weatherHistory}
                  onChange={() => onWeatherHistory(!weatherHistory)}
                  ariaLabel="Show past weather"
                />
              </div>
              {/* Rain alert only means something with the per-day summary —
                  that's where the review lens rides. */}
              {weatherMode === "day" && (
                <div className="ledger__row">
                  <span className="ledger__label">
                    <CampIcon.Bell className="ledger__ic" />
                    Rain alert
                  </span>
                  <MiniSeg
                    ariaLabel="Rain alert threshold"
                    value={String(rainThreshold)}
                    onChange={(v) => onRainThreshold(Number(v))}
                    options={rainThresholdOptions.map((o) => ({
                      id: o.value,
                      label: o.label,
                      ariaLabel:
                        o.value === "0" ? "No rain alert" : "Alert at " + o.label + " chance of rain",
                    }))}
                  />
                </div>
              )}
              {note && <p className="calset__wxnote">{note}</p>}
            </>
          )}
        </div>
      </Disclosure>
    </>
  );
}
