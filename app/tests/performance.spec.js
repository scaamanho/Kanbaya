const { test, expect } = require('@playwright/test');
const { fixture } = require('./fixtures');
test('records warm performance and bounded DOM with 10000 cards', async ({ page, context }) => {
  test.setTimeout(120000);
  await page.addInitScript(data => {
    if (!sessionStorage.getItem('fixture')) {
      localStorage.setItem('kanbaya-pwa:v1', JSON.stringify(data));
      sessionStorage.setItem('fixture', 'yes');
    }
    window.detailReads = 0;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'cardDetails') window.detailReads++;
      return get.apply(this, args);
    };
  }, fixture());
  await page.goto('/app/#/b/board0');
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 60000 });
  const cdp = await context.newCDPSession(page);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await page.reload();
    await expect(page.locator('.card').first()).toBeVisible();
    const startup = Date.now() - start;
    expect(await page.evaluate(() => window.detailReads)).toBe(0);
    const list = page.locator('[data-virtual-list="list0"]');
    const beforeScroll = Date.now();
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    await expect(list.locator('.card').last()).toContainText('Tarea 9998');
    const scroll = Date.now() - beforeScroll;
    expect(await list.locator('.card').count()).toBeLessThanOrEqual(60);
    const open = Date.now();
    await list.locator('.card').last().click();
    await expect(page.locator('.description-view')).toHaveText(i ? `Medición ${i - 1}` : 'aguja-remota');
    const detail = Date.now() - open;
    expect(await page.evaluate(() => window.detailReads)).toBe(1);
    const edit = Date.now();
    await page.getByRole('button', { name: 'Edit description', exact: true }).click();
    await page.locator('[data-f="desc"]').fill(`Medición ${i}`);
    await page.getByRole('button', { name: 'Save description', exact: true }).click();
    await page.evaluate(() => window.kambayaFlush());
    const commit = Date.now() - edit;
    await page.keyboard.press('Escape');
    await page.locator('[data-act="toggle-filters"]').click();
    const searchStart = Date.now();
    await page.locator('.filter-keyword').fill(`Medición ${i}`);
    await expect(page.locator('.card')).toHaveCount(1);
    const search = Date.now() - searchStart;
    await page.locator('[data-act="clear-filters"]').click();
    await page.locator('[data-act="close-filters"]').first().click();
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    samples.push({ startup, scroll, detail, commit, search, heapMiB: Math.round(heap.usedSize / 1048576 * 10) / 10 });
  }
  const summary = Object.fromEntries(Object.keys(samples[0]).map(key => {
    const values = samples.map(s => s[key]).sort((a, b) => a - b);
    return [key, { median: values[2], p95: values[4] }];
  }));
  console.log('Warm Chromium, 1280x800, 10k cards. Milliseconds except heapMiB:', JSON.stringify(summary));
});
