// Unit test ตรรกะใน js/store.js: node --test tests/store.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../js/store.js');

const prod = (o = {}) => Object.assign({ sku: 'T1', name: 'ทดสอบ', category: 'ก', price: 10, cost: 6, stock: 5, min: 2 }, o);
beforeEach(() => { S.importJSON(JSON.stringify({ products: [], sales: [], seq: 1 })); });
const pid = sku => S.products().find(p => p.sku === sku).id;

test('เขตเวลา Asia/Bangkok: วันที่และชั่วโมงอิง UTC+7', () => {
  const d = new Date('2026-03-01T17:30:00Z'); // 00:30 วันถัดไปที่กรุงเทพฯ
  assert.equal(S.dateKey(d), '2026-03-02');
  assert.equal(S.hourOf(d.toISOString()), 0);
  assert.equal(S.timeLabel(d.toISOString()), '00:30');
  assert.equal(S.dateKey(S.at('2026-03-02', 0, 30)), '2026-03-02');
  assert.equal(S.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
});

test('importJSON คำนวณ date ของบิลใหม่จาก ts', () => {
  const sale = { id: 's1', ts: '2026-03-01T17:30:00Z', date: '2026-03-01', items: [], total: 0, voided: false };
  S.importJSON(JSON.stringify({ products: [], sales: [sale] }));
  assert.equal(S.sales()[0].date, '2026-03-02');
});

test('saveProduct: ตรวจข้อมูลและ SKU ซ้ำ (ไม่สนตัวพิมพ์)', () => {
  assert.ok(S.saveProduct(prod()).ok);
  assert.equal(S.saveProduct(prod({ sku: 't1' })).ok, false);
  assert.equal(S.saveProduct(prod({ sku: 'T2', price: -1 })).ok, false);
  assert.equal(S.saveProduct(prod({ sku: 'T2', price: 'abc' })).ok, false);
  assert.equal(S.saveProduct(prod({ sku: 'T2', stock: 1.5 })).ok, false);
  assert.equal(S.saveProduct(prod({ sku: 'T2', name: 'x'.repeat(101) })).ok, false);
  assert.ok(S.saveProduct(prod({ price: 0 }), pid('T1')).ok, 'แก้ไขตัวเอง SKU เดิมต้องผ่าน');
});

test('checkout: ตัดสต็อก คิดยอด และห้ามขายเกินสต็อก', () => {
  S.saveProduct(prod({ price: 10.5, cost: 6, stock: 5 }));
  const r = S.checkout([{ pid: pid('T1'), qty: 3 }]);
  assert.ok(r.ok);
  assert.equal(r.sale.total, 31.5);
  assert.equal(S.find(pid('T1')).stock, 2);
  const over = S.checkout([{ pid: pid('T1'), qty: 3 }]);
  assert.equal(over.ok, false);
  assert.equal(S.find(pid('T1')).stock, 2, 'ขายไม่สำเร็จต้องไม่ตัดสต็อก');
  assert.equal(S.checkout([]).ok, false);
  assert.equal(S.checkout([{ pid: pid('T1'), qty: 0 }]).ok, false);
  assert.equal(S.checkout([{ pid: pid('T1'), qty: 1.5 }]).ok, false);
  assert.equal(S.checkout([{ pid: 'nope', qty: 1 }]).ok, false);
});

test('checkout หลายรายการ: ล้มเหลวทั้งบิลถ้ารายการใดสต็อกไม่พอ', () => {
  S.saveProduct(prod({ sku: 'A', stock: 5 })); S.saveProduct(prod({ sku: 'B', stock: 1 }));
  const r = S.checkout([{ pid: pid('A'), qty: 2 }, { pid: pid('B'), qty: 2 }]);
  assert.equal(r.ok, false);
  assert.equal(S.find(pid('A')).stock, 5);
  assert.equal(S.sales().length, 0);
});

test('voidSale: ต้องมีเหตุผล คืนสต็อก และยกเลิกซ้ำไม่ได้', () => {
  S.saveProduct(prod({ stock: 5 }));
  const sale = S.checkout([{ pid: pid('T1'), qty: 2 }]).sale;
  assert.equal(S.voidSale(sale.id, '  ').ok, false);
  assert.equal(S.find(pid('T1')).stock, 3, 'ไม่มีเหตุผลต้องไม่ยกเลิก');
  assert.ok(S.voidSale(sale.id, 'ลูกค้ายกเลิก').ok);
  const s = S.sales()[0];
  assert.equal(s.voided, true);
  assert.equal(s.voidReason, 'ลูกค้ายกเลิก');
  assert.ok(s.voidedAt);
  assert.equal(S.find(pid('T1')).stock, 5);
  assert.equal(S.voidSale(sale.id, 'อีกครั้ง').ok, false);
  assert.equal(S.find(pid('T1')).stock, 5, 'ห้ามคืนสต็อกซ้ำ');
  assert.equal(S.voidSale('nope', 'x').ok, false);
});

test('voidSale: สินค้าถูกลบไปแล้วไม่ทำให้พัง', () => {
  S.saveProduct(prod());
  const sale = S.checkout([{ pid: pid('T1'), qty: 1 }]).sale;
  S.deleteProduct(pid('T1'));
  assert.ok(S.voidSale(sale.id, 'x').ok);
});

test('summary: รายได้ กำไร ไม่นับบิลที่ยกเลิก', () => {
  S.saveProduct(prod({ price: 10, cost: 6, stock: 20 }));
  const when = S.at('2026-05-10', 10, 15);
  S.checkout([{ pid: pid('T1'), qty: 3 }], { when: when });
  const b = S.checkout([{ pid: pid('T1'), qty: 2 }], { when: when }).sale;
  S.voidSale(b.id, 'x');
  const r = S.summary('2026-05-10');
  assert.deepEqual([r.revenue, r.bills, r.units, r.profit, r.avg], [30, 1, 3, 12, 30]);
  assert.equal(S.summary('2026-05-11').bills, 0);
});

test('hourly: จัดชั่วโมงตามเวลาร้าน และรองรับ 24 ชั่วโมง', () => {
  S.saveProduct(prod({ stock: 50 }));
  S.checkout([{ pid: pid('T1'), qty: 1 }], { when: S.at('2026-05-10', 0, 5) });
  S.checkout([{ pid: pid('T1'), qty: 2 }], { when: S.at('2026-05-10', 23, 59) });
  const h = S.hourly('2026-05-10');
  assert.equal(h.length, 24);
  assert.equal(h[0], 10);
  assert.equal(h[23], 20);
});

test('top และ lastDays', () => {
  S.saveProduct(prod({ sku: 'A', price: 10, stock: 50 })); S.saveProduct(prod({ sku: 'B', price: 100, stock: 50 }));
  const when = S.at('2026-05-10', 9, 0);
  S.checkout([{ pid: pid('A'), qty: 5 }, { pid: pid('B'), qty: 1 }], { when: when });
  const top = S.top('2026-05-10', 5);
  assert.equal(top[0].name, 'ทดสอบ');
  assert.equal(top[0].revenue, 100);
  const wk = S.lastDays('2026-05-10', 7);
  assert.equal(wk.length, 7);
  assert.equal(wk[6].revenue, 150);
  assert.equal(wk[0].date, '2026-05-04');
});

test('lowStock: นับสินค้าที่ stock <= min', () => {
  S.saveProduct(prod({ sku: 'A', stock: 2, min: 2 })); S.saveProduct(prod({ sku: 'B', stock: 3, min: 2 }));
  assert.deepEqual(S.lowStock().map(p => p.sku), ['A']);
});

test('CSV ส่งออก: BOM, escape เครื่องหมายคำพูด และกัน formula injection', () => {
  S.saveProduct(prod({ name: '=HYPERLINK("x")' })); S.saveProduct(prod({ sku: 'T2', name: 'a "b", c' }));
  const csv = S.productsCSV();
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"a ""b"", c"'));
});

test('salesCSV มีเหตุผลยกเลิกและเวลาตามเขตเวลาร้าน', () => {
  S.saveProduct(prod({ stock: 5 }));
  const sale = S.checkout([{ pid: pid('T1'), qty: 1 }], { when: S.at('2026-05-10', 8, 5) }).sale;
  S.voidSale(sale.id, 'ทดสอบ');
  const csv = S.salesCSV();
  assert.ok(csv.includes('"08:05"'));
  assert.ok(csv.includes('"ยกเลิก","ทดสอบ"'));
});

test('parseCSV: เครื่องหมายคำพูด จุลภาค ขึ้นบรรทัดใหม่ในเซลล์ CRLF และ BOM', () => {
  const r = S.parseCSV('﻿a,b\r\n"x, y","l1\nl2"\r\n\r\n"q""q",z');
  assert.deepEqual(r.rows, [['a', 'b'], ['x, y', 'l1\nl2'], ['q"q', 'z']]);
  assert.equal(r.unterminated, false);
  assert.equal(S.parseCSV('a,"b').unterminated, true);
});

test('parseProductsCSV: ยอมรับหัวคอลัมน์ไทย/อังกฤษ ค่าเริ่มต้น และรายงานข้อผิดพลาด', () => {
  S.saveProduct(prod({ sku: 'EXIST' }));
  const text = 'sku,ชื่อสินค้า,ราคา,ต้นทุน,สต็อก\nN1,สินค้าใหม่,"1,000",600,5\nN1,ซ้ำในไฟล์,1,1,1\nexist,ซ้ำของเดิม,1,1,1\nN2,ราคาผิด,abc,1,1\nN3,ติดลบ,-5,1,1\nN4,ทศนิยมสต็อก,1,1,1.5\n,ไม่มีรหัส,1,1,1';
  const r = S.parseProductsCSV(text);
  assert.equal(r.fatal, '');
  assert.equal(r.valid.length, 1);
  assert.deepEqual([r.valid[0].price, r.valid[0].min, r.valid[0].category], [1000, 5, 'ทั่วไป']);
  assert.equal(r.errors.length, 6);
  assert.deepEqual(r.errors.map(e => e.line), [3, 4, 5, 6, 7, 8]);
});

test('parseProductsCSV: ไฟล์เสีย/ขาดคอลัมน์ได้ fatal', () => {
  assert.ok(S.parseProductsCSV('').fatal);
  assert.ok(S.parseProductsCSV('sku,name\nA,b').fatal.includes('price'));
  assert.ok(S.parseProductsCSV('sku,"name\nA,b').fatal);
});

test('importProducts + round-trip กับไฟล์ที่ส่งออก/ไฟล์ตัวอย่าง', () => {
  S.saveProduct(prod({ sku: 'A', name: 'ชื่อ, มีจุลภาค' }));
  const exported = S.productsCSV();
  S.importJSON(JSON.stringify({ products: [], sales: [] }));
  const r = S.parseProductsCSV(exported);
  assert.equal(r.errors.length, 0);
  assert.equal(S.importProducts(r.valid).added, 1);
  assert.equal(S.products()[0].name, 'ชื่อ, มีจุลภาค');
  const tpl = S.parseProductsCSV(S.productsTemplateCSV());
  assert.equal(tpl.valid.length, 1);
  // นำเข้าซ้ำ ข้ามรายการซ้ำ ไม่เขียนทับ
  assert.deepEqual(S.importProducts(r.valid), { added: 0, skipped: 1 });
});

test('backupStatus: เตือนเมื่อเกิน 7 วัน และรีเซ็ตเมื่อสำรอง', () => {
  const t0 = new Date('2026-01-01T00:00:00Z'), day = n => new Date(t0.getTime() + n * 86400000);
  const first = S.backupStatus(t0);
  assert.equal(first.due, false);
  assert.equal(S.backupStatus(day(6)).due, false);
  const d7 = S.backupStatus(day(7));
  assert.equal(d7.due, true); assert.equal(d7.never, true);
  S.markBackup(day(7));
  const after = S.backupStatus(day(8));
  assert.equal(after.due, false); assert.equal(after.never, false);
  assert.equal(S.backupStatus(day(15)).due, true);
});

test('seed: สร้างข้อมูลตัวอย่างและยอดขายวันนี้ถูกต้องตามเขตเวลา', () => {
  S.seed();
  assert.equal(S.products().length, 10);
  assert.ok(S.sales().length > 0);
  S.sales().forEach(s => assert.equal(s.date, S.dateKey(new Date(s.ts))));
  assert.equal(S.lastDays(S.today(), 7).filter(d => d.revenue > 0).length >= 6, true);
});
