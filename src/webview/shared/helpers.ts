/** Minimal timeline API shape shared by the issue and PR normalizers. */
export interface TimelineActivity {
  event?: string;
  type?: string;
  body?: string;
  content?: string;
  [key: string]: unknown;
}

export interface ActivityPage<T> {
  items: T[];
  hasMore: boolean;
  totalCount?: number | null;
}

export interface NewestActivityPage<T> {
  items: T[];
  truncated: boolean;
  newest: boolean;
}

const ACTIVITY_PAGE_SIZE = 50;
const MAX_ACTIVITY_PAGE_PROBES = 20;

/**
 * Normalizes a page result whose `items` Forgejo reported as `null`.
 *
 * Forgejo returns a bare `null` body instead of `[]` for some empty activity
 * endpoints (for example an issue timeline with no events yet), and the client
 * library passes that through verbatim. Callers iterate `items` directly, so
 * a null page would throw `Cannot read properties of null` far away from the
 * fetch (GitHub issue #20 / Codeberg issue #31).
 */
function normalizeActivityPage<T>(page: ActivityPage<T> | null | undefined): ActivityPage<T> {
  if (!page || !Array.isArray(page.items)) {
    // A page with invalid items is terminal: a malformed `hasMore: true`
    // must not send the probe loop chasing pages of null (CodeRabbit
    // finding on PR #26), which would flag an empty stream as truncated.
    return { items: [], hasMore: false, totalCount: page?.totalCount ?? null };
  }
  return { items: page.items, hasMore: page.hasMore, totalCount: page.totalCount };
}

/**
 * Finds the tail of a paginated activity stream without walking all intervening
 * pages. Forgejo reports `hasMore` for a full page even when it is the final
 * page, so unknown totals require probing for the first non-full page.
 *
 * Most Forgejo activity streams are ascending (oldest first), so the newest
 * items live on the last page. Set `options.descending` for endpoints that
 * return newest first (e.g. `/pulls/{index}/commits`, which mirrors `git log`),
 * where the newest items are on page 1.
 */
export async function fetchNewestActivityPage<T>(
  paged: ((page: number) => Promise<ActivityPage<T>>) | undefined,
  legacy: () => Promise<T[]>,
  keyOf: (item: T) => string,
  options: { descending?: boolean } = {}
): Promise<NewestActivityPage<T>> {
  if (!paged) {
    const legacyItems = await legacy();
    return { items: Array.isArray(legacyItems) ? legacyItems : [], truncated: false, newest: true };
  }

  const cache = new Map<number, ActivityPage<T>>();
  const fetchPage = async (page: number): Promise<ActivityPage<T>> => {
    const cached = cache.get(page);
    if (cached) return cached;
    const result = normalizeActivityPage(await paged(page));
    cache.set(page, result);
    return result;
  };
  const first = await fetchPage(1);
  if (!first.hasMore) return { items: first.items, truncated: false, newest: true };
  // Newest-first streams already have the newest items on page 1; older pages
  // are dropped, so flag the result as truncated.
  if (options.descending) return { items: first.items, truncated: true, newest: true };

  let boundaryPage: number;
  if (typeof first.totalCount === 'number') {
    boundaryPage = Math.max(1, Math.ceil(first.totalCount / ACTIVITY_PAGE_SIZE));
  } else {
    let lowerFullPage = 1;
    let upperNonFullPage: number | undefined;
    for (let probe = 2, attempts = 0; attempts < MAX_ACTIVITY_PAGE_PROBES; probe *= 2, attempts += 1) {
      const result = await fetchPage(probe);
      if (!result.hasMore) {
        upperNonFullPage = probe;
        break;
      }
      lowerFullPage = probe;
    }
    if (!upperNonFullPage) {
      return { items: first.items, truncated: true, newest: false };
    }
    while (lowerFullPage + 1 < upperNonFullPage) {
      const middle = Math.floor((lowerFullPage + upperNonFullPage) / 2);
      if ((await fetchPage(middle)).hasMore) lowerFullPage = middle;
      else upperNonFullPage = middle;
    }
    const boundary = await fetchPage(upperNonFullPage);
    boundaryPage = boundary.items.length > 0 ? upperNonFullPage : upperNonFullPage - 1;
  }

  const last = await fetchPage(boundaryPage);
  const tailPages = last.items.length < ACTIVITY_PAGE_SIZE && boundaryPage > 1
    ? [await fetchPage(boundaryPage - 1), last]
    : [last];
  const deduplicated = new Map<string, T>();
  for (const page of tailPages) {
    for (const item of page.items) deduplicated.set(keyOf(item), item);
  }
  return {
    items: Array.from(deduplicated.values()).slice(-ACTIVITY_PAGE_SIZE),
    truncated: boundaryPage > 1,
    newest: true
  };
}

/** Forgejo uses `type`; normalized/internal rows may already use `event`. */
export function getTimelineEventName(activity: TimelineActivity): string | undefined {
  return [activity.event, activity.type]
    .find(candidate => typeof candidate === 'string' && candidate.length > 0);
}
