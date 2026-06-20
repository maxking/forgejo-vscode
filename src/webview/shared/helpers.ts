/**
 * Shared helper functions for webview rendering.
 * These are extracted to enable unit testing.
 */

/**
 * Escapes HTML entities in text to prevent XSS attacks.
 * Uses DOM-based escaping for maximum security.
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  // For Node.js environment (tests), use manual escaping
  // In browser, the webview.js uses DOM-based escaping
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Converts basic markdown to HTML.
 * Supports: headers, bold, italic, links, code, and newlines.
 * Note: Input is escaped first to prevent XSS.
 */
export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  let html = escapeHtml(text);
  // Headers (must be processed before other patterns)
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  // Bold and italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

/**
 * Formats a date string as relative time (e.g., "2 hours ago").
 * Falls back to formatted date for dates older than 30 days.
 */
export function formatTimeAgo(dateString: string | null | undefined, now?: Date): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  const currentTime = now ?? new Date();
  const diffMs = currentTime.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return diffMins + ' minute' + (diffMins > 1 ? 's' : '') + ' ago';
  if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
  if (diffDays < 30) return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface TimelineActivity {
  event?: string;
  type?: string;
  body?: string;
  content?: string;
  label?: { name?: string };
  old_title?: string;
  new_title?: string;
  assignee?: { login?: string };
  removed_assignee?: boolean;
  milestone?: { title?: string };
  ref?: string;
  branch?: string;
  old_ref?: string;
  new_ref?: string;
  old_branch?: string;
  new_branch?: string;
  commit_id?: string;
  commit_sha?: string;
  old_commit_id?: string;
  new_commit_id?: string;
  commit_url?: string;
  commit_message?: string;
  commit?: {
    id?: string;
    sha?: string;
    url?: string;
    html_url?: string;
    message?: string;
  };
  tracked_time?: {
    time?: number;
    seconds?: number;
    duration?: string;
  };
  time?: number | { time?: number; seconds?: number; duration?: string };
  seconds?: number;
  duration?: string;
}

export function getTimelineEventName(activity: TimelineActivity): string | undefined {
  const eventName = [activity.event, activity.type].find((candidate) => typeof candidate === 'string' && candidate.length > 0);
  return eventName;
}

// Forgejo API event names shared between issue and PR timeline views
const sharedForgejoEvents: Record<string, string> = {
  comment: 'commented',
  change_title: 'changed the title',
  commit_ref: 'referenced this',
  issue_ref: 'referenced this',
  comment_ref: 'referenced this',
  pull_ref: 'referenced this',
  project: 'changed the project',
  project_board: 'moved in project board',
  added_deadline: 'added a deadline',
  modified_deadline: 'modified the deadline',
  removed_deadline: 'removed the deadline',
  add_dependency: 'added a dependency',
  remove_dependency: 'removed a dependency',
  start_tracking: 'started time tracking',
  stop_tracking: 'stopped time tracking',
  add_time_manual: 'added tracked time',
  cancel_tracking: 'cancelled time tracking',
  delete_time_manual: 'removed tracked time',
  change_issue_ref: 'changed the issue reference',
  // GitHub-style shared events
  renamed: 'changed the title',
  commented: 'commented',
  referenced: 'referenced this',
};

function buildEventMap(itemType: 'issue' | 'pull request'): Record<string, string> {
  const typeSpecific: Record<string, string> = {};

  // Close/reopen/lock/unlock/pin/unpin apply to both, but text varies
  typeSpecific.close = `closed this ${itemType}`;
  typeSpecific.reopen = `reopened this ${itemType}`;
  typeSpecific.label = 'added/removed a label';
  typeSpecific.milestone = 'changed the milestone';
  typeSpecific.assignees = 'changed assignees';
  typeSpecific.lock = `locked this ${itemType}`;
  typeSpecific.unlock = `unlocked this ${itemType}`;
  typeSpecific.pin = `pinned this ${itemType}`;
  typeSpecific.unpin = `unpinned this ${itemType}`;
  // GitHub-style
  typeSpecific.closed = `closed this ${itemType}`;
  typeSpecific.reopened = `reopened this ${itemType}`;
  typeSpecific.labeled = 'added a label';
  typeSpecific.unlabeled = 'removed a label';
  typeSpecific.milestoned = 'added to a milestone';
  typeSpecific.demilestoned = 'removed from a milestone';
  typeSpecific.assigned = 'was assigned';
  typeSpecific.unassigned = 'was unassigned';
  typeSpecific.locked = `locked this ${itemType}`;
  typeSpecific.unlocked = `unlocked this ${itemType}`;
  typeSpecific.pinned = `pinned this ${itemType}`;
  typeSpecific.unpinned = `unpinned this ${itemType}`;

  if (itemType === 'pull request') {
    typeSpecific.delete_branch = 'deleted the head branch';
    typeSpecific.merge_pull = 'merged this pull request';
    typeSpecific.review = 'submitted a review';
    typeSpecific.review_request = 'requested a review';
    typeSpecific.dismiss_review = 'dismissed a review';
    typeSpecific.change_target_branch = 'changed the target branch';
    typeSpecific.pull_push = 'pushed commits';
    typeSpecific.code = 'commented on code';
    typeSpecific.pull_scheduled_merge = 'scheduled auto-merge';
    typeSpecific.pull_cancel_scheduled_merge = 'cancelled auto-merge';
    // GitHub-style PR events
    typeSpecific.merged = 'merged this pull request';
    typeSpecific.reviewed = 'submitted a review';
    typeSpecific.approved = 'approved this pull request';
    typeSpecific.rejected = 'requested changes';
    typeSpecific.head_ref_deleted = 'deleted the head branch';
    typeSpecific.head_ref_restored = 'restored the head branch';
    typeSpecific.marked_ready_for_review = 'marked as ready for review';
    typeSpecific.converted_to_draft = 'converted to draft';
  } else {
    typeSpecific.transferred = 'transferred this issue';
  }

  // Build the reference text for shared events
  const resolvedShared: Record<string, string> = {};
  for (const [key, value] of Object.entries(sharedForgejoEvents)) {
    resolvedShared[key] = value === 'referenced this' ? `referenced this ${itemType}` : value;
  }

  return { ...resolvedShared, ...typeSpecific };
}

function getTimelineBody(activity: TimelineActivity): string {
  return [activity.body, activity.content].find((value) => typeof value === 'string') ?? '';
}

function getLabelEventVerb(activity: TimelineActivity, eventName: string): 'added' | 'removed' | undefined {
  if (eventName === 'labeled') return 'added';
  if (eventName === 'unlabeled') return 'removed';

  if (eventName !== 'label') return undefined;

  const body = getTimelineBody(activity).trim();
  if (body === '1') return 'added';
  if (body.length === 0) return 'removed';
  return undefined;
}

function getFiniteSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function getTrackedTimeText(activity: TimelineActivity): string {
  const trackedTime = activity.tracked_time;
  const legacyTime = typeof activity.time === 'object' ? activity.time : undefined;
  const seconds = [
    getFiniteSeconds(trackedTime?.time),
    getFiniteSeconds(trackedTime?.seconds),
    getFiniteSeconds(legacyTime?.time),
    getFiniteSeconds(legacyTime?.seconds),
    getFiniteSeconds(activity.time),
    getFiniteSeconds(activity.seconds)
  ].find((value): value is number => value !== undefined);

  if (seconds !== undefined) return formatDuration(seconds);

  const duration = [trackedTime?.duration, legacyTime?.duration, activity.duration, getTimelineBody(activity)]
    .find((value) => typeof value === 'string' && value.trim().length > 0 && value.trim() !== '1');
  return duration?.trim() ?? '';
}

function enrichEventText(activity: TimelineActivity, eventName: string, eventText: string): string {
  if (eventName === 'label' && activity.label) {
    const verb = getLabelEventVerb(activity, eventName);
    if (verb) {
      return verb + ' label <strong>' + escapeHtml(activity.label.name ?? '') + '</strong>';
    }
    return eventText + ' <strong>' + escapeHtml(activity.label.name ?? '') + '</strong>';
  }
  if ((eventName === 'labeled' || eventName === 'unlabeled') && activity.label) {
    const verb = getLabelEventVerb(activity, eventName) ?? (eventName === 'labeled' ? 'added' : 'removed');
    return verb + ' label <strong>' + escapeHtml(activity.label.name ?? '') + '</strong>';
  }
  if (eventName === 'change_title' && activity.old_title && activity.new_title) {
    return 'changed title from <del>' + escapeHtml(activity.old_title) + '</del> to <strong>' + escapeHtml(activity.new_title) + '</strong>';
  }
  if (eventName === 'assignees' && activity.assignee) {
    return (activity.removed_assignee ? 'unassigned ' : 'assigned ') + '<strong>' + escapeHtml(activity.assignee.login ?? '') + '</strong>';
  }
  if (eventName === 'milestone' && activity.milestone) {
    return 'set milestone to <strong>' + escapeHtml(activity.milestone.title ?? '') + '</strong>';
  }
  const trackedTimeText = getTrackedTimeText(activity);
  if (eventName === 'add_time_manual' && trackedTimeText) {
    return 'added <strong>' + escapeHtml(trackedTimeText) + '</strong> tracked time';
  }
  if (eventName === 'stop_tracking' && trackedTimeText) {
    return 'stopped time tracking and added <strong>' + escapeHtml(trackedTimeText) + '</strong>';
  }
  if (eventName === 'delete_time_manual' && trackedTimeText) {
    return 'removed <strong>' + escapeHtml(trackedTimeText) + '</strong> tracked time';
  }
  return eventText;
}

const issueEventMap = buildEventMap('issue');
const prEventMap = buildEventMap('pull request');

/**
 * Renders a human-readable description of a timeline event for issues.
 */
export function renderIssueTimelineEvent(activity: TimelineActivity): string {
  const eventName = getTimelineEventName(activity);
  if (!eventName) return 'performed an action';
  const eventText = issueEventMap[eventName] ?? eventName;
  return enrichEventText(activity, eventName, eventText);
}

/**
 * Renders a human-readable description of a timeline event for pull requests.
 */
export function renderPRTimelineEvent(activity: TimelineActivity): string {
  const eventName = getTimelineEventName(activity);
  if (!eventName) return 'performed an action';
  const eventText = prEventMap[eventName] ?? eventName;
  return enrichEventText(activity, eventName, eventText);
}
