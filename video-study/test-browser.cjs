const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readFileSync } = fs;
const path = require('node:path');

(async () => {
  const report = process.argv[2];
  assert.ok(report, 'Pass the generated local review.html path');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const studyRoot = path.dirname(path.dirname(path.resolve(report)));
    // Use in-process HTTP routing: managed Chromium disables file://. No external
    // server or network request is involved; range reads keep large media bounded.
    await page.route('http://study.test/**', async route => {
      const name = path.resolve(studyRoot, '.' + decodeURIComponent(new URL(route.request().url()).pathname));
      if (!name.startsWith(studyRoot + path.sep)) return route.fulfill({ status: 403, body: 'Invalid path' });
      if (!fs.existsSync(name) || !fs.statSync(name).isFile()) return route.fulfill({ status: 404, body: 'Not found' });
      const type = { '.mp4': 'video/mp4', '.html': 'text/html', '.jpg': 'image/jpeg', '.json': 'application/json' }[path.extname(name)] || 'application/octet-stream';
      const size = fs.statSync(name).size;
      const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
      if (match) {
        const start = Number(match[1]);
        if (start >= size) return route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        const end = Math.min(match[2] ? Number(match[2]) : start + 4*1024*1024-1, size-1);
        const body = Buffer.alloc(end-start+1), file = fs.openSync(name, 'r');
        try { fs.readSync(file, body, 0, body.length, start); } finally { fs.closeSync(file); }
        return route.fulfill({ status: 206, contentType: type, headers: { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }, body });
      }
      return route.fulfill({ contentType: type, body: readFileSync(name) });
    });
    await page.goto('http://study.test/' + path.relative(studyRoot, path.resolve(report)).split(path.sep).join('/'));
    await page.waitForFunction(() => document.querySelector('video').readyState >= 1);
    const initial = await page.locator('#segments article').count();
    assert.ok(initial > 1, 'Expected annotated real media');
    await page.locator('#segments article').first().locator('.evidence button').last().click();
    await page.waitForFunction(() => !document.querySelector('video').seeking);
    const before = await page.locator('video').evaluate(v => v.currentTime);
    await page.click('#next');
    await page.waitForFunction(() => !document.querySelector('video').seeking);
    const after = await page.locator('video').evaluate(v => v.currentTime);
    assert.ok(Math.abs(after - before - 1/30) < .005);
    await page.click('#mark');
    await page.fill('#note', '<img src=x onerror=alert(1)> test observation');
    await page.click('#save-note');
    const downloadEvent = page.waitForEvent('download');
    await page.click('#download');
    const download = await downloadEvent;
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.reviewNotes.at(-1).description, '<img src=x onerror=alert(1)> test observation');
    const wrongPart = structuredClone(exported); wrongPart.source.page = 1;
    await page.setInputFiles('#study-file', { name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrongPart)) });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('载入失败'));
    assert.equal(await page.locator('#segments article').count(), initial);
    await page.setInputFiles('#study-file', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('载入失败'));
    const untrusted = structuredClone(exported);
    untrusted.segments[0].title = '<img src=x onerror=alert(1)>';
    await page.setInputFiles('#study-file', { name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(untrusted)) });
    await page.waitForFunction(() => document.querySelector('#status').textContent === '已载入标注。');
    assert.equal(await page.locator('#segments img').count(), 0);
    assert.match(await page.locator('#segments article').first().textContent(), /<img/);
    // Restore the review title before taking the deliverable screenshot.
    await page.setInputFiles('#study-file', { name: 'study.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.waitForFunction(() => !document.querySelector('#segments article').textContent.includes('<img'));
    await page.screenshot({ path: path.join(path.dirname(path.resolve(report)), 'review-preview.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const gallery = await page.locator('#clips a').first().getAttribute('href');
    await page.goto(new URL(gallery, page.url()).href);
    await page.waitForFunction(() => document.querySelector('#frame').naturalWidth === 1920);
    const frameBefore = await page.locator('#frame').getAttribute('src');
    await page.click('#next');
    await page.waitForFunction(() => document.querySelector('#index').value === '1');
    assert.notEqual(await page.locator('#frame').getAttribute('src'), frameBefore);
    assert.deepEqual(errors, []);
    console.log('PASS real local video, timestamp seek/frame step, note export, wrong-part/malformed import retention, safe text, mobile layout, full-resolution frame gallery; no page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
