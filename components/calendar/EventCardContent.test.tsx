// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { EventContentArg } from "@fullcalendar/core";
import type { CalEventExtendedProps } from "@/lib/calendar/adapter";
import type { CalendarEvent } from "@/lib/calendar/types";
import { renderEventContent } from "./EventCardContent";

afterEach(cleanup);

// A full, valid event-props bag (the typed contract) with everything "off"; each
// test flips just the fields it cares about. Because the writer is `satisfies
// CalEventExtendedProps`, this fixture and the adapter can't drift apart.
const baseProps = (over: Partial<CalEventExtendedProps> = {}): CalEventExtendedProps => ({
  calendarEvent: {} as CalendarEvent,
  activityId: undefined,
  tint: "#446644",
  kind: "custom",
  categoryLabel: undefined,
  themeTint: undefined,
  themeLabel: undefined,
  location: undefined,
  repeats: false,
  pinned: false,
  customized: false,
  legLabel: undefined,
  alternatesGlyph: undefined,
  shared: undefined,
  ...over,
});

const arg = (
  extendedProps: object,
  opts: { title?: string; allDay?: boolean; viewType?: string; timeText?: string } = {}
): EventContentArg =>
  ({
    event: { title: opts.title ?? "Craft time", allDay: opts.allDay ?? false, extendedProps },
    view: { type: opts.viewType ?? "timeGridWeek" },
    timeText: opts.timeText ?? "9:00",
  }) as unknown as EventContentArg;

const draw = (a: EventContentArg) => render(<>{renderEventContent(a)}</>).container;

describe("renderEventContent — calendar card", () => {
  it("renders nothing for a closed-day background segment", () => {
    expect(draw(arg({ bgKind: "closed" })).childElementCount).toBe(0);
  });

  it("renders a quiet inline label for a guidance-band background segment", () => {
    const c = draw(arg({ bgKind: "band" }, { title: "Free play" }));
    expect(c.querySelector(".cal-band__label")?.textContent).toBe("Free play");
  });

  it("renders a timed card with the title and time", () => {
    const c = draw(arg(baseProps(), { timeText: "10:30" }));
    expect(c.querySelector(".cal-card")).not.toBeNull();
    expect(c.querySelector(".cal-card__title")?.textContent).toBe("Craft time");
    expect(c.querySelector(".cal-card__time")?.textContent).toBe("10:30");
  });

  it("paints the repeat / pin / edited badges only when their flags are set", () => {
    const off = draw(arg(baseProps()));
    expect(off.querySelector(".cal-card__repeat")).toBeNull();
    expect(off.querySelector(".cal-card__pin")).toBeNull();
    expect(off.querySelector(".cal-card__edited")).toBeNull();

    const on = draw(arg(baseProps({ repeats: true, pinned: true, customized: true })));
    expect(on.querySelector(".cal-card__repeat")).not.toBeNull();
    expect(on.querySelector(".cal-card__pin")).not.toBeNull();
    expect(on.querySelector(".cal-card__edited")).not.toBeNull();
  });

  it("shows the location line only when a location is present", () => {
    expect(draw(arg(baseProps())).querySelector(".cal-card__loc")).toBeNull();
    const c = draw(arg(baseProps({ location: "Gym" })));
    expect(c.querySelector(".cal-card__loctext")?.textContent).toBe("Gym");
  });

  it("shows the shared badge and a backup badge with its count from the contract", () => {
    const c = draw(arg(baseProps({ shared: true, alternatesGlyph: { rain: true, count: 2 } })));
    expect(c.querySelector(".cal-card__shared")).not.toBeNull();
    expect(c.querySelector(".cal-card__backup")).not.toBeNull();
    expect(c.querySelector(".cal-card__backup-n")?.textContent).toBe("2");
  });

  it("renders the compact chip layout in month view", () => {
    const c = draw(arg(baseProps({ legLabel: "1/2" }), { viewType: "dayGridMonth", title: "Assembly" }));
    expect(c.querySelector(".cal-chip")).not.toBeNull();
    expect(c.querySelector(".cal-card")).toBeNull();
    expect(c.querySelector(".cal-chip__title")?.textContent).toBe("Assembly");
    expect(c.querySelector(".cal-chip__leg")?.textContent).toBe("1/2");
  });
});
