// ทดสอบงานหลักด้วย Playwright: node tests/smoke.mjs  (ต้องมี playwright ติดตั้งไว้)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
// เสิร์ฟภายใต้ sub-path /boss-pos/ เหมือน GitHub Pages เพื่อพิสูจน์ว่าพาธเป็น relative
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith('/boss-pos/')) { res.writeHead(404); return res.end(); }
  let f = path.join(root, u.slice('/boss-pos/'.length) || 'index.html');
  if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d);
  });
}).listen(0);
const url = `http://localhost:${server.address().port}/boss-pos/`;

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 375, height: 700 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [], bad = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) bad.push(r.url()); });
page.on('dialog', d => d.accept());

await page.goto(url);
ok(bad.length === 0, 'ทุกไฟล์ (css/js) โหลดได้ภายใต้ sub-path ' + bad.join());
ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'มือถือ: ไม่มี horizontal scroll');

// dashboard
const rev0 = await page.$eval('#k-rev', e => e.textContent);
ok((await page.$$('#bills .item')).length > 0, 'Dashboard แสดงบิลของวันนี้ (ข้อมูลตัวอย่าง)');

// เพิ่มสินค้า
await page.click('[data-view=products]');
await page.click('#p-add');
await page.fill('[name=sku]', 'T001'); await page.fill('[name=name]', 'สินค้าทดสอบ <b>x</b>');
await page.fill('[name=price]', '100'); await page.fill('[name=cost]', '60');
await page.fill('[name=stock]', '5'); await page.fill('[name=min]', '2');
await page.click('#pf-save');
ok(await page.locator('#p-list', { hasText: 'สินค้าทดสอบ' }).count() === 1, 'เพิ่มสินค้าได้');
ok(await page.locator('#p-list b b').count() === 0, 'ชื่อสินค้าถูก escape (ไม่มี HTML injection)');

// SKU ซ้ำ
await page.click('#p-add');
await page.fill('[name=sku]', 't001'); await page.fill('[name=name]', 'ซ้ำ');
await page.fill('[name=price]', '1'); await page.fill('[name=cost]', '1'); await page.fill('[name=stock]', '1'); await page.fill('[name=min]', '1');
await page.click('#pf-save');
ok((await page.textContent('#pf-err')).includes('มีอยู่แล้ว'), 'ปฏิเสธ SKU ซ้ำ');
await page.click('#pf-cancel');

// ขาย 2 ชิ้น
await page.click('[data-view=sell]');
await page.fill('#s-search', 'T001');
await page.click('[data-add]'); await page.click('[data-add]');
ok((await page.textContent('#c-total')).includes('200'), 'ตะกร้ารวม ฿200');
await page.click('[data-inc]');
ok((await page.textContent('#c-total')).includes('300'), 'เพิ่มเป็น 3 ชิ้น ฿300');
await page.click('#c-pay');
await page.click('[data-view=dashboard]');
const rev1 = await page.$eval('#k-rev', e => e.textContent);
const n = s => Number(s.replace(/,/g, ''));
ok(n(rev1) - n(rev0) === 300, `ยอดขายวันนี้เพิ่ม 300 (${rev0} -> ${rev1})`);

// สต็อกลดเหลือ 2 และห้ามขายเกินสต็อก
await page.click('[data-view=sell]');
await page.fill('#s-search', 'T001');
await page.click('[data-add]'); await page.click('[data-add]'); await page.click('[data-add]');
ok((await page.textContent('#c-total')).includes('200'), 'ห้ามใส่ตะกร้าเกินสต็อกคงเหลือ (2)');
await page.click('#c-clear');

// ยกเลิกบิล -> ยอดลด สต็อกคืน
await page.click('[data-view=dashboard]');
await page.locator('[data-void]').first().click();
const rev2 = await page.$eval('#k-rev', e => e.textContent);
ok(n(rev2) === n(rev0), 'ยกเลิกบิลล่าสุด ยอดกลับเท่าเดิม');

// เปลี่ยนวัน
await page.click('#d-prev');
ok(await page.inputValue('#d-date') !== await page.evaluate(() => Store.dateKey(new Date())), 'เลื่อนไปวันก่อนหน้าได้');

// persist
await page.reload();
await page.click('[data-view=products]');
ok(await page.locator('#p-list', { hasText: 'สินค้าทดสอบ' }).count() === 1, 'ข้อมูลคงอยู่หลังรีโหลด');

// export / import
await page.click('[data-view=settings]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#x-json')]);
const file = await dl.path();
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
ok(json.products.length > 10 && json.sales.length > 0, 'ส่งออก JSON ได้');
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#x-csv-sales')]);
ok(fs.readFileSync(await dl2.path(), 'utf8').startsWith('﻿'), 'CSV มี BOM (เปิดภาษาไทยใน Excel ได้)');
await page.click('#x-reset');
await page.click('[data-view=products]');
ok(await page.locator('#p-list', { hasText: 'สินค้าทดสอบ' }).count() === 0, 'รีเซ็ตข้อมูลได้');
await page.click('[data-view=settings]');
await page.setInputFiles('#x-import', file);
await page.waitForFunction(() => document.getElementById('toast').textContent.includes('สำเร็จ'));
await page.click('[data-view=products]');
ok(await page.locator('#p-list', { hasText: 'สินค้าทดสอบ' }).count() === 1, 'นำเข้า JSON กู้ข้อมูลได้');

ok(errors.length === 0, 'ไม่มี JS error ' + errors.join());
await page.screenshot({ path: process.env.SHOT || 'tests/shot.png' });
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
