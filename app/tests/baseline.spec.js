const { test, expect } = require('@playwright/test');
const { fixture } = require('./fixtures');
test('preserves legacy card details, search and calendar contracts', async ({ page }) => {
  await page.addInitScript(data => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(data)), fixture(20));
  await page.goto('/app/#/b/board0');
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await expect(page.locator('.description-view')).toHaveText('Descripción 0');
  await expect(page.locator('.comments')).toContainText('Nota 0');
  await expect(page.locator('[data-f="recurrence"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-act="toggle-filters"]').click();
  await page.locator('.filter-keyword').fill('aguja-remota');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card')).toContainText('Tarea 18');
  await page.locator('[data-act="clear-filters"]').click();
  await page.locator('[data-act="close-filters"]').first().click();
  await page.locator('[data-act="toggle-view"]').click();
  await expect(page.locator('.cal-day')).toHaveCount(42);
});
test('due date removal fits the card editor on desktop and mobile', async ({ page }) => {
  await page.addInitScript(data => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(data)), fixture(20));
  await page.goto('/app/#/b/board0');
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const measurements = await page.locator('.card-properties .row').evaluate(row => {
      const rect = row.getBoundingClientRect();
      const items = [...row.children].map(el => el.getBoundingClientRect());
      return { overflow: row.scrollWidth - row.clientWidth, right: rect.right, viewport: innerWidth,
        overlap: items.some((a, i) => items.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)) };
    });
    expect(measurements.overflow).toBeLessThanOrEqual(1);
    expect(measurements.right).toBeLessThanOrEqual(measurements.viewport);
    expect(measurements.overlap).toBe(false);
  }
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
});
test('template name uses a cancellable app dialog and accepts Enter', async ({ page }) => {
  await page.addInitScript(data => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(data)), fixture(20));
  await page.goto('/app/#/b/board0');
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await page.locator('[data-act="save-template"]').click();
  const dialog = page.getByRole('dialog', { name: 'Template name' });
  const input = dialog.getByRole('textbox', { name: 'Template name' });
  await expect(input).toHaveValue('Tarea 0');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.locator('[data-act="save-template"]').click();
  await input.fill('My template');
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Personal template saved');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="open-templates"]').click();
  await expect(page.locator('.template-row')).toHaveCount(2);
  await expect(page.locator('.template-row').filter({ hasText: 'My template' })).toHaveCount(1);
});
test('shows IndexedDB storage usage and refreshes it after saving', async ({ page }) => {
  await page.addInitScript(() => {
    let estimates = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: (estimates++ === 0 ? 10 : 45) * 1024 * 1024, quota: 100 * 1024 * 1024 }) }
    });
  });
  await page.goto('/app/');
  const progress = page.getByRole('progressbar', { name: 'Storage used' });
  await expect(progress).toHaveAttribute('aria-valuenow', '10');
  await expect(page.locator('.storage-value')).toHaveText('10%');
  await page.locator('[data-act="new-board"]').first().click();
  await page.locator('[data-act="create-board"]').click();
  await expect(progress).toHaveAttribute('aria-valuenow', '45');
  await expect(progress).toHaveAttribute('aria-valuetext', '45.0 MB used of 100.0 MB (45%)');
});
test('renders selected-label checkmarks without encoding artifacts', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('.board-tile').filter({ hasText: 'My first board' }).click();
  await page.locator('.card').filter({ hasText: 'Your data is saved only in this browser' }).click();
  const selectedLabel = page.locator('.chip.on').first();
  await expect(selectedLabel).toBeVisible();
  expect(await selectedLabel.evaluate(label => getComputedStyle(label, '::before').content)).toBe('"✓"');
});
test('card priority is editable, visible, and persisted', async ({ page }) => {
  await page.addInitScript(data => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(data)), fixture(20));
  await page.goto('/app/#/b/board0');
  const card = page.locator('.card').filter({ hasText: 'Tarea 0' });
  await card.click();
  await page.getByLabel('Priority').selectOption('critical');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card.locator('.priority-badge')).toHaveText('▲ Critical');
  await page.reload();
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await expect(page.getByLabel('Priority')).toHaveValue('critical');
});
test('adds sample priorities to an existing My first board without replacing set priorities', async ({ page }) => {
  const data = fixture(10);
  const board = data.boards[0];
  board.name = 'My first board';
  const cards = board.lists.flatMap(list => list.cards);
  const titles = [
    '👋 Welcome: drag this card to another list', 'Click a card to view its details',
    'Create your own board with "＋ Create"', 'Your data is saved only in this browser',
    'Install the app (browser menu → Install)'
  ];
  cards.forEach((card, index) => { card.title = titles[index]; });
  cards[0].priority = 'critical';
  await page.addInitScript(value => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(value)), data);
  await page.goto('/app/#/b/board0');
  await expect(page.locator('.card').filter({ hasText: titles[0] }).locator('.priority-badge')).toHaveText('▲ Critical');
  await expect(page.locator('.card').filter({ hasText: titles[1] }).locator('.priority-badge')).toHaveText('▲ Medium');
  await expect(page.locator('.card').filter({ hasText: titles[2] }).locator('.priority-badge')).toHaveText('▲ High');
  await expect(page.locator('.card').filter({ hasText: titles[3] }).locator('.priority-badge')).toHaveText('▲ Critical');
  await expect(page.locator('.card').filter({ hasText: titles[4] }).locator('.priority-badge')).toHaveText('▲ Low');
});
test('new My first board shows priorities on its welcome cards', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('.board-tile').filter({ hasText: 'My first board' }).click();
  await expect(page.locator('.card').filter({ hasText: 'Welcome: drag this card' }).locator('.priority-badge')).toHaveText('▲ Low');
  await expect(page.locator('.card').filter({ hasText: 'Click a card to view its details' }).locator('.priority-badge')).toHaveText('▲ Medium');
  await expect(page.locator('.card').filter({ hasText: 'Create your own board' }).locator('.priority-badge')).toHaveText('▲ High');
  await expect(page.locator('.card').filter({ hasText: 'Your data is saved only in this browser' }).locator('.priority-badge')).toHaveText('▲ Critical');
  await expect(page.locator('.card').filter({ hasText: 'Install the app' }).locator('.priority-badge')).toHaveText('▲ Low');
});
test('board statistics summarize only the selected board', async ({ page }) => {
  const data = fixture(20);
  const cards = data.boards[0].lists[0].cards;
  cards[0].due = '2000-01-01';
  cards[0].priority = 'critical';
  cards[0].checklist[0].done = false;
  cards[1].due = '';
  cards[1].priority = 'low';
  cards[2].completed = true;
  await page.addInitScript(value => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(value)), data);
  await page.goto('/app/#/b/board0');
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="open-statistics"]').click();

  await expect(page.getByRole('heading', { name: /^Statistics/ })).toBeVisible();
  await expect(page.locator('[data-stat="cards"]')).toHaveText('10');
  await expect(page.locator('[data-stat="overdue"]')).toHaveText('1');
  await expect(page.locator('[data-stat="with-due"]')).toHaveText('9');
  await expect(page.locator('[data-stat="completed"]')).toHaveText('1');
  await expect(page.locator('[data-stat="checklists"]')).toHaveText('90%');
  await expect(page.locator('[data-stat-row="list"]').filter({ hasText: 'Pendientes' })).toContainText('10');
  await expect(page.locator('[data-stat-row="list"]').filter({ hasText: 'Destino' })).toContainText('0');
  await expect(page.getByRole('heading', { name: 'By member' })).toHaveCount(0);
  await expect(page.locator('[data-stat-row="member"]')).toHaveCount(0);
  await expect(page.locator('[data-stat-row="priority"]').filter({ hasText: 'Critical' })).toContainText('1');
  await expect(page.locator('[data-stat-row="priority"]').filter({ hasText: 'Low' })).toContainText('1');
});
test('favorites persist and appear first in the Boards menu', async ({ page }) => {
  await page.goto('/app/');
  const favorite = page.getByRole('button', { name: 'Add My first board to favorites' });
  await favorite.click();
  await expect(page.getByRole('button', { name: 'Remove My first board from favorites' }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove My first board from favorites' }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-act="boards-menu"]').click();
  await expect(page.locator('.menu-item').first()).toHaveText('★ My first board');
});
test('home separates favorites and filters boards by name', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Add My first board to favorites' }).click();

  const favorites = page.locator('[data-section="favorites"]');
  const allBoards = page.locator('[data-section="all-boards"]');
  await expect(favorites.locator('.board-tile-wrap')).toHaveCount(1);
  await expect(allBoards.locator('.board-tile-wrap')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('first');
  await expect(favorites.locator('.board-tile-wrap')).toHaveCount(1);
  await expect(allBoards.locator('.board-tile-wrap')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('missing');
  await expect(favorites).toBeHidden();
  await expect(allBoards.locator('.board-tile-wrap')).toHaveCount(0);
  await expect(allBoards).toContainText('No boards match your search.');
});
test('home search keeps focus and caret across delayed filtering without stealing focus', async ({ page }) => {
  await page.goto('/app/');
  const search = page.getByRole('searchbox', { name: 'Search boards' });
  await search.focus();
  for (const letter of 'first') {
    await page.keyboard.type(letter);
    await expect(search).toHaveValue('first'.slice(0, 'first'.indexOf(letter) + 1));
    await page.waitForTimeout(220);
    await expect(search).toBeFocused();
  }
  await expect(page.locator('.board-tile-wrap')).toHaveCount(1);
  await search.press('Home');
  await page.keyboard.type('x');
  await expect(page.locator('.empty')).toHaveText('No boards match your search.');
  await expect(search).toBeFocused();
  expect(await search.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([1, 1]);
  await search.press('Backspace');
  await expect(page.locator('.board-tile-wrap')).toHaveCount(1);
  await expect(search).toHaveValue('first');
  await search.fill('missing');
  await page.getByRole('heading', { name: 'Your boards' }).click();
  await expect(page.locator('.empty')).toBeVisible();
  await expect(search).not.toBeFocused();
});
test('board names fit their text and wrap without clipping on narrow screens', async ({ page }, testInfo) => {
  const names = ['Kambaya', 'WWW WWW WWW', 'W'.repeat(100)];
  const data = fixture(4);
  data.boards[0].name = names[0];
  await page.addInitScript(data => localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(data)), data);
  await page.goto('/app/#/b/board0');
  const title = page.getByRole('textbox', { name: 'Board name', exact: true });
  for (const name of names) {
    await title.fill(name);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(title).toHaveValue(name);
      const bounds = await title.evaluate(el => ({
        horizontalClip: el.scrollWidth - el.clientWidth,
        verticalClip: el.scrollHeight - el.clientHeight,
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
        viewport: innerWidth
      }));
      expect(bounds.horizontalClip).toBeLessThanOrEqual(1);
      expect(bounds.verticalClip).toBeLessThanOrEqual(1);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    }
  }
  await title.press('Enter');
  await page.reload();
  await expect(title).toHaveValue(names[2]);
  await page.screenshot({ path: testInfo.outputPath('board-name-mobile.png') });
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  const tile = page.locator('.board-tile').filter({ hasText: names[2] });
  await expect(tile).toBeVisible();
  expect(await tile.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
test('shows the Buy Me a Coffee link only on the home page', async ({ page }) => {
  await page.goto('/app/');
  const supportLink = page.getByRole('link', { name: 'Buy Me a Coffee' });
  await expect(supportLink).toHaveAttribute('href', 'https://www.buymeacoffee.com/scaamanho');
  await expect(supportLink).toHaveAttribute('target', '_blank');
  await expect(supportLink).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(supportLink.locator('img')).toHaveAttribute('src', 'https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png');
  await expect(supportLink).toHaveCSS('position', 'fixed');
  await expect(supportLink).toHaveCSS('right', '16px');
  await expect(supportLink).toHaveCSS('bottom', '16px');
  await page.locator('.board-tile').filter({ hasText: 'My first board' }).click();
  await expect(page.getByRole('link', { name: 'Buy Me a Coffee' })).toHaveCount(0);
});
test('uses English throughout the interface and for new default content', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const manifest = await (await page.request.get('/app/manifest.webmanifest')).json();
  expect(manifest.lang).toBe('en');
  expect(manifest.description).toContain('Works offline');
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await page.locator('.board-tile').filter({ hasText: 'My first board' }).click();
  await expect(page.locator('.list-title')).toHaveText(['To do', 'In progress', 'Done']);
  await page.locator('.card').filter({ hasText: 'Welcome: drag this card to another list' }).click();
  await expect(page.getByLabel('Card title', { exact: true })).toHaveValue('👋 Welcome: drag this card to another list');
  await expect(page.locator('.description-view')).toContainText('You can drag cards');
  await expect(page.getByLabel('Mark as complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Labels', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personal comments' })).toBeVisible();
  await expect(page.getByLabel('New item', { exact: true })).toHaveAttribute('placeholder', 'Add an item…');
  await expect(page.getByLabel('New comment', { exact: true })).toHaveAttribute('placeholder', 'Write a note or comment…');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-act="toggle-filters"]').click();
  await expect(page.getByRole('complementary', { name: 'Filter cards' })).toBeVisible();
  await expect(page.getByLabel('Keyword', { exact: true })).toHaveAttribute('placeholder', 'Enter a keyword…');
  await expect(page.getByText('No due date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('[data-act="toggle-view"]').click();
  await expect(page.locator('.cal-week strong')).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  const expectedMonth = await page.evaluate(() => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
  await expect(page.locator('.calendar-head h2')).toHaveText(expectedMonth);
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  await page.locator('[data-act="board-menu"]').click();
  await expect(page.getByRole('heading', { name: 'Board menu', exact: true })).toBeVisible();
  await page.locator('[data-act="open-labels"]').click();
  await expect(page.getByRole('heading', { name: 'Board labels', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('[data-act="open-archive"]').click();
  await expect(page.getByText('There are no archived cards.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-act="open-templates"]').click();
  await expect(page.getByText('Save a card as a template from its details.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-act="new-board"]').click();
  await expect(page.getByRole('heading', { name: 'Create board', exact: true })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('placeholder', 'e.g. Web project');
  await page.locator('[data-act="create-board"]').click();
  await expect(page.getByLabel('Board name', { exact: true })).toHaveValue('New board');
  await page.locator('[data-act="data-menu"]').click();
  await expect(page.getByRole('menuitem', { name: 'Export all boards (backup)', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete all data', exact: true })).toBeVisible();
});
