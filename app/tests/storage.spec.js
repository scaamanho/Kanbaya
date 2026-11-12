const { test, expect } = require('@playwright/test');
const { fixture, seed: seedDatabase, prepareDatabase } = require('./fixtures');
async function seed(page, data = fixture(20)) {
  await seedDatabase(page, data);
}
async function db(page, fn) {
  return page.evaluate(async source => {
    const store = new KanbayaStore();
    await store.db.open();
    try { return await (new Function('store', 'return (' + source + ')(store)'))(store); }
    finally { store.db.close(); }
  }, fn.toString());
}
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});
test('lane menu Add card opens a focused composer and saves in the selected lane', async ({ page }) => {
  await seed(page);
  const lane = page.locator('.list[data-id="empty0"]');
  await lane.getByRole('button', { name: 'List actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add card', exact: true }).click();
  const composer = lane.locator('.composer textarea');
  await expect(composer).toBeVisible();
  await expect(composer).toBeFocused();
  await page.keyboard.type('Created from lane menu');
  await lane.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(lane.locator('.card').filter({ hasText: 'Created from lane menu' })).toBeVisible();
  const saved = await db(page, store => store.db.cards.where('boardId').equals('board0').filter(card => card.title === 'Created from lane menu').toArray());
  expect(saved).toHaveLength(1);
  expect(saved[0].listId).toBe('empty0');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(lane.locator('.card').filter({ hasText: 'Created from lane menu' })).toBeVisible();
  await lane.getByRole('button', { name: 'List actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add card', exact: true }).press('Enter');
  await expect(composer).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(composer).toHaveCount(0);
});
test('initializes all fields once and retains them across restarts', async ({ page }) => {
  const original = fixture(20);
  await seed(page, original);
  await expect(page.locator('.card').first()).toBeVisible();
  const exported = await db(page, store => store.exportState());
  expect(exported.boards.map(b => b.lists.map(l => l.cards))).toEqual(original.boards.map(b => b.lists.map(l => l.cards)));
  expect(exported.templates).toEqual(original.templates);
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(20);
});
test('valid empty state stays empty across restarts', async ({ page }) => {
  await seed(page, { version: 2, theme: 'light', boards: [], templates: [] });
  await expect(page.locator('.empty')).toBeVisible();
  await page.reload();
  await expect(page.locator('.empty')).toBeVisible();
  expect(await db(page, store => store.db.boards.count())).toBe(0);
});
test('duplicate card ids fail initialization atomically', async ({ page }) => {
  const data = fixture(6);
  data.boards[0].lists[0].cards[1].id = data.boards[0].lists[0].cards[0].id;
  await page.goto('/tests/blank');
  await page.addScriptTag({ url: '/app/vendor/dexie.min.js' });
  await page.addScriptTag({ url: '/app/scripts/storage.js' });
  const result = await page.evaluate(async state => {
    const store = new KanbayaStore();
    try { await store.initialize(() => state); return { error: null, cards: await store.db.cards.count() }; }
    catch (error) { return { error: error.message, cards: await store.db.cards.count() }; }
    finally { store.db.close(); }
  }, data);
  expect(result.error).toContain('duplicate identifiers');
  expect(result.cards).toBe(0);
});
test('windowed list remains bounded and finds unloaded detail text', async ({ page }) => {
  test.setTimeout(120000);
  const started = Date.now();
  await seed(page, fixture());
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 60000 });
  const list = page.locator('[data-virtual-list="list0"]');
  expect(await list.locator('.card').count()).toBeLessThanOrEqual(60);
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await expect(list.locator('.card').last()).toContainText('Tarea 9998');
  expect(await list.locator('.card').count()).toBeLessThanOrEqual(60);
  await page.locator('[data-act="toggle-filters"]').click();
  await page.locator('.filter-keyword').fill('aguja-remota');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.card').click();
  await expect(page.locator('.description-view')).toHaveText('aguja-remota');
  console.log('10k initialization + initial view + scroll + search (ms):', Date.now() - started);
});
test('saving one card only writes its summary, details and metadata', async ({ page }) => {
  await seed(page);
  await page.locator('.card').first().click();
  await page.evaluate(() => {
    window.writes = [];
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { window.writes.push({ table: this.name, id: args[0]?.id }); return original.apply(this, args); };
  });
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.locator('[data-f="desc"]').fill('Cambio persistido');
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await expect.poll(() => db(page, store => store.db.cardDetails.get(['board0', 'card0']).then(x => x.desc))).toBe('Cambio persistido');
  const writes = await page.evaluate(() => window.writes);
  expect(writes.filter(x => ['cards', 'cardDetails'].includes(x.table)).every(x => x.id === 'card0')).toBe(true);
  expect(writes.filter(x => x.table === 'boards').every(x => x.id === 'board0')).toBe(true);
  expect(writes.some(x => x.table === 'cardDetails')).toBe(true);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.card').first().click();
  await expect(page.locator('.description-view')).toHaveText('Cambio persistido');
});
test('archive all and undo include cards outside the window', async ({ page }) => {
  await seed(page, fixture(200));
  await page.locator('.list').first().locator('[data-act="list-menu"]').click();
  await page.getByRole('menuitem', { name: 'Archive all cards' }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').filter(c => c.archived).count())).toBe(100);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.card').first()).toBeVisible();
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').filter(c => c.archived).count())).toBe(0);
});
test('board menu counts labels and all archived cards, updating after edits and reload', async ({ page }) => {
  const data = fixture(160);
  const first = data.boards[0];
  for (const card of first.lists[0].cards.slice(0, 65)) card.archived = true;
  const moved = first.lists[0].cards.shift();
  moved.due = '';
  first.lists[1].cards.push(moved);
  data.boards[1].labels = [];
  for (const card of data.boards[1].lists[0].cards) card.labels = [];
  data.boards[1].lists[0].cards[0].archived = true;
  await seed(page, data);
  const labels = page.locator('[data-act="open-labels"]');
  const archived = page.locator('[data-act="open-archive"]');
  await page.locator('[data-act="board-menu"]').click();
  await expect(labels).toContainText('Labels (1)');
  await expect(archived).toContainText('Archived cards (65)');
  await labels.click();
  await page.locator('[data-act="add-label"]').click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(labels).toContainText('Labels (2)');
  await archived.click();
  await page.locator('.arch-row').first().getByRole('button', { name: 'Restore' }).click();
  await page.locator('.arch-row').first().getByRole('button', { name: 'Delete' }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(archived).toContainText('Archived cards (63)');
  await page.reload();
  await page.locator('[data-act="board-menu"]').click();
  await expect(labels).toContainText('Labels (2)');
  await expect(archived).toContainText('Archived cards (63)');
  await page.goto('/app/#/b/board1');
  await page.locator('[data-act="board-menu"]').click();
  await expect(labels).toContainText('Labels (0)');
  await expect(archived).toContainText('Archived cards (1)');
});
test('board menu refreshes archived counts after another tab changes the board', async ({ page, context }) => {
  await seed(page, fixture(4));
  await page.locator('[data-act="board-menu"]').click();
  const archived = page.locator('[data-act="open-archive"]');
  await expect(archived).toContainText('Archived cards (0)');
  const other = await context.newPage();
  await other.goto('/app/#/b/board0');
  await other.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await other.locator('[data-act="archive-card"]').click();
  await expect(archived).toContainText('Archived cards (1)');
  await other.close();
});
test('deleting a list cascades details and undo restores all records', async ({ page }) => {
  await seed(page, fixture(200));
  await page.locator('.list').first().locator('[data-act="list-menu"]').click();
  await page.getByRole('menuitem', { name: 'Delete list', exact: true }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.list')).toHaveCount(1);
  expect(await db(page, store => store.db.cardDetails.where('boardId').equals('board0').count())).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.list')).toHaveCount(2);
  expect(await db(page, store => store.db.cardDetails.where('boardId').equals('board0').count())).toBe(100);
});
test('calendar bounds DOM even with 1000 events on a single date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-11T12:00:00') });
  await seed(page, fixture(2000));
  await page.locator('[data-act="toggle-view"]').click();
  const events = page.locator('[data-virtual-day="2026-11-11"]');
  await expect(events.locator('.cal-event').first()).toBeVisible();
  expect(await events.locator('.cal-event').count()).toBeLessThanOrEqual(60);
  await events.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await page.clock.runFor(100);
  await expect(events.locator('.cal-event').last()).toContainText('Tarea 1998');
});
test('failed transaction rolls back without a success toast', async ({ page }) => {
  await seed(page);
  await page.locator('.card').first().click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'cardDetails') throw new DOMException('Cuota de prueba', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.locator('[data-f="desc"]').fill('No debe persistir');
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await expect(page.locator('.storage-error')).toBeVisible();
  expect(await db(page, store => store.db.cardDetails.get(['board0', 'card0']).then(x => x.desc))).toBe('Descripción 0');
});
test('updates other tabs and refuses stale writes', async ({ page, context }) => {
  await seed(page);
  const other = await context.newPage();
  await other.goto('/app/#/b/board0');
  await expect(other.locator('.card').first()).toBeVisible();
  await page.locator('.card').first().click();
  await page.locator('[data-f="title"]').fill('Título compartido');
  await expect.poll(() => db(page, store => store.db.cards.get(['board0', 'card0']).then(c => c.title))).toBe('Título compartido');
  await expect(other.locator('.card').first()).toContainText('Título compartido');
  await other.close();
});
test('create, duplicate and move cards preserve position and full contents', async ({ page }) => {
  await seed(page);
  await page.locator('.card').first().click();
  await page.locator('[data-act="dup-card"]').click();
  await expect(page.locator('.card').nth(1)).toContainText('Tarea 0 (copy)');
  await page.locator('.card').nth(1).click();
  await expect(page.locator('.comments')).toContainText('Nota 0');
  await page.locator('[data-f="move"]').selectOption('empty0');
  await expect(page.locator('.modal .muted').first()).toContainText('Destino');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-virtual-list="empty0"] .card')).toHaveCount(1);
  await page.locator('.list').first().locator('[data-act="add-card"]').click();
  await page.locator('.composer textarea').fill('Nueva A\nNueva B');
  await page.locator('[data-act="save-card"]').click();
  await expect.poll(() => db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(13);
  const rows = await db(page, store => store.db.cards.where('[boardId+listId+position]').between(['board0', 'list0', -Infinity], ['board0', 'list0', Infinity]).toArray());
  expect(rows.slice(-2).map(c => c.title)).toEqual(['Nueva A', 'Nueva B']);
});
test('duplicate board, sort and templates include all cards', async ({ page }) => {
  await seed(page, fixture(200));
  await page.locator('.list').first().locator('[data-act="list-menu"]').click();
  await page.getByRole('menuitem', { name: 'Sort by name (A→Z)', exact: true }).click();
  await expect(page.locator('.card').nth(2)).toContainText('Tarea 100');
  const sorted = await db(page, store => store.db.cards.where('[boardId+listId+position]').between(['board0', 'list0', -Infinity], ['board0', 'list0', Infinity]).toArray());
  expect(sorted.map(c => c.title)).toEqual([...sorted.map(c => c.title)].sort((a, b) => a.localeCompare(b, 'en')));
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="dup-board"]').click();
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0 (copy)');
  expect(await db(page, store => store.db.cards.count())).toBe(300);
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="open-templates"]').click();
  await expect(page.locator('.template-row')).toHaveCount(1);
  await page.locator('[data-act="use-template"]').click();
  await expect.poll(() => db(page, store => store.db.cards.count())).toBe(301);
});
test('export without attachments uses .kanbaya, includes unloaded details and imports legacy JSON', async ({ page }) => {
  await seed(page, fixture(200));
  await page.locator('[data-act="data-menu"]').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export all boards (backup)' }).click();
  const filenameDialog = page.getByRole('dialog', { name: 'Backup filename' });
  await filenameDialog.getByLabel('Backup filename').fill('Mi copia');
  await filenameDialog.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await pending;
  const fs = require('node:fs/promises');
  expect(download.suggestedFilename()).toBe('Mi copia.kanbaya');
  const buffer = await fs.readFile(await download.path());
  expect(buffer.subarray(0, 8).toString()).toBe('KANBAYA4');
  const json = JSON.parse(buffer.subarray(12, 12 + buffer.readUInt32LE(8)).toString());
  expect(json.version).toBe(4);
  expect(json.images).toEqual([]);
  expect(json.boards[0].lists[0].cards).toHaveLength(100);
  expect(json.boards[0].lists[0].cards.at(-1).desc).toBe('aguja-remota');
  expect(json.boards[0].lists[0].cards[0]).toEqual(fixture(200).boards[0].lists[0].cards[0]);
  expect(Object.keys(json.boards[0]).sort()).toEqual(Object.keys(fixture(200).boards[0]).sort());
  await page.locator('#import-file').setInputFiles({ name: 'copia.kanbaya', mimeType: 'application/octet-stream', buffer });
  await expect.poll(() => db(page, store => store.db.templates.count())).toBe(2);
  expect(await db(page, store => store.db.cards.count())).toBe(200);
  expect(await db(page, store => store.db.templates.count())).toBe(2);
  json.version = 2;
  delete json.images;
  await page.locator('#import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await expect.poll(() => db(page, store => store.db.templates.count())).toBe(3);
  expect(await db(page, store => store.db.cards.count())).toBe(200);
  expect(await db(page, store => store.db.templates.count())).toBe(3);
});
test('local board export without attachments uses .kanbaya and merges without duplicates', async ({ page }) => {
  await seed(page, fixture(4));
  await page.locator('[data-act="board-menu"]').click();
  const pending = page.waitForEvent('download');
  await page.locator('[data-act="export-board"]').click();
  const filenameDialog = page.getByRole('dialog', { name: 'Backup filename' });
  await expect(filenameDialog.getByLabel('Backup filename')).toHaveValue(/^Tablero_0-\d{4}-\d{2}-\d{2}\.kanbaya$/);
  await filenameDialog.getByLabel('Backup filename').fill('Panel.KANBAYA');
  await filenameDialog.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Panel.KANBAYA');
  const buffer = await require('node:fs/promises').readFile(await download.path());
  expect(buffer.subarray(0, 8).toString()).toBe('KANBAYA4');
  const data = JSON.parse(buffer.subarray(12, 12 + buffer.readUInt32LE(8)).toString());
  expect(data.boards.map(board => board.id)).toEqual(['board0']);
  expect(data.images).toEqual([]);
  expect(data.templates).toBeUndefined();
  await page.locator('#import-file').setInputFiles({ name: 'board.kanbaya', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('.toast')).toContainText('1 board(s) imported');
  expect(await db(page, store => store.db.boards.count())).toBe(2);
  expect(await db(page, store => store.db.cards.count())).toBe(4);
});
test('local export rejects invalid names and can be cancelled', async ({ page }) => {
  await seed(page, fixture(4));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('[data-act="data-menu"]').click();
  await page.getByRole('menuitem', { name: 'Export all boards (backup)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Backup filename' });
  const input = dialog.getByLabel('Backup filename');
  for (const value of ['', 'bad/name', 'CON']) {
    await input.fill(value);
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(input).toHaveJSProperty('validationMessage', 'Enter a valid filename without path separators or reserved characters.');
    await expect(dialog).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(downloads).toBe(0);
});
for (const preferred of ['local', 'backup']) {
  test(`merges matching boards and uses ${preferred} for conflicting cards and lanes`, async ({ page }) => {
    const data = fixture(4);
    await seed(page, data);
    await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
    const backup = structuredClone(data);
    backup.templates = [];
    const board = backup.boards[0], card = board.lists[0].cards.shift();
    card.title = 'Edited in backup';
    board.name = 'Backup board';
    board.lists[1].cards.push(card);
    board.lists[0].cards = [{ ...structuredClone(card), id: 'backup-only', title: 'Backup only' }];
    await page.locator('#import-file').setInputFiles({
      name: 'merge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
    });
    const dialog = page.getByRole('dialog', { name: 'Conflicts in Backup board' });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 320, height: 600 });
    expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: preferred === 'local' ? 'Keep local version' : 'Use backup version' }).click();
    await expect(page.locator('.toast')).toContainText('2 board(s) imported');
    const result = await db(page, store => store.exportState(['board0']));
    const merged = result.boards[0];
    expect(merged.name).toBe(preferred === 'local' ? 'Tablero 0' : 'Backup board');
    const lists = merged.lists.map(list => ({ id: list.id, cards: list.cards.map(card => ({ id: card.id, title: card.title })) }));
    const source = preferred === 'local' ? 'list0' : 'empty0';
    expect(lists.find(list => list.id === source).cards).toContainEqual({ id: 'card0', title: preferred === 'local' ? 'Tarea 0' : 'Edited in backup' });
    expect(lists.find(list => list.id === 'list0').cards.map(card => card.id)).toEqual(expect.arrayContaining(['card2', 'backup-only']));
    expect(await db(page, store => store.db.boards.count())).toBe(2);
    expect(await db(page, store => store.db.cards.count())).toBe(5);
  });
}
test('cancelling a conflict leaves all boards unchanged', async ({ page }) => {
  const data = fixture(4);
  await seed(page, data);
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  const backup = structuredClone(data);
  backup.boards[0].name = 'Changed first';
  backup.boards[1].name = 'Changed second';
  await page.locator('#import-file').setInputFiles({
    name: 'cancel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
  });
  await page.getByRole('dialog', { name: 'Conflicts in Changed first' }).getByRole('button', { name: 'Use backup version' }).click();
  await page.getByRole('dialog', { name: 'Conflicts in Changed second' }).getByRole('button', { name: 'Cancel import' }).click();
  const result = await db(page, store => store.exportState());
  expect(result.boards.map(board => board.name)).toEqual(['Tablero 0', 'Tablero 1']);
  expect(result.templates).toHaveLength(1);
});
test('merge adds new boards and cards without asking when shared items are unchanged', async ({ page }) => {
  const data = fixture(4);
  await seed(page, data);
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  const backup = structuredClone(data);
  backup.templates = [];
  backup.boards[0].lists[0].cards.push({ ...structuredClone(backup.boards[0].lists[0].cards[0]), id: 'new-card', title: 'New card' });
  backup.boards.push({ ...structuredClone(backup.boards[1]), id: 'new-board', name: 'New board' });
  await page.locator('#import-file').setInputFiles({
    name: 'additions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('.toast')).toContainText('3 board(s) imported');
  expect(await db(page, store => store.db.boards.count())).toBe(3);
  expect(await db(page, store => store.db.cards.get(['board0', 'new-card']))).toMatchObject({ title: 'New card' });
  expect(await db(page, store => store.db.boards.get('new-board'))).toMatchObject({ name: 'New board' });
  await expect(page.getByRole('dialog', { name: /Conflicts in/ })).toHaveCount(0);
});
test('a merge exceeding a WIP limit rolls back every imported board', async ({ page }) => {
  const data = fixture(4);
  data.boards[0].lists[0].wipLimit = 2;
  await seed(page, data);
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  const backup = structuredClone(data);
  backup.boards[0].lists[0].cards.push({ ...structuredClone(backup.boards[0].lists[0].cards[0]), id: 'new-card' });
  backup.boards.push({ ...structuredClone(backup.boards[1]), id: 'new-board' });
  await page.locator('#import-file').setInputFiles({
    name: 'over-limit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, store => store.db.boards.count())).toBe(2);
  expect(await db(page, store => store.db.cards.count())).toBe(4);
  expect(await db(page, store => store.db.templates.count())).toBe(1);
});
test('card completion drives deadline filters, statistics and calendar status', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00'));
  const data = fixture(4);
  const cards = data.boards[0].lists[0].cards;
  cards[0].completed = true;
  cards[1].dueDone = true;
  await seed(page, data);
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  const result = await db(page, async store => {
    const board = (await store.readState()).boards.find(board => board.id === 'board0');
    const keys = await store.listKeys(board, board.lists[0], { status: [], due: ['overdue'], labels: [] }, '');
    const stats = await store.statistics(board);
    return { ids: keys.map(key => key.id), overdue: stats.overdue, completed: stats.completed };
  });
  expect(result).toEqual({ ids: ['card2'], overdue: 1, completed: 1 });
  await page.locator('[data-act="toggle-view"]').click();
  await expect(page.locator('.cal-event').filter({ hasText: 'Tarea 0' })).toHaveClass(/done/);
  await expect(page.locator('.cal-event').filter({ hasText: 'Tarea 2' })).not.toHaveClass(/done/);
});
test('completed recurrence advances and label renaming updates offscreen search', async ({ page }) => {
  await seed(page, fixture(200));
  await page.locator('.card').first().click();
  await page.locator('.due-date-section summary').click();
  await page.getByLabel('Mark as complete', { exact: true }).check();
  await expect(page.locator('[data-f="due"]')).toHaveValue('2026-11-12');
  await expect(page.getByLabel('Mark as complete', { exact: true })).not.toBeChecked();
  const recurring = await db(page, store => store.db.cards.get(['board0', 'card0']));
  expect(recurring.completed).toBe(false);
  expect(recurring.dueDone).toBe(false);
  await page.locator('[data-act="edit-labels"]').click();
  await page.locator('[data-f="label-name"]').fill('Nombre totalmente nuevo');
  await expect.poll(() => db(page, store => store.db.boards.get('board0').then(b => b.labels[0].name))).toBe('Nombre totalmente nuevo');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-act="toggle-filters"]').click();
  await page.locator('.filter-keyword').fill('Nombre totalmente nuevo');
  await expect(page.locator('.list .count').first()).toHaveText('100/100');
});
test('mouse drag between lists and cancellation preserve data', async ({ page }) => {
  await seed(page, fixture(200));
  const card = page.locator('[data-virtual-list="list0"] .card').first();
  const source = await card.boundingBox();
  const target = await page.locator('[data-virtual-list="empty0"]').boundingBox();
  await page.mouse.move(source.x + 30, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 10, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-virtual-list="empty0"] .card')).toHaveCount(1);
  expect(await db(page, store => store.db.cards.get(['board0', 'card0']).then(c => c.listId))).toBe('empty0');
  const next = await page.locator('[data-virtual-list="list0"] .card').first().boundingBox();
  await page.mouse.move(next.x + 30, next.y + 20);
  await page.mouse.down();
  await page.mouse.move(next.x + 80, next.y + 30, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(100);
});
test('stale writer fails without overwriting a concurrent commit', async ({ page }) => {
  await seed(page);
  await page.locator('.card').first().click();
  await db(page, async store => {
    await store.db.transaction('rw', store.db.cards, store.db.settings, async () => {
      await store.db.cards.update(['board0', 'card0'], { title: 'Cambio externo' });
      const revision = await store.db.settings.get('revision');
      await store.db.settings.put({ key: 'revision', value: revision.value + 1 });
    });
  });
  await page.locator('[data-f="title"]').fill('Borrador antiguo');
  await expect(page.locator('.storage-error')).toContainText('Another tab');
  expect(await db(page, store => store.db.cards.get(['board0', 'card0']).then(c => c.title))).toBe('Cambio externo');
});
test('first load initializes once and metadata-only home never reads details', async ({ page }) => {
  await page.addInitScript(() => {
    window.detailReads = 0;
    for (const method of ['get', 'getAll', 'openCursor']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        if (this.name === 'cardDetails') window.detailReads++;
        return original.apply(this, args);
      };
    }
  });
  await page.goto('/app/');
  await expect(page.locator('.board-tile').first()).toContainText('My first board');
  expect(await page.evaluate(() => window.detailReads)).toBe(0);
  expect(await db(page, store => store.db.cards.count())).toBe(5);
  await page.reload();
  await expect(page.locator('.board-tile').first()).toBeVisible();
  expect(await page.evaluate(() => window.detailReads)).toBe(0);
  expect(await db(page, store => store.db.cards.count())).toBe(5);
});
test('offline reload retains dependencies and supports writes', async ({ page, context }) => {
  await seed(page);
  await expect(page.locator('.card').first()).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  const resources = await page.evaluate(async () => {
    const urls = [
      document.querySelector('link[rel="stylesheet"]').href,
      ...[...document.scripts].map(script => script.src).filter(Boolean)
    ];
    const responses = await Promise.all(urls.map(url => fetch(url)));
    return {
      paths: urls.map(url => new URL(url).pathname),
      allAvailable: responses.every(response => response.ok),
      stylesheetLoaded: document.styleSheets[0].cssRules.length > 0
    };
  });
  expect(resources.paths).toEqual(expect.arrayContaining([
    '/app/css/styles.css', '/app/scripts/boot.js', '/app/scripts/app.js', '/app/scripts/storage.js', '/app/scripts/virtual.js'
  ]));
  expect(resources.allAvailable).toBe(true);
  expect(resources.stylesheetLoaded).toBe(true);
  await page.locator('.card').first().click();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.locator('[data-f="desc"]').fill('Sin conexión');
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await expect.poll(() => db(page, store => store.db.cardDetails.get(['board0', 'card0']).then(c => c.desc))).toBe('Sin conexión');
  await context.setOffline(false);
});
test('initialization rollback can retry after an interrupted transaction', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('failure-injected')) return;
    sessionStorage.setItem('failure-injected', 'yes');
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'cardDetails') throw new DOMException('Interrupción de prueba', 'AbortError');
      return original.apply(this, args);
    };
  });
  await page.goto('/app/');
  await expect(page.locator('.storage-error')).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(0);
  expect(await db(page, store => store.db.settings.get('initialized'))).toBeUndefined();
  await page.reload();
  await expect(page.locator('.board-tile').first()).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(5);
});
test('a cached previous release detects the deployed update on startup and preserves data offline', async ({ page, context }) => {
  await prepareDatabase(page, fixture(4));
  await page.goto('/app/tests/blank');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/app/tests/previous-sw.js', { scope: '/app/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await page.goto('/app/#/b/board0');
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  expect(await page.evaluate(() => [...document.scripts].filter(script => script.src).every(script => new URL(script.src).searchParams.get('v') === '27'))).toBe(true);
  await expect(page.locator('.update-notice')).toBeVisible();
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await page.getByLabel('Card title', { exact: true }).fill('Saved before updating');
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Activate update and reload' }).click()
  ]);
  await expect(page.locator('.update-notice')).toHaveCount(0);
  await expect(page.locator('.product-version')).toHaveText('Kanbaya v1.1.0');
  await expect(page.locator('.card').filter({ hasText: 'Saved before updating' })).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(4);
  const cachesAfterUpdate = await page.evaluate(() => caches.keys());
  expect(cachesAfterUpdate).toContain('kanbaya-pwa-v35');
  expect(cachesAfterUpdate).not.toContain('kanbaya-pwa-v27');
  expect(await page.evaluate(() => [...document.scripts].filter(script => script.src).every(script => new URL(script.src).searchParams.get('v') === '35'))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.product-version')).toHaveText('Kanbaya v1.1.0');
  await expect(page.locator('.card').filter({ hasText: 'Saved before updating' })).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(4);
});
test('an installed legacy worker cannot mix old app code with the new shell', async ({ page }) => {
  await prepareDatabase(page, { version: 2, theme: 'auto', boards: [], templates: [] });
  await page.goto('/app/tests/blank');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/app/sw.js?legacy=1');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await page.goto('/app/');
  await expect(page.locator('.update-notice')).toBeVisible();
  await page.getByRole('button', { name: 'Activate update and reload' }).click();
  await expect(page.locator('.empty')).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(0);
});
test('moves the previous root worker to app scope without losing data', async ({ page }) => {
  await prepareDatabase(page, { version: 2, theme: 'auto', boards: [], templates: [] });
  await page.goto('/tests/blank');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js?legacy-root=1');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await page.goto('/app/?install=1');
  await expect(page.locator('.empty')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Install Kanbaya' })).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(reg => new URL(reg.scope).pathname))).toEqual(['/app/']);
  await page.goto('/tests/blank');
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
test('works offline under a GitHub Pages project path without controlling the website', async ({ page, context }) => {
  await page.goto('/project/app/');
  await expect(page.locator('.board-tile').first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(reg => new URL(reg.scope).pathname))).toEqual(['/project/app/']);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.board-tile').first()).toBeVisible();
  await context.setOffline(false);
  await page.goto('/project/tests/blank');
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
test('mobile variable-height cards stay bounded and keyboard focus advances', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const data = fixture(200);
  data.boards[0].lists[0].cards[0].title = 'Título largo '.repeat(30);
  await seed(page, data);
  const list = page.locator('[data-virtual-list="list0"]');
  await expect(list.locator('.card').first()).toBeVisible();
  await list.locator('.card').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(list.locator('[data-id="card2"]')).toBeFocused();
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await expect(list.locator('.card').last()).toContainText('Tarea 198');
  expect(await list.locator('.card').count()).toBeLessThanOrEqual(60);
});
test('touch long-press drag moves the card', async ({ page }) => {
  await seed(page);
  const card = page.locator('.card').first();
  const source = await card.boundingBox();
  const target = await page.locator('[data-virtual-list="empty0"]').boundingBox();
  await card.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: source.x + 30, clientY: source.y + 20 });
  await expect(page.locator('.drag-ghost')).toBeVisible();
  await page.locator('body').dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: target.x + 30, clientY: target.y + 4 });
  await page.locator('body').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: target.x + 30, clientY: target.y + 4 });
  await expect(page.locator('[data-virtual-list="empty0"] .card')).toHaveCount(1);
});
test('a schema upgrade closes old connections and warns before further edits', async ({ page }) => {
  await seed(page);
  await expect(page.locator('.card').first()).toBeVisible();
  await page.evaluate(async () => {
    const newer = new Dexie('kanbaya');
    newer.version(3).stores({ settings: 'key' });
    await newer.open(); newer.close();
  });
  await expect(page.locator('.storage-error')).toContainText('new version');
});
test('clearing boards retains theme and templates across restarts', async ({ page }) => {
  await seed(page);
  await page.locator('[data-act="data-menu"]').click();
  await page.getByRole('menuitem', { name: 'Delete all data' }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.empty')).toBeVisible();
  await page.reload();
  await expect(page.locator('.empty')).toBeVisible();
  expect(await db(page, store => store.db.cards.count())).toBe(0);
  expect(await db(page, store => store.db.templates.count())).toBe(1);
  expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
});
test('two first-start requests share one atomic initialization', async ({ page }) => {
  await page.goto('/tests/blank');
  await page.addScriptTag({ url: '/app/vendor/dexie.min.js' });
  await page.addScriptTag({ url: '/app/scripts/storage.js' });
  const result = await page.evaluate(async data => {
    const a = new KanbayaStore('kanbaya-test-concurrency');
    const b = new KanbayaStore('kanbaya-test-concurrency');
    await Promise.all([a.initialize(() => data), b.initialize(() => data)]);
    const count = await a.db.cards.count();
    a.db.close(); b.db.close();
    await Dexie.delete('kanbaya-test-concurrency');
    return count;
  }, fixture(20));
  expect(result).toBe(20);
});
test('blocked database upgrade shows an actionable error', async ({ page }) => {
  await page.addInitScript(() => {
    const request = indexedDB.open('kanbaya', 1);
    request.onsuccess = () => { window.blocker = request.result; };
  });
  await page.goto('/app/');
  await expect(page.locator('.storage-error')).toContainText('Close other Kanbaya tabs');
  await page.evaluate(() => window.blocker.close());
});
test('fractional positions are rebalanced atomically when precision runs out', async ({ page }) => {
  await page.goto('/tests/blank');
  await page.addScriptTag({ url: '/app/vendor/dexie.min.js' });
  await page.addScriptTag({ url: '/app/scripts/storage.js' });
  const ordered = await page.evaluate(async data => {
    const store = new KanbayaStore('kanbaya-test-positions');
    const state = await store.initialize(() => data);
    await store.hydrate(state.boards[0]);
    const list = state.boards[0].lists[0];
    list.cards[0]._pos = 1;
    list.cards[1]._pos = 1 + Number.EPSILON;
    store.adopt(state);
    await store.db.cards.update(['board0', 'card0'], { position: 1 });
    await store.db.cards.update(['board0', 'card2'], { position: 1 + Number.EPSILON });
    const moving = list.cards.pop();
    moving._pos = await store.positionBefore('board0', 'list0', 'card2', moving.id);
    moving._positioned = true;
    list.cards.splice(1, 0, moving);
    await store.commit(state);
    const rows = await store.db.cards.where('[boardId+listId+position]').between(['board0', 'list0', -Infinity], ['board0', 'list0', Infinity]).toArray();
    store.db.close(); await Dexie.delete('kanbaya-test-positions');
    return rows.map(c => c.id);
  }, fixture(6));
  expect(ordered).toEqual(['card0', 'card4', 'card2']);
});
test('edits made during an in-flight commit are not mistaken for persisted data', async ({ page }) => {
  await page.goto('/tests/blank');
  await page.addScriptTag({ url: '/app/vendor/dexie.min.js' });
  await page.addScriptTag({ url: '/app/scripts/storage.js' });
  const desc = await page.evaluate(async data => {
    const store = new KanbayaStore('kanbaya-test-draft');
    const state = await store.initialize(() => data);
    await store.hydrate(state.boards[0]); store.adopt(state);
    const card = state.boards[0].lists[0].cards[0];
    card.desc = 'Primer cambio';
    const pending = store.commit(state);
    card.desc = 'Segundo cambio durante el guardado';
    await pending;
    await store.commit(state);
    const saved = await store.db.cardDetails.get(['board0', card.id]);
    store.db.close(); await Dexie.delete('kanbaya-test-draft');
    return saved.desc;
  }, fixture(6));
  expect(desc).toBe('Segundo cambio durante el guardado');
});
test('drag can cross a virtual window without appending to the end of the dataset', async ({ page }) => {
  await seed(page, fixture(1000));
  const list = page.locator('[data-virtual-list="list0"]');
  await expect(list.locator('.card').first()).toBeVisible();
  const source = await list.locator('.card').first().boundingBox();
  const target = await list.boundingBox();
  await page.mouse.move(source.x + 30, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(source.x + 50, source.y + 30, { steps: 4 });
  await expect(page.locator('.drag-ghost')).toBeVisible();
  await list.evaluate(el => { el.scrollTop = 10000; el.dispatchEvent(new Event('scroll')); });
  await page.mouse.move(target.x + 100, target.y + target.height - 20, { steps: 8 });
  await expect(list.locator('[data-id="card0"]:not(.drag-hidden)')).toHaveCount(0);
  await expect.poll(() => list.locator('.card').first().getAttribute('data-id')).not.toBe('card0');
  await page.mouse.up();
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  await expect.poll(() => db(page, async store => {
    const rows = await store.db.cards.where('[boardId+listId+position]').between(['board0', 'list0', -Infinity], ['board0', 'list0', Infinity]).toArray();
    return rows.findIndex(c => c.id === 'card0');
  })).toBeGreaterThan(0);
  const index = await db(page, async store => {
    const rows = await store.db.cards.where('[boardId+listId+position]').between(['board0', 'list0', -Infinity], ['board0', 'list0', Infinity]).toArray();
    return rows.findIndex(c => c.id === 'card0');
  });
  expect(index).toBeLessThan(499);
});
