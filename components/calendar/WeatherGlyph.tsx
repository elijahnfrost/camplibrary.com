"use client";

import { weatherGlyphInner, type WeatherCondition } from "@/lib/weather";

// The weather line-art, shared by the detail popover (and any React surface).
// Renders the SAME static markup the imperative calendar chips build, so the two
// never drift. The markup is app-authored (no user input), so the inner-HTML set
// is safe.
export function WeatherGlyph({
  condition,
  isDay = true,
  className,
}: {
  condition: WeatherCondition;
  isDay?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={["cal-wx-glyph", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: weatherGlyphInner(condition, isDay) }}
    />
  );
}
