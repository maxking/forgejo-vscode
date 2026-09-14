import { fetchNewestActivityPage, getTimelineEventName, type ActivityPage } from '../../webview/shared/helpers';

describe('getTimelineEventName', () => {
  it('prefers a normalized event name', () => {
    expect(getTimelineEventName({ event: 'merged', type: 'merge_pull' })).toBe('merged');
  });

  it('falls back to Forgejo type and rejects blank names', () => {
    expect(getTimelineEventName({ event: '', type: 'label' })).toBe('label');
    expect(getTimelineEventName({})).toBeUndefined();
  });
});

describe('fetchNewestActivityPage', () => {
  const rows = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => ({ id: start + index }));

  it('combines a preceding page with a partial final page and deduplicates overlap', async () => {
    const paged = jest.fn((page: number) => Promise.resolve(page === 1
      ? { items: rows(1, 50), hasMore: true, totalCount: 51 }
      : { items: [{ id: 50 }, { id: 51 }], hasMore: false, totalCount: 51 }));

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id));

    expect(result.items.map(item => item.id)).toEqual(rows(2, 51).map(item => item.id));
    expect(paged).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ truncated: true, newest: true });
  });

  it('uses exactly the final full page when the total is divisible by 50', async () => {
    const paged = jest.fn((page: number) => Promise.resolve({
      items: page === 1 ? rows(1, 50) : rows(51, 100), hasMore: true, totalCount: 100
    }));

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id));

    expect(result.items.map(item => item.id)).toEqual(rows(51, 100).map(item => item.id));
    expect(paged).toHaveBeenCalledTimes(2);
  });

  it('keeps only the first page for newest-first (descending) streams', async () => {
    // A newest-first endpoint (e.g. /pulls/{index}/commits) returns the newest
    // commits on page 1; page 2 holds older commits that should be dropped.
    const paged = jest.fn((page: number) => Promise.resolve(page === 1
      ? { items: rows(51, 100), hasMore: true, totalCount: 100 }
      : { items: rows(1, 50), hasMore: true, totalCount: 100 }));

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id), { descending: true });

    expect(result.items.map(item => item.id)).toEqual(rows(51, 100).map(item => item.id));
    expect(paged).toHaveBeenCalledTimes(1);
    expect(paged).toHaveBeenCalledWith(1);
    expect(result).toMatchObject({ truncated: true, newest: true });
  });

  it('returns the whole first page for a single-page descending stream', async () => {
    const paged = jest.fn(() => Promise.resolve({ items: rows(1, 10), hasMore: false, totalCount: 10 }));

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id), { descending: true });

    expect(result.items.map(item => item.id)).toEqual(rows(1, 10).map(item => item.id));
    expect(paged).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ truncated: false, newest: true });
  });

  it('finds an unknown final page with exponential probing and binary search', async () => {
    const paged = jest.fn((page: number) => {
      if (page === 1) return Promise.resolve({ items: rows(1, 50), hasMore: true, totalCount: null });
      if (page === 2) return Promise.resolve({ items: rows(51, 100), hasMore: true, totalCount: null });
      if (page === 3) return Promise.resolve({ items: rows(101, 120), hasMore: false, totalCount: null });
      return Promise.resolve({ items: [], hasMore: false, totalCount: null });
    });

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id));

    expect(result.items.map(item => item.id)).toEqual(rows(71, 120).map(item => item.id));
    expect(result).toMatchObject({ truncated: true, newest: true });
    expect(paged.mock.calls.map(([page]) => page)).toEqual([1, 2, 4, 3]);
  });

  it('treats a null-items single page as empty instead of throwing (GitHub #20)', async () => {
    // Forgejo returns a bare `null` body for some empty activity endpoints
    // (e.g. an issue timeline with no events). The client library passes the
    // null through, and callers previously crashed on `null.flatMap`.
    const paged = jest.fn(() => Promise.resolve({ items: null, hasMore: false, totalCount: 0 } as unknown as ActivityPage<{ id: number }>));

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id));

    expect(result).toMatchObject({ items: [], truncated: false, newest: true });
    expect(paged).toHaveBeenCalledTimes(1);
  });

  it('treats a null-items page without total metadata as empty instead of probing', async () => {
    // Without an x-total-count header the null page must not be fed into
    // page-length probing either; it should resolve as a final empty page.
    const paged = jest.fn((page: number) => Promise.resolve(
      (page === 1
        ? { items: null, hasMore: false, totalCount: null }
        : { items: rows(1, 50), hasMore: true, totalCount: null }) as unknown as ActivityPage<{ id: number }>));

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id));

    expect(result).toMatchObject({ items: [], truncated: false, newest: true });
    expect(paged).toHaveBeenCalledTimes(1);
  });

  it('terminates immediately when a malformed page reports null items with hasMore true', async () => {
    // A malformed `hasMore: true` alongside invalid items must not send the
    // probe loop chasing pages of null; the stream resolves as a final
    // empty page (CodeRabbit finding on PR #26).
    const paged = jest.fn(() => Promise.resolve({ items: null, hasMore: true, totalCount: 100 } as unknown as ActivityPage<{ id: number }>));

    const result = await fetchNewestActivityPage(paged, async () => [], item => String(item.id));

    expect(result).toMatchObject({ items: [], truncated: false, newest: true });
    expect(paged).toHaveBeenCalledTimes(1);
  });

  it('normalizes a null legacy (non-paged) result to an empty page', async () => {
    const legacy = async () => null as unknown as { id: number }[];

    const result = await fetchNewestActivityPage(undefined, legacy, item => String(item.id));

    expect(result).toMatchObject({ items: [], truncated: false, newest: true });
  });
});
