const { test, expect } = require('@playwright/test');
const { fixture, seed } = require('./fixtures');
test('board views have no footer while the home footer keeps the product version', async ({ page }) => {
  await seed(page, fixture(4));
  const version = page.locator('.app-footer .product-version');
  for (const view of ['Board', 'Calendar', 'Timeline']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.app-footer')).toHaveCount(0);
      const gap = await page.locator('.board').evaluate(el => Math.abs(innerHeight - el.getBoundingClientRect().bottom));
      expect(gap).toBeLessThanOrEqual(1);
    }
  }
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(version).toHaveText(/^Kanbaya v\d+\.\d+\.\d+$/);
    await expect(version).toBeInViewport();
    const bounds = await version.evaluate(el => {
      const footer = el.closest('footer');
      const rect = footer.getBoundingClientRect();
      const text = el.getBoundingClientRect();
      const content = footer.previousElementSibling.getBoundingClientRect();
      const support = footer.querySelector('.support-link').getBoundingClientRect();
      return { left: rect.left, bottom: rect.bottom, height: innerHeight,
        contentBottom: content.bottom, top: rect.top, textRight: text.right,
        supportTop: support.top, supportBottom: support.bottom, supportLeft: support.left,
        supportRight: support.right, viewport: innerWidth,
        interactive: !!el.closest('a, button, [data-act], [tabindex]') };
    });
    expect(bounds.left).toBe(0);
    expect(Math.abs(bounds.bottom - bounds.height)).toBeLessThanOrEqual(1);
    expect(bounds.contentBottom).toBeLessThanOrEqual(bounds.top + 1);
    expect(bounds.supportTop).toBeGreaterThanOrEqual(bounds.top);
    expect(bounds.supportBottom).toBeLessThanOrEqual(bounds.bottom);
    expect(bounds.textRight).toBeLessThan(bounds.supportLeft);
    expect(bounds.supportRight).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.interactive).toBe(false);
    const url = page.url();
    await version.click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('preserves legacy card details, search and calendar contracts', async ({ page }) => {
  await seed(page, fixture(20));
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
  await page.locator('[data-act="show-calendar"]').click();
  await expect(page.locator('.cal-day')).toHaveCount(42);
});
test('status and due date collapse below priority and fit desktop and mobile', async ({ page }) => {
  await seed(page, fixture(20));
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  const section = page.locator('.m-side .due-date-section');
  const due = page.getByLabel('Due date', { exact: true });
  await expect(section).toBeVisible();
  await expect(due).toBeHidden();
  await expect(page.locator('.card-priority + .due-date-section')).toHaveCount(1);
  await section.locator('summary').click();
  await expect(due).toBeVisible();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const measurements = await section.evaluate(row => {
      const rect = row.getBoundingClientRect();
      const items = [...row.querySelectorAll('input[type="date"], .check, button')].map(el => el.getBoundingClientRect());
      return { overflow: row.scrollWidth - row.clientWidth, right: rect.right, viewport: innerWidth,
        overlap: items.some((a, i) => items.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)) };
    });
    expect(measurements.overflow).toBeLessThanOrEqual(1);
    expect(measurements.right).toBeLessThanOrEqual(measurements.viewport);
    expect(measurements.overlap).toBe(false);
  }
  await due.fill('2026-12-01');
  await expect(due).toBeVisible();
  await expect(due).toHaveValue('2026-12-01');
  await section.locator('summary').click();
  await page.getByLabel('Priority').selectOption('high');
  await expect(due).toBeHidden();
  await section.locator('summary').click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(due).toBeVisible();
  await expect(due).toHaveValue('');
  await expect(section.getByLabel('Mark as complete', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
});
for (const initialDue of ['', '2000-01-01']) {
  test(`one completion control persists card and deadline status ${initialDue ? 'with' : 'without'} a date`, async ({ page }) => {
    const data = fixture(20);
    const source = data.boards[0].lists[0].cards[0];
    source.due = initialDue;
    source.recurrence = '';
    source.checklist[0].done = false;
    await seed(page, data);
    const card = page.locator('.card').filter({ hasText: 'Tarea 0' });
    await card.click();
    const section = page.locator('.due-date-section');
    const complete = page.getByLabel('Mark as complete', { exact: true });
    const due = page.getByLabel('Due date', { exact: true });
    await expect(complete).toHaveCount(1);
    await expect(page.locator('[data-f="dueDone"]')).toHaveCount(0);
    await section.locator('summary').click();
    await complete.check();
    await expect(complete).toBeChecked();
    await expect(complete).toBeVisible();
    await expect(page.locator('[data-f="check-done"]')).not.toBeChecked();
    await section.locator('summary').click();
    await expect(section.locator('summary')).toContainText('Completed');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(card).toHaveClass(/is-completed/);
    if (initialDue) await expect(card.locator('.badge.ok')).toBeVisible();
    await page.reload();
    await card.click();
    await expect(section.locator('summary')).toContainText('Completed');
    await section.locator('summary').click();
    await expect(complete).toBeChecked();
    await due.fill('2000-01-02');
    await expect(complete).toBeChecked();
    await complete.uncheck();
    await expect(section.locator('summary')).not.toContainText('Completed');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(card).not.toHaveClass(/is-completed/);
    await expect(card.locator('.badge.overdue')).toBeVisible();
    await card.click();
    await section.locator('summary').click();
    await complete.check();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(complete).toBeChecked();
    await expect(due).toHaveValue('');
  });
}
test('template name uses a cancellable app dialog and accepts Enter', async ({ page }) => {
  await seed(page, fixture(20));
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
  await seed(page);
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
  await seed(page, fixture(20));
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
  await seed(page, data);
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
for (const date of ['2025-02-28T12:00:00', '2024-02-29T12:00:00', '2026-12-31T12:00:00']) {
  test(`new sample cards have visible date ranges in their creation month ${date.slice(0, 7)}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(date));
    await page.goto('/app/');
    await page.locator('.board-tile').filter({ hasText: 'My first board' }).click();
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(page.locator('.timeline-bar')).toHaveCount(5);
    const dates = await page.locator('.timeline-bar').evaluateAll(bars => bars.map(bar => [bar.dataset.start, bar.dataset.due]));
    for (const [start, due] of dates) {
      expect(start).toMatch(new RegExp(`^${date.slice(0, 7)}-\\d{2}$`));
      expect(due).toMatch(new RegExp(`^${date.slice(0, 7)}-\\d{2}$`));
      expect(start < due).toBe(true);
      expect(Number(due.slice(-2))).toBeLessThanOrEqual(28);
    }
  });
}
test('existing sample cards gain dates once without changing dates already set', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-02-15T12:00:00'));
  const data = fixture(10), board = data.boards[0];
  board.name = 'My first board';
  board.created = new Date('2026-01-01T12:00:00').getTime();
  const cards = board.lists.flatMap(list => list.cards);
  const titles = [
    '👋 Welcome: drag this card to another list', 'Click a card to view its details',
    'Create your own board with "＋ Create"', 'Your data is saved only in this browser',
    'Install the app (browser menu → Install)'
  ];
  cards.forEach((card, index) => { card.title = titles[index]; card.due = ''; });
  Object.assign(cards[0], { startDate: '2026-01-02', due: '2026-01-03' });
  cards[1].startDate = '2026-01-08';
  cards[2].due = '2026-01-20';
  await seed(page, data);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  const bars = page.locator('.timeline-bar');
  await expect(bars).toHaveCount(5);
  await expect(bars.nth(0)).toHaveAttribute('data-start', '2026-01-02');
  await expect(bars.nth(0)).toHaveAttribute('data-due', '2026-01-03');
  await expect(bars.nth(1)).toHaveAttribute('data-start', '2026-01-08');
  await expect(bars.nth(1)).toHaveAttribute('data-due', '');
  await expect(bars.nth(2)).toHaveAttribute('data-start', '');
  await expect(bars.nth(2)).toHaveAttribute('data-due', '2026-01-20');
  await expect(bars.nth(3)).toHaveAttribute('data-start', '2026-01-15');
  await expect(bars.nth(3)).toHaveAttribute('data-due', '2026-01-23');
  await page.locator('.timeline-card').filter({ hasText: titles[3] }).click();
  await page.locator('.due-date-section summary').click();
  await page.getByRole('button', { name: 'Remove start date' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.timeline-unscheduled')).toContainText(titles[3]);
  await page.reload();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.timeline-unscheduled')).toContainText(titles[3]);
});
test('a similarly named board without all sample cards is not given sample dates', async ({ page }) => {
  const data = fixture(2);
  data.boards[0].name = 'My first board';
  data.boards[0].lists[0].cards[0].due = '';
  await seed(page, data);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.timeline-unscheduled')).toContainText('Tarea 0');
});
test('board statistics summarize only the selected board', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T12:00:00'));
  const data = fixture(20);
  const cards = data.boards[0].lists[0].cards;
  cards[0].due = '2000-01-01';
  cards[0].priority = 'critical';
  cards[0].checklist[0].done = false;
  cards[1].due = '';
  cards[1].priority = 'low';
  cards[2].completed = true;
  await seed(page, data);
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
test('statistics break down labels, priorities and due dates without counting archived cards', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00'));
  const data = fixture(16), board = data.boards[0], cards = board.lists[0].cards;
  board.labels.push({ id: 'extra', name: 'Client <Important> label', color: '#4bce97' });
  cards[0].due = '2026-11-11'; cards[0].priority = 'high'; cards[0].labels = ['label0', 'extra'];
  cards[1].due = '2026-11-12'; cards[1].labels = [];
  cards[2].due = '2026-11-19'; cards[2].priority = 'low'; cards[2].labels = ['extra'];
  cards[3].due = '2026-11-20'; cards[3].priority = 'medium';
  cards[4].due = ''; cards[4].priority = 'critical'; cards[4].labels = [];
  cards[5].due = '2000-01-01'; cards[5].completed = true; cards[5].labels = ['extra'];
  cards[6].archived = true; cards[6].priority = 'high'; cards[6].labels = ['extra'];
  cards[7].due = '2026-11-13';
  await seed(page, data);
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="open-statistics"]').click();
  await expect(page.locator('[data-stat="cards"]')).toHaveText('7');
  for (const [label, count] of [['Urgente', 3], ['Client <Important> label', 3], ['No label', 2]]) {
    await expect(page.locator('[data-stat-row="label"]').filter({ hasText: label }).locator('strong')).toHaveText(String(count));
  }
  for (const [label, count] of [['Low', 1], ['Medium', 1], ['High', 1], ['Critical', 1], ['No priority', 3]]) {
    await expect(page.locator('[data-stat-row="priority"]').filter({ hasText: label }).locator('strong')).toHaveText(String(count));
  }
  for (const [label, count] of [['Completed', 1], ['Overdue', 1], ['Due today', 1], ['Next 7 days', 2], ['Later', 1], ['No due date', 1]]) {
    await expect(page.locator('[data-stat-row="due"]').filter({ hasText: label }).locator('strong')).toHaveText(String(count));
  }
  await expect(page.locator('[data-stat-row="label"] .stats-label-color')).toHaveCount(2);
  const modal = page.locator('.statistics-modal');
  for (const [width, columns] of [[1280, 2], [320, 1]]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await modal.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator('.stats-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
  }
  for (const title of ['Cards by list', 'By due date', 'By label', 'By priority']) {
    const select = page.getByLabel(`${title} chart type`, { exact: true });
    await select.selectOption('pie');
    await expect(select).toBeFocused();
    await expect(select.locator('option:checked')).toHaveText('Pie chart');
  }
  await expect(page.locator('.stats-pie')).toHaveCount(4);
  const labelSection = page.locator('.stats-section').filter({ has: page.getByRole('heading', { name: 'By label', exact: true }) });
  await expect(labelSection).toContainText('label assignments and unlabelled cards, not the share of cards');
  const gradient = await labelSection.locator('.stats-pie').evaluate(el => el.style.background);
  expect(gradient).toContain('37.5%');
  expect(gradient).toContain('75%');
  expect(gradient).toContain('100%');
  await expect(labelSection.locator('[data-stat-row="label"]').filter({ hasText: 'No label' }).locator('strong')).toHaveText('2');
  const priorityRows = page.locator('[data-stat-row="priority"]');
  const criticalColor = await priorityRows.filter({ hasText: 'Critical' }).locator('.stats-label-color').evaluate(el => el.style.background);
  const noPriorityColor = await priorityRows.filter({ hasText: 'No priority' }).locator('.stats-label-color').evaluate(el => el.style.background);
  expect(noPriorityColor).not.toBe(criticalColor);
  await page.getByLabel('By priority chart type').selectOption('bars');
  await expect(page.locator('.stats-pie')).toHaveCount(3);
  await expect(page.getByLabel('By label chart type')).toHaveValue('pie');
  await expect(page.locator('[data-stat-row="priority"]').filter({ hasText: 'High' }).locator('strong')).toHaveText('1');
  expect(await modal.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
test('pie charts handle empty statistics without inventing slices', async ({ page }) => {
  const data = fixture(0);
  data.boards[0].lists = [];
  data.boards[0].labels = [];
  await seed(page, data);
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="open-statistics"]').click();
  for (const title of ['Cards by list', 'By due date', 'By label', 'By priority']) {
    await page.getByLabel(`${title} chart type`).selectOption('pie');
  }
  await expect(page.locator('.stats-pie')).toHaveCount(0);
  await expect(page.getByText('No data to chart.', { exact: true })).toHaveCount(4);
  await expect(page.locator('[data-stat-row="label"]').filter({ hasText: 'No label' }).locator('strong')).toHaveText('0');
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
  const names = ['Kanbaya', 'WWW WWW WWW', 'W'.repeat(100)];
  const data = fixture(4);
  data.boards[0].name = names[0];
  await seed(page, data);
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
  await page.waitForTimeout(350);
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
  await expect(page.locator('.app-footer').getByRole('link', { name: 'Buy Me a Coffee' })).toBeVisible();
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
  await page.locator('.due-date-section summary').click();
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
  await page.locator('[data-act="show-calendar"]').click();
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
  for (const name of ['Export all boards (backup)', 'Import from file…', 'Save backup to Google Drive…', 'Import backup from Google Drive…', 'Delete all data']) {
    const item = page.getByRole('menuitem', { name, exact: true });
    await expect(item).toBeVisible();
    await expect(item.locator('.menu-item-icon')).toBeVisible();
    await expect(item.locator('.menu-item-icon')).toHaveAttribute('aria-hidden', 'true');
  }
});
