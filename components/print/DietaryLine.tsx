// Camp Library — the printed day-header dietary line (approved plan §H,
// "Meals on paper"). Shared by both the agenda (SchedulePrintDocument) and
// timeline (CalendarTimeline) layouts so the two can never disagree on what
// counts as "severe" or how the line reads — safety copy shouldn't fork.

import type { DietaryEntry } from "@/lib/meals";

// A compact "Peanuts — severe, Shellfish — severe" line under a day heading —
// SEVERE dietary entries only: the anaphylaxis/medical tier, never buried
// among lower-stakes notes on a printed sheet the kitchen staff glance at
// once per day. `entries` is pre-filtered to severity === "severe" by the
// caller (empty renders nothing).
export function DietaryLine({ entries }: { entries: DietaryEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <p className="pd-day__dietary" role="note">
      <span className="pd-day__dietary-kicker">Severe dietary</span>{" "}
      {entries.map((entry, i) => (
        <span key={entry.id} className="pd-day__dietary-item">
          {i > 0 && ", "}
          {entry.label} — severe
        </span>
      ))}
    </p>
  );
}
