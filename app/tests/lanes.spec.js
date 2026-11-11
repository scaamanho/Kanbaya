const { test, expect } = require('@playwright/test');
const { fixture, seed: seedDatabase } = require('./fixtures');

async function seed(page, data = fixture(8)) {
  page.laneErrors = [];
  page.on('pageerror', error => page.laneErrors.push(error.message));
  await seedDatabase(page, data);
  await page.goto('/app/#/b/board0');
  await expect(page.locator('.list').first()).toBeVisible();
}
async function db(page, fn) {
  return page.evaluate(async source => {
    const store = new KanbayaStore();
    try {
      await store.db.open();
      return await new Function('store', 'return (' + source + ')(store)')(store);
    } finally { store.db.close(); }
  }, fn.toString());
}
const lane = (page, id = 'list0') => page.locator(`.list[data-id="${id}"]`);
async function menu(page, action, id = 'list0') {
  await lane(page, id).getByRole('button', { name: 'List actions', exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}
async function setWip(page, value, id = 'list0') {
  await menu(page, 'Set WIP limit...', id);
  await page.getByLabel('Maximum work in progress').fill(String(value));
  await page.getByRole('button', { name: 'Save WIP limit', exact: true }).click();
}
test.afterEach(({ page }) => { expect(page.laneErrors || []).toEqual([]); });

test('collapses persistently, expands and Add card opens a collapsed list', async ({ page }) => {
  await seed(page);
  const width = await lane(page).evaluate(el => el.getBoundingClientRect().width);
  await menu(page, 'Collapse list');
  await expect(lane(page)).toHaveClass(/is-collapsed/);
  expect(await lane(page).evaluate(el => el.getBoundingClientRect().width)).toBe(width);
  await expect(lane(page).locator('[data-virtual-list]')).toHaveCount(0);
  await page.reload();
  await expect(lane(page)).toHaveClass(/is-collapsed/);
  await lane(page).getByRole('button', { name: 'Expand Pendientes', exact: true }).click();
  await expect(lane(page).locator('.card')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 800 });
  const mobileWidth = await lane(page).evaluate(el => el.getBoundingClientRect().width);
  await menu(page, 'Collapse list');
  expect(await lane(page).evaluate(el => el.getBoundingClientRect().width)).toBe(mobileWidth);
  await menu(page, 'Add card');
  await expect(lane(page)).not.toHaveClass(/is-collapsed/);
  await expect(lane(page).locator('.composer textarea')).toBeFocused();
});

test('lane deletion uses an accessible application confirmation and preserves data on cancellation', async ({ page }) => {
  await seed(page);
  let nativeDialogs = 0;
  page.on('dialog', dialog => { nativeDialogs++; dialog.dismiss(); });
  await menu(page, 'Delete list');
  const dialog = page.getByRole('dialog', { name: 'Confirm action' });
  await expect(dialog).toContainText('Delete the list "Pendientes" and its cards?');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(lane(page)).toBeVisible();
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(4);
  await menu(page, 'Delete list');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(lane(page)).toHaveCount(0);
  expect(nativeDialogs).toBe(0);
});

test('WIP counts incomplete non-archived cards, blocks batches atomically and allows unlimited', async ({ page }) => {
  const data = fixture(8);
  data.boards[0].lists[0].cards[0].completed = true;
  data.boards[0].lists[0].cards[1].archived = true;
  await seed(page, data);
  await setWip(page, 3);
  await expect(lane(page).getByLabel('WIP 2 of 3', { exact: true })).toBeVisible();
  await menu(page, 'Add card');
  const composer = lane(page).locator('.composer textarea');
  await composer.fill('Batch one\nBatch two');
  await lane(page).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(4);
  await expect(page.locator('.storage-error')).toHaveCount(0);
  await composer.fill('Fits the limit');
  await lane(page).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(lane(page).getByLabel('WIP 3 of 3', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await setWip(page, 1);
  await expect(lane(page).getByLabel('WIP 3 of 1', { exact: true })).toBeVisible();
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(5);
  await page.reload();
  await expect(lane(page).getByLabel('WIP 3 of 1', { exact: true })).toBeVisible();
  await setWip(page, 0);
  await expect(lane(page).locator('.wip-count')).toHaveCount(0);
  await menu(page, 'Add card');
  await composer.fill('Unlimited one\nUnlimited two');
  await lane(page).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(lane(page).locator('.card').filter({ hasText: 'Unlimited' })).toHaveCount(2);
});

test('rejects invalid WIP settings and permits completing but not reopening at capacity', async ({ page }) => {
  const data = fixture(4);
  data.boards[0].lists[0].cards[0].completed = true;
  await seed(page, data);
  await menu(page, 'Set WIP limit...');
  for (const value of ['-1', '1.5', '9007199254740992']) {
    await page.getByLabel('Maximum work in progress').fill(value);
    await page.getByRole('button', { name: 'Save WIP limit', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('non-negative whole number');
    await expect(page.locator('.modal')).toBeVisible();
  }
  await page.getByLabel('Maximum work in progress').fill('1');
  await page.getByRole('button', { name: 'Save WIP limit', exact: true }).click();
  await lane(page).locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await page.getByLabel('Mark as complete', { exact: true }).uncheck();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  await expect(page.getByLabel('Mark as complete', { exact: true })).toBeChecked();
  await expect(page.locator('.storage-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await lane(page).locator('.card').filter({ hasText: 'Tarea 2' }).click();
  await page.getByLabel('Mark as complete', { exact: true }).check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(lane(page).getByLabel('WIP 0 of 1', { exact: true })).toBeVisible();
  await lane(page).locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await page.getByLabel('Mark as complete', { exact: true }).uncheck();
  await expect(page.getByLabel('Mark as complete', { exact: true })).not.toBeChecked();
});

test('bulk moves include unloaded cards, retain order, respect WIP and support Undo', async ({ page }) => {
  const data = fixture(150);
  data.boards[0].lists[0].cards[0].archived = true;
  await seed(page, data);
  await setWip(page, 1, 'empty0');
  await menu(page, 'Move all cards to...');
  await page.getByRole('button', { name: 'Move cards', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, store => store.db.cards.where('[boardId+listId+position]').between(['board0', 'empty0', Dexie.minKey], ['board0', 'empty0', Dexie.maxKey]).count())).toBe(0);
  await setWip(page, 0, 'empty0');
  await menu(page, 'Move all cards to...');
  await page.getByRole('button', { name: 'Move cards', exact: true }).click();
  await expect(lane(page, 'empty0').locator('.count')).toHaveText('74');
  const moved = await db(page, store => store.db.cards.where('[boardId+listId+position]').between(['board0', 'empty0', Dexie.minKey], ['board0', 'empty0', Dexie.maxKey]).toArray());
  expect(moved.map(card => card.id)).toEqual(data.boards[0].lists[0].cards.slice(1).map(card => card.id));
  expect(await db(page, async store => (await store.db.cards.get(['board0', 'card0'])).listId)).toBe('list0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(lane(page).locator('.count')).toHaveText('74');
  expect(await db(page, store => store.db.cards.where('[boardId+listId+position]').between(['board0', 'empty0', Dexie.minKey], ['board0', 'empty0', Dexie.maxKey]).count())).toBe(0);
});

test('duplicates complete lists and independent attachment references and sorts all priorities', async ({ page }) => {
  const data = fixture(150);
  const priorities = ['', 'low', 'medium', 'high', 'critical'];
  data.boards[0].lists[0].theme = '#579dff';
  data.boards[0].lists[0].wipLimit = 100;
  data.boards[0].lists[0].cards.forEach((card, index) => { card.priority = priorities[index % 5]; });
  await seed(page, data);
  await db(page, async store => {
    const blob = new Blob(['attachment bytes'], { type: 'text/plain' });
    const compressed = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    await store.db.transaction('rw', store.tables(), async () => {
      await store.db.images.put({ id: 'attached', boardId: 'board0', cardId: 'card0', kind: 'file', compression: 'gzip', originalSize: blob.size, blob: compressed, mime: 'text/plain', size: compressed.size, name: 'note.txt', created: 1 });
      await store.db.cards.update(['board0', 'card0'], { imageIds: ['attached'], coverImageId: null });
      await store.db.cardDetails.update(['board0', 'card0'], { desc: 'Full copied description' });
    });
  });
  await page.reload();
  await menu(page, 'Duplicate list');
  await expect(page.locator('.list-title').filter({ hasText: 'Pendientes (copy)' })).toBeVisible();
  const result = await db(page, async store => {
    const lists = await store.db.lists.where('boardId').equals('board0').sortBy('position');
    const copy = lists.find(list => list.name === 'Pendientes (copy)');
    const cards = await store.db.cards.where('[boardId+listId+position]').between(['board0', copy.id, Dexie.minKey], ['board0', copy.id, Dexie.maxKey]).toArray();
    const first = cards.find(card => card.title === 'Tarea 0');
    return { copy, cards, detail: await store.db.cardDetails.get(['board0', first.id]), image: await store.db.images.get(first.imageIds[0]), lists: lists.map(list => list.id) };
  });
  expect(result.cards).toHaveLength(75);
  expect(result.copy).toMatchObject({ theme: '#579dff', wipLimit: 100 });
  expect(result.lists).toEqual(['list0', result.copy.id, 'empty0']);
  expect(result.detail.desc).toBe('Full copied description');
  expect(result.image.id).not.toBe('attached');
  expect(result.image.cardId).toBe(result.detail.id);
  expect(result.cards.every(card => !data.boards[0].lists[0].cards.some(original => original.id === card.id))).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await db(page, store => store.db.images.count())).toBe(1);
  await setWip(page, 1);
  await menu(page, 'Duplicate list');
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  await expect(page.locator('.list')).toHaveCount(2);
  expect(await db(page, store => store.db.images.count())).toBe(1);
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(75);
  await setWip(page, 0);
  await menu(page, 'Sort by priority');
  await expect.poll(() => db(page, async store => (await store.db.cards.where('[boardId+listId+position]').between(['board0', 'list0', Dexie.minKey], ['board0', 'list0', Dexie.maxKey]).first()).priority)).toBe('critical');
  const rows = await db(page, store => store.db.cards.where('[boardId+listId+position]').between(['board0', 'list0', Dexie.minKey], ['board0', 'list0', Dexie.maxKey]).toArray());
  const ranks = rows.map(card => priorities.indexOf(card.priority));
  expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  expect(rows).toHaveLength(75);
});

test('transactional WIP rejects moves, restores, duplicates and reopenings without partial persistence', async ({ page }) => {
  const data = fixture(8);
  data.boards[0].lists[0].wipLimit = 4;
  await seed(page, data);
  const results = await db(page, async store => {
    const outcomes = [];
    for (const action of ['duplicate', 'move', 'restore', 'reopen']) {
      let state = await store.readState();
      await store.hydrate(state.boards[0]); store.adopt(state);
      const source = state.boards[0].lists[0], target = state.boards[0].lists[1];
      if (action !== 'duplicate') {
        const extra = structuredClone(source.cards[0]);
        extra.id = 'extra'; extra.listId = action === 'move' ? target.id : source.id;
        extra.archived = action === 'restore'; extra.completed = action === 'reopen';
        await store.db.cards.put({ ...await store.db.cards.get(['board0', 'card0']), id: 'extra', listId: extra.listId, archived: extra.archived, archivedKey: Number(extra.archived), completed: extra.completed, position: 100000 });
        await store.db.cardDetails.put({ ...await store.db.cardDetails.get(['board0', 'card0']), id: 'extra' });
        state = await store.readState(); await store.hydrate(state.boards[0]); store.adopt(state);
      }
      const lists = state.boards[0].lists, first = lists[0];
      if (action === 'duplicate') {
        const copy = structuredClone(first.cards[0]); copy.id = 'extra'; first.cards.push(copy);
      } else {
        const extra = lists.flatMap(list => list.cards).find(card => card.id === 'extra');
        if (action === 'move') {
          lists[1].cards = lists[1].cards.filter(card => card.id !== extra.id);
          first.cards.push(extra);
        } else if (action === 'restore') extra.archived = false;
        else extra.completed = false;
      }
      const revision = store.revision;
      try { await store.preparePositions(state); await store.commit(state); outcomes.push({ action, error: null }); }
      catch (error) {
        outcomes.push({ action, error: error.name, revisionUnchanged: (await store.db.settings.get('revision')).value === revision });
      }
      await store.db.cards.delete(['board0', 'extra']); await store.db.cardDetails.delete(['board0', 'extra']);
    }
    return outcomes;
  });
  expect(results).toHaveLength(4);
  for (const result of results) expect(result).toMatchObject({ error: 'WipLimitError', revisionUnchanged: true });
});

test('WIP blocks card duplication, template creation and archive restoration through the UI', async ({ page }) => {
  const data = fixture(6);
  data.boards[0].lists[0].wipLimit = 2;
  data.boards[0].lists[0].cards[2].archived = true;
  await seed(page, data);
  await lane(page).locator('.card').first().click();
  await page.locator('[data-act="dup-card"]').click();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(3);
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="open-templates"]').click();
  await page.locator('[data-template-list="template"]').selectOption('list0');
  await page.locator('[data-act="use-template"]').click();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').count())).toBe(3);
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="open-archive"]').click();
  await page.locator('[data-act="restore-card"][data-id="card4"]').click();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, async store => (await store.db.cards.get(['board0', 'card4'])).archived)).toBe(true);
  await expect(page.locator('.storage-error')).toHaveCount(0);
});

test('card moves and dragging respect destination WIP without blocking the application', async ({ page }) => {
  const data = fixture(6);
  const lists = data.boards[0].lists;
  lists[1].cards.push(lists[0].cards.pop());
  lists[1].wipLimit = 1;
  await seed(page, data);
  const card = lane(page).locator('.card').first();
  await card.click();
  await page.getByLabel('Move to list', { exact: true }).selectOption('empty0');
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  await expect(page.getByLabel('Move to list', { exact: true })).toHaveValue('list0');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const source = await card.boundingBox(), target = await lane(page, 'empty0').locator('.list-cards').boundingBox();
  await page.mouse.move(source.x + 30, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 10, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, async store => (await store.db.cards.get(['board0', 'card0'])).listId)).toBe('list0');
  await expect(page.locator('.storage-error')).toHaveCount(0);
  await expect(lane(page, 'empty0').locator('.card')).toHaveCount(1);
});

test('Undo cannot reintroduce cards beyond a lowered WIP limit', async ({ page }) => {
  await seed(page);
  await setWip(page, 1);
  await menu(page, 'Archive all cards');
  await expect(lane(page).getByLabel('WIP 0 of 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, store => store.db.cards.where('boardId').equals('board0').filter(card => card.archived).count())).toBe(4);
  await expect(page.locator('.storage-error')).toHaveCount(0);
});

test('lane options survive JSON export/import and the full menu fits mobile height', async ({ page }) => {
  await seed(page);
  await setWip(page, 8);
  await menu(page, 'Collapse list');
  const json = await db(page, async store => JSON.parse(await (await store.exportBackup(['board0'])).blob.text()));
  expect(json.boards[0].lists[0]).toMatchObject({ collapsed: true, wipLimit: 8 });
  const invalid = structuredClone(json);
  invalid.boards[0].lists[0].wipLimit = -1;
  await page.locator('#import-file').setInputFiles({
    name: 'invalid-lanes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid))
  });
  await expect(page.locator('.toast')).toContainText('not a valid Kanbaya backup');
  expect(await db(page, store => store.db.boards.count())).toBe(2);
  invalid.boards[0].lists[0].wipLimit = 1;
  await page.locator('#import-file').setInputFiles({
    name: 'over-limit-lanes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid))
  });
  await expect(page.locator('.toast')).toContainText('WIP limit reached');
  expect(await db(page, store => store.db.boards.count())).toBe(2);
  await expect(page.locator('.storage-error')).toHaveCount(0);
  await page.locator('#import-file').setInputFiles({
    name: 'lanes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json))
  });
  await expect.poll(() => db(page, store => store.db.boards.count())).toBe(3);
  const imported = await db(page, async store => (await store.db.lists.toArray()).find(list => list.boardId !== 'board0' && list.boardId !== 'board1' && list.name === 'Pendientes'));
  expect(imported).toMatchObject({ collapsed: true, wipLimit: 8 });
  await page.setViewportSize({ width: 320, height: 480 });
  await lane(page).getByRole('button', { name: 'List actions', exact: true }).click();
  const bounds = await page.getByRole('menu').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, viewport: innerHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport);
  await page.getByRole('menuitem', { name: 'Sort by priority', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('menuitem', { name: 'Sort by priority', exact: true })).toBeVisible();
});
