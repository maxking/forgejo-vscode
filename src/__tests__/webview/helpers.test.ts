import { escapeHtml, renderMarkdown, formatTimeAgo, getTimelineEventName, renderIssueTimelineEvent, renderPRTimelineEvent } from '../../webview/shared/helpers';

describe('Webview Helpers', () => {
  describe('escapeHtml', () => {
    test('should escape < and > characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    test('should escape & characters', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    test('should escape double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    test('should escape single quotes', () => {
      expect(escapeHtml("it's working")).toBe('it&#039;s working');
    });

    test('should return empty string for null', () => {
      expect(escapeHtml(null)).toBe('');
    });

    test('should return empty string for undefined', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    test('should return empty string for empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('should handle text with no special characters', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    test('should handle multiple special characters', () => {
      expect(escapeHtml('<div class="test">&</div>')).toBe(
        '&lt;div class=&quot;test&quot;&gt;&amp;&lt;/div&gt;'
      );
    });
  });

  describe('renderMarkdown', () => {
    test('should convert # headers to h1', () => {
      expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    });

    test('should convert ## headers to h2', () => {
      expect(renderMarkdown('## Subtitle')).toBe('<h2>Subtitle</h2>');
    });

    test('should convert ### headers to h3', () => {
      expect(renderMarkdown('### Section')).toBe('<h3>Section</h3>');
    });

    test('should convert **bold** to strong', () => {
      expect(renderMarkdown('This is **bold** text')).toBe(
        'This is <strong>bold</strong> text'
      );
    });

    test('should convert *italic* to em', () => {
      expect(renderMarkdown('This is *italic* text')).toBe(
        'This is <em>italic</em> text'
      );
    });

    test('should convert [link](url) to anchor tags', () => {
      expect(renderMarkdown('[Click here](https://example.com)')).toBe(
        '<a href="https://example.com">Click here</a>'
      );
    });

    test('should convert `code` to code tags', () => {
      expect(renderMarkdown('Use `console.log()`')).toBe(
        'Use <code>console.log()</code>'
      );
    });

    test('should convert newlines to br tags', () => {
      expect(renderMarkdown('Line 1\nLine 2')).toBe('Line 1<br>Line 2');
    });

    test('should return empty string for null', () => {
      expect(renderMarkdown(null)).toBe('');
    });

    test('should return empty string for undefined', () => {
      expect(renderMarkdown(undefined)).toBe('');
    });

    test('should escape HTML before markdown processing (XSS prevention)', () => {
      expect(renderMarkdown('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    test('should handle combined markdown formatting', () => {
      const input = '## Review\n\n**Important** point with `code`';
      const result = renderMarkdown(input);
      expect(result).toContain('<h2>Review</h2>');
      expect(result).toContain('<strong>Important</strong>');
      expect(result).toContain('<code>code</code>');
    });

    test('should handle markdown in mixed content', () => {
      const input = '- Fixed the **bug**\n- Added `tests`';
      const result = renderMarkdown(input);
      expect(result).toContain('<strong>bug</strong>');
      expect(result).toContain('<code>tests</code>');
      expect(result).toContain('<br>');
    });
  });

  describe('formatTimeAgo', () => {
    // Use a fixed "now" time for consistent testing
    const now = new Date('2024-01-15T12:00:00Z');

    test('should return "just now" for < 60 seconds', () => {
      const date = new Date('2024-01-15T11:59:30Z'); // 30 seconds ago
      expect(formatTimeAgo(date.toISOString(), now)).toBe('just now');
    });

    test('should return "1 minute ago" for exactly 1 minute', () => {
      const date = new Date('2024-01-15T11:59:00Z'); // 1 minute ago
      expect(formatTimeAgo(date.toISOString(), now)).toBe('1 minute ago');
    });

    test('should return "X minutes ago" for < 60 minutes', () => {
      const date = new Date('2024-01-15T11:30:00Z'); // 30 minutes ago
      expect(formatTimeAgo(date.toISOString(), now)).toBe('30 minutes ago');
    });

    test('should return "1 hour ago" for exactly 1 hour', () => {
      const date = new Date('2024-01-15T11:00:00Z'); // 1 hour ago
      expect(formatTimeAgo(date.toISOString(), now)).toBe('1 hour ago');
    });

    test('should return "X hours ago" for < 24 hours', () => {
      const date = new Date('2024-01-15T06:00:00Z'); // 6 hours ago
      expect(formatTimeAgo(date.toISOString(), now)).toBe('6 hours ago');
    });

    test('should return "1 day ago" for exactly 1 day', () => {
      const date = new Date('2024-01-14T12:00:00Z'); // 1 day ago
      expect(formatTimeAgo(date.toISOString(), now)).toBe('1 day ago');
    });

    test('should return "X days ago" for < 30 days', () => {
      const date = new Date('2024-01-10T12:00:00Z'); // 5 days ago
      expect(formatTimeAgo(date.toISOString(), now)).toBe('5 days ago');
    });

    test('should return formatted date for >= 30 days', () => {
      const date = new Date('2023-12-01T12:00:00Z'); // 45 days ago
      const result = formatTimeAgo(date.toISOString(), now);
      expect(result).toBe('Dec 1');
    });

    test('should return empty string for null', () => {
      expect(formatTimeAgo(null, now)).toBe('');
    });

    test('should return empty string for undefined', () => {
      expect(formatTimeAgo(undefined, now)).toBe('');
    });

    test('should return empty string for empty string', () => {
      expect(formatTimeAgo('', now)).toBe('');
    });

    test('should handle singular minute correctly', () => {
      const date = new Date('2024-01-15T11:59:00Z');
      expect(formatTimeAgo(date.toISOString(), now)).toBe('1 minute ago');
    });

    test('should handle singular hour correctly', () => {
      const date = new Date('2024-01-15T11:00:00Z');
      expect(formatTimeAgo(date.toISOString(), now)).toBe('1 hour ago');
    });

    test('should handle singular day correctly', () => {
      const date = new Date('2024-01-14T12:00:00Z');
      expect(formatTimeAgo(date.toISOString(), now)).toBe('1 day ago');
    });
  });

  describe('renderIssueTimelineEvent', () => {
    test('should use Forgejo timeline type when event is missing', () => {
      expect(getTimelineEventName({ type: 'label' })).toBe('label');
      expect(renderIssueTimelineEvent({ type: 'label', label: { name: 'problem' } })).toContain('problem');
    });

    test('should use Forgejo timeline type when event is empty', () => {
      expect(getTimelineEventName({ event: '', type: 'label' })).toBe('label');
      expect(renderIssueTimelineEvent({ event: '', type: 'label' })).toBe('added/removed a label');
    });

    test('should return "performed an action" when event is missing', () => {
      expect(renderIssueTimelineEvent({})).toBe('performed an action');
    });

    test('should return "performed an action" when event is empty string', () => {
      expect(renderIssueTimelineEvent({ event: '' })).toBe('performed an action');
    });

    test('should render close event', () => {
      expect(renderIssueTimelineEvent({ event: 'close' })).toBe('closed this issue');
    });

    test('should render reopen event', () => {
      expect(renderIssueTimelineEvent({ event: 'reopen' })).toBe('reopened this issue');
    });

    test('should render comment event as "commented"', () => {
      expect(renderIssueTimelineEvent({ event: 'comment' })).toBe('commented');
    });

    test('should render Forgejo label add event with label name', () => {
      expect(renderIssueTimelineEvent({ event: 'label', body: '1', label: { name: 'bug' } })).toBe(
        'added label <strong>bug</strong>'
      );
    });

    test('should render Forgejo label remove event with label name', () => {
      expect(renderIssueTimelineEvent({ event: 'label', body: '', label: { name: 'priority/high' } })).toBe(
        'removed label <strong>priority/high</strong>'
      );
    });

    test('should render GitHub-style label events with label names', () => {
      expect(renderIssueTimelineEvent({ event: 'labeled', label: { name: 'feature' } })).toBe(
        'added label <strong>feature</strong>'
      );
      expect(renderIssueTimelineEvent({ event: 'unlabeled', label: { name: 'feature' } })).toBe(
        'removed label <strong>feature</strong>'
      );
    });

    test('should render tracked time added for manual time events', () => {
      expect(renderIssueTimelineEvent({ event: 'add_time_manual', tracked_time: { time: 5400 } })).toBe(
        'added <strong>1h 30m</strong> tracked time'
      );
    });

    test('should render tracked time added for stopped timers', () => {
      expect(renderIssueTimelineEvent({ event: 'stop_tracking', tracked_time: { time: 90 } })).toBe(
        'stopped time tracking and added <strong>1m 30s</strong>'
      );
    });

    test('should render tracked time removed for deleted time events', () => {
      expect(renderIssueTimelineEvent({ event: 'delete_time_manual', tracked_time: { time: 45 } })).toBe(
        'removed <strong>45s</strong> tracked time'
      );
    });

    test('should render change_title event with old and new titles', () => {
      const result = renderIssueTimelineEvent({ event: 'change_title', old_title: 'Old', new_title: 'New' });
      expect(result).toContain('Old');
      expect(result).toContain('New');
    });

    test('should fall back to event name for unknown events', () => {
      expect(renderIssueTimelineEvent({ event: 'some_unknown_event' })).toBe('some_unknown_event');
    });
  });

  describe('renderPRTimelineEvent', () => {
    test('should use Forgejo timeline type when event is missing', () => {
      expect(getTimelineEventName({ type: 'merge_pull' })).toBe('merge_pull');
      expect(renderPRTimelineEvent({ type: 'merge_pull' })).toBe('merged this pull request');
    });

    test('should return "performed an action" when event is missing', () => {
      expect(renderPRTimelineEvent({})).toBe('performed an action');
    });

    test('should render merge_pull event', () => {
      expect(renderPRTimelineEvent({ event: 'merge_pull' })).toBe('merged this pull request');
    });

    test('should render review event', () => {
      expect(renderPRTimelineEvent({ event: 'review' })).toBe('submitted a review');
    });

    test('should render comment event as "commented"', () => {
      expect(renderPRTimelineEvent({ event: 'comment' })).toBe('commented');
    });

    test('should render Forgejo label add and remove events with label names', () => {
      expect(renderPRTimelineEvent({ event: 'label', body: '1', label: { name: 'type/feature' } })).toBe(
        'added label <strong>type/feature</strong>'
      );
      expect(renderPRTimelineEvent({ event: 'label', body: '', label: { name: 'type/feature' } })).toBe(
        'removed label <strong>type/feature</strong>'
      );
    });

    test('should render tracked time details for PR timeline events', () => {
      expect(renderPRTimelineEvent({ event: 'add_time_manual', tracked_time: { time: 3661 } })).toBe(
        'added <strong>1h 1m 1s</strong> tracked time'
      );
    });

    test('should render close event for pull requests', () => {
      expect(renderPRTimelineEvent({ event: 'close' })).toBe('closed this pull request');
    });

    test('should fall back to event name for unknown events', () => {
      expect(renderPRTimelineEvent({ event: 'some_unknown_event' })).toBe('some_unknown_event');
    });
  });
});
