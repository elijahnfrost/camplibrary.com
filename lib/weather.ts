// Camp Library — hourly/daily weather for the calendar.
//
// A small, self-contained weather layer backed by Open-Meteo (open-meteo.com):
// a free, key-less, CORS-enabled forecast API. We pull one ~16-day block (the
// service's forecast horizon) of HOURLY conditions plus a DAILY roll-up for the
// configured location, and the calendar paints it as either a per-hour chip in
// each hour block ("Hour" mode) or a single summary in each day header ("Day"
// mode). It's purely a viewing aid — nothing here is synced or persisted server-
// side; the location/unit/mode prefs live in the browser like the other view
// settings.
//
// Times: we request the forecast in the VIEWER's timezone (see viewerTimeZone),
// so the returned day/hour stamps line up with the calendar's own local day
// columns and a given day's weather always lands on that day — never sliding a
// column over because the camp sits in a different zone than the viewer. We key
// the map by those date+hour strings and look them up by the calendar's local
// date/hour. No "use client" directive: the mapping helpers are isomorphic; only
// the hook (useWeatherForecast) runs in the browser.

const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";

// Open-Meteo's forecast horizon. Days beyond this simply have no chip.
export const FORECAST_DAYS = 16;
// How far back the "History" toggle reaches (Open-Meteo's forecast endpoint serves
// up to 92 past days from reanalysis/measured data — enough to look back over the
// season and see what you did in similar weather).
export const HISTORY_PAST_DAYS = 92;

export type TempUnit = "f" | "c";

// How far ahead the forecast reaches — the "Forecast" range setting. The ids map
// to Open-Meteo `forecast_days`; "today" is just the current day.
export type WeatherRange = "today" | "3d" | "5d" | "7d" | "14d" | "16d";
export const WEATHER_RANGE_DAYS: Record<WeatherRange, number> = {
  today: 1,
  "3d": 3,
  "5d": 5,
  "7d": 7,
  "14d": 14,
  "16d": 16,
};
export const WEATHER_RANGE_OPTIONS: { value: WeatherRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "3d", label: "3 days" },
  { value: "5d", label: "5 days" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "2 weeks" },
  { value: "16d", label: "Max (16d)" },
];
export function isWeatherRange(value: unknown): value is WeatherRange {
  return typeof value === "string" && value in WEATHER_RANGE_DAYS;
}

// The 3-way calendar view setting: weather off, a per-day summary, or per-hour.
export type WeatherMode = "off" | "day" | "hour";

export function isWeatherMode(value: unknown): value is WeatherMode {
  return value === "off" || value === "day" || value === "hour";
}
export function isTempUnit(value: unknown): value is TempUnit {
  return value === "f" || value === "c";
}

// A geocoded place. lat/lon is all the forecast endpoint needs; the rest is for
// the label shown in settings.
export interface WeatherLocation {
  name: string;
  admin1?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export function locationLabel(loc: WeatherLocation): string {
  return [loc.name, loc.admin1, loc.country].filter(Boolean).join(", ");
}
export function locationShort(loc: WeatherLocation): string {
  return [loc.name, loc.admin1 || loc.country].filter(Boolean).join(", ");
}

// The handful of glyph families the chips/popover draw. WMO codes collapse onto
// these; clear/partly additionally split day vs night (sun vs moon).
export type WeatherCondition =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "showers"
  | "thunder";

export interface HourWeather {
  hour: number; // 0–23, local to the location
  temp: number;
  apparentTemp: number;
  code: number;
  condition: WeatherCondition;
  isDay: boolean;
  precip: number; // inch or mm, per unit
  precipProb: number; // %
  wind: number; // mph or km/h, per unit
  uvIndex: number; // 0–11+, dimensionless (0 overnight)
}

export interface DayWeather {
  code: number;
  condition: WeatherCondition;
  tempMax: number;
  tempMin: number;
  precipProbMax: number; // %
  precipSum: number; // inch or mm
  uvIndexMax: number; // that day's peak UV index (0–11+)
}

export interface WeatherUnits {
  temp: string; // "°F" | "°C"
  precip: string; // "inch" | "mm"
  wind: string; // "mph" | "km/h"
}

export interface WeatherData {
  location: WeatherLocation;
  unit: TempUnit;
  units: WeatherUnits;
  /** key = `${YYYY-MM-DD}@${hour}` → conditions for that local hour. */
  hourly: Map<string, HourWeather>;
  /** key = `${YYYY-MM-DD}` → that day's roll-up. */
  daily: Map<string, DayWeather>;
  fetchedAt: number;
  /** Bumps whenever a fetch lands, so consumers can cheaply detect new data. */
  version: number;
}

// WMO weather-code → glyph family. https://open-meteo.com/en/docs (weather_code).
export function wmoToCondition(code: number): WeatherCondition {
  if (code <= 1) return "clear"; // 0 clear, 1 mainly clear
  if (code === 2) return "partly"; // partly cloudy
  if (code === 3) return "cloudy"; // overcast
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || code === 66 || code === 67) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95) return "thunder";
  return "cloudy";
}

// A human label for the condition. Day/night nuances the clear/partly cases.
export function conditionLabel(condition: WeatherCondition, isDay = true): string {
  switch (condition) {
    case "clear":
      return isDay ? "Sunny" : "Clear";
    case "partly":
      return isDay ? "Partly cloudy" : "Partly cloudy";
    case "cloudy":
      return "Overcast";
    case "fog":
      return "Fog";
    case "drizzle":
      return "Drizzle";
    case "rain":
      return "Rain";
    case "showers":
      return "Rain showers";
    case "snow":
      return "Snow";
    case "thunder":
      return "Thunderstorm";
  }
}

// ---- glyphs -------------------------------------------------------------
// Inner SVG markup per condition (viewBox 0 0 24 24, 1.7 stroke, currentColor),
// matching the CampIcon line-art language. ONE source of truth: the imperative
// hour chips build an <svg> string from it, and the React <WeatherGlyph> renders
// the same markup. Static, app-authored markup — no user input — so the
// dangerouslySetInnerHTML in the component is safe.
const SUN =
  '<circle cx="12" cy="12" r="3.7"/><path d="M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M7.4 16.6l-1.5 1.5"/>';
const MOON = '<path d="M19.5 13.8A7.3 7.3 0 1 1 10.8 4.6a5.8 5.8 0 0 0 8.7 9.2z"/>';
const CLOUD = '<path d="M7.5 18h8a3.5 3.5 0 0 0 .3-7 4.6 4.6 0 0 0-8.8-1.2A3.6 3.6 0 0 0 7.5 18z"/>';
// A cloud raised a touch so precipitation strokes have room beneath it.
const CLOUD_HI = '<path d="M7.5 15h8a3.4 3.4 0 0 0 .3-6.8 4.5 4.5 0 0 0-8.6-1.2A3.5 3.5 0 0 0 7.5 15z"/>';
const SUN_PEEK =
  '<circle cx="16.6" cy="7.4" r="2.2"/><path d="M16.6 3.5v1.2M20.5 7.4h-1.2M19.4 4.6l-.9.9"/>';

const GLYPHS: Record<WeatherCondition, (isDay: boolean) => string> = {
  clear: (isDay) => (isDay ? SUN : MOON),
  partly: (isDay) => (isDay ? SUN_PEEK + CLOUD : MOON + CLOUD),
  cloudy: () => CLOUD,
  fog: () => CLOUD_HI + '<path d="M6 18h11M8 21h9"/>',
  drizzle: () => CLOUD_HI + '<path d="M9.5 17.5v1.6M13 17.5v1.6M16.5 17.5v1.6"/>',
  rain: () => CLOUD_HI + '<path d="M9 17.5l-1 2.6M12.5 17.5l-1 2.6M16 17.5l-1 2.6"/>',
  showers: () => CLOUD_HI + '<path d="M9 17.5l-1 2.6M12.5 17.5l-1 2.6M16 17.5l-1 2.6"/>',
  snow: () =>
    CLOUD_HI + '<path d="M9 18.6v.01M12.2 19.8v.01M15.4 18.6v.01M10.6 21.2v.01M13.8 21.2v.01"/>',
  thunder: () => CLOUD_HI + '<path d="M12.7 16.6l-2.4 3.4h2.1l-1 3 3.6-4.2h-2.3z"/>',
};

export function weatherGlyphInner(condition: WeatherCondition, isDay = true): string {
  return GLYPHS[condition](isDay);
}

// Full <svg> string for the imperatively-built calendar chips.
export function weatherGlyphSvg(condition: WeatherCondition, isDay = true): string {
  return (
    '<svg class="cal-wx-glyph" viewBox="0 0 24 24" aria-hidden="true">' +
    weatherGlyphInner(condition, isDay) +
    "</svg>"
  );
}

// ---- formatting ---------------------------------------------------------
export function formatTemp(value: number): string {
  return Math.round(value) + "°";
}
export function formatTempWithUnit(value: number, units: WeatherUnits): string {
  return Math.round(value) + units.temp;
}
export function formatPrecip(value: number, units: WeatherUnits): string {
  // inches read with two decimals (0.04"), mm with one (1.2 mm).
  const isInch = units.precip === "inch";
  const rounded = isInch ? value.toFixed(2) : value.toFixed(1);
  return isInch ? rounded + '"' : rounded + " mm";
}
// UV index → WHO exposure band. The index is a dimensionless 0–11+ scale; these
// are the standard World Health Organization categories, so a staffer reads the
// sun-protection risk (a high-UV afternoon may want hats/shade for outdoor play)
// without knowing what the raw number means.
export function uvCategory(value: number): string {
  const uv = Math.round(value);
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very high";
  return "Extreme";
}
// The UV index as shown in the detail card: rounded value plus its band ("7 · High").
export function formatUv(value: number): string {
  return `${Math.round(value)} · ${uvCategory(value)}`;
}
// The span of dates the loaded forecast actually covers (earliest → latest day
// with data), so the UI can show how far the weather reaches. Null when empty.
export function forecastCoverage(data: WeatherData): { start: string; end: string } | null {
  const keys = Array.from(data.daily.keys()).sort();
  if (keys.length === 0) return null;
  return { start: keys[0], end: keys[keys.length - 1] };
}

// ---- fetch --------------------------------------------------------------
function unitParams(unit: TempUnit): { temperature_unit: string; wind_speed_unit: string; precipitation_unit: string } {
  return unit === "c"
    ? { temperature_unit: "celsius", wind_speed_unit: "kmh", precipitation_unit: "mm" }
    : { temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" };
}

function dateAndHour(iso: string): { date: string; hour: number } {
  // "2026-06-28T14:00" → { date: "2026-06-28", hour: 14 }
  return { date: iso.slice(0, 10), hour: parseInt(iso.slice(11, 13), 10) };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// The IANA timezone the forecast times are expressed in. We use the VIEWER's
// timezone (not the location's) so the returned day/hour stamps line up exactly
// with the calendar's local day columns — otherwise a viewer in a different zone
// than the camp sees each day's weather slide onto the wrong column (a ~24h
// shift). Falls back to Open-Meteo's "auto" (the location's own zone) when Intl
// isn't available (e.g. server-side).
function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "auto";
  } catch {
    return "auto";
  }
}

export interface ForecastOptions {
  /** Days ahead to fetch (1–16). Defaults to the full horizon. */
  forecastDays?: number;
  /** Days of measured history to include (0–92). 0 = forecast only. */
  pastDays?: number;
  /** IANA timezone the returned stamps are in. Defaults to the viewer's. */
  timezone?: string;
  signal?: AbortSignal;
}

export async function fetchForecast(
  location: WeatherLocation,
  unit: TempUnit,
  options: ForecastOptions = {}
): Promise<WeatherData> {
  const { forecastDays = FORECAST_DAYS, pastDays = 0, timezone, signal } = options;
  const u = unitParams(unit);
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    hourly:
      "temperature_2m,weather_code,precipitation,precipitation_probability,apparent_temperature,wind_speed_10m,is_day,uv_index",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max",
    timezone: timezone || viewerTimeZone(),
    forecast_days: String(Math.max(1, Math.min(FORECAST_DAYS, forecastDays))),
    past_days: String(Math.max(0, Math.min(HISTORY_PAST_DAYS, pastDays))),
    ...u,
  });
  const res = await fetch(`${FORECAST_BASE}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  const json = (await res.json()) as Record<string, unknown>;

  const hourlyUnitsRaw = (json.hourly_units ?? {}) as Record<string, string>;
  const units: WeatherUnits = {
    temp: hourlyUnitsRaw.temperature_2m === "°C" ? "°C" : "°F",
    precip: hourlyUnitsRaw.precipitation === "mm" ? "mm" : "inch",
    wind: u.wind_speed_unit === "kmh" ? "km/h" : "mph",
  };

  const h = (json.hourly ?? {}) as Record<string, unknown[]>;
  const times = (h.time as string[]) ?? [];
  const hourly = new Map<string, HourWeather>();
  for (let i = 0; i < times.length; i += 1) {
    const { date, hour } = dateAndHour(times[i]);
    const code = num(h.weather_code?.[i]);
    hourly.set(`${date}@${hour}`, {
      hour,
      temp: num(h.temperature_2m?.[i]),
      apparentTemp: num(h.apparent_temperature?.[i]),
      code,
      condition: wmoToCondition(code),
      isDay: num(h.is_day?.[i]) === 1,
      precip: num(h.precipitation?.[i]),
      precipProb: num(h.precipitation_probability?.[i]),
      wind: num(h.wind_speed_10m?.[i]),
      uvIndex: num(h.uv_index?.[i]),
    });
  }

  const d = (json.daily ?? {}) as Record<string, unknown[]>;
  const dTimes = (d.time as string[]) ?? [];
  const daily = new Map<string, DayWeather>();
  for (let i = 0; i < dTimes.length; i += 1) {
    const code = num(d.weather_code?.[i]);
    daily.set(dTimes[i], {
      code,
      condition: wmoToCondition(code),
      tempMax: num(d.temperature_2m_max?.[i]),
      tempMin: num(d.temperature_2m_min?.[i]),
      precipProbMax: num(d.precipitation_probability_max?.[i]),
      precipSum: num(d.precipitation_sum?.[i]),
      uvIndexMax: num(d.uv_index_max?.[i]),
    });
  }

  const fetchedAt = Date.now();
  return { location, unit, units, hourly, daily, fetchedAt, version: fetchedAt };
}

// Forward geocoding for the location picker. Returns up to `count` matches.
export async function searchLocations(
  query: string,
  signal?: AbortSignal
): Promise<WeatherLocation[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const params = new URLSearchParams({
    name: trimmed,
    count: "6",
    language: "en",
    format: "json",
  });
  const res = await fetch(`${GEOCODE_BASE}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Location search failed (${res.status})`);
  const json = (await res.json()) as { results?: Record<string, unknown>[] };
  const results = json.results ?? [];
  return results.map((r) => ({
    name: String(r.name ?? ""),
    admin1: typeof r.admin1 === "string" ? r.admin1 : undefined,
    country: typeof r.country === "string" ? r.country : undefined,
    countryCode: typeof r.country_code === "string" ? r.country_code : undefined,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    timezone: typeof r.timezone === "string" ? r.timezone : undefined,
  }));
}

// Validators for the persisted view prefs (mirrors the calendar's other
// localStorage validators — a garbage value falls back cleanly).
export function parseWeatherMode(value: unknown, fallback: WeatherMode): WeatherMode {
  return isWeatherMode(value) ? value : fallback;
}
export function parseTempUnit(value: unknown, fallback: TempUnit): TempUnit {
  return isTempUnit(value) ? value : fallback;
}
export function parseWeatherRange(value: unknown, fallback: WeatherRange): WeatherRange {
  return isWeatherRange(value) ? value : fallback;
}
export function parseWeatherLocation(value: unknown, fallback: WeatherLocation | null): WeatherLocation | null {
  if (typeof value !== "object" || value === null) return fallback;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !v.name.trim()) return fallback;
  if (typeof v.latitude !== "number" || !Number.isFinite(v.latitude)) return fallback;
  if (typeof v.longitude !== "number" || !Number.isFinite(v.longitude)) return fallback;
  return {
    name: v.name,
    admin1: typeof v.admin1 === "string" ? v.admin1 : undefined,
    country: typeof v.country === "string" ? v.country : undefined,
    countryCode: typeof v.countryCode === "string" ? v.countryCode : undefined,
    latitude: v.latitude,
    longitude: v.longitude,
    timezone: typeof v.timezone === "string" ? v.timezone : undefined,
  };
}
