const { test, expect } = require('@playwright/test');
const { fixture, seed } = require('./fixtures');

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

async function openTimeline(page, data) {
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00'));
  await seed(page, data);
  await page.getByRole('button', { name: 'Timeline', exact: false }).click();
  await expect(page.getByRole('region', { name: 'Board timeline' })).toBeVisible();
}

async function drag(page, locator, pixels, cancel = false) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + pixels, y, { steps: 4 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

test('timeline shows overlapping intervals, milestones and unscheduled cards and respects filters', async ({ page }) => {
  const data = fixture(12), cards = data.boards[0].lists[0].cards;
  Object.assign(cards[0], { title: 'Crossing month', startDate: '2026-10-20', due: '2026-12-03' });
  Object.assign(cards[1], { title: 'Due milestone', due: '2026-11-11' });
  Object.assign(cards[2], { title: 'Start milestone', startDate: '2026-11-12', due: '' });
  Object.assign(cards[3], { title: 'Unscheduled', due: '' });
  Object.assign(cards[4], { title: 'Outside month', startDate: '2026-12-01', due: '2026-12-02' });
  Object.assign(cards[5], { title: 'Archived', due: '', archived: true });
  await openTimeline(page, data);
  const timeline = page.locator('.timeline-window');
  await expect(timeline.locator('.timeline-row')).toHaveCount(3);
  await expect(timeline).toContainText('Crossing month');
  await expect(timeline.locator('.milestone')).toHaveCount(2);
  await expect(page.locator('.timeline-unscheduled')).toContainText('Unscheduled');
  await expect(page.locator('.timeline')).not.toContainText('Outside month');
  await expect(page.locator('.timeline')).not.toContainText('Archived');
  await page.getByRole('button', { name: 'Filter', exact: false }).click();
  await page.getByRole('searchbox', { name: 'Keyword', exact: true }).fill('Unscheduled');
  await expect(page.locator('.timeline-window')).toContainText('No cards scheduled');
  await expect(page.locator('.timeline-unscheduled')).toContainText('Unscheduled');
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.locator('.timeline')).toContainText('December 2026');
});

test('timeline uses priority colors for bars and milestones, including completed cards', async ({ page }) => {
  const data = fixture(12), cards = data.boards[0].lists[0].cards;
  for (const card of cards) Object.assign(card, { startDate: '2026-11-05', recurrence: '' });
  cards[0].priority = 'low';
  cards[1].priority = 'medium';
  Object.assign(cards[2], { priority: 'high', completed: true });
  cards[3].priority = 'critical';
  cards[4].completed = true;
  Object.assign(cards[5], { priority: 'critical', startDate: '' });
  await openTimeline(page, data);
  for (const [id, color] of [
    ['card0', 'rgb(75, 206, 151)'],
    ['card2', 'rgb(245, 205, 71)'],
    ['card4', 'rgb(254, 163, 98)'],
    ['card6', 'rgb(248, 113, 104)']
  ]) await expect(page.locator(`[data-timeline-id="${id}"]`)).toHaveCSS('background-color', color);
  const defaultBar = page.locator('[data-timeline-id="card8"]');
  const primary = await page.locator('.timeline-days .today').evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(defaultBar).toHaveCSS('background-color', primary);
  await expect(page.locator('[data-timeline-id="card10"]')).toHaveCSS('color', 'rgb(248, 113, 104)');
  await page.locator('.timeline-row').filter({ has: defaultBar }).locator('.timeline-card').click();
  await page.getByLabel('Priority', { exact: true }).selectOption('high');
  await page.keyboard.press('Escape');
  await expect(defaultBar).toHaveCSS('background-color', 'rgb(254, 163, 98)');
});

test('double-clicking a timeline bar or milestone opens its card without changing dates', async ({ page }) => {
  const data = fixture(4), cards = data.boards[0].lists[0].cards;
  Object.assign(cards[0], { startDate: '2026-11-05', due: '2026-11-10' });
  await openTimeline(page, data);
  const bar = page.locator('[data-timeline-id="card0"]');
  await bar.locator('.timeline-bar-label').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const target of ['.timeline-bar-label', '.timeline-handle.start', '.timeline-handle.end']) {
    await bar.locator(target).dblclick();
    await expect(page.getByLabel('Card title', { exact: true })).toHaveValue('Tarea 0');
    await page.keyboard.press('Escape');
    await expect(bar).toHaveAttribute('data-start', '2026-11-05');
    await expect(bar).toHaveAttribute('data-due', '2026-11-10');
  }
  await page.locator('[data-timeline-id="card2"]').dblclick();
  await expect(page.getByLabel('Card title', { exact: true })).toHaveValue('Tarea 2');
});

test('date fields validate ranges and survive reload; single dates remain milestones', async ({ page }) => {
  const data = fixture(2);
  await openTimeline(page, data);
  await page.locator('.timeline-card').first().click();
  await page.locator('.due-date-section summary').click();
  const start = page.getByLabel('Start date', { exact: true });
  await start.fill('2026-11-05');
  await expect(start).toHaveValue('2026-11-05');
  await start.fill('2026-11-15');
  await expect(page.locator('.toast')).toContainText('Start date must not be later');
  await expect(start).toHaveValue('2026-11-05');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('');
  await page.reload();
  await page.getByRole('button', { name: 'Timeline', exact: false }).click();
  await expect(page.locator('.timeline-bar.milestone')).toHaveCount(1);
  await page.locator('.timeline-card').first().click();
  await page.locator('.due-date-section summary').click();
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2026-11-05');
});

test('dragging moves and resizes dates, preserves milestone type, and Escape cancels', async ({ page }) => {
  const data = fixture(4), cards = data.boards[0].lists[0].cards;
  Object.assign(cards[0], { startDate: '2026-11-05', due: '2026-11-10' });
  Object.assign(cards[1], { due: '2026-11-15' });
  await openTimeline(page, data);
  const bar = page.locator('[data-timeline-id="card0"]');
  await expect(bar).toBeVisible();
  await drag(page, bar.locator('.timeline-bar-label'), 72);
  await expect(bar).toHaveAttribute('data-start', '2026-11-07');
  await expect(bar).toHaveAttribute('data-due', '2026-11-12');
  await drag(page, bar.locator('.timeline-handle.end'), 36);
  await expect(bar).toHaveAttribute('data-due', '2026-11-13');
  await drag(page, bar.locator('.timeline-handle.start'), 360);
  await expect(bar).toHaveAttribute('data-start', '2026-11-13');
  await drag(page, bar.locator('.timeline-bar-label'), 72, true);
  await expect(bar).toHaveAttribute('data-start', '2026-11-13');
  const milestone = page.locator('[data-timeline-id="card2"]');
  await drag(page, milestone, 36);
  await expect(milestone).toHaveAttribute('data-due', '2026-11-16');
  await expect(milestone).toHaveAttribute('data-start', '');
  await page.reload();
  await page.getByRole('button', { name: 'Timeline', exact: false }).click();
  await expect(bar).toHaveAttribute('data-start', '2026-11-13');
  await expect(bar).toHaveAttribute('data-due', '2026-11-13');
  await expect(milestone).toHaveAttribute('data-due', '2026-11-16');
});

test('timeline virtualizes large dated and undated result sets', async ({ page }) => {
  const data = fixture(2000);
  data.boards[0].lists[0].cards.forEach((card, index) => { if (index % 2) card.due = ''; });
  await openTimeline(page, data);
  await expect(page.locator('.timeline-row').first()).toBeVisible();
  await expect(page.locator('.timeline-undated-row').first()).toBeVisible();
  expect(await page.locator('.timeline-row').count()).toBeLessThanOrEqual(60);
  expect(await page.locator('.timeline-undated-row').count()).toBeLessThanOrEqual(60);
});

test('timeline dates survive real backup import and board duplication', async ({ page }) => {
  const data = fixture(2);
  data.boards[0].lists[0].cards[0].startDate = '2026-11-05';
  await openTimeline(page, data);
  await page.locator('[data-act="board-menu"]').click();
  const pending = page.waitForEvent('download');
  await page.locator('[data-act="export-board"]').click();
  await page.getByRole('dialog', { name: 'Backup filename' }).getByRole('button', { name: 'Export', exact: true }).click();
  const download = await pending;
  const buffer = await require('node:fs/promises').readFile(await download.path());
  const backup = JSON.parse(buffer.subarray(12, 12 + buffer.readUInt32LE(8)).toString());
  expect(backup.boards[0].lists[0].cards[0].startDate).toBe('2026-11-05');
  await page.locator('#import-file').setInputFiles({ name: 'backup.kanbaya', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('.toast')).toContainText('1 board(s) imported');
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="dup-board"]').click();
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0 (copy)');
  await expect(page.locator('.timeline-bar').first()).toHaveAttribute('data-start', '2026-11-05');
});

test('import conflicts detect start dates and preserve the selected version', async ({ page }) => {
  const data = fixture(2);
  await openTimeline(page, data);
  const backup = structuredClone(data);
  backup.boards[0].lists[0].cards[0].startDate = '2026-11-05';
  await page.locator('#import-file').setInputFiles({ name: 'dates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  const dialog = page.getByRole('dialog', { name: 'Conflicts in Tablero 0' });
  await expect(dialog).toContainText('startDate');
  await dialog.getByRole('button', { name: 'Use backup version' }).click();
  await expect(page.locator('.timeline-bar').first()).toHaveAttribute('data-start', '2026-11-05');
});

test('a concurrent board change cancels a stale timeline drag', async ({ page }) => {
  const data = fixture(2);
  Object.assign(data.boards[0].lists[0].cards[0], { startDate: '2026-11-05', due: '2026-11-10' });
  await openTimeline(page, data);
  const bar = page.locator('[data-timeline-id="card0"]');
  const box = await bar.locator('.timeline-bar-label').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 36, y);
  await page.evaluate(async () => {
    const other = new KanbayaStore();
    await other.db.open();
    try {
      const state = await other.readState(), board = state.boards.find(b => b.id === 'board0');
      const card = await other.card('board0', 'card0');
      board.lists.find(l => l.id === card.listId).cards.push(card);
      other.adopt(state);
      card.due = '2026-11-12';
      await other.commit(state);
    } finally { other.db.close(); }
  });
  await page.mouse.up();
  await expect(page.locator('.toast')).toContainText('changed in another tab');
  await expect(bar).toHaveAttribute('data-start', '2026-11-05');
  await expect(bar).toHaveAttribute('data-due', '2026-11-12');
  await drag(page, bar.locator('.timeline-bar-label'), 36);
  await expect(bar).toHaveAttribute('data-start', '2026-11-06');
  await expect(bar).toHaveAttribute('data-due', '2026-11-13');
});

test('completing a recurring card advances both dates by the same number of days', async ({ page }) => {
  const data = fixture(2);
  Object.assign(data.boards[0].lists[0].cards[0], { startDate: '2026-11-05', due: '2026-11-11', recurrence: 'daily' });
  await openTimeline(page, data);
  await page.locator('.timeline-card').first().click();
  await page.locator('.due-date-section summary').click();
  await page.getByLabel('Mark as complete').check();
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2026-11-06');
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('2026-11-12');
  await expect(page.getByLabel('Mark as complete')).not.toBeChecked();
});

test('touch dragging moves a start-only milestone on a narrow screen', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8765', viewport: { width: 375, height: 800 }, hasTouch: true });
  const page = await context.newPage();
  try {
    const data = fixture(2);
    Object.assign(data.boards[0].lists[0].cards[0], { startDate: '2026-11-02', due: '' });
    await openTimeline(page, data);
    const bar = page.locator('[data-timeline-id="card0"]');
    await bar.scrollIntoViewIfNeeded();
    const box = await bar.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 36, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(bar).toHaveAttribute('data-start', '2026-11-03');
    await expect(bar).toHaveAttribute('data-due', '');
  } finally {
    await context.close();
  }
});
