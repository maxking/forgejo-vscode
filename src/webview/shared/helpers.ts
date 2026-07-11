/** Minimal timeline API shape shared by the issue and PR normalizers. */
export interface TimelineActivity {
  event?: string;
  type?: string;
  body?: string;
  content?: string;
  [key: string]: unknown;
}

/** Forgejo uses `type`; normalized/internal rows may already use `event`. */
export function getTimelineEventName(activity: TimelineActivity): string | undefined {
  return [activity.event, activity.type]
    .find(candidate => typeof candidate === 'string' && candidate.length > 0);
}
