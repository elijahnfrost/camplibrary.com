"use client";

import { formatEventDateLabel } from "@/lib/calendar/dates";
import {
  conditionLabel,
  formatPrecip,
  formatTempWithUnit,
  type DayWeather,
  type HourWeather,
  type WeatherUnits,
} from "@/lib/weather";
import { CampIcon } from "../icons";
import { FloatingLayer } from "../floating/FloatingLayer";
import { WeatherGlyph } from "./WeatherGlyph";

// Click a weather chip → this anchored detail card, hosted in the shared
// FloatingLayer engine (rect-anchored on desktop, bottom-docked on phones,
// dismiss on Escape/outside click/scroll — see FloatingLayer.tsx). One card
// serves both modes: an HOUR target shows that hour's temp / rain / wind, a
// DAY target shows the high–low and the day's rain outlook.
export type WeatherPopoverTarget =
  | { kind: "hour"; date: string; hour: number; weather: HourWeather }
  | { kind: "day"; date: string; weather: DayWeather };

function formatHour(hour: number): string {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h} ${ampm}`;
}

export function WeatherPopover({
  target,
  units,
  locationName,
  anchor,
  onClose,
}: {
  target: WeatherPopoverTarget;
  units: WeatherUnits;
  locationName: string;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const isHour = target.kind === "hour";
  const condition = target.weather.condition;
  const isDay = isHour ? (target as { weather: HourWeather }).weather.isDay : true;
  const label = conditionLabel(condition, isDay);
  const when = isHour
    ? `${formatEventDateLabel(target.date)} · ${formatHour((target as { hour: number }).hour)}`
    : formatEventDateLabel(target.date);

  return (
    <FloatingLayer
      anchor={{ kind: "rect", rect: anchor }}
      onClose={onClose}
      className="cal-popover cal-wx-pop"
      role="dialog"
      ariaLabel={`${label} — ${when}`}
    >
      <div className="cal-wx-pop__head">
        <WeatherGlyph condition={condition} isDay={isDay} className="cal-wx-pop__glyph" />
        <div className="cal-wx-pop__heading">
          {isHour ? (
            <span className="cal-wx-pop__temp">
              {formatTempWithUnit((target as { weather: HourWeather }).weather.temp, units)}
            </span>
          ) : (
            <span className="cal-wx-pop__temp">
              {formatTempWithUnit((target as { weather: DayWeather }).weather.tempMax, units)}
              <span className="cal-wx-pop__lo">
                {formatTempWithUnit((target as { weather: DayWeather }).weather.tempMin, units)}
              </span>
            </span>
          )}
          <span className="cal-wx-pop__cond">{label}</span>
          <span className="cal-wx-pop__when">{when}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CampIcon.Close />
        </button>
      </div>

      <dl className="cal-wx-pop__rows">
        {isHour ? (
          <HourRows weather={(target as { weather: HourWeather }).weather} units={units} />
        ) : (
          <DayRows weather={(target as { weather: DayWeather }).weather} units={units} />
        )}
      </dl>

      {locationName && <p className="cal-wx-pop__loc">{locationName}</p>}
    </FloatingLayer>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="cal-wx-pop__row">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HourRows({ weather, units }: { weather: HourWeather; units: WeatherUnits }) {
  const feelsApart = Math.round(weather.apparentTemp) !== Math.round(weather.temp);
  return (
    <>
      {feelsApart && <Row term="Feels like" value={formatTempWithUnit(weather.apparentTemp, units)} />}
      <Row term="Chance of rain" value={`${Math.round(weather.precipProb)}%`} />
      {weather.precip > 0 && <Row term="Rain" value={formatPrecip(weather.precip, units)} />}
      <Row term="Wind" value={`${Math.round(weather.wind)} ${units.wind}`} />
    </>
  );
}

function DayRows({ weather, units }: { weather: DayWeather; units: WeatherUnits }) {
  return (
    <>
      <Row term="High / Low" value={`${formatTempWithUnit(weather.tempMax, units)} / ${formatTempWithUnit(weather.tempMin, units)}`} />
      <Row term="Chance of rain" value={`${Math.round(weather.precipProbMax)}%`} />
      {weather.precipSum > 0 && <Row term="Total rain" value={formatPrecip(weather.precipSum, units)} />}
    </>
  );
}
