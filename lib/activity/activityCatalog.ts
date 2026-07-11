import type { Activity } from "../types";

export function mergeActivityCatalog(
  seedActivities: Activity[],
  extraActivities: Activity[],
  deletedActivityIds: string[]
): Activity[] {
  const deleted = new Set(deletedActivityIds);
  const visibleExtra: Activity[] = [];
  const seenExtra = new Set<string>();
  for (const activity of extraActivities) {
    if (deleted.has(activity.id) || seenExtra.has(activity.id)) continue;
    visibleExtra.push(activity);
    seenExtra.add(activity.id);
  }
  const extraIds = new Set(visibleExtra.map((activity) => activity.id));

  return [
    ...visibleExtra,
    ...seedActivities.filter((activity) => !deleted.has(activity.id) && !extraIds.has(activity.id)),
  ];
}

export function upsertActivityRecord(extraActivities: Activity[], activity: Activity): Activity[] {
  let found = false;
  const next = extraActivities.map((existing) => {
    if (existing.id !== activity.id) return existing;
    found = true;
    return activity;
  });
  return found ? next : [activity, ...extraActivities];
}

export function removeActivityRecord(extraActivities: Activity[], activityId: string): Activity[] {
  return extraActivities.filter((activity) => activity.id !== activityId);
}

export function seedActivityIds(seedActivities: Activity[]): Set<string> {
  return new Set(seedActivities.map((activity) => activity.id));
}
