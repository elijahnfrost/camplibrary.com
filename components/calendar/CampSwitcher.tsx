"use client";

import { useState } from "react";
import type { Camp } from "@/lib/camps";
import { CampIcon } from "../icons";
import { ListManagerModal } from "../ListManagerModal";

// The calendar's camp control — a header pill sized to match the Today / view
// controls. With no camps it reads "Add camp"; once camps exist it shows the
// active one. Clicking opens the Camps manager (a real screen): switch, create,
// rename, delete. The library catalog is shared; only the schedule is per-camp.

export function CampSwitcher({
  camps,
  activeCampId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  camps: Camp[];
  activeCampId: string | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const empty = camps.length === 0;
  const active = camps.find((c) => c.id === activeCampId) ?? null;

  return (
    <>
      <button
        type="button"
        className={"campswitch__trigger" + (empty ? " is-empty" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={empty ? "Add a camp" : "Camps — currently " + (active?.name ?? "")}
        onClick={() => setOpen(true)}
      >
        <CampIcon.Pin />
        <span className="campswitch__name">{empty ? "Add camp" : active?.name ?? "Camps"}</span>
        {empty ? <CampIcon.Plus /> : <CampIcon.ChevronDown />}
      </button>

      {open && (
        <ListManagerModal
          title="Camps"
          intro="Each camp keeps its own schedule. Your activity library is shared across all of them."
          items={camps.map((c) => ({ id: c.id, label: c.name }))}
          activeId={activeCampId}
          createPlaceholder="e.g. Summer Day Camp"
          createLabel="Add camp"
          emptyHint="No camps yet. Add one to keep its schedule separate from the rest."
          onSelect={(id) => {
            onSwitch(id);
            setOpen(false);
          }}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={(item) => onDelete(item.id, item.label)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
