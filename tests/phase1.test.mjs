// Unit test Phase 1: สต็อก, ส่วนลด, วิธีชำระเงิน, รอบขาย, ตั้งค่า, migration v1 -> v2
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../js/store.js');

const prod = (o = {}) => Object.assign({ sku: 'T1', name: 'ทดสอบ', category: 'ก', price: 100, cost: 60, stock: 50, min: 2 }, o);
const reset = () => S.importJSON(JSON.stringify({ schemaVersion: 2, products: [], sales: [], stockMoves: [], shifts: [], seq: 1 }));
beforeEach(reset);
const pid = sku => S.products().find(p => p.sku === sku).id;
const dump = () => JSON.parse(S.exportJSON());
// ยอดคงเหลือต้องเท่ากับผลรวม movement เสมอ
const assertInvariant = () => {
  const d = dump();
  d.products.forEach(p => {
    const sum = d.stockMoves.filter(m => m.pid === p.id).reduce((a, m) => a + m.qty, 0);
    assert.equal(sum, p.stock, `stock ของ ${p.sku} ต้องเท่าผลรวม movement`);
  });
};

/* ---------- migration ---------- */
test('migration: v1 backup จริง (สร้างจากโค้ดก่อน Phase 1) ย้ายเป็น v2 ได้ครบ', () => {
  const text = fs.readFileSync(new URL('./fixtures/v1-backup.json', import.meta.url), 'utf8');
  const v1 = JSON.parse(text);
  assert.equal(v1.schemaVersion, undefined);
  assert.ok(S.importJSON(text).ok);
  const d = dump();
  assert.equal(d.schemaVersion, 2);
  assert.equal(d.products.length, v1.products.length);
  assert.equal(d.sales.length, v1.sales.length);
  // ยอดเงินของบิลเดิมต้องไม่เปลี่ยน
  d.sales.forEach((s, i) => {
    assert.equal(s.total, v1.sales[i].total);
    assert.equal(s.voided, v1.sales[i].voided);
    assert.equal(s.paymentMethod, 'unknown');
    assert.equal(s.discount, 0);
    assert.equal(s.paid, s.total);
    assert.equal(s.shiftId, null);
  });
  // เลขบิลไม่ซ้ำ เรียงตามเวลา
  const nos = d.sales.map(s => s.no);
  assert.equal(new Set(nos).size, nos.length);
  const byTs = [...d.sales].sort((a, b) => a.ts < b.ts ? -1 : 1).map(s => s.no);
  assert.deepEqual(byTs, [...byTs].sort((a, b) => a - b));
  assert.equal(d.saleNo, d.sales.length);
  // ยอดยกมาตรงกับสต็อกเดิม
  assert.equal(d.stockMoves.filter(m => m.type === 'opening').length, v1.products.length);
  assertInvariant();
  assert.deepEqual(d.settings.receiptWidth, 80);
  assert.deepEqual(d.shifts, []);
});

test('migration: ทำซ้ำได้ (idempotent) และ export -> import ได้ข้อมูลเท่าเดิม', () => {
  const text = fs.readFileSync(new URL('./fixtures/v1-backup.json', import.meta.url), 'utf8');
  S.importJSON(text);
  const once = S.exportJSON();
  S.importJSON(once);
  assert.equal(S.exportJSON(), once);
});

test('migration: ปฏิเสธไฟล์จากเวอร์ชันใหม่กว่า และไฟล์รูปแบบผิด', () => {
  assert.equal(S.importJSON(JSON.stringify({ schemaVersion: 99, products: [], sales: [] })).ok, false);
  assert.equal(S.importJSON('{}').ok, false);
  assert.equal(S.importJSON('ไม่ใช่ json').ok, false);
  assert.equal(dump().schemaVersion, 2, 'ข้อมูลเดิมต้องไม่ถูกทับเมื่อนำเข้าล้มเหลว');
});

/* ---------- สต็อก ---------- */
test('saveProduct: สร้างด้วยสต็อก > 0 ได้ยอดยกมา และแก้สต็อกจากฟอร์มสร้าง movement ปรับยอด', () => {
  S.saveProduct(prod({ stock: 10 }));
  assert.deepEqual(dump().stockMoves.map(m => [m.type, m.qty, m.balance]), [['opening', 10, 10]]);
  S.saveProduct(prod({ stock: 7 }), pid('T1'));
  const last = dump().stockMoves.at(-1);
  assert.deepEqual([last.type, last.qty, last.balance], ['adjust', -3, 7]);
  S.saveProduct(prod({ price: 120, stock: 7 }), pid('T1'));
  assert.equal(dump().stockMoves.length, 2, 'แก้ราคาอย่างเดียวต้องไม่เพิ่ม movement');
  assertInvariant();
});

test('addStockMove: รับเข้า / ชำรุด / นับสต็อก พร้อมตรวจข้อมูล', () => {
  S.saveProduct(prod({ stock: 10 }));
  const id = pid('T1');
  assert.ok(S.addStockMove(id, { type: 'receive', qty: '5', note: 'INV-1' }).ok);
  assert.equal(S.find(id).stock, 15);
  assert.equal(S.addStockMove(id, { type: 'receive', qty: 0 }).ok, false);
  assert.equal(S.addStockMove(id, { type: 'receive', qty: 1.5 }).ok, false);
  assert.equal(S.addStockMove(id, { type: 'waste', qty: 2 }).ok, false, 'ชำรุดต้องมีสาเหตุ');
  assert.equal(S.addStockMove(id, { type: 'waste', qty: 99, reason: 'หมดอายุ' }).ok, false, 'เกินสต็อก');
  assert.ok(S.addStockMove(id, { type: 'waste', qty: 3, reason: 'หมดอายุ' }).ok);
  assert.equal(S.find(id).stock, 12);
  assert.equal(S.addStockMove(id, { type: 'adjust', counted: 12 }).ok, false, 'ยอดเท่าเดิม');
  assert.equal(S.addStockMove(id, { type: 'adjust', counted: '' }).ok, false);
  assert.equal(S.addStockMove(id, { type: 'adjust', counted: -1 }).ok, false);
  const adj = S.addStockMove(id, { type: 'adjust', counted: 9 });
  assert.ok(adj.ok);
  assert.deepEqual([adj.move.qty, adj.move.balance, adj.move.reason], [-3, 9, 'นับสต็อก']);
  assert.equal(S.addStockMove('nope', { type: 'receive', qty: 1 }).ok, false);
  assert.equal(S.addStockMove(id, { type: 'xx', qty: 1 }).ok, false);
  assertInvariant();
  assert.equal(S.moves(id, 2).length, 2);
  assert.equal(S.moves(id)[0].type, 'adjust', 'เรียงใหม่สุดก่อน');
});

test('ขายและยกเลิกบิลสร้าง movement และสต็อกยังสอดคล้อง', () => {
  S.saveProduct(prod({ stock: 10 }));
  const sale = S.checkout([{ pid: pid('T1'), qty: 4 }]).sale;
  assert.equal(S.find(pid('T1')).stock, 6);
  S.voidSale(sale.id, 'ผิดรายการ');
  assert.equal(S.find(pid('T1')).stock, 10);
  assert.deepEqual(dump().stockMoves.map(m => m.type), ['opening', 'sale', 'void']);
  assert.ok(dump().stockMoves[1].reason.includes(S.billNo(sale.no)));
  assertInvariant();
});

/* ---------- ส่วนลดและยอดรวม ---------- */
test('quote: ส่วนลดรายการ ส่วนลดท้ายบิล (บาท/%) และการปัดเศษ', () => {
  S.saveProduct(prod({ sku: 'A', price: 99.99, stock: 20 })); S.saveProduct(prod({ sku: 'B', price: 10, stock: 20 }));
  const cart = [{ pid: pid('A'), qty: 3, disc: 10 }, { pid: pid('B'), qty: 2 }];
  const q0 = S.quote(cart);
  assert.deepEqual([q0.subtotal, q0.lineDiscount, q0.billDiscount, q0.total], [319.97, 10, 0, 309.97]);
  const q1 = S.quote(cart, { type: 'baht', value: '9.97' });
  assert.deepEqual([q1.billDiscount, q1.total], [9.97, 300]);
  const q2 = S.quote(cart, { type: 'pct', value: 10 });
  assert.deepEqual([q2.billDiscount, q2.total], [31, 278.97]);
  assert.deepEqual(q2.billSpec, { type: 'pct', value: 10 });
  assert.equal(S.quote(cart, { type: 'pct', value: 100 }).total, 0, 'ลด 100% ได้');
});

test('quote: ปฏิเสธส่วนลดที่ไม่สมเหตุผล และสต็อกไม่พอ (รวมรายการซ้ำสินค้าเดียวกัน)', () => {
  S.saveProduct(prod({ price: 100, stock: 5 }));
  const id = pid('T1');
  assert.equal(S.quote([{ pid: id, qty: 1, disc: 101 }]).ok, false);
  assert.equal(S.quote([{ pid: id, qty: 1, disc: -1 }]).ok, false);
  assert.equal(S.quote([{ pid: id, qty: 1, disc: 'abc' }]).ok, false);
  assert.equal(S.quote([{ pid: id, qty: 1 }], { type: 'baht', value: 101 }).ok, false);
  assert.equal(S.quote([{ pid: id, qty: 1 }], { type: 'baht', value: -1 }).ok, false);
  assert.equal(S.quote([{ pid: id, qty: 1 }], { type: 'pct', value: 101 }).ok, false);
  assert.equal(S.quote([{ pid: id, qty: 3 }, { pid: id, qty: 3 }]).ok, false, 'รวมสองบรรทัดเกินสต็อก 5');
  assert.equal(S.quote([]).ok, false);
});

test('checkout: ส่วนลดถูกบันทึก ยอดรวม/กำไร/สต็อกถูกต้อง', () => {
  S.saveProduct(prod({ price: 100, cost: 60, stock: 10 }));
  const r = S.checkout([{ pid: pid('T1'), qty: 2, disc: 20 }], { bill: { type: 'pct', value: 10 }, when: S.at('2026-05-10', 9, 0) });
  assert.ok(r.ok);
  const s = r.sale;
  assert.deepEqual([s.subtotal, s.billDiscount, s.discount, s.total], [200, 18, 38, 162]);
  assert.equal(s.items[0].discount, 20);
  assert.equal(S.find(pid('T1')).stock, 8);
  const sum = S.summary('2026-05-10');
  assert.deepEqual([sum.revenue, sum.profit, sum.discount], [162, 42, 38]); // 162 - ต้นทุน 120
});

test('lineNets กระจายส่วนลดท้ายบิลและรวมกลับเท่ายอดบิลเสมอ (เศษสตางค์)', () => {
  S.saveProduct(prod({ sku: 'A', price: 33.33, stock: 9 })); S.saveProduct(prod({ sku: 'B', price: 10, stock: 9 })); S.saveProduct(prod({ sku: 'C', price: 7.77, stock: 9 }));
  const cart = [{ pid: pid('A'), qty: 3 }, { pid: pid('B'), qty: 1 }, { pid: pid('C'), qty: 2 }];
  for (const bill of [{ type: 'baht', value: 17.77 }, { type: 'pct', value: 7 }, { type: 'baht', value: 0.01 }]) {
    const s = S.checkout(cart, { bill }).sale;
    const nets = S.lineNets(s);
    assert.equal(Math.round(nets.reduce((a, b) => a + b, 0) * 100) / 100, s.total);
    S.voidSale(s.id, 'x');
  }
});

test('lineNets: กรณีปัดเศษไม่ลงตัว เศษสตางค์ต้องตกที่รายการสุดท้าย (หาเคสด้วยการสุ่มแล้ว)', () => {
  // ถ้าปัดแต่ละรายการอย่างเดียวจะได้ 64.58 ทั้งที่ยอดบิลคือ 64.57
  S.saveProduct(prod({ sku: 'A', price: 18.16, stock: 9 })); S.saveProduct(prod({ sku: 'B', price: 34.44, stock: 9 })); S.saveProduct(prod({ sku: 'C', price: 23.7, stock: 9 }));
  const s = S.checkout([{ pid: pid('A'), qty: 1 }, { pid: pid('B'), qty: 1 }, { pid: pid('C'), qty: 1 }], { bill: { type: 'baht', value: 11.73 } }).sale;
  assert.equal(s.total, 64.57);
  const nets = S.lineNets(s);
  assert.equal(Math.round(nets.reduce((a, b) => a + b, 0) * 100) / 100, 64.57);
});

test('top: รายได้ต่อสินค้าคิดหลังส่วนลด', () => {
  S.saveProduct(prod({ sku: 'A', price: 100, stock: 9 })); S.saveProduct(prod({ sku: 'B', price: 100, stock: 9 }));
  S.checkout([{ pid: pid('A'), qty: 1, disc: 50 }, { pid: pid('B'), qty: 1 }], { when: S.at('2026-05-10', 9, 0) });
  const t = S.top('2026-05-10', 5);
  assert.deepEqual(t.map(x => [x.name, x.revenue]), [['ทดสอบ', 100], ['ทดสอบ', 50]]);
});

/* ---------- วิธีชำระเงิน ---------- */
test('checkout: เงินสดคิดเงินทอน รับไม่พอไม่ผ่าน เว้นว่าง = พอดี', () => {
  S.saveProduct(prod({ price: 45, stock: 20 }));
  const c = [{ pid: pid('T1'), qty: 2 }];
  assert.equal(S.checkout(c, { payment: { method: 'cash', received: 89 } }).ok, false);
  assert.equal(S.find(pid('T1')).stock, 20, 'รับเงินไม่พอต้องไม่ตัดสต็อก');
  const a = S.checkout(c, { payment: { method: 'cash', received: 100 } }).sale;
  assert.deepEqual([a.paymentMethod, a.paid, a.change], ['cash', 100, 10]);
  const b = S.checkout(c, { payment: { method: 'cash', received: '' } }).sale;
  assert.deepEqual([b.paid, b.change], [90, 0]);
  const d = S.checkout(c).sale;
  assert.equal(d.paymentMethod, 'cash');
});

test('checkout: โอน/QR จ่ายพอดี (ไม่มีเงินทอน) และปฏิเสธวิธีชำระที่ไม่รู้จัก', () => {
  S.saveProduct(prod({ price: 50, stock: 20 }));
  const c = [{ pid: pid('T1'), qty: 1 }];
  const t = S.checkout(c, { payment: { method: 'transfer', received: 999 } }).sale;
  assert.deepEqual([t.paymentMethod, t.paid, t.change], ['transfer', 50, 0], 'ยอดรับเกินไม่มีผลกับโอน');
  assert.equal(S.checkout(c, { payment: { method: 'qr' } }).sale.paymentMethod, 'qr');
  assert.equal(S.checkout(c, { payment: { method: 'bitcoin' } }).ok, false);
});

test('paymentBreakdown: แยกตามวิธีชำระ ไม่นับบิลที่ยกเลิก', () => {
  S.saveProduct(prod({ price: 10, stock: 99 }));
  const when = S.at('2026-05-10', 9, 0), c = [{ pid: pid('T1'), qty: 1 }];
  S.checkout(c, { when, payment: { method: 'cash' } });
  S.checkout(c, { when, payment: { method: 'qr' } });
  const v = S.checkout(c, { when, payment: { method: 'transfer' } }).sale;
  S.voidSale(v.id, 'x');
  const pb = S.paymentBreakdown('2026-05-10');
  assert.deepEqual([pb.cash.bills, pb.qr.bills, pb.transfer.bills, pb.unknown.bills], [1, 1, 0, 0]);
  assert.equal(pb.cash.amount + pb.qr.amount, 20);
});

/* ---------- รอบขาย ---------- */
test('shift: เปิด-ขาย-ปิด คำนวณเงินสดที่ควรมีและส่วนต่าง', () => {
  S.saveProduct(prod({ price: 100, stock: 99 }));
  const c = [{ pid: pid('T1'), qty: 1 }];
  const before = S.checkout(c, { payment: { method: 'cash' } }).sale;
  assert.equal(before.shiftId, null, 'ขายก่อนเปิดรอบไม่ผูกกับรอบ');
  assert.equal(S.openShift(-1).ok, false);
  const open = S.openShift('500', S.at('2026-05-10', 8, 0));
  assert.ok(open.ok);
  assert.equal(S.openShift(0).ok, false, 'เปิดซ้อนไม่ได้');
  const inShift = S.checkout(c, { payment: { method: 'cash', received: 200 } }).sale;
  assert.equal(inShift.shiftId, open.shift.id);
  S.checkout(c, { payment: { method: 'qr' } });
  const voided = S.checkout(c, { payment: { method: 'cash' } }).sale;
  S.voidSale(voided.id, 'x');
  const live = S.shiftSummary(S.currentShift());
  assert.deepEqual([live.bills, live.revenue, live.cashSales, live.expected], [2, 200, 100, 600]);
  assert.equal(S.closeShift('').ok, false);
  assert.equal(S.closeShift(-5).ok, false);
  const r = S.closeShift('590', 'ทอนเกิน', S.at('2026-05-10', 17, 0));
  assert.ok(r.ok);
  assert.deepEqual([r.shift.expected, r.shift.countedCash, r.shift.diff, r.shift.note], [600, 590, -10, 'ทอนเกิน']);
  assert.equal(S.currentShift(), null);
  assert.equal(S.closeShift(0).ok, false, 'ไม่มีรอบที่เปิดอยู่');
  const after = S.checkout(c).sale;
  assert.equal(after.shiftId, null);
  assert.equal(S.shiftsOn('2026-05-10').length, 1);
  assert.equal(S.shiftsOn('2026-05-11').length, 0);
});

test('shift: ยอดที่ปิดแล้วเป็นค่าคงที่ ไม่เปลี่ยนเมื่อยกเลิกบิลภายหลัง', () => {
  S.saveProduct(prod({ price: 100, stock: 99 }));
  S.openShift(0, S.at('2026-05-10', 8, 0));
  const s = S.checkout([{ pid: pid('T1'), qty: 1 }], { when: S.at('2026-05-10', 9, 0) }).sale;
  S.closeShift(100, '', S.at('2026-05-10', 17, 0));
  S.voidSale(s.id, 'x');
  const sh = S.shiftsOn('2026-05-10')[0];
  assert.deepEqual([sh.expected, sh.diff], [100, 0]);
});

/* ---------- ตั้งค่า ---------- */
test('settings: บันทึก ทำความสะอาดค่า และคงอยู่หลัง export/import', () => {
  assert.equal(S.settings().receiptWidth, 80);
  S.saveSettings({ shopName: '  ร้านบอส  ', taxId: ' 0123456789012 ', footer: 'ขอบคุณ', receiptWidth: '58' });
  assert.deepEqual(S.settings(), { shopName: 'ร้านบอส', taxId: '0123456789012', footer: 'ขอบคุณ', receiptWidth: 58 });
  S.saveSettings({ shopName: '   ', receiptWidth: 70 });
  assert.equal(S.settings().shopName, 'Boss POS', 'ชื่อว่างใช้ค่าเริ่มต้น');
  assert.equal(S.settings().receiptWidth, 80, 'ขนาดที่ไม่รู้จักถอยกลับเป็น 80');
  S.saveSettings({ shopName: 'ร้าน X', receiptWidth: 58 });
  const text = S.exportJSON();
  reset();
  S.importJSON(text);
  assert.equal(S.settings().shopName, 'ร้าน X');
  assert.equal(S.settings().receiptWidth, 58);
});

/* ---------- ส่งออก ---------- */
test('salesCSV: คอลัมน์ระดับบิลอยู่เฉพาะแถวแรก (SUM ไม่ซ้ำ) และมีวิธีชำระ', () => {
  S.saveProduct(prod({ sku: 'A', price: 100, stock: 9 })); S.saveProduct(prod({ sku: 'B', name: 'บี', price: 50, stock: 9 }));
  S.checkout([{ pid: pid('A'), qty: 1, disc: 10 }, { pid: pid('B'), qty: 2 }], { bill: { type: 'baht', value: 5 }, payment: { method: 'qr' }, when: S.at('2026-05-10', 9, 0) });
  const rows = S.parseCSV(S.salesCSV()).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].slice(6, 11), ['ส่วนลดรายการ', 'รวมรายการ', 'ส่วนลดท้ายบิล', 'ยอดสุทธิบิล', 'วิธีชำระ']);
  assert.deepEqual(rows[1].slice(6, 11), ['10', '90', '5', '185', 'QR']);
  assert.deepEqual(rows[2].slice(6, 11), ['0', '100', '', '', '']);
  assert.equal(rows[1][2], '000001');
});

test('stockMovesCSV: มี BOM หัวคอลัมน์ และชื่อประเภทภาษาไทย', () => {
  S.saveProduct(prod({ stock: 3 }));
  S.addStockMove(pid('T1'), { type: 'receive', qty: 2 });
  const csv = S.stockMovesCSV();
  assert.ok(csv.startsWith('﻿'));
  const rows = S.parseCSV(csv).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[1][4], rows[2][4]], ['ยอดยกมา', 'รับเข้า']);
});

test('billNo: เติมศูนย์ 6 หลัก', () => {
  assert.equal(S.billNo(7), '000007');
  assert.equal(S.billNo(123456), '123456');
  assert.equal(S.billNo(1234567), '1234567');
});
