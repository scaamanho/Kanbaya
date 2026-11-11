const { test, expect } = require('@playwright/test');

for (const width of [1280, 390, 320]) {
  test(`product page works at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/project/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Less noise.More progress.');
    await expect(page.getByRole('link', { name: /Get started with Kanbaya/ })).toHaveAttribute('href', 'app/');
    for (const image of await page.locator('main img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
      const ratioError = await image.evaluate(el => Math.abs(el.clientWidth / el.clientHeight - el.naturalWidth / el.naturalHeight));
      expect(ratioError).toBeLessThan(0.03);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('link', { name: /Get started with Kanbaya/ }).click();
    await expect(page).toHaveURL(/\/project\/app\/$/);
    await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  });
}

for (const width of [1280, 390]) {
  test(`full screenshots open and close at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/project/');
    const links = page.locator('[data-screenshot]');
    await expect(links).toHaveCount(5);

    for (const [index, link] of (await links.all()).entries()) {
      const source = await link.getAttribute('href');
      const description = await link.locator('img').getAttribute('alt');
      if (index === 0) {
        await link.focus();
        await page.keyboard.press('Enter');
      } else {
        await link.click();
      }
      const viewer = page.getByRole('dialog', { name: description });
      await expect(viewer).toBeVisible();
      const image = viewer.getByRole('img', { name: description });
      await expect(image).toHaveAttribute('src', new RegExp(`${source.replace('.', '\\.')}$`));
      await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
      const bounds = await image.boundingBox();
      expect(bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height).toBeLessThanOrEqual(800);
      const ratioError = await image.evaluate(el => Math.abs(el.clientWidth / el.clientHeight - el.naturalWidth / el.naturalHeight));
      expect(ratioError).toBeLessThan(0.03);
      await page.keyboard.press('Escape');
      await expect(viewer).not.toBeVisible();
      await expect(link).toBeFocused();
    }

    await links.last().click();
    const viewer = page.getByRole('dialog');
    await viewer.getByRole('button', { name: 'Close image viewer' }).click();
    await expect(viewer).not.toBeVisible();
    await expect(links.last()).toBeFocused();
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('screenshot links still open the full image', async ({ page }) => {
    await page.goto('/project/');
    await page.getByRole('link', { name: /View full screenshot: Board statistics/ }).click();
    await expect(page).toHaveURL(/\/project\/assets\/board_statistics\.png$/);
  });
});

test('install link opens the app with an installation banner and browser instructions', async ({ page }) => {
  await page.goto('/project/');
  await page.getByRole('link', { name: 'Install Kanbaya' }).click();
  await expect(page).toHaveURL(/\/project\/app\/\?install=1$/);
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  const banner = page.getByRole('region', { name: 'Install Kanbaya' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(banner).toContainText('Add to Home Screen');
  await banner.getByRole('button', { name: 'Dismiss install banner' }).click();
  await expect(banner).not.toBeVisible();
  await page.goto('/project/app/');
  await expect(banner).not.toBeVisible();
});

test('the app install banner invokes an available browser prompt', async ({ page }) => {
  await page.goto('/project/app/?install=1');
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await page.evaluate(() => {
    window.installCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { window.installCalls++; return { outcome: 'accepted' }; };
    window.dispatchEvent(event);
  });
  const banner = page.getByRole('region', { name: 'Install Kanbaya' });
  await expect(page.getByRole('button', { name: '⬇ Install' })).toBeVisible();
  await banner.getByRole('button', { name: 'Install', exact: true }).click();
  expect(await page.evaluate(() => window.installCalls)).toBe(1);
  await expect(banner).not.toBeVisible();
  await expect(page.getByRole('button', { name: '⬇ Install' })).toHaveCount(0);
});

test('captures an install prompt before the app scripts finish loading', async ({ page }) => {
  await page.addInitScript(() => {
    const append = Element.prototype.append;
    Element.prototype.append = function (...nodes) {
      if (this === document.head && nodes.some(node => node instanceof HTMLScriptElement && node.src.includes('/scripts/app.js'))) {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => ({ outcome: 'dismissed' });
        window.dispatchEvent(event);
      }
      return append.apply(this, nodes);
    };
  });
  await page.goto('/project/app/');
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await expect(page.getByRole('button', { name: '⬇ Install' })).toBeVisible();
  await page.getByRole('button', { name: '⬇ Install' }).click();
  await expect(page.getByRole('button', { name: '⬇ Install' })).toHaveCount(0);
});
