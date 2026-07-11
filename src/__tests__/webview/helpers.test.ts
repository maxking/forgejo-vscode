import { fetchNewestActivityPage, getTimelineEventName } from '../../webview/shared/helpers';

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
});
