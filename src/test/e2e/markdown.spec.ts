import { test, expect } from '@playwright/test';
import { WebviewHarness, createMockIssueData, createMockPRData } from './fixtures/webview-harness';

test.describe('Markdown Rendering', () => {
  let harness: WebviewHarness;

  test.beforeEach(async ({ page }) => {
    harness = new WebviewHarness(page);
    await harness.loadPRDetail();
  });

  /**
   * Helper to render markdown in the PR description and return the description locator.
   */
  async function renderMarkdown(page: import('@playwright/test').Page, markdown: string) {
    await harness.sendPRUpdate(createMockPRData({ body: markdown }));
    return page.locator('#pr-description');
  }

  test.describe('Headings', () => {
    test('renders h1 headings', async ({ page }) => {
      const desc = await renderMarkdown(page, '# Heading 1');
      await expect(desc.locator('h1')).toHaveText('Heading 1');
    });

    test('renders h2 headings', async ({ page }) => {
      const desc = await renderMarkdown(page, '## Heading 2');
      await expect(desc.locator('h2')).toHaveText('Heading 2');
    });

    test('renders h3 headings', async ({ page }) => {
      const desc = await renderMarkdown(page, '### Heading 3');
      await expect(desc.locator('h3')).toHaveText('Heading 3');
    });

    test('renders h4-h6 headings', async ({ page }) => {
      const desc = await renderMarkdown(page, '#### H4\n##### H5\n###### H6');
      await expect(desc.locator('h4')).toHaveText('H4');
      await expect(desc.locator('h5')).toHaveText('H5');
      await expect(desc.locator('h6')).toHaveText('H6');
    });
  });

  test.describe('Inline Formatting', () => {
    test('renders bold text with **', async ({ page }) => {
      const desc = await renderMarkdown(page, '**bold text**');
      await expect(desc.locator('strong')).toHaveText('bold text');
    });

    test('renders bold text with __', async ({ page }) => {
      const desc = await renderMarkdown(page, '__bold text__');
      await expect(desc.locator('strong')).toHaveText('bold text');
    });

    test('renders italic text with *', async ({ page }) => {
      const desc = await renderMarkdown(page, '*italic text*');
      await expect(desc.locator('em')).toHaveText('italic text');
    });

    test('renders strikethrough text', async ({ page }) => {
      const desc = await renderMarkdown(page, '~~deleted text~~');
      await expect(desc.locator('del')).toHaveText('deleted text');
    });

    test('renders bold and italic combined', async ({ page }) => {
      const desc = await renderMarkdown(page, '***bold italic***');
      const strong = desc.locator('strong');
      await expect(strong.locator('em')).toHaveText('bold italic');
    });
  });

  test.describe('Code', () => {
    test('renders inline code', async ({ page }) => {
      const desc = await renderMarkdown(page, 'Use `console.log()` for debugging');
      const code = desc.locator('code');
      await expect(code).toHaveText('console.log()');
    });

    test('renders fenced code blocks', async ({ page }) => {
      const desc = await renderMarkdown(page, '```javascript\nconst x = 1;\nconsole.log(x);\n```');
      const pre = desc.locator('pre');
      await expect(pre).toBeVisible();
      const code = pre.locator('code');
      await expect(code).toHaveClass(/language-javascript/);
    });

    test('renders code blocks without language', async ({ page }) => {
      const desc = await renderMarkdown(page, '```\nplain code\n```');
      const pre = desc.locator('pre');
      await expect(pre).toBeVisible();
      await expect(pre.locator('code')).toContainText('plain code');
    });
  });

  test.describe('Links and Images', () => {
    test('renders links', async ({ page }) => {
      const desc = await renderMarkdown(page, '[Click here](https://example.com)');
      const link = desc.locator('a');
      await expect(link).toHaveText('Click here');
      await expect(link).toHaveAttribute('href', 'https://example.com');
    });

    test('renders images', async ({ page }) => {
      const desc = await renderMarkdown(page, '![Alt text](https://example.com/image.png)');
      const img = desc.locator('img');
      await expect(img).toHaveAttribute('alt', 'Alt text');
      await expect(img).toHaveAttribute('src', 'https://example.com/image.png');
    });

    test('autolinks same-repository issue references', async ({ page }) => {
      const desc = await renderMarkdown(page, 'Fixes #199');
      const link = desc.locator('a');
      await expect(link).toHaveText('#199');
      await expect(link).toHaveAttribute('href', 'https://git.example.com/owner/repo/issues/199');
    });

    test('autolinks cross-repository issue references', async ({ page }) => {
      const desc = await renderMarkdown(page, 'Related to other/project#12');
      const link = desc.locator('a');
      await expect(link).toHaveText('other/project#12');
      await expect(link).toHaveAttribute('href', 'https://git.example.com/other/project/issues/12');
    });

    test('does not autolink issue references inside code spans or explicit links', async ({ page }) => {
      const desc = await renderMarkdown(page, '`#199` and [already linked #200](https://example.com/custom)');

      await expect(desc.locator('code')).toHaveText('#199');
      const links = desc.locator('a');
      await expect(links).toHaveCount(1);
      await expect(links.first()).toHaveText('already linked #200');
      await expect(links.first()).toHaveAttribute('href', 'https://example.com/custom');
    });
  });

  test.describe('Lists', () => {
    test('renders unordered lists', async ({ page }) => {
      const desc = await renderMarkdown(page, '- Item 1\n- Item 2\n- Item 3');
      const ul = desc.locator('ul');
      await expect(ul).toBeVisible();
      await expect(ul.locator('li')).toHaveCount(3);
    });

    test('renders ordered lists', async ({ page }) => {
      const desc = await renderMarkdown(page, '1. First\n2. Second\n3. Third');
      const ol = desc.locator('ol');
      await expect(ol).toBeVisible();
      await expect(ol.locator('li')).toHaveCount(3);
    });

    test('renders task lists', async ({ page }) => {
      const desc = await renderMarkdown(page, '- [x] Done task\n- [ ] Pending task');
      const items = desc.locator('.task-list-item');
      await expect(items).toHaveCount(2);

      const checkboxes = desc.locator('input[type="checkbox"]');
      await expect(checkboxes).toHaveCount(2);
      await expect(checkboxes.first()).toBeChecked();
      await expect(checkboxes.last()).not.toBeChecked();
    });
  });

  test.describe('Blockquotes', () => {
    test('renders blockquotes', async ({ page }) => {
      const desc = await renderMarkdown(page, '> This is a quote');
      const blockquote = desc.locator('blockquote');
      await expect(blockquote).toBeVisible();
      await expect(blockquote).toContainText('This is a quote');
    });
  });

  test.describe('Tables', () => {
    test('renders tables', async ({ page }) => {
      const markdown = '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |';
      const desc = await renderMarkdown(page, markdown);
      const table = desc.locator('table');
      await expect(table).toBeVisible();
      await expect(table.locator('th')).toHaveCount(2);
      await expect(table.locator('td')).toHaveCount(2);
    });

    test('renders table with alignment', async ({ page }) => {
      const markdown = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| L | C | R |';
      const desc = await renderMarkdown(page, markdown);
      const table = desc.locator('table');
      await expect(table).toBeVisible();

      // Check alignment via style attributes
      const headers = table.locator('th');
      await expect(headers.nth(0)).toHaveAttribute('style', /text-align:\s*left/);
      await expect(headers.nth(1)).toHaveAttribute('style', /text-align:\s*center/);
      await expect(headers.nth(2)).toHaveAttribute('style', /text-align:\s*right/);
    });
  });

  test.describe('Horizontal Rules', () => {
    test('renders horizontal rules with ---', async ({ page }) => {
      const desc = await renderMarkdown(page, 'Before\n\n---\n\nAfter');
      await expect(desc.locator('hr')).toHaveCount(1);
    });
  });

  test.describe('XSS Protection', () => {
    test('sanitizes javascript: URLs in links', async ({ page }) => {
      const desc = await renderMarkdown(page, '[Click me](javascript:alert("xss"))');
      // Should render text but not as a link with javascript: href
      const links = desc.locator('a[href^="javascript"]');
      await expect(links).toHaveCount(0);
      // Text should still be visible
      await expect(desc).toContainText('Click me');
    });

    test('sanitizes javascript: URLs in images', async ({ page }) => {
      const desc = await renderMarkdown(page, '![alt](javascript:alert("xss"))');
      const imgs = desc.locator('img[src^="javascript"]');
      await expect(imgs).toHaveCount(0);
    });

    test('escapes HTML tags in text', async ({ page }) => {
      const desc = await renderMarkdown(page, '<script>alert("xss")</script>');
      // Should not have any script elements
      const scripts = desc.locator('script');
      await expect(scripts).toHaveCount(0);
      // The escaped text should be visible
      await expect(desc).toContainText('<script>');
    });

    test('escapes HTML in headings', async ({ page }) => {
      const desc = await renderMarkdown(page, '# <b>Not bold HTML</b>');
      // Should be inside h1 but the <b> should be escaped, not rendered
      const h1 = desc.locator('h1');
      await expect(h1).toContainText('<b>Not bold HTML</b>');
      // Should NOT have a real <b> element inside h1
      const boldInH1 = h1.locator('b');
      await expect(boldInH1).toHaveCount(0);
    });

    test('sanitizes data: URLs', async ({ page }) => {
      const desc = await renderMarkdown(page, '[Click](data:text/html,<script>alert(1)</script>)');
      const dangerousLinks = desc.locator('a[href^="data:"]');
      await expect(dangerousLinks).toHaveCount(0);
    });

    test('allows safe https URLs', async ({ page }) => {
      const desc = await renderMarkdown(page, '[Safe link](https://example.com)');
      const link = desc.locator('a');
      await expect(link).toHaveAttribute('href', 'https://example.com');
    });

    test('allows mailto URLs', async ({ page }) => {
      const desc = await renderMarkdown(page, '[Email](mailto:test@example.com)');
      const link = desc.locator('a');
      await expect(link).toHaveAttribute('href', 'mailto:test@example.com');
    });

    test('sanitizes onerror handlers in images', async ({ page }) => {
      const desc = await renderMarkdown(page, '<img src=x onerror="alert(1)">');
      const imgs = desc.locator('img[onerror]');
      await expect(imgs).toHaveCount(0);
    });
  });

  test.describe('Complex Markdown', () => {
    test('renders mixed markdown content', async ({ page }) => {
      const markdown = [
        '# Feature Implementation',
        '',
        'This PR adds **authentication** support.',
        '',
        '## Changes',
        '',
        '- Added `login()` function',
        '- Updated [config docs](https://example.com/docs)',
        '- Fixed ~~broken~~ tests',
        '',
        '## Code Example',
        '',
        '```typescript',
        'const auth = new Auth();',
        'await auth.login(user);',
        '```',
        '',
        '> Note: This requires Node.js 18+',
      ].join('\n');

      const desc = await renderMarkdown(page, markdown);

      await expect(desc.locator('h1')).toHaveText('Feature Implementation');
      await expect(desc.locator('h2').first()).toHaveText('Changes');
      await expect(desc.locator('strong')).toHaveText('authentication');
      await expect(desc.locator('del')).toHaveText('broken');
      await expect(desc.locator('code').first()).toHaveText('login()');
      await expect(desc.locator('a')).toHaveText('config docs');
      await expect(desc.locator('pre')).toBeVisible();
      await expect(desc.locator('blockquote')).toContainText('Note: This requires Node.js 18+');
    });
  });
});

test.describe('Issue Markdown Rendering', () => {
  test('autolinks same-repository issue references in issue details', async ({ page }) => {
    const harness = new WebviewHarness(page);
    await harness.loadIssueDetail();
    await harness.sendIssueUpdate(createMockIssueData({ body: 'Duplicate of #199' }));

    const link = page.locator('#issue-description a');
    await expect(link).toHaveText('#199');
    await expect(link).toHaveAttribute('href', 'https://git.example.com/owner/repo/issues/199');
  });
});
