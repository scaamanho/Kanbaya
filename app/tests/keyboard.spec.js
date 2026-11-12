const { test, expect } = require('@playwright/test');
const { fixture, seed: seedDatabase } = require('./fixtures');

async function seed(page, data = fixture(8)) {
  await seedDatabase(page, data);
  await page.goto('/app/#/b/board0');
  await expect(page.locator('.board-title')).toHaveValue('Tablero 0');
}

test('view buttons select their named view directly and indicate the active view', async ({ page }) => {
  await seed(page);
  const views = [
    { name: 'Board', content: '.lists' },
    { name: 'Calendar', content: '.calendar' },
    { name: 'Timeline', content: '.timeline' }
  ];
  for (const sequence of [views, [views[0], views[2], views[1]], [views[2], views[0], views[1]]]) {
    for (const selected of sequence) {
      await page.getByRole('button', { name: selected.name, exact: true }).click();
      await expect(page.locator(selected.content)).toBeVisible();
      for (const view of views) {
        await expect(page.getByRole('button', { name: view.name, exact: true })).toHaveAttribute('aria-pressed', String(view === selected));
      }
      await page.getByRole('button', { name: selected.name, exact: true }).click();
      await expect(page.locator(selected.content)).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  for (const view of views) await expect(page.getByRole('button', { name: view.name, exact: true })).toBeVisible();
});

test('board shortcuts search, filter, switch views and show the responsive guide', async ({ page }) => {
  await seed(page);
  await page.locator('body').press('/');
  await expect(page.getByRole('searchbox', { name: 'Keyword', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await expect(page.locator('.filter-panel')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Keyword', exact: true })).toBeFocused();
  await page.locator('[data-act="toggle-filters"]').focus();
  await page.keyboard.press('f');
  await expect(page.locator('.filter-panel')).toHaveCount(0);
  await page.keyboard.press('v');
  await expect(page.locator('.calendar')).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.locator('.lists')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts', exact: true })).toBeVisible();
  const guide = page.locator('.keyboard-shortcuts');
  for (const key of ['N', 'L', '/', 'F', 'V', 'M']) {
    await expect(guide.locator('kbd').filter({ hasText: new RegExp(`^${key}$`) })).toHaveCount(1);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await guide.scrollIntoViewIfNeeded();
  expect(await guide.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test('creation shortcuts use the focused list, expand collapsed lists and persist cards', async ({ page }) => {
  await seed(page);
  const destination = page.locator('.list[data-id="empty0"]');
  await destination.getByRole('button', { name: 'List actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Collapse list', exact: true }).click();
  await expect(destination).toHaveClass(/is-collapsed/);
  await destination.getByRole('button', { name: 'Expand Destino', exact: true }).focus();
  await page.keyboard.press('n');
  await expect(destination).not.toHaveClass(/is-collapsed/);
  const title = destination.getByRole('textbox', { name: 'Card title', exact: true });
  await expect(title).toBeFocused();
  await title.fill('Keyboard card');
  await title.press('Enter');
  await expect(destination.locator('.card')).toContainText('Keyboard card');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  const listName = page.getByRole('textbox', { name: 'List name', exact: true });
  await expect(listName).toBeFocused();
  await listName.fill('Keyboard list');
  await listName.press('Enter');
  await expect(page.locator('.list-title').filter({ hasText: 'Keyboard list' })).toBeVisible();
  await page.reload();
  await expect(destination.locator('.card')).toContainText('Keyboard card');
  await expect(page.locator('.list-title').filter({ hasText: 'Keyboard list' })).toBeVisible();
});

test('shortcuts leave typing, modifiers, IME composition and dialogs alone', async ({ page }) => {
  await seed(page);
  const name = page.getByRole('textbox', { name: 'Board name', exact: true });
  await name.fill('');
  await name.pressSequentially('nlfvm/');
  await expect(name).toHaveValue('nlfvm/');
  await expect(page.locator('.composer, .add-list.open, .filter-panel, .calendar, .overlay')).toHaveCount(0);
  await page.locator('body').press('Control+m');
  await page.locator('body').press('Alt+n');
  await page.locator('body').evaluate(el => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', isComposing: true, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', repeat: true, bubbles: true }));
  });
  await expect(page.locator('.composer, .overlay')).toHaveCount(0);
  await page.locator('.card').first().click();
  await page.keyboard.press('n');
  await page.keyboard.press('v');
  await expect(page.locator('.description-view')).toBeVisible();
  await expect(page.locator('.composer, .calendar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'Description', exact: true });
  await description.fill('nlfvm/');
  await description.press('Control+Enter');
  await expect(page.locator('.description-view')).toHaveText('nlfvm/');
  await page.reload();
  await page.locator('.card').first().click();
  await expect(page.locator('.description-view')).toHaveText('nlfvm/');
});

test('new-card shortcut handles an empty board and creation stays disabled in calendar view', async ({ page }) => {
  const data = fixture(0);
  data.boards[0].lists = [];
  await seed(page, data);
  await page.locator('body').press('n');
  await expect(page.locator('.toast')).toContainText('Create a list before adding a card.');
  await page.keyboard.press('v');
  await expect(page.locator('.calendar')).toBeVisible();
  await page.keyboard.press('n');
  await page.keyboard.press('l');
  await expect(page.locator('.composer, .add-list.open')).toHaveCount(0);
  await page.keyboard.press('v');
  await page.keyboard.press('l');
  await expect(page.getByRole('textbox', { name: 'List name', exact: true })).toBeFocused();
});
