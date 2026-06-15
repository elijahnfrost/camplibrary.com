"use client";

import { useMemo } from "react";
import { AGE_GROUPS } from "@/lib/data";
import type { AgeGroupId } from "@/lib/types";
import { CampIcon } from "../icons";
import {
  DEFAULT_CAMP_HOURS,
  hourOptions,
  windowFromCampHours,
  withClose,
  withOpen,
  type CampHours,
  type CampHoursMap,
} from "@/lib/calendar/hours";
import { formatRangeLabel } from "@/lib/calendar/time";
import { Modal } from "../Modal";
import { ToggleSwitch } from "../primitives";
import { Select } from "../floating/Select";

// "Camp hours" — the independent control for how far the calendar day is
// viewed. Each camp (age group) carries its own drop-off/pickup; the grid spans
// the union of the enabled camps, so pre-K opening at 8:00 alongside the older
// camps' 7:30 drop-off shows a 7:30 grid. A bottom sheet on phones, a centered
// card on desktop (the shared Modal), so it's reachable from anywhere.
export function HoursPanel({
  hours,
  onChange,
  onClose,
}: {
  hours: CampHoursMap;
  onChange: (next: CampHoursMap) => void;
  onClose: () => void;
}) {
  const options = useMemo(() => hourOptions(), []);
  const window_ = windowFromCampHours(hours);
  const anyEnabled = AGE_GROUPS.some((group) => hours[group.id]?.enabled);
  const isDefault = AGE_GROUPS.every((group) => {
    const camp = hours[group.id];
    const base = DEFAULT_CAMP_HOURS[group.id];
    return camp.enabled === base.enabled && camp.openMin === base.openMin && camp.closeMin === base.closeMin;
  });

  const update = (id: AgeGroupId, camp: CampHours) => onChange({ ...hours, [id]: camp });
  const resetDefaults = () =>
    onChange({
      pre: { ...DEFAULT_CAMP_HOURS.pre },
      g13: { ...DEFAULT_CAMP_HOURS.g13 },
      g46: { ...DEFAULT_CAMP_HOURS.g46 },
    });

  return (
    <Modal label="Camp hours" onClose={onClose} overlayProps={{ className: "overlay--card overlay--hours" }}>
      <div className="overlay__bar">
        <h2 className="filtersheet__title">Camp hours</h2>
        <div className="overlay__bar-actions">
          {!isDefault && (
            <button type="button" className="sidesection__action" onClick={resetDefaults}>
              Reset
            </button>
          )}
          {/* A persistent close — the "Done" footer scrolls off on short viewports,
              leaving no visible way out (scrim-tap/Escape aside). */}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CampIcon.Close />
          </button>
        </div>
      </div>
      <div className="overlay__body calhours">
        <p className="calhours__intro">
          Set when each camp&rsquo;s day starts and ends. The calendar shows from the earliest start to the
          latest end.
        </p>
        <div className="calhours__list">
          {AGE_GROUPS.map((group) => {
            const camp = hours[group.id];
            return (
              <div
                key={group.id}
                className={"calhours__camp" + (camp.enabled ? " is-on" : "")}
              >
                <div className="calhours__row">
                  <span className="calhours__name">{group.label}</span>
                  <ToggleSwitch
                    on={camp.enabled}
                    onChange={(on) => update(group.id, { ...camp, enabled: on })}
                    ariaLabel={"Include " + group.label + " in the calendar hours"}
                  />
                </div>
                {camp.enabled && (
                  <div className="calhours__times">
                    <div className="calhours__field">
                      <span className="calhours__fieldlabel">Open</span>
                      <Select
                        value={camp.openMin}
                        options={options}
                        onChange={(value) => update(group.id, withOpen(camp, value))}
                        ariaLabel={group.label + " opening time"}
                      />
                    </div>
                    <span className="calhours__dash" aria-hidden="true">
                      &ndash;
                    </span>
                    <div className="calhours__field">
                      <span className="calhours__fieldlabel">Close</span>
                      <Select
                        value={camp.closeMin}
                        options={options}
                        onChange={(value) => update(group.id, withClose(camp, value))}
                        ariaLabel={group.label + " pickup time"}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="calhours__summary" role="status">
          {anyEnabled ? (
            <>
              Calendar shows <strong>{formatRangeLabel(window_.startMin, window_.endMin)}</strong>
            </>
          ) : (
            "No camps enabled — showing the standard day."
          )}
        </p>
      </div>
      <button type="button" className="btn btn--primary filtersheet__done calhours__done" onClick={onClose}>
        Done
      </button>
    </Modal>
  );
}
