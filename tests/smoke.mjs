// ทดสอบงานหลักด้วย Playwright: node tests/smoke.mjs  (ต้องมี playwright ติดตั้งไว้)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
ok((await page.$$('#hourly .bar')).length === 24, 'กราฟรายชั่วโมงแสดงครบ 24 ชั่วโมง');
ok(await page.locator('#backup-banner').isHidden(), 'ผู้ใช้ใหม่ยังไม่เห็นแบนเนอร์เตือนสำรองข้อมูล');

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
ok(await page.locator('#cdlg').evaluate(d => d.open), 'กดชำระเงินแล้วเปิดกล่องชำระเงิน');
await page.click('#c-ok');
ok((await page.textContent('#r-body')).includes('ยอดสุทธิ'), 'ชำระแล้วแสดงใบเสร็จ');
await page.click('#r-close');
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
await page.click('#vf button[type=submit]');
ok(await page.locator('#vdlg').evaluate(d => d.open), 'ยกเลิกบิลโดยไม่ใส่เหตุผลไม่ได้ (กล่องยังเปิด)');
await page.fill('#vf [name=reason]', 'ลูกค้ายกเลิก');
await page.click('#vf button[type=submit]');
ok(await page.locator('#bills', { hasText: 'เหตุผล: ลูกค้ายกเลิก' }).count() === 1, 'บิลที่ยกเลิกแสดงเหตุผล');
const rev2 = await page.$eval('#k-rev', e => e.textContent);
ok(n(rev2) === n(rev0), 'ยกเลิกบิลล่าสุด ยอดกลับเท่าเดิม');

// เปลี่ยนวัน
await page.click('#d-prev');
ok(await page.inputValue('#d-date') !== await page.evaluate(() => Store.today()), 'เลื่อนไปวันก่อนหน้าได้');

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

// เตือนสำรองข้อมูล
await page.evaluate(() => localStorage.setItem('bosspos.meta', JSON.stringify({ firstUseAt: '2020-01-01T00:00:00Z' })));
await page.reload();
ok(await page.locator('#backup-banner').isVisible(), 'แสดงแบนเนอร์เตือนเมื่อไม่ได้สำรองเกิน 7 วัน');
await page.click('#backup-now');
await page.waitForEvent('download').catch(() => {});
ok(await page.locator('#backup-banner').isHidden(), 'สำรองข้อมูลแล้วแบนเนอร์หายไป');

// นำเข้าสินค้า CSV
const csvFile = path.join(os.tmpdir(), 'bosspos-import-test.csv');
fs.writeFileSync(csvFile, '\uFEFFSKU,ชื่อ,หมวดหมู่,ราคาขาย,ต้นทุน,สต็อก,จุดสั่งซื้อ\r\nI001,"นำเข้า, หนึ่ง",ทดสอบ,"1,200",800,10,3\r\nI002,นำเข้าสอง,,50,30,5,\r\nDR001,ซ้ำกับเดิม,,1,1,1,1\r\nI003,ราคาผิด,,abc,1,1,1\r\n');
await page.click('[data-view=settings]');
await page.setInputFiles('#x-csv-import', csvFile);
await page.waitForSelector('#idlg[open]'); // FileReader ทำงานแบบ async
ok((await page.textContent('#i-summary')).includes('นำเข้าได้ 2') && (await page.textContent('#i-summary')).includes('2 รายการ'), 'พรีวิว CSV: นำเข้าได้ 2 ข้าม 2');
ok((await page.textContent('#i-errors')).includes('มีอยู่แล้ว'), 'รายงาน SKU ซ้ำ');
await page.click('#i-ok');
await page.click('[data-view=products]');
await page.fill('#p-search', 'I001');
ok(await page.locator('#p-list', { hasText: 'นำเข้า, หนึ่ง' }).count() === 1, 'นำเข้า CSV แล้วเห็นสินค้า (ชื่อมีเครื่องหมายจุลภาค)');
ok(await page.locator('#p-list', { hasText: '1,200' }).count() === 1, 'ราคา "1,200" ถูกอ่านเป็น 1200');

// คีย์บอร์ดหน้าขาย: Enter เพิ่มรายการแรก
await page.click('[data-view=sell]');
await page.fill('#s-search', 'I002');
await page.press('#s-search', 'Enter');
ok((await page.textContent('#c-total')).includes('50'), 'Enter ในช่องค้นหาเพิ่มสินค้ารายการแรกลงตะกร้า');
await page.press('#s-search', 'Escape');
ok(await page.inputValue('#s-search') === '', 'Esc ล้างช่องค้นหา');

/* ===== Phase 1 ===== */
// ชำระเงินสด: รับเงินไม่พอ / พอดี / ทอน
await page.click('[data-view=sell]');
await page.click('#c-clear'); // ล้างตะกร้าที่ค้างจากขั้นตอนก่อนหน้า
await page.fill('#s-search', 'I002');
await page.click('[data-add]');
await page.click('#c-pay');
await page.fill('#cf [name=received]', '40');
ok(await page.locator('#c-ok').isDisabled() && (await page.textContent('#c-err')).includes('รับเงินไม่พอ'), 'รับเงินสดไม่พอ ปุ่มยืนยันถูกปิด');
await page.fill('#cf [name=received]', '100');
ok((await page.textContent('#c-change')).includes('50'), 'รับ 100 ซื้อ 50 ทอน 50');
await page.click('#c-quick [data-recv]');
ok((await page.inputValue('#cf [name=received]')) === '50' && (await page.textContent('#c-change')).includes('0'), 'ปุ่ม "พอดี" ใส่ยอดพอดี');
await page.fill('#cf [name=received]', '100');
await page.click('#c-ok');
const rc1 = await page.textContent('#r-body');
ok(rc1.includes('เงินทอน') && rc1.includes('Boss POS') && /เลขที่ \d{6}/.test(rc1), 'ใบเสร็จมีชื่อร้าน เลขที่บิล เงินรับ/ทอน');
await page.click('#r-close');

// ส่วนลดรายการ + ท้ายบิล % + QR
await page.fill('#s-search', 'I002');
await page.click('[data-add]'); await page.click('[data-add]');
await page.fill('[data-disc]', '10'); await page.press('[data-disc]', 'Tab');
ok((await page.textContent('#c-total')).includes('90'), 'ส่วนลดรายการ 10 บาท ทำให้ยอดเหลือ 90');
await page.click('#c-pay');
await page.fill('#cf [name=bdisc]', '10'); await page.selectOption('#cf [name=btype]', 'pct');
await page.check('#cf [value=qr]');
ok((await page.textContent('#cd-total')).includes('81'), 'ลดท้ายบิล 10% เหลือ 81');
ok(await page.locator('#c-cash').isHidden(), 'จ่าย QR ซ่อนช่องรับเงินสด');
await page.click('#c-ok');
const rc2 = await page.textContent('#r-body');
ok(rc2.includes('ส่วนลดรายการ') && rc2.includes('ส่วนลดท้ายบิล') && rc2.includes('QR') && !rc2.includes('เงินทอน'), 'ใบเสร็จแสดงส่วนลดและวิธีชำระ QR');
// พิมพ์: ตอนพิมพ์ต้องเห็นเฉพาะใบเสร็จ
await page.click('#r-print');
ok((await page.textContent('#receipt-print')).includes('Boss POS'), 'ปุ่มพิมพ์เตรียมใบเสร็จสำหรับพิมพ์');
await page.emulateMedia({ media: 'print' });
ok(await page.locator('#receipt-print').isVisible() && await page.locator('main').isHidden() && await page.locator('.topbar').isHidden() && await page.locator('#tabs').isHidden(), 'โหมดพิมพ์แสดงเฉพาะใบเสร็จ');
await page.emulateMedia({ media: 'screen' });
ok((await page.textContent('#print-page')).includes('80mm'), 'กำหนดขนาดกระดาษ 80mm');
await page.click('#r-close');
await page.click('[data-view=dashboard]');
ok((await page.textContent('#pay')).includes('QR') && (await page.textContent('#pay')).includes('เงินสด'), 'หน้ายอดขายแสดงสรุปตามวิธีชำระเงิน');

// รอบขาย
await page.click('[data-view=sell]');
ok((await page.textContent('#shift-bar')).includes('ยังไม่ได้เปิดรอบขาย'), 'เริ่มต้นยังไม่เปิดรอบขาย');
await page.click('#sh-open');
await page.fill('#of [name=openCash]', '500');
await page.click('#of button[type=submit]');
ok((await page.textContent('#sh-expected')).includes('500'), 'เปิดรอบขาย เงินสดที่ควรมี 500');
await page.fill('#s-search', 'I002');
await page.click('[data-add]');
await page.click('#c-pay'); await page.fill('#cf [name=received]', '50'); await page.click('#c-ok'); await page.click('#r-close');
ok((await page.textContent('#sh-expected')).includes('550'), 'ขายเงินสดในรอบ เงินสดที่ควรมี 550');
await page.click('#sh-close');
await page.fill('#xf [name=counted]', '540');
ok((await page.textContent('#x-diff')).includes('ขาด'), 'นับได้ 540 แสดงว่าขาด 10');
await page.fill('#xf [name=note]', 'ทอนผิด');
await page.click('#xf button[type=submit]');
ok((await page.textContent('#shift-bar')).includes('ยังไม่ได้เปิดรอบขาย'), 'ปิดรอบแล้วกลับเป็นยังไม่เปิดรอบ');
await page.click('[data-view=dashboard]');
const shTxt = await page.textContent('#shifts');
ok(shTxt.includes('ขาด') && shTxt.includes('ทอนผิด') && shTxt.includes('540'), 'หน้ายอดขายแสดงรอบขายที่ปิดพร้อมส่วนต่าง');

// สต็อก
await page.click('[data-view=stock]');
await page.fill('#st-search', 'I002');
await page.click('[data-mv=receive]');
await page.fill('#sf [name=qty]', '5'); await page.fill('#sf [name=note]', 'INV-9');
await page.click('#sf button[type=submit]');
ok((await page.textContent('#st-moves')).includes('รับเข้า') && (await page.textContent('#st-moves')).includes('INV-9'), 'รับสินค้าเข้าแล้วมีประวัติ');
await page.click('[data-mv=waste]');
await page.fill('#sf [name=qty]', '1');
await page.click('#sf button[type=submit]');
ok(await page.locator('#sdlg').evaluate(d => d.open), 'ตัดชำรุดโดยไม่ระบุสาเหตุไม่ได้');
await page.fill('#sf [name=reason]', 'หมดอายุ');
await page.click('#sf button[type=submit]');
ok((await page.textContent('#st-moves')).includes('ชำรุด/สูญเสีย') && (await page.textContent('#st-moves')).includes('หมดอายุ'), 'ตัดสินค้าชำรุดพร้อมสาเหตุ');
await page.click('[data-mv=adjust]');
await page.fill('#sf [name=counted]', '2');
await page.click('#sf button[type=submit]');
ok((await page.textContent('#st-moves')).includes('ปรับยอด') && (await page.textContent('#st-list')).includes('คงเหลือ 2'), 'นับสต็อกปรับยอดเหลือ 2');
const [mvDl] = await Promise.all([page.waitForEvent('download'), page.click('#st-csv')]);
ok(fs.readFileSync(await mvDl.path(), 'utf8').includes('ปรับยอด'), 'ส่งออกประวัติสต็อก CSV');

// ตั้งค่าร้าน / ใบเสร็จ 58 มม.
await page.click('[data-view=settings]');
await page.fill('#shf [name=shopName]', 'ร้านทดสอบ <i>x</i>');
await page.selectOption('#shf [name=receiptWidth]', '58');
await page.click('#shf button[type=submit]');
await page.click('[data-view=dashboard]');
await page.locator('[data-reprint]').first().click();
ok((await page.textContent('#r-body')).includes('ร้านทดสอบ') && await page.locator('#r-body .rc.w58').count() === 1, 'ใบเสร็จใช้ชื่อร้านและขนาด 58 มม. ตามตั้งค่า');
ok(await page.locator('#r-body i').count() === 0, 'ชื่อร้านถูก escape ในใบเสร็จ');
await page.click('#r-print');
ok((await page.textContent('#print-page')).includes('58mm'), 'กำหนดขนาดกระดาษ 58mm');
await page.click('#r-close');

// ย้ายข้อมูล v1 -> v2 ในเบราว์เซอร์จริง
const ctx2 = await browser.newContext({ viewport: { width: 375, height: 700 } });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errors.push('p2: ' + e.message));
await p2.goto(url);
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/v1-backup.json'), 'utf8');
await p2.evaluate(t => localStorage.setItem('bosspos.v1', t), fixture);
await p2.reload();
const mig = await p2.evaluate(() => ({ n: Store.sales().length, m: Store.sales()[0].paymentMethod, d: Store.sales()[0].date, v: JSON.parse(localStorage.getItem('bosspos.v1')).schemaVersion }));
ok(mig.n === JSON.parse(fixture).sales.length && mig.m === 'unknown' && mig.v === 2, 'เปิดแอปด้วยข้อมูล v1 แล้วย้ายเป็น v2 อัตโนมัติและบันทึกกลับ');
await p2.fill('#d-date', mig.d);
ok((await p2.textContent('#bills')).includes('ไม่ระบุ'), 'บิลเก่าแสดงวิธีชำระ "ไม่ระบุ"');
await p2.click('[data-view=stock]');
ok((await p2.textContent('#st-moves')).includes('ยอดยกมา'), 'ข้อมูลเก่าได้ยอดยกมาในประวัติสต็อก');
await ctx2.close();

ok(errors.length === 0, 'ไม่มี JS error ' + errors.join());
await page.screenshot({ path: process.env.SHOT || 'tests/shot.png' });
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
