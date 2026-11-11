const { test, expect } = require('@playwright/test');
const { fixture } = require('./fixtures');

async function seed(page) {
  page.descriptionErrors = [];
  page.on('pageerror', error => page.descriptionErrors.push(error.message));
  await page.addInitScript(data => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(data)), fixture(4));
  await page.goto('/app/#/b/board0');
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
}

async function savedDescription(page) {
  return page.evaluate(async () => {
    const store = new KambayaStore();
    try {
      await store.db.open();
      return (await store.db.cardDetails.get(['board0', 'card0'])).desc;
    } finally { store.db.close(); }
  });
}

test.afterEach(({ page }) => { expect(page.descriptionErrors || []).toEqual([]); });

test('shows only rendered content, explicitly saves and cancels without writing draft text', async ({ page }) => {
  await seed(page);
  await expect(page.locator('.description-view')).toHaveText('Descripci\u00f3n 0');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await expect(page.locator('.description-view')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('**Unsaved draft**');
  // Another committed card property must not implicitly save the description.
  await page.getByLabel('Priority', { exact: true }).selectOption('high');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('**Unsaved draft**');
  expect(await savedDescription(page)).toBe('Descripci\u00f3n 0');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.description-view')).toHaveText('Descripci\u00f3n 0');
  expect(await savedDescription(page)).toBe('Descripci\u00f3n 0');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('## Saved heading\n\n**Saved bold**');
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await expect(page.locator('.description-view h2')).toHaveText('Saved heading');
  await expect(page.locator('.description-view strong')).toHaveText('Saved bold');
  expect(await savedDescription(page)).toBe('## Saved heading\n\n**Saved bold**');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await expect(page.locator('.description-view h2')).toHaveText('Saved heading');
});

test('renders CommonMark and GFM in preview and saved view, including reference syntax', async ({ page, context }) => {
  await seed(page);
  const markdown = [
    '# Heading one', '## Heading two', '### Heading three',
    'Paragraph **bold**, *italic*, ~~deleted~~ and `inline`.',
    '> Quote\n>\n> Second paragraph',
    '- Parent\n  - Nested\n- Other',
    '1. First\n2. Second',
    '- [x] Done\n- [ ] Pending',
    '| Left | Right |\n| :--- | ---: |\n| A | B |',
    '```js\nconst answer = "<safe>";\n```',
    '---',
    '[Link](https://example.com "Title") and https://example.org',
    '[Reference][ref]\n\n[ref]: https://example.net',
    'Line with a hard break  \nNext line',
    '![External](https://markdown.example.test/photo.png)'
  ].join('\n\n');
  await page.route('https://markdown.example.test/**', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>'
  }));
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(markdown);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.locator('.description-preview');
  await expect(preview.locator('h1')).toHaveText('Heading one');
  await expect(preview.locator('h2')).toHaveText('Heading two');
  await expect(preview.locator('h3')).toHaveText('Heading three');
  await expect(preview.locator('strong')).toHaveText('bold');
  await expect(preview.locator('em')).toHaveText('italic');
  await expect(preview.locator('del')).toHaveText('deleted');
  await expect(preview.locator('blockquote')).toContainText('Second paragraph');
  await expect(preview.locator('ul ul li')).toHaveText('Nested');
  await expect(preview.locator('ol > li')).toHaveText(['First', 'Second']);
  await expect(preview.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(preview.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(preview.locator('input[type="checkbox"]').first()).toBeDisabled();
  await expect(preview.locator('table tbody td')).toHaveText(['A', 'B']);
  await expect(preview.locator('pre code.language-js')).toHaveText('const answer = "<safe>";\n');
  await expect(preview.locator('hr')).toHaveCount(1);
  await expect(preview.locator('br')).toHaveCount(1);
  await expect(preview.getByRole('link', { name: 'Reference', exact: true })).toHaveAttribute('href', 'https://example.net/');
  await expect(preview.locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(markdown);
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await expect(page.locator('.description-view table')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await expect(page.locator('.description-view strong')).toHaveText('bold');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(markdown);
});

test('toolbar wraps selections, supports keyboard formatting and saves with Ctrl+Enter', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  const textarea = page.getByRole('textbox', { name: 'Description', exact: true });
  await textarea.fill('Selected text');
  await textarea.evaluate(el => { el.focus(); el.select(); el.dispatchEvent(new Event('keyup', { bubbles: true })); });
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(textarea).toHaveValue('**Selected text**');
  await textarea.press('Control+i');
  await expect(textarea).toHaveValue('***Selected text***');
  await textarea.press('Control+Enter');
  await expect(page.locator('.description-view strong em, .description-view em strong')).toHaveText('Selected text');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await textarea.fill('List item');
  await textarea.evaluate(el => { el.focus(); el.select(); el.dispatchEvent(new Event('keyup', { bubbles: true })); });
  await page.getByRole('button', { name: 'Task list', exact: true }).click();
  await expect(textarea).toHaveValue('- [ ] List item');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.description-preview input[type="checkbox"]')).not.toBeChecked();
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await textarea.fill('');
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  expect(await savedDescription(page)).toBe('');
  await expect(page.locator('.description-view')).toContainText('Add a more detailed description');
});

test('HTML and unsafe links cannot execute and crafted image attributes remain inert', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  const payload = [
    '<script>globalThis.markdownExecuted = true</script>',
    '<img src=x onerror="globalThis.markdownExecuted=true">',
    '<svg onload="globalThis.markdownExecuted=true"></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '[Unsafe](javascript:alert%281%29)',
    '[Data](data:text/html,test)',
    '![Data image](data:image/svg+xml,test)',
    '![Missing](attachment:not-owned)',
    '![Alt" onerror="alert(1)](https://example.test/image.png "Title\\" onerror=\\"alert(1)")'
  ].join('\n\n');
  await page.route('https://example.test/**', route => route.abort());
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(payload);
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  const view = page.locator('.description-view');
  await expect(view.locator('script, svg, iframe, [onerror], [onload]')).toHaveCount(0);
  await expect(view.locator('a[href^="javascript:"], a[href^="data:"], img[src^="data:"]')).toHaveCount(0);
  await expect(view.locator('img[data-image-id]')).toHaveCount(0);
  await expect(view).toContainText('[Image unavailable: Missing]');
  await expect(view).toContainText('<script>');
  expect(await page.evaluate(() => globalThis.markdownExecuted)).toBeUndefined();
});

test('close, Escape and navigation protect unsaved drafts and update activation refuses them', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  const textarea = page.getByRole('textbox', { name: 'Description', exact: true });
  await textarea.fill('Draft to keep');
  const updateError = await page.evaluate(async () => {
    try { await kambayaFlush(); return null; } catch (error) { return error.message; }
  });
  expect(updateError).toContain('Save or cancel the description');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(textarea).toHaveValue('Draft to keep');
  await page.evaluate(() => { location.hash = '#/'; });
  await page.locator('.app-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.app-dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/b\/board0$/);
  await expect(textarea).toHaveValue('Draft to keep');
  await textarea.press('Escape');
  await page.locator('.app-dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.description-view')).toHaveText('Descripci\u00f3n 0');
  await expect(page.locator('.modal')).toBeVisible();
  expect(await savedDescription(page)).toBe('Descripci\u00f3n 0');
});

test('editor and rendered Markdown fit mobile screens', async ({ page }, testInfo) => {
  await seed(page);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('## Heading\n\n**Formatted text**\n\n```js\n' + 'x'.repeat(200) + '\n```\n\n| Column | Value |\n| --- | --- |\n| One | Two |');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.description-editor').scrollIntoViewIfNeeded();
    const overflow = () => page.locator('.overlay').evaluate(el => el.scrollWidth - el.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    const imageButton = page.getByRole('button', { name: 'Insert attached image', exact: true });
    await expect(page.getByRole('toolbar').getByRole('button', { name: 'Insert attached image', exact: true })).toBeVisible();
    await expect(imageButton).toHaveAttribute('aria-expanded', 'false');
    const editorHeight = await page.locator('.description-editor').evaluate(el => el.getBoundingClientRect().height);
    await imageButton.click();
    await expect(imageButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Attached images', exact: true })).toContainText('Upload an image in Attachments first.');
    expect(await page.locator('.description-editor').evaluate(el => el.getBoundingClientRect().height)).toBe(editorHeight);
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(imageButton).toHaveAttribute('aria-expanded', 'false');
    await expect(imageButton).toBeFocused();
    const toolbar = await page.locator('.description-toolbar').evaluate(el => ({
      height: el.getBoundingClientRect().height,
      tools: [...el.querySelectorAll('[data-format]')].map(button => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        background: getComputedStyle(button).backgroundColor,
        hasIcon: !!button.querySelector('svg[aria-hidden="true"]'),
        label: button.getAttribute('aria-label')
      }))
    }));
    expect(toolbar.tools).toHaveLength(13);
    for (const tool of toolbar.tools) {
      expect(tool.width).toBe(26);
      expect(tool.height).toBe(28);
      expect(tool.background).toBe('rgba(0, 0, 0, 0)');
      expect(tool.hasIcon).toBe(true);
      expect(tool.label).toBeTruthy();
    }
    if (width === 1280) {
      expect(toolbar.height).toBeLessThanOrEqual(40);
      await page.screenshot({ path: testInfo.outputPath('description-editor-desktop.png') });
    }
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('description-editor-mobile.png') });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Write', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await expect(page.locator('.description-view h2')).toHaveText('Heading');
  await page.locator('.description-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('description-saved-mobile.png') });
});
