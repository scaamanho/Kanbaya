const { test, expect } = require('@playwright/test');
const { fixture, seed: seedDatabase } = require('./fixtures');
const fs = require('node:fs/promises');

test.beforeEach(({ page }) => {
  page.imageErrors = [];
  page.on('pageerror', error => page.imageErrors.push(error.message));
});
test.afterEach(({ page }) => { expect(page.imageErrors).toEqual([]); });

async function seed(page) {
  await seedDatabase(page, fixture(4));
  await page.goto('/app/#/b/board0');
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
}

async function imageFile(page, name = 'photo.png', color = '#ff0000', width = 2400, height = 1200) {
  const bytes = await page.evaluate(async ({ color, width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { color, width, height });
  return { name, mimeType: 'image/png', buffer: Buffer.from(bytes) };
}

async function attach(page, files, count) {
  await page.getByLabel('Add attachments from device').setInputFiles(files);
  await expect(page.locator('.image-attachment')).toHaveCount(count);
  await page.locator('.image-attachment img').first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.image-attachment img').first().evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
}

async function addFromWeb(page, url) {
  await page.getByRole('button', { name: 'Add from web' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add attachment from web' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Attachment URL').fill(url);
  await dialog.getByRole('button', { name: 'Add attachment' }).click();
}

async function db(page, fn) {
  return page.evaluate(async source => {
    const store = new KanbayaStore();
    await store.db.open();
    try { return await (new Function('store', 'return (' + source + ')(store)'))(store); }
    finally { store.db.close(); }
  }, fn.toString());
}

test('attachment source buttons are aligned and open device and web import flows', async ({ page }) => {
  await seed(page);
  const device = page.getByRole('button', { name: 'Add from device' });
  const web = page.getByRole('button', { name: 'Add from web' });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const bounds = await Promise.all([device, web].map(button => button.evaluate(el => {
      const { x, y, width } = el.getBoundingClientRect();
      return { x, y, width };
    })));
    expect(Math.abs(bounds[0].y - bounds[1].y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds[0].width - bounds[1].width)).toBeLessThanOrEqual(1);
  }
  const chooserPromise = page.waitForEvent('filechooser');
  await device.click();
  await (await chooserPromise).setFiles(await imageFile(page));
  await expect(page.locator('.image-attachment')).toHaveCount(1);
  await web.click();
  const dialog = page.getByRole('dialog', { name: 'Add attachment from web' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('CORS');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('compresses local images into separate Blobs, selects covers and persists offline', async ({ page, context }) => {
  await seed(page);
  await attach(page, [
    await imageFile(page, 'first.png'),
    await imageFile(page, 'second.png', '#00ff00', 80, 60)
  ], 2);
  const saved = await db(page, async store => {
    const card = await store.db.cards.get(['board0', 'card0']);
    const images = await store.db.images.where('[boardId+cardId]').equals(['board0', 'card0']).toArray();
    return {
      card,
      images: images.map(({ blob, ...metadata }) => ({ ...metadata, isBlob: blob instanceof Blob, actualSize: blob.size })),
      bytes: await store.imageUsage()
    };
  });
  expect(saved.card.imageIds).toHaveLength(2);
  expect(saved.card.coverImageId).toBe(saved.card.imageIds[0]);
  expect(saved.card).not.toHaveProperty('blob');
  expect(saved.card).not.toHaveProperty('images');
  expect(saved.images.every(image => image.isBlob && image.size === image.actualSize && image.mime === 'image/webp')).toBe(true);
  expect(saved.images.find(image => image.name === 'first.png')).toMatchObject({ width: 1600, height: 800 });
  expect(saved.images.find(image => image.name === 'second.png')).toMatchObject({ width: 80, height: 60 });
  expect(saved.bytes).toBe(saved.images.reduce((size, image) => size + image.size, 0));
  await page.locator('.image-attachment').nth(1).getByRole('button', { name: 'Make cover', exact: true }).click();
  await expect(page.locator('.modal-cover')).toHaveAttribute('data-image-id', saved.card.imageIds[1]);
  await page.locator('.appearance-section summary').click();
  await page.getByLabel('Cover image', { exact: true }).selectOption('');
  await expect(page.locator('.modal-cover')).toHaveCount(0);
  await attach(page, await imageFile(page, 'third.png'), 3);
  await expect(page.locator('.modal-cover')).toHaveCount(0);
  await page.locator('.appearance-section summary').click();
  await page.getByLabel('Cover image', { exact: true }).selectOption(saved.card.imageIds[0]);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const card = page.locator('.card').filter({ hasText: 'Tarea 0' });
  await expect(card.locator('.card-cover')).toHaveAttribute('data-image-id', saved.card.imageIds[0]);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect.poll(() => card.locator('.card-cover').evaluate(img => img.naturalWidth)).toBe(1600);
  await card.click();
  await expect(page.locator('.image-attachment')).toHaveCount(3);
});

test('downloads URL images and rejects network, protocol and invalid file errors without blocking edits', async ({ page }) => {
  await seed(page);
  const file = await imageFile(page);
  await page.route('https://images.example.test/**', route => {
    if (route.request().url().endsWith('missing.png')) return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    return route.fulfill({ contentType: 'image/png', body: file.buffer, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await addFromWeb(page, 'https://images.example.test/remote.png');
  await expect(page.locator('.image-attachment')).toContainText('remote.png');
  await expect.poll(() => page.locator('.modal-cover').evaluate(img => img.naturalWidth)).toBe(1600);
  await addFromWeb(page, 'https://images.example.test/missing.png');
  await expect(page.locator('.toast')).toContainText('HTTP 404');
  await addFromWeb(page, 'javascript:alert(1)');
  await expect(page.locator('.toast')).toContainText('HTTP or HTTPS');
  await page.getByLabel('Add attachments from device').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('.toast')).toContainText('damaged');
  await page.getByLabel('Add attachments from device').setInputFiles({ name: 'text.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
  await expect(page.locator('.image-attachment')).toHaveCount(2);
  await page.locator('[data-f="title"]').fill('Still editable');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.card')).toContainText(['Still editable', 'Tarea 2']);
  await expect(page.locator('.storage-error')).toHaveCount(0);
  expect(await db(page, store => store.db.images.count())).toBe(2);
});

test('attachment menu renames, downloads, removes covers, and deleting an image is undoable', async ({ page }) => {
  await seed(page);
  await attach(page, await imageFile(page), 1);
  const bytes = await db(page, async store => [...new Uint8Array(await (await store.db.images.toCollection().first()).blob.arrayBuffer())]);
  await page.getByRole('button', { name: 'Attachment options for photo.png' }).click();
  await page.getByRole('menuitem', { name: 'Edit name', exact: true }).click();
  await page.getByRole('textbox', { name: 'Attachment name' }).fill('Renamed');
  await page.locator('.app-dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.image-attachment strong')).toHaveText('Renamed');
  await page.getByRole('button', { name: 'Attachment options for Renamed' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Renamed.webp');
  expect([...await fs.readFile(await download.path())]).toEqual(bytes);
  await page.getByRole('button', { name: 'Attachment options for Renamed' }).click();
  await page.getByRole('menuitem', { name: 'Remove cover', exact: true }).click();
  await expect(page.locator('.modal-cover')).toHaveCount(0);
  await page.getByRole('button', { name: 'Attachment options for Renamed' }).click();
  await page.getByRole('menuitem', { name: 'Delete attachment', exact: true }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.image-attachment')).toHaveCount(0);
  expect(await db(page, store => store.db.images.count())).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(1);
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await expect(page.locator('.image-attachment strong')).toHaveText('Renamed');
  const restored = await db(page, async store => [...new Uint8Array(await (await store.db.images.toCollection().first()).blob.arrayBuffer())]);
  expect(restored).toEqual(bytes);
});

test('duplicates images independently and cascades card and list deletion with Undo', async ({ page }) => {
  await seed(page);
  await attach(page, await imageFile(page), 1);
  await page.locator('[data-act="dup-card"]').click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(2);
  const cards = await db(page, store => store.db.cards.where('boardId').equals('board0').toArray());
  const original = cards.find(card => card.id === 'card0');
  const copy = cards.find(card => card.title === 'Tarea 0 (copy)');
  expect(copy.imageIds).not.toEqual(original.imageIds);
  await page.locator('.card').filter({ hasText: 'Tarea 0 (copy)' }).click();
  await page.locator('[data-act="del-card"]').click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(2);
  await page.locator('.list').first().locator('[data-act="list-menu"]').click();
  await page.getByRole('menuitem', { name: 'Delete list', exact: true }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(2);
});

test('binary backups round-trip image bytes and references, board copies and deletion remain independent', async ({ page }) => {
  await seed(page);
  await attach(page, await imageFile(page), 1);
  const original = await db(page, async store => {
    const image = await store.db.images.toCollection().first();
    return { id: image.id, bytes: [...new Uint8Array(await image.blob.arrayBuffer())] };
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-act="data-menu"]').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export all boards (backup)' }).click();
  const backup = await pending;
  expect(backup.suggestedFilename()).toMatch(/\.kanbaya$/);
  const buffer = await fs.readFile(await backup.path());
  expect(buffer.subarray(0, 8).toString()).toBe('KANBAYA4');
  expect([...buffer.subarray(-original.bytes.length)]).toEqual(original.bytes);
  await page.locator('#import-file').setInputFiles({ name: 'backup.kanbaya', mimeType: 'application/octet-stream', buffer });
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(2);
  const imported = await db(page, async store => {
    const images = await store.db.images.toArray();
    const image = images.find(image => image.boardId !== 'board0');
    const card = await store.db.cards.get([image.boardId, image.cardId]);
    return { card, imageId: image.id, bytes: [...new Uint8Array(await image.blob.arrayBuffer())] };
  });
  expect(imported.bytes).toEqual(original.bytes);
  expect(imported.imageId).not.toBe(original.id);
  expect(imported.card.coverImageId).toBe(imported.imageId);
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="dup-board"]').click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(3);
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0 (copy)');
  await expect.poll(() => page.locator('.card-cover').evaluate(img => img.naturalWidth)).toBe(1600);
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="del-board"]').click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(2);
});

test('quota failures roll back both the image and the card reference', async ({ page }) => {
  await seed(page);
  const file = await imageFile(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'images') throw new DOMException('Image storage quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByLabel('Add attachments from device').setInputFiles(file);
  await expect(page.locator('.storage-error')).toContainText('quota exceeded');
  expect(await db(page, store => store.db.images.count())).toBe(0);
  expect(await db(page, async store => (await store.db.cards.get(['board0', 'card0'])).imageIds || [])).toEqual([]);
});

test('upgrading a version 1 database preserves cards and adds an empty image store', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.board-tile').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const legacy = new Dexie('image-upgrade-test');
    legacy.version(1).stores({
      boards: 'id, position', lists: '[boardId+id], boardId, [boardId+position]',
      cards: '[boardId+id], boardId, [boardId+listId+position], [boardId+listId+archivedKey+position], [boardId+archivedKey+due]',
      cardDetails: '[boardId+id], boardId', templates: 'id, position', settings: 'key'
    });
    await legacy.open();
    await legacy.table('cards').put({ boardId: 'old', id: 'preserved', title: 'Keep me' });
    legacy.close();
    const store = new KanbayaStore('image-upgrade-test');
    try {
      await store.db.open();
      return { title: (await store.db.cards.get(['old', 'preserved'])).title, count: await store.db.images.count(), version: store.db.verno };
    } finally { await store.db.delete(); }
  });
  expect(result).toEqual({ title: 'Keep me', count: 0, version: 2 });
});

test('multi-file failures and truncated backups never partially save images', async ({ page }) => {
  await seed(page);
  const valid = await imageFile(page);
  await page.getByLabel('Add attachments from device').setInputFiles([
    valid, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }
  ]);
  await expect(page.locator('.toast')).toContainText('damaged');
  await expect(page.locator('.image-attachment')).toHaveCount(0);
  expect(await db(page, store => store.db.images.count())).toBe(0);
  await attach(page, valid, 1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-act="data-menu"]').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export all boards (backup)' }).click();
  const download = await pending;
  const buffer = await fs.readFile(await download.path());
  await page.locator('#import-file').setInputFiles({
    name: 'truncated.kanbaya', mimeType: 'application/octet-stream', buffer: buffer.subarray(0, buffer.length - 1)
  });
  await expect(page.locator('.toast')).toContainText('not a valid Kanbaya backup');
  expect(await db(page, store => store.db.images.count())).toBe(1);
  expect(await db(page, store => store.db.boards.count())).toBe(2);
});

test('preview URLs are released when elements disappear and revisiting uses fresh URLs', async ({ page }) => {
  await page.addInitScript(() => {
    window.liveImageURLs = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = create(blob);
      if (blob.type.startsWith('image/')) window.liveImageURLs.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      window.liveImageURLs = window.liveImageURLs.filter(value => value !== url);
      revoke(url);
    };
  });
  await seed(page);
  await attach(page, await imageFile(page), 1);
  const previous = await page.evaluate(() => [...window.liveImageURLs]);
  expect(previous.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => page.locator('.card-cover').evaluate(img => img.naturalWidth)).toBe(1600);
  await expect.poll(() => page.evaluate(() => window.liveImageURLs.length)).toBe(1);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.liveImageURLs.length)).toBe(0);
  await page.locator('.board-tile').filter({ hasText: 'Tablero 0' }).click();
  await expect.poll(() => page.locator('.card-cover').evaluate(img => img.naturalWidth)).toBe(1600);
  const current = await page.evaluate(() => window.liveImageURLs);
  expect(current).toHaveLength(1);
  expect(previous).not.toContain(current[0]);
});

test('image controls and cover fit desktop and mobile layouts', async ({ page }, testInfo) => {
  await seed(page);
  const file = await imageFile(page, 'a-long-image-name-that-should-wrap-instead-of-overflowing-the-card.png');
  await attach(page, file, 1);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('.image-attachments').scrollIntoViewIfNeeded();
    const layout = await page.locator('.overlay').evaluate(overlay => {
      const modal = overlay.querySelector('.modal').getBoundingClientRect();
      const cover = overlay.querySelector('.modal-cover').getBoundingClientRect();
      const attachment = overlay.querySelector('.image-attachment').getBoundingClientRect();
      return { overflow: overlay.scrollWidth - overlay.clientWidth, modalLeft: modal.left, modalRight: modal.right, coverLeft: cover.left, coverRight: cover.right, attachmentRight: attachment.right };
    });

    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.coverLeft).toBeGreaterThanOrEqual(layout.modalLeft - 1);
    expect(layout.coverRight).toBeLessThanOrEqual(layout.modalRight + 1);
    expect(layout.attachmentRight).toBeLessThanOrEqual(layout.modalRight);
    if (width === 390) {
      const screenshot = testInfo.outputPath('image-attachments-mobile.png');
      await page.screenshot({ path: screenshot });
      console.log('Image layout screenshot:', screenshot);
    }
  }
});

test('compresses arbitrary files without loss, downloads original bytes and works offline', async ({ page, context }) => {
  await seed(page);
  const buffer = Buffer.from('A lossless attachment\n'.repeat(10000));
  await page.getByLabel('Add attachments from device').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer },
    { name: 'empty.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) }
  ]);
  await expect(page.locator('.image-attachment')).toHaveCount(2);
  await expect(page.locator('.modal-cover')).toHaveCount(0);
  await expect(page.locator('[data-act="set-cover"]')).toHaveCount(0);
  await expect(page.locator('.image-attachment img')).toHaveCount(0);
  const saved = await db(page, async store => {
    const files = await store.db.images.toArray();
    return Promise.all(files.map(async file => ({
      name: file.name, mime: file.mime, size: file.size, originalSize: file.originalSize, compression: file.compression,
      isBlob: file.blob instanceof Blob, bytes: [...new Uint8Array(await (await KanbayaStore.attachmentBlob(file)).arrayBuffer())]
    })));
  });
  const notes = saved.find(file => file.name === 'notes.txt');
  expect(notes).toMatchObject({ isBlob: true, mime: 'text/plain', compression: 'gzip', originalSize: buffer.length });
  expect(notes.size).toBeLessThan(buffer.length / 10);
  expect(notes.bytes).toEqual([...buffer]);
  expect(saved.find(file => file.name === 'empty.bin').bytes).toEqual([]);
  await page.getByRole('button', { name: 'Attachment options for notes.txt' }).click();
  await expect(page.getByRole('menuitem', { name: 'Make cover', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Edit name', exact: true }).click();
  await page.getByRole('textbox', { name: 'Attachment name' }).fill('renamed.txt');
  await page.locator('.app-dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.image-attachment')).toContainText(['renamed.txt', 'empty.bin']);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await page.getByRole('button', { name: 'Attachment options for renamed.txt' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('renamed.txt');
  expect(await fs.readFile(await download.path())).toEqual(buffer);
});

test('URL files are compressed and only images appear in cover and description selectors', async ({ page }) => {
  await seed(page);
  await page.route('https://files.example.test/**', route => route.fulfill({
    contentType: 'application/pdf', body: Buffer.from('%PDF-example\n'.repeat(200)),
    headers: { 'Access-Control-Allow-Origin': '*' }
  }));
  await addFromWeb(page, 'https://files.example.test/document.pdf');
  await expect(page.locator('.image-attachment')).toHaveCount(1);
  await attach(page, [await imageFile(page, 'first.png'), await imageFile(page, 'second.png')], 3);
  const card = await db(page, store => store.db.cards.get(['board0', 'card0']));
  expect(card.coverImageId).toBe(card.imageIds[1]);
  await page.locator('.appearance-section summary').click();
  await expect(page.getByLabel('Cover image', { exact: true }).locator('option')).toHaveCount(3);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await expect(page.locator('.description-image-options button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Attachment options for first.png' }).click();
  await page.getByRole('menuitem', { name: 'Delete attachment', exact: true }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.modal-cover')).toHaveAttribute('data-image-id', card.imageIds[2]);
});

test('inserts attached images at the description cursor, escapes text and persists previews', async ({ page, context }) => {
  await seed(page);
  await attach(page, await imageFile(page, '<photo>[one].png'), 1);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'Description', exact: true });
  await description.fill('Before  after <img src=x onerror=alert(1)>');
  await description.evaluate(el => { el.focus(); el.setSelectionRange(7, 7); el.dispatchEvent(new Event('keyup', { bubbles: true })); });
  await page.getByRole('button', { name: 'Insert attached image', exact: true }).click();
  await page.locator('[data-act="insert-description-image"]').click();
  await expect(description).toHaveValue(/^Before !\[<photo> one .png\]\(attachment:[\w-]+\) after <img/);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.description-preview img')).toHaveCount(1);
  await page.locator('.description-preview img').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.description-preview img').evaluate(img => img.naturalWidth)).toBe(1600);
  await expect(page.locator('.description-preview')).toContainText('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await expect(page.locator('.description-view img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Attachment options for <photo>[one].png' }).click();
  await page.getByRole('menuitem', { name: 'Delete attachment', exact: true }).click();
  await page.locator('.app-dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.description-view')).toHaveText('Before  after <img src=x onerror=alert(1)>');
  await expect(page.locator('.description-view img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(1);
  await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
  await expect(page.locator('.description-view img')).toHaveCount(1);
});

test('mixed backups and copies remap description references while retaining exact compressed bytes', async ({ page }) => {
  await seed(page);
  await page.getByLabel('Add attachments from device').setInputFiles({
    name: 'data.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 255, 0, 99])
  });
  await attach(page, await imageFile(page), 2);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('button', { name: 'Insert attached image', exact: true }).click();
  await page.locator('[data-act="insert-description-image"]').click();
  const inserted = await page.getByRole('textbox', { name: 'Description', exact: true }).inputValue();
  const attachmentId = inserted.match(/attachment:([\w-]+)/)[1];
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(
    `${inserted}\n\n![Reference][photo]\n\n[photo]: attachment:${attachmentId}\n\n![Angle](<attachment:${attachmentId}> "Title")`
  );
  await page.getByRole('button', { name: 'Save description', exact: true }).click();
  await expect(page.locator('.description-view img')).toHaveCount(3);
  await page.locator('[data-act="dup-card"]').click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(4);
  const copies = await db(page, async store => {
    const cards = await store.db.cards.where('boardId').equals('board0').toArray();
    return Promise.all(cards.filter(card => card.imageIds?.length).map(async card => ({
      ...card, desc: (await store.db.cardDetails.get([card.boardId, card.id])).desc
    })));
  });
  expect(copies).toHaveLength(2);
  for (const card of copies) {
    expect(card.desc).toContain(`attachment:${card.coverImageId})`);
    expect(card.desc).toContain(`[photo]: attachment:${card.coverImageId}`);
    expect(card.desc).toContain(`<attachment:${card.coverImageId}>`);
  }
  expect(copies[0].coverImageId).not.toBe(copies[1].coverImageId);
  const result = await db(page, async store => {
    const backup = await store.exportBackup(['board0']);
    const parsed = await store.parseBackup(backup.blob);
    const originals = await store.db.images.where('boardId').equals('board0').toArray();
    return {
      bytes: [...new Uint8Array(await backup.blob.arrayBuffer())],
      exact: await Promise.all(parsed.images.map(async image => {
        const old = originals.find(item => item.id === image.id);
        const bytes = new Uint8Array(await image.blob.arrayBuffer());
        const oldBytes = new Uint8Array(await old.blob.arrayBuffer());
        return bytes.length === oldBytes.length && bytes.every((value, i) => value === oldBytes[i]);
      }))
    };
  });
  expect(result.exact.every(Boolean)).toBe(true);
  await page.locator('#import-file').setInputFiles({
    name: 'mixed.kanbaya', mimeType: 'application/octet-stream', buffer: Buffer.from(result.bytes)
  });
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(8);
  const imported = await db(page, async store => {
    const rows = await store.db.cards.toArray();
    const cards = rows.filter(card => card.boardId !== 'board0' && card.imageIds?.length);
    return Promise.all(cards.map(async card => ({
      cover: card.coverImageId, desc: (await store.db.cardDetails.get([card.boardId, card.id])).desc
    })));
  });
  for (const card of imported) {
    expect(card.desc).toContain(`attachment:${card.cover})`);
    expect(card.desc).toContain(`[photo]: attachment:${card.cover}`);
    expect(copies.some(copy => copy.coverImageId === card.cover)).toBe(false);
  }
  await page.locator('[data-act="board-menu"]').click();
  await page.locator('[data-act="dup-board"]').click();
  await expect.poll(() => db(page, store => store.db.images.count())).toBe(12);
  const boardCopies = await db(page, async store => {
    const board = (await store.db.boards.toArray()).find(board => board.name === 'Tablero 0 (copy)');
    const cards = await store.db.cards.where('boardId').equals(board.id).toArray();
    return Promise.all(cards.filter(card => card.imageIds?.length).map(async card => ({
      cover: card.coverImageId, desc: (await store.db.cardDetails.get([board.id, card.id])).desc
    })));
  });
  expect(boardCopies).toHaveLength(2);
  for (const card of boardCopies) {
    expect(card.desc).toContain(`attachment:${card.cover})`);
    expect(card.desc).toContain(`[photo]: attachment:${card.cover}`);
  }
});

test('compression and decompression failures are explicit and leave the app editable', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    window.originalCompressionStream = CompressionStream;
    window.CompressionStream = class { constructor() { throw new Error('Compression unavailable'); } };
  });
  await page.getByLabel('Add attachments from device').setInputFiles({
    name: 'failure.txt', mimeType: 'text/plain', buffer: Buffer.from('not saved')
  });
  await expect(page.locator('.toast')).toContainText('Compression unavailable');
  expect(await db(page, store => store.db.images.count())).toBe(0);
  await page.evaluate(() => { window.CompressionStream = window.originalCompressionStream; });
  await page.getByLabel('Add attachments from device').setInputFiles({
    name: 'damaged.txt', mimeType: 'text/plain', buffer: Buffer.from('original')
  });
  await expect(page.locator('.image-attachment')).toHaveCount(1);
  await db(page, async store => {
    const image = await store.db.images.toCollection().first();
    const blob = new Blob(['not gzip']);
    await store.db.images.put({ ...image, blob, size: blob.size });
  });
  await page.getByRole('button', { name: 'Attachment options for damaged.txt' }).click();
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Could not download attachment');
  await expect(page.locator('.storage-error')).toHaveCount(0);
  await page.getByLabel('Card title', { exact: true }).fill('Editable after failure');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.card')).toContainText(['Editable after failure', 'Tarea 2']);
});

test('rejects a file cover in backups before importing and blocks invalid persisted covers atomically', async ({ page }) => {
  await seed(page);
  await page.getByLabel('Add attachments from device').setInputFiles({
    name: 'file.txt', mimeType: 'text/plain', buffer: Buffer.from('file contents')
  });
  await expect(page.locator('.image-attachment')).toHaveCount(1);
  const invalid = await db(page, async store => {
    const state = await store.exportState();
    const image = await store.db.images.toCollection().first();
    state.boards[0].lists[0].cards.find(card => card.id === 'card0').coverImageId = image.id;
    const { blob, ...metadata } = image;
    const header = new TextEncoder().encode(JSON.stringify({ ...state, version: 4, images: [metadata] }));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, header.length, true);
    return [...new Uint8Array(await new Blob(['KANBAYA4', length, header, blob]).arrayBuffer())];
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#import-file').setInputFiles({
    name: 'invalid.kanbaya', mimeType: 'application/octet-stream', buffer: Buffer.from(invalid)
  });
  await expect(page.locator('.toast')).toContainText('not a valid Kanbaya backup');
  await expect(page.locator('.storage-error')).toHaveCount(0);
  expect(await db(page, store => store.db.images.count())).toBe(1);
  const result = await db(page, async store => {
    const state = await store.readState();
    await store.hydrate(state.boards[0]); store.adopt(state);
    const card = state.boards[0].lists[0].cards.find(card => card.id === 'card0');
    card.coverImageId = card.imageIds[0];
    const revision = store.revision;
    try { await store.commit(state); return { error: null }; }
    catch (error) {
      return {
        error: error.message,
        cover: (await store.db.cards.get(['board0', 'card0'])).coverImageId,
        revisionUnchanged: (await store.db.settings.get('revision')).value === revision
      };
    }
  });
  expect(result).toEqual({ error: 'Only an attached image can be a cover.', cover: null, revisionUnchanged: true });
});
