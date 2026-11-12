const { test, expect } = require('@playwright/test');
const { fixture, seed } = require('./fixtures');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function mockDrive(page, options = {}) {
  const calls = [];
  let uploaded = null, savedName = '';
  await page.route('https://accounts.google.com/gsi/client', route => {
    if (options.libraryFailure) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: `
      window.google = { accounts: { oauth2: { initTokenClient(config) {
        window.testOAuthConfig = { clientId: config.client_id, scope: config.scope, includeGranted: config.include_granted_scopes };
        return { requestAccessToken() { queueMicrotask(() => {
          ${options.cancel ? "config.error_callback({type:'popup_closed'});" : `config.callback({access_token:'drive-test-token',expires_in:3600,scope:${JSON.stringify(options.missingScope ? '' : SCOPE)}});`}
        }); } };
      } } } };
    ` });
  });
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-expose-headers': 'Location'
    };
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, headers: { ...headers, ...extra }, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push({ method: request.method(), url: url.href, authorization: request.headers().authorization, body: request.postDataBuffer() });
    if (options.apiStatus) return json({ error: { message: 'Test Drive refusal' } }, options.apiStatus);
    if (url.pathname === '/upload/drive/v3/files') {
      if (request.method() === 'POST') {
        const metadata = request.postDataJSON();
        savedName = metadata.name;
        return json({}, 200, { Location: options.unsafeLocation || 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test-session' });
      }
      uploaded = request.postDataBuffer();
      return json({ id: 'saved-backup', name: savedName });
    }
    if (url.pathname === '/drive/v3/files' && request.method() === 'POST') return json({ id: 'backup-folder' });
    if (url.pathname === '/drive/v3/files') {
      if (url.searchParams.get('q').includes('backup-folder')) return json({ files: [] });
      if (options.pagination && !url.searchParams.get('pageToken')) return json({ files: [{ id: 'first', name: 'First backup.json' }], nextPageToken: 'next-page' });
      return json({ files: [{ id: 'saved-backup', name: savedName || '<img src=x onerror=alert(1)>.json' }] });
    }
    if (url.pathname === '/drive/v3/files/saved-backup') {
      return route.fulfill({
        headers, contentType: 'application/octet-stream',
        body: options.invalidBackup ? Buffer.from('not a backup') : uploaded || Buffer.from(JSON.stringify(options.backup || fixture(4)))
      });
    }
    throw new Error('Unexpected mocked Drive request: ' + request.url());
  });
  return { calls, uploaded: () => uploaded };
}
async function openDrive(page, mode) {
  await page.getByRole('button', { name: 'Data menu', exact: true }).click();
  await page.getByRole('menuitem', { name: mode === 'save' ? 'Save backup to Google Drive…' : 'Import backup from Google Drive…', exact: true }).click();
  return page.getByRole('dialog', { name: mode === 'save' ? 'Save backup to Google Drive' : 'Import backup from Google Drive', exact: true });
}
async function connect(dialog) {
  await dialog.getByRole('button', { name: 'Connect / change Google account', exact: true }).click();
}
async function counts(page) {
  return page.evaluate(async () => {
    const store = new KanbayaStore();
    await store.db.open();
    try { return { boards: await store.db.boards.count(), images: await store.db.images.count() }; }
    finally { store.db.close(); }
  });
}

for (const withAttachment of [false, true]) {
  test(`Drive saves and merges identical .kanbaya backups ${withAttachment ? 'with' : 'without'} attachments without duplicating boards`, async ({ page }) => {
    const mock = await mockDrive(page);
    await seed(page, fixture(4));
    if (withAttachment) {
      await page.locator('.card').filter({ hasText: 'Tarea 0' }).click();
      await page.getByLabel('Add attachments from device').setInputFiles({
        name: 'data.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 255, 0, 99])
      });
      await expect(page.locator('.image-attachment')).toHaveCount(1);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
    }
    expect(mock.calls).toHaveLength(0);
    let dialog = await openDrive(page, 'save');
    if (!withAttachment) for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await dialog.evaluate(el => ({
        overflow: el.scrollWidth - el.clientWidth, left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right, viewport: innerWidth
      }));
      expect(bounds.overflow).toBeLessThanOrEqual(1);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    }
    await connect(dialog);
    const config = await page.evaluate(() => window.testOAuthConfig);
    expect(config).toEqual({ clientId: '54984532757-hr8smhh2lb9fctmcdc9obq26voqgv2ps.apps.googleusercontent.com', scope: SCOPE, includeGranted: false });
    await dialog.getByRole('button', { name: 'Save backup', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Backup saved in Google Drive');
    expect(mock.calls.every(call => call.authorization === 'Bearer drive-test-token')).toBe(true);
    const metadata = JSON.parse(mock.calls.find(call => call.method === 'POST' && call.url.includes('uploadType=resumable')).body.toString());
    expect(metadata.parents).toEqual(['backup-folder']);
    expect(metadata.name).toMatch(/\.kanbaya$/);
    expect(mock.uploaded().subarray(0, 8).toString()).toBe('KANBAYA4');
    const data = JSON.parse(mock.uploaded().subarray(12, 12 + mock.uploaded().readUInt32LE(8)).toString());
    expect(data.boards).toHaveLength(2);
    expect(data.images).toHaveLength(withAttachment ? 1 : 0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    dialog = await openDrive(page, 'import');
    await dialog.getByLabel('Backup', { exact: true }).selectOption('saved-backup');
    await dialog.getByRole('button', { name: 'Import backup', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Backup imported');
    await expect(page.getByRole('dialog', { name: /^Conflicts in / })).toHaveCount(0);
    expect(await counts(page)).toEqual({ boards: 2, images: withAttachment ? 1 : 0 });
    expect(await page.evaluate(async () => {
      const store = new KanbayaStore();
      await store.db.open();
      try { return await store.db.boards.toCollection().primaryKeys(); }
      finally { store.db.close(); }
    })).toEqual(['board0', 'board1']);
    if (withAttachment) {
      const attachments = await page.evaluate(async () => {
        const store = new KanbayaStore();
        await store.db.open();
        try {
          return await Promise.all((await store.db.images.toArray()).map(async image => ({
            id: image.id, bytes: [...new Uint8Array(await image.blob.arrayBuffer())]
          })));
        } finally { store.db.close(); }
      });
      expect(attachments).toEqual([{ id: data.images[0].id, bytes: [...mock.uploaded().subarray(12 + mock.uploaded().readUInt32LE(8))] }]);
    }
    expect(await page.evaluate(() => [localStorage, sessionStorage].some(storage => Object.values(storage).some(value => value.includes('drive-test-token'))))).toBe(false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Data menu', exact: true })).toBeFocused();
  });
}

for (const withAttachment of [false, true]) {
  test(`Drive saves only the selected board as a .kanbaya backup ${withAttachment ? 'with' : 'without'} attachments and restores it independently`, async ({ page }) => {
    const mock = await mockDrive(page);
    await seed(page, fixture(140));
    if (withAttachment) for (const index of [0, 1]) {
      await page.goto(`/app/#/b/board${index}`);
      await page.locator('.card').filter({ has: page.getByText(`Tarea ${index}`, { exact: true }) }).click();
      await page.getByLabel('Add attachments from device').setInputFiles({
        name: `board${index}.bin`, mimeType: 'application/octet-stream', buffer: Buffer.from(`Only board ${index}`)
      });
      await expect(page.locator('.image-attachment')).toHaveCount(1);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await page.goto('/app/#/b/board0');
    if (!withAttachment) await page.setViewportSize({ width: 320, height: 800 });
    await page.locator('[data-act="board-menu"]').click();
    await page.getByRole('button', { name: 'Save this board to Google Drive…', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Save this board to Google Drive', exact: true });
    await expect(dialog).toContainText('Tablero 0');
    await expect(dialog).toContainText('Other boards and personal templates are not included.');
    await connect(dialog);
    for (let save = 0; save < 2; save++) {
      await dialog.getByRole('button', { name: 'Save backup', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText('Backup saved in Google Drive');
    }
    const uploads = mock.calls.filter(call => call.method === 'POST' && call.url.includes('uploadType=resumable'));
    expect(uploads).toHaveLength(2);
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false);
    for (const call of uploads) {
      const { name } = JSON.parse(call.body.toString());
      expect(name).toMatch(/^kanbaya-Tablero_0-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\./);
      expect(name.endsWith('.kanbaya')).toBe(true);
    }
    const bytes = mock.uploaded();
    expect(bytes.subarray(0, 8).toString()).toBe('KANBAYA4');
    const data = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString());
    expect(data.boards.map(board => board.id)).toEqual(['board0']);
    expect(data.templates).toBeUndefined();
    const cards = data.boards[0].lists.flatMap(list => list.cards);
    expect(cards).toHaveLength(70);
    expect(cards.find(card => card.id === 'card138').desc).toBe('aguja-remota');
    expect(data.images).toHaveLength(withAttachment ? 1 : 0);
    if (withAttachment) {
      expect(data.images).toHaveLength(1);
      expect(data.images[0]).toMatchObject({ boardId: 'board0', cardId: 'card0', name: 'board0.bin' });
    }
    expect(await counts(page)).toEqual({ boards: 2, images: withAttachment ? 2 : 0 });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('[data-act="board-menu"]')).toBeFocused();
    await page.locator('[data-act="board-menu"]').click();
    await page.locator('[data-act="del-board"]').click();
    await page.locator('.app-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => counts(page)).toEqual({ boards: 1, images: withAttachment ? 1 : 0 });
    dialog = await openDrive(page, 'import');
    await expect(dialog).toContainText('Import merges boards with matching IDs');
    await dialog.getByLabel('Backup', { exact: true }).selectOption('saved-backup');
    await dialog.getByRole('button', { name: 'Import backup', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Backup imported');
    expect(await counts(page)).toEqual({ boards: 2, images: withAttachment ? 2 : 0 });
    const restored = await page.evaluate(async () => {
      const store = new KanbayaStore();
      await store.db.open();
      try {
        const board = await store.db.boards.get('board0');
        return {
          id: board.id,
          name: board.name,
          cards: await store.db.cards.where('boardId').equals(board.id).primaryKeys(),
          attachments: await store.db.images.where('boardId').equals(board.id).primaryKeys()
        };
      } finally { store.db.close(); }
    });
    expect(restored.id).toBe('board0');
    expect(restored.name).toBe('Tablero 0');
    expect(restored.cards.map(key => key[1]).sort()).toEqual(cards.map(card => card.id).sort());
    expect(restored.attachments).toEqual(data.images.map(image => image.id));
  });
}

for (const choice of ['Keep local version', 'Use backup version', 'Cancel import']) {
  test(`Drive resolves differing boards with "${choice}" without duplicating IDs`, async ({ page }) => {
    const local = fixture(4), backup = fixture(4);
    local.boards[0].lists[0].cards[0].title = 'Local title';
    const remoteCard = structuredClone(backup.boards[0].lists[0].cards[0]);
    remoteCard.id = 'remote-card';
    remoteCard.title = 'Backup-only card';
    backup.boards[0].lists[0].cards.push(remoteCard);
    const localCard = structuredClone(local.boards[0].lists[0].cards[0]);
    localCard.id = 'local-card';
    localCard.title = 'Local-only card';
    local.boards[0].lists[0].cards.push(localCard);
    await mockDrive(page, { backup });
    await seed(page, local);
    await expect(page.getByRole('button', { name: 'Data menu', exact: true })).toBeVisible();
    const before = await page.evaluate(async () => {
      const store = new KanbayaStore();
      try { return await store.exportState(); } finally { store.db.close(); }
    });
    const dialog = await openDrive(page, 'import');
    await connect(dialog);
    await dialog.getByLabel('Backup', { exact: true }).selectOption('saved-backup');
    await dialog.getByRole('button', { name: 'Import backup', exact: true }).click();
    const conflict = page.getByRole('dialog', { name: 'Conflicts in Tablero 0', exact: true });
    await expect(conflict).toBeVisible();
    for (const name of ['Keep local version', 'Use backup version', 'Cancel import']) {
      await expect(conflict.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await conflict.getByRole('button', { name: choice, exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(choice === 'Cancel import' ? 'Import cancelled' : 'Backup imported');
    const after = await page.evaluate(async () => {
      const store = new KanbayaStore();
      try { return await store.exportState(); } finally { store.db.close(); }
    });
    if (choice === 'Cancel import') expect(after).toEqual(before);
    else {
      expect(after.boards.map(board => board.id)).toEqual(['board0', 'board1']);
      const cards = after.boards[0].lists.flatMap(list => list.cards);
      expect(cards.find(card => card.id === 'card0').title).toBe(choice === 'Keep local version' ? 'Local title' : 'Tarea 0');
      expect(cards.map(card => card.id).sort()).toEqual(['card0', 'card2', 'local-card', 'remote-card']);
    }
    expect(await counts(page)).toEqual({ boards: 2, images: 0 });
  });
}

test('Drive import lists all pages safely and rejects an invalid backup without changing local data', async ({ page }) => {
  const mock = await mockDrive(page, { pagination: true, invalidBackup: true });
  await seed(page, fixture(4));
  const dialog = await openDrive(page, 'import');
  await connect(dialog);
  await expect(dialog.getByLabel('Backup', { exact: true }).locator('option')).toHaveCount(3);
  expect(mock.calls.some(call => new URL(call.url).searchParams.get('pageToken') === 'next-page')).toBe(true);
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.getByLabel('Backup', { exact: true }).selectOption('saved-backup');
  await dialog.getByRole('button', { name: 'Import backup', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await counts(page)).toEqual({ boards: 2, images: 0 });
});

for (const option of [{ cancel: true }, { missingScope: true }]) {
  test(`Google authorization ${option.cancel ? 'cancellation' : 'missing permission'} does not access Drive`, async ({ page }) => {
    const mock = await mockDrive(page, option);
    await seed(page, fixture(4));
    const dialog = await openDrive(page, 'save');
    await connect(dialog);
    await expect(dialog.getByRole('alert')).toContainText(option.cancel ? 'cancelled' : 'permission was not granted');
    await expect(dialog.getByRole('button', { name: 'Save backup', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
    expect(mock.calls).toHaveLength(0);
  });
}

for (const apiStatus of [401, 403]) {
  test(`Drive HTTP ${apiStatus} is explicit and leaves local data editable`, async ({ page }) => {
    await mockDrive(page, { apiStatus });
    await seed(page, fixture(4));
    const dialog = await openDrive(page, 'save');
    await connect(dialog);
    await dialog.getByRole('button', { name: 'Save backup', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(apiStatus === 401 ? 'Connect again' : 'HTTP 403');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.storage-error')).toHaveCount(0);
    await page.locator('.card').first().click();
    await page.getByLabel('Priority', { exact: true }).selectOption('high');
    await expect(page.getByLabel('Priority', { exact: true })).toHaveValue('high');
    expect(await counts(page)).toEqual({ boards: 2, images: 0 });
  });
}

test('Drive never sends a token or backup to an unexpected upload address', async ({ page }) => {
  const mock = await mockDrive(page, { unsafeLocation: 'https://unexpected.example/upload' });
  let externalRequests = 0;
  await page.route('https://unexpected.example/**', route => { externalRequests++; return route.abort(); });
  await seed(page, fixture(4));
  const dialog = await openDrive(page, 'save');
  await connect(dialog);
  await dialog.getByRole('button', { name: 'Save backup', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('unexpected upload address');
  expect(externalRequests).toBe(0);
  expect(mock.uploaded()).toBeNull();
});

test('offline Drive and a failed Google script show errors while local import remains available', async ({ page, context }) => {
  await mockDrive(page, { libraryFailure: true });
  await seed(page, fixture(4));
  let dialog = await openDrive(page, 'save');
  await expect(dialog.getByRole('alert')).toContainText('Could not load Google sign-in');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  dialog = await openDrive(page, 'import');
  await expect(dialog.getByRole('alert')).toContainText('Internet connection');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#import-file').setInputFiles({ name: 'local.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(4))) });
  await expect(page.locator('.toast')).toContainText('imported');
  await expect(page.getByRole('dialog', { name: /^Conflicts in / })).toHaveCount(0);
  expect(await counts(page)).toEqual({ boards: 2, images: 0 });
});
