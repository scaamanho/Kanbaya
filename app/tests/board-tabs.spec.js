const { test, expect } = require('@playwright/test');
const { fixture, seed } = require('./fixtures');

function boards(count) {
  const data = fixture(4);
  while (data.boards.length < count) {
    const n = data.boards.length;
    const board = structuredClone(data.boards[0]);
    board.id = `board${n}`;
    board.name = `Tablero ${n}`;
    data.boards.push(board);
  }
  return data;
}

async function openFromMenu(page, name) {
  await page.getByRole('button', { name: 'Boards ▾' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(page.locator('.board-title')).toHaveValue(name);
}

test('tabs share the top bar between Create and storage at desktop and mobile widths', async ({ page }) => {
  await seed(page, boards(3));
  await openFromMenu(page, 'Tablero 1');
  for (const install of [false, true]) {
    await page.evaluate(available => {
      window.kanbayaInstallAvailable = available;
      window.dispatchEvent(new Event('kanbaya-install-change'));
    }, install);
    for (const width of [1280, 701, 700, 521, 520, 441, 440, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await page.locator('.topbar').evaluate(header => {
        const elements = [...header.children].map(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, center: (rect.top + rect.bottom) / 2 };
        });
        const create = header.querySelector('[data-act="new-board"]').getBoundingClientRect();
        const tabs = header.querySelector('.board-tabs').getBoundingClientRect();
        const storage = header.querySelector('.storage-meter').getBoundingClientRect();
        return { elements, createRight: create.right, tabsLeft: tabs.left, tabsRight: tabs.right, storageLeft: storage.left };
      });
      expect(layout.tabsLeft).toBeGreaterThanOrEqual(layout.createRight);
      expect(layout.tabsRight).toBeLessThanOrEqual(layout.storageLeft);
      for (let i = 0; i < layout.elements.length; i++) {
        const item = layout.elements[i];
        expect(Math.abs(item.center - layout.elements[0].center), `width=${width}, install=${install}, layout=${JSON.stringify(layout)}`).toBeLessThanOrEqual(1);
        expect(item.right).toBeLessThanOrEqual(width);
        if (i) expect(item.left).toBeGreaterThanOrEqual(layout.elements[i - 1].right);
      }
      await page.getByRole('button', { name: 'Show open boards' }).click();
      await expect(page.getByRole('menuitem', { name: 'Tablero 0', exact: true })).toBeVisible();
      if (width === 320 && install) {
        await page.getByRole('menuitem', { name: 'Tablero 0', exact: true }).click();
        await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
        await page.getByRole('button', { name: 'Close Tablero 0 tab' }).click();
        await expect(page.locator('.board-title')).toHaveValue('Tablero 1');
      } else {
        await page.keyboard.press('Escape');
      }
    }
  }
});

test('open tabs persist, switch without duplicates and close without deleting boards', async ({ page }) => {
  await seed(page, boards(3));
  const tabs = page.getByRole('navigation', { name: 'Open boards' });
  await expect(tabs.getByRole('link', { name: 'Tablero 0' })).toHaveAttribute('aria-current', 'page');
  await openFromMenu(page, 'Tablero 1');
  await openFromMenu(page, 'Tablero 2');
  await tabs.getByRole('link', { name: 'Tablero 1' }).click();
  await expect(page.locator('.board-title')).toHaveValue('Tablero 1');
  await openFromMenu(page, 'Tablero 1');
  await expect(tabs.locator('.board-tab')).toHaveCount(3);

  await page.reload();
  await expect(tabs.locator('.board-tab')).toHaveCount(3);
  await expect(tabs.getByRole('link', { name: 'Tablero 1' })).toHaveAttribute('aria-current', 'page');
  const secondWindow = await page.context().newPage();
  await secondWindow.goto('/app/#/');
  await expect(secondWindow.getByRole('navigation', { name: 'Open boards' }).locator('.board-tab')).toHaveCount(3);
  await secondWindow.close();
  await tabs.getByRole('button', { name: 'Close Tablero 1 tab' }).click();
  await expect(page.locator('.board-title')).toHaveValue('Tablero 2');
  await tabs.getByRole('button', { name: 'Close Tablero 2 tab' }).click();
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  await tabs.getByRole('button', { name: 'Close Tablero 0 tab' }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await expect(tabs).toHaveCount(0);
  await page.reload();
  await expect(tabs).toHaveCount(0);
  await openFromMenu(page, 'Tablero 1');
  await expect(tabs.locator('.board-tab')).toHaveCount(1);
});

test('tab titles follow renames and an inactive tab can be closed from home', async ({ page }) => {
  await seed(page, boards(2));
  await openFromMenu(page, 'Tablero 1');
  const name = 'Board <special> & renamed';
  await page.getByLabel('Board name').fill(name);
  await page.getByLabel('Board name').blur();
  const tabs = page.getByRole('navigation', { name: 'Open boards' });
  await expect(tabs.getByRole('link', { name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await tabs.getByRole('button', { name: `Close ${name} tab` }).click();
  await expect(tabs.locator('.board-tab')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await page.reload();
  await expect(tabs.locator('.board-tab')).toHaveCount(1);
  await openFromMenu(page, name);
});

test('creating a board opens its tab and scrolls it into view', async ({ page }) => {
  await seed(page, boards(8));
  await page.setViewportSize({ width: 320, height: 800 });
  for (let i = 1; i < 8; i++) await openFromMenu(page, `Tablero ${i}`);
  await page.getByRole('button', { name: '＋ Create' }).click();
  await page.locator('.nb-name').fill('New project');
  await page.locator('[data-act="create-board"]').click();
  const active = page.locator('.board-tab.active');
  await expect(active.getByRole('link')).toHaveText('New project');
  await expect.poll(() => active.evaluate(el => {
    const item = el.getBoundingClientRect(), container = el.parentElement.getBoundingClientRect();
    return item.left >= container.left - 1 && item.right <= container.right + 1;
  })).toBe(true);
  await page.reload();
  await expect(page.locator('.board-tab.active a')).toHaveText('New project');
});

test('removes a tab when its board is deleted in another browser tab', async ({ page }) => {
  await seed(page, boards(2));
  await openFromMenu(page, 'Tablero 1');
  await page.locator('.board-tab a[href="#/b/board0"]').click();
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  const other = await page.context().newPage();
  await other.goto('/app/#/b/board1');
  await expect(other.locator('.board-title')).toHaveValue('Tablero 1');
  await expect(page.locator('[data-act="close-board-tab"][data-id="board1"]')).toHaveCount(1);
  await other.locator('[data-act="board-menu"]').click();
  await other.getByRole('button', { name: '🗑 Delete board' }).click();
  await other.getByRole('dialog').filter({ hasText: 'Delete the board' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('[data-act="close-board-tab"][data-id="board1"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-act="close-board-tab"][data-id="board1"]')).toHaveCount(0);
  await other.close();
});

test('closing or navigating away protects description drafts', async ({ page }) => {
  await seed(page, boards(2));
  await openFromMenu(page, 'Tablero 1');
  await page.locator('.card').filter({ hasText: 'Tarea 1' }).click();
  await page.getByRole('button', { name: 'Edit description' }).click();
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Unsaved draft');

  await page.locator('[data-act="close-board-tab"][data-id="board1"]').dispatchEvent('click');
  const confirmation = page.getByRole('dialog').filter({ hasText: 'Discard unsaved description changes?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Unsaved draft');
  await expect(page.locator('[data-act="close-board-tab"][data-id="board1"]')).toHaveCount(1);
  await expect(page).toHaveURL(/#\/b\/board1$/);

  await page.evaluate(() => { location.hash = '#/b/board0'; });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/#\/b\/board1$/);
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Unsaved draft');
  await page.locator('[data-act="close-board-tab"][data-id="board1"]').dispatchEvent('click');
  await confirmation.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
  await expect(page.locator('[data-act="close-board-tab"][data-id="board1"]')).toHaveCount(0);
});

test('overflow menu reaches hidden boards and deleted boards disappear', async ({ page }) => {
  await seed(page, boards(12));
  for (let i = 1; i < 12; i++) await openFromMenu(page, `Tablero ${i}`);
  const tabs = page.getByRole('navigation', { name: 'Open boards' });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const bounds = await tabs.evaluate(el => {
      const strip = el.querySelector('.board-tabs-scroll');
      return { overflow: strip.scrollWidth > strip.clientWidth, overflowX: getComputedStyle(strip).overflowX,
        right: el.getBoundingClientRect().right, width: innerWidth };
    });
    expect(bounds.overflow).toBe(true);
    expect(bounds.overflowX).toBe('hidden');
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    await tabs.getByRole('button', { name: 'Show open boards' }).click();
    await page.getByRole('menuitem', { name: 'Tablero 0', exact: true }).click();
    await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
    await expect(tabs.getByRole('link', { name: 'Tablero 0' })).toBeInViewport();
    await tabs.getByRole('button', { name: 'Show open boards' }).click();
    await page.getByRole('menuitem', { name: 'Tablero 11', exact: true }).click();
    await expect(page.locator('.board-title')).toHaveValue('Tablero 11');
    await expect(tabs.getByRole('link', { name: 'Tablero 11' })).toBeInViewport();
  }
  await page.locator('[data-act="board-menu"]').click();
  await page.getByRole('button', { name: '🗑 Delete board' }).click();
  const confirmation = page.getByRole('dialog').filter({ hasText: 'Delete the board' });
  await confirmation.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Tablero 11' })).toHaveCount(0);
  await page.reload();
  await expect(tabs.locator('.board-tab')).toHaveCount(11);
});

test('dropdown closes hidden inactive tabs without opening them and closes the active tab', async ({ page }) => {
  await seed(page, boards(12));
  for (let i = 1; i < 12; i++) await openFromMenu(page, `Tablero ${i}`);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: 'Show open boards' }).click();
  const menu = page.getByRole('menu');
  for (const id of [0, 1]) {
    await menu.getByRole('menuitem', { name: `Close Tablero ${id} tab`, exact: true }).click();
    await expect(page.locator('.board-title')).toHaveValue('Tablero 11');
    await expect(page).toHaveURL(/#\/b\/board11$/);
    await expect(menu.getByRole('menuitem', { name: `Tablero ${id}`, exact: true })).toHaveCount(0);
    await expect(page.locator(`.board-tab a[href="#/b/board${id}"]`)).toHaveCount(0);
  }
  await menu.getByRole('menuitem', { name: 'Close Tablero 11 tab', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.board-title')).toHaveValue('Tablero 10');
  await page.reload();
  await expect(page.locator('.board-tab')).toHaveCount(9);
  await openFromMenu(page, 'Tablero 0');
});
