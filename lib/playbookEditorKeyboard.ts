import type { PlaybookFrame } from "./playbooks";

export type PlaybookSelectionType = "player" | "flag" | "zone" | "arrow" | "marker";

export interface PlaybookSelection {
  type: PlaybookSelectionType;
  id: string;
}

export interface PlaybookNudge {
  dx: number;
  dy: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function teamLabel(team: "blue" | "red" | "neutral" | undefined): string {
  if (team === "red") return "Red";
  if (team === "blue") return "Blue";
  return "Path";
}

function withKeyboardHint(label: string): string {
  return label + ". Use arrow keys to move. Press Delete to remove.";
}

export function describePlaybookSelection(frame: PlaybookFrame, selection: PlaybookSelection): string {
  if (selection.type === "player") {
    const index = frame.players.findIndex((player) => player.id === selection.id);
    const player = frame.players[index];
    if (player) {
      const role = player.role === "runner" ? " runner" : player.role === "flag" ? " carrier" : " player";
      return withKeyboardHint(teamLabel(player.team) + role + " " + (index + 1));
    }
  }

  if (selection.type === "flag") {
    const index = frame.flags.findIndex((flag) => flag.id === selection.id);
    const flag = frame.flags[index];
    if (flag) return withKeyboardHint(teamLabel(flag.team) + " flag " + (index + 1));
  }

  if (selection.type === "zone") {
    const index = frame.zones.findIndex((zone) => zone.id === selection.id);
    const zone = frame.zones[index];
    if (zone) {
      const fallback = zone.kind + " zone " + (index + 1);
      const name = (zone.label || fallback).trim();
      const suffix = name.toLowerCase().includes("zone") ? "" : " " + zone.kind + " zone";
      return withKeyboardHint(name + suffix);
    }
  }

  if (selection.type === "arrow") {
    const index = frame.arrows.findIndex((arrow) => arrow.id === selection.id);
    const arrow = frame.arrows[index];
    if (arrow) return withKeyboardHint(teamLabel(arrow.team) + " arrow " + (index + 1));
  }

  if (selection.type === "marker") {
    const markers = frame.markers || [];
    const index = markers.findIndex((marker) => marker.id === selection.id);
    const marker = markers[index];
    if (marker) {
      const label = (marker.label || "").trim();
      const what = marker.shape === "text" ? "label" : marker.color + " " + marker.shape + " marker";
      return withKeyboardHint((label ? label + " — " : "") + what + " " + (index + 1));
    }
  }

  return withKeyboardHint("Diagram item");
}

export function nudgePlaybookSelection(
  frame: PlaybookFrame,
  selection: PlaybookSelection,
  nudge: PlaybookNudge
): PlaybookFrame {
  if (selection.type === "player") {
    let changed = false;
    const players = frame.players.map((player) => {
      if (player.id !== selection.id) return player;
      changed = true;
      return { ...player, x: clamp(player.x + nudge.dx, 3, 97), y: clamp(player.y + nudge.dy, 3, 97) };
    });
    return changed ? { ...frame, players } : frame;
  }

  if (selection.type === "flag") {
    let changed = false;
    const flags = frame.flags.map((flag) => {
      if (flag.id !== selection.id) return flag;
      changed = true;
      return { ...flag, x: clamp(flag.x + nudge.dx, 4, 96), y: clamp(flag.y + nudge.dy, 6, 96) };
    });
    return changed ? { ...frame, flags } : frame;
  }

  if (selection.type === "zone") {
    let changed = false;
    const zones = frame.zones.map((zone) => {
      if (zone.id !== selection.id) return zone;
      changed = true;
      return {
        ...zone,
        x: clamp(zone.x + nudge.dx, 1, 99 - zone.w),
        y: clamp(zone.y + nudge.dy, 1, 99 - zone.h),
      };
    });
    return changed ? { ...frame, zones } : frame;
  }

  if (selection.type === "marker") {
    const markers = frame.markers || [];
    let changed = false;
    const next = markers.map((marker) => {
      if (marker.id !== selection.id) return marker;
      changed = true;
      return { ...marker, x: clamp(marker.x + nudge.dx, 3, 97), y: clamp(marker.y + nudge.dy, 3, 97) };
    });
    return changed ? { ...frame, markers: next } : frame;
  }

  if (selection.type === "arrow") {
    let changed = false;
    const arrows = frame.arrows.map((arrow) => {
      if (arrow.id !== selection.id) return arrow;
      changed = true;
      const from: [number, number] = [
        clamp(arrow.from[0] + nudge.dx, 1, 99),
        clamp(arrow.from[1] + nudge.dy, 1, 99),
      ];
      const to: [number, number] = [
        clamp(arrow.to[0] + nudge.dx, 1, 99),
        clamp(arrow.to[1] + nudge.dy, 1, 99),
      ];
      return {
        ...arrow,
        from,
        to,
      };
    });
    return changed ? { ...frame, arrows } : frame;
  }

  return frame;
}
