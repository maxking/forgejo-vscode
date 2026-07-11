import { getTimelineEventName } from '../../webview/shared/helpers';

describe('getTimelineEventName', () => {
  it('prefers a normalized event name', () => {
    expect(getTimelineEventName({ event: 'merged', type: 'merge_pull' })).toBe('merged');
  });

  it('falls back to Forgejo type and rejects blank names', () => {
    expect(getTimelineEventName({ event: '', type: 'label' })).toBe('label');
    expect(getTimelineEventName({})).toBeUndefined();
  });
});
