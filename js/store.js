/* ชั้นข้อมูลและตรรกะธุรกิจ (ไม่ผูกกับ DOM) เก็บข้อมูลใน localStorage */
(function (root) {
  'use strict';
  var KEY = 'bosspos.v1';        // ชื่อ key คงเดิมเพื่อให้ข้อมูลเก่าอ่านได้ (เวอร์ชันโครงสร้างอยู่ใน schemaVersion)
  var META_KEY = 'bosspos.meta';
  var SCHEMA = 2;
  var METHODS = ['cash', 'transfer', 'qr'];
  var state = emptyState();
  var mem = null, metaMem = null; // fallback เมื่อ localStorage ใช้ไม่ได้

  function defaultSettings() { return { shopName: 'Boss POS', taxId: '', footer: 'ขอบคุณที่อุดหนุน', receiptWidth: 80 }; }
  function emptyState() {
    return { schemaVersion: SCHEMA, products: [], sales: [], stockMoves: [], shifts: [], settings: defaultSettings(), seq: 1, saleNo: 0 };
  }

  function uid(p) { return p + (state.seq++).toString(36) + Date.now().toString(36); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // วัน/เวลาทั้งหมดอิงเขตเวลาร้าน Asia/Bangkok (UTC+7, ไม่มี DST) ไม่ขึ้นกับนาฬิกาเครื่อง
  var TZ_OFFSET = 7 * 3600000;
  function shifted(d) { return new Date(d.getTime() + TZ_OFFSET); }
  function dateKey(d) { var s = shifted(d); return s.getUTCFullYear() + '-' + pad(s.getUTCMonth() + 1) + '-' + pad(s.getUTCDate()); }
  function todayKey() { return dateKey(new Date()); }
  function hourOf(ts) { return shifted(new Date(ts)).getUTCHours(); }
  function timeLabel(ts) { var s = shifted(new Date(ts)); return pad(s.getUTCHours()) + ':' + pad(s.getUTCMinutes()); }
  function at(k, h, m) { var p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], h, m) - TZ_OFFSET); }
  function addDays(k, n) {
    var p = k.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function billNo(n) { var s = String(n || 0); while (s.length < 6) s = '0' + s; return s; }

  function save() {
    var s = JSON.stringify(state);
    try { localStorage.setItem(KEY, s); } catch (e) { mem = s; }
  }
  function load() {
    var s = null;
    try { s = localStorage.getItem(KEY); } catch (e) { s = mem; }
    if (s) {
      try {
        var r = migrate(JSON.parse(s));
        if (r.ok) { state = r.state; if (r.changed) save(); return false; }
      } catch (e) { /* ข้อมูลเสีย -> seed ใหม่ */ }
    }
    seed();
    return true;
  }

  /* ---------- Migration: v1 -> v2 (และเติมค่าเริ่มต้นให้ v2) ----------
     v1 = {products, sales, seq}; v2 เพิ่ม schemaVersion, stockMoves, shifts, settings, saleNo
     และฟิลด์ของบิล: no, subtotal, discount, paymentMethod, paid, change, shiftId */
  function migrate(o) {
    if (!o || !Array.isArray(o.products) || !Array.isArray(o.sales)) return { ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' };
    if (o.schemaVersion > SCHEMA) return { ok: false, error: 'ไฟล์นี้มาจากเวอร์ชันที่ใหม่กว่าแอปนี้' };
    var legacy = !(o.schemaVersion >= 2);
    var prev = state, s = emptyState();
    s.products = o.products; s.sales = o.sales;
    s.stockMoves = Array.isArray(o.stockMoves) ? o.stockMoves : [];
    s.shifts = Array.isArray(o.shifts) ? o.shifts : [];
    s.settings = cleanSettings(Object.assign(defaultSettings(), o.settings || {}));
    s.seq = o.seq || 1; s.saleNo = o.saleNo || 0;
    state = s; // ให้ uid()/logMove() ใช้ seq ของข้อมูลที่กำลังย้าย
    try {
      s.sales.forEach(function (x) {
        x.date = dateKey(new Date(x.ts));
        x.items = x.items || [];
        var gross = 0;
        x.items.forEach(function (i) { if (i.discount === undefined) i.discount = 0; gross += i.qty * i.price; });
        if (x.subtotal === undefined) x.subtotal = round2(gross);
        if (x.billDiscount === undefined) x.billDiscount = 0;
        if (x.discount === undefined) x.discount = round2(x.subtotal - x.total);
        if (!x.paymentMethod) x.paymentMethod = 'unknown'; // บิลเก่าไม่ได้บันทึกวิธีชำระ
        if (x.paid === undefined) x.paid = x.total;
        if (x.change === undefined) x.change = 0;
        if (x.shiftId === undefined) x.shiftId = null;
      });
      s.sales.filter(function (x) { return !x.no; })
        .sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; })
        .forEach(function (x) { x.no = ++s.saleNo; });
      if (legacy) {
        s.products.forEach(function (p) { logMove(p, 'opening', p.stock, { reason: 'ยอดยกมา', ts: new Date(0).toISOString() }); });
      }
      s.schemaVersion = SCHEMA;
    } finally { state = prev; }
    return { ok: true, state: s, changed: legacy };
  }

  function cleanSettings(st) {
    st.shopName = String(st.shopName || '').trim().slice(0, 60) || 'Boss POS';
    st.taxId = String(st.taxId || '').trim().slice(0, 20);
    st.footer = String(st.footer || '').trim().slice(0, 120);
    st.receiptWidth = Number(st.receiptWidth) === 58 ? 58 : 80;
    return st;
  }

  function seed() {
    state = emptyState();
    var demo = [
      ['DR001', 'น้ำดื่ม 600 มล.', 'เครื่องดื่ม', 7, 4, 120, 30],
      ['DR002', 'กาแฟกระป๋อง', 'เครื่องดื่ม', 15, 9, 60, 20],
      ['DR003', 'ชาเขียวพร้อมดื่ม', 'เครื่องดื่ม', 20, 12, 8, 15],
      ['SN001', 'มันฝรั่งทอดกรอบ', 'ขนม', 25, 16, 45, 15],
      ['SN002', 'ช็อกโกแลตแท่ง', 'ขนม', 18, 11, 30, 10],
      ['FD001', 'ข้าวกล่องไก่กระเทียม', 'อาหาร', 45, 28, 25, 10],
      ['FD002', 'บะหมี่กึ่งสำเร็จรูป', 'อาหาร', 8, 5, 90, 30],
      ['HH001', 'สบู่เหลว 450 มล.', 'ของใช้', 79, 52, 18, 8],
      ['HH002', 'ผงซักฟอก 1 กก.', 'ของใช้', 95, 68, 0, 6],
      ['HH003', 'กระดาษทิชชู่ 6 ม้วน', 'ของใช้', 55, 38, 40, 12]
    ];
    demo.forEach(function (r) {
      var p = { id: uid('p'), sku: r[0], name: r[1], category: r[2], price: r[3], cost: r[4], stock: r[5], min: r[6] };
      state.products.push(p);
      logMove(p, 'opening', p.stock, { reason: 'ยอดยกมา' });
    });
    // ยอดขายย้อนหลัง 6 วัน + วันนี้ (ค่าคงที่ เพื่อให้ผลซ้ำได้) ไม่ตัดสต็อก ถือว่าสต็อกข้างบนเป็นยอดปัจจุบันแล้ว
    var today = todayKey(), n = 0;
    for (var back = 6; back >= 0; back--) {
      var day = addDays(today, -back);
      var bills = back === 0 ? 5 : 8 + (back * 3) % 7;
      for (var b = 0; b < bills; b++) {
        n++;
        var items = [], cnt = 1 + n % 3;
        for (var i = 0; i < cnt; i++) {
          var p2 = state.products[(n * 3 + i * 5) % state.products.length];
          items.push({ pid: p2.id, name: p2.name, qty: 1 + (n + i) % 3, price: p2.price, cost: p2.cost, discount: 0 });
        }
        var t = at(day, 8 + (n * 2) % 12, (n * 7) % 60);
        if (back === 0 && t > new Date()) t = new Date(Date.now() - (6 - b) * 600000);
        state.sales.push(makeSale(items, t, { method: METHODS[n % 3] }));
      }
    }
    save();
  }

  // สร้างบิล (ยังไม่ตัดสต็อก) items: [{pid,name,qty,price,cost,discount}]
  function makeSale(items, when, o) {
    o = o || {};
    var gross = 0, lineDisc = 0;
    items.forEach(function (i) { gross += i.qty * i.price; lineDisc += i.discount || 0; });
    var billDisc = o.billDiscount || 0;
    var total = round2(gross - lineDisc - billDisc);
    var paid = o.received !== undefined ? o.received : total;
    return {
      id: uid('s'), no: ++state.saleNo, ts: when.toISOString(), date: dateKey(when), items: items,
      subtotal: round2(gross), billDiscount: round2(billDisc), billDiscountSpec: o.billSpec || null,
      discount: round2(lineDisc + billDisc), total: total,
      paymentMethod: o.method || 'cash', paid: round2(paid), change: round2(paid - total),
      shiftId: o.shiftId || null, voided: false
    };
  }

  /* ---------- สต็อกและประวัติการเคลื่อนไหว ---------- */
  // บันทึก movement หลังปรับ p.stock แล้ว: qty = ส่วนต่าง (+/-), balance = ยอดคงเหลือหลังรายการ
  function logMove(p, type, delta, extra) {
    extra = extra || {};
    var m = { id: uid('m'), pid: p.id, sku: p.sku, name: p.name, type: type, qty: delta, balance: p.stock,
      reason: extra.reason || '', note: extra.note || '', ts: extra.ts || new Date().toISOString() };
    if (extra.saleId) m.saleId = extra.saleId;
    state.stockMoves.push(m);
    return m;
  }
  var MOVE_TYPES = ['receive', 'waste', 'adjust'];
  function addStockMove(pid, input) {
    var p = find(pid);
    if (!p) return { ok: false, error: 'ไม่พบสินค้า' };
    var type = input.type, reason = String(input.reason || '').trim().slice(0, 100), note = String(input.note || '').trim().slice(0, 200);
    if (MOVE_TYPES.indexOf(type) < 0) return { ok: false, error: 'ประเภทรายการไม่ถูกต้อง' };
    var delta;
    if (type === 'adjust') {
      var counted = Number(input.counted);
      if (input.counted === '' || input.counted === undefined || !(counted >= 0) || counted % 1) return { ok: false, error: 'ยอดที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ' };
      delta = counted - p.stock;
      if (delta === 0) return { ok: false, error: 'ยอดที่นับได้เท่ากับยอดในระบบ' };
      reason = reason || 'นับสต็อก';
    } else {
      var q = Number(input.qty);
      if (!(q >= 1) || q % 1) return { ok: false, error: 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1' };
      if (type === 'waste') {
        if (q > p.stock) return { ok: false, error: 'จำนวนเกินสต็อกคงเหลือ (' + p.stock + ')' };
        if (!reason) return { ok: false, error: 'กรุณาระบุสาเหตุ' };
        delta = -q;
      } else { delta = q; reason = reason || 'รับสินค้าเข้า'; }
    }
    p.stock += delta;
    var m = logMove(p, type, delta, { reason: reason, note: note });
    save();
    return { ok: true, move: m };
  }
  function moves(pid, limit) {
    var list = state.stockMoves.filter(function (m) { return !pid || m.pid === pid; });
    list = list.map(function (m, i) { return { m: m, i: i }; })
      .sort(function (a, b) { return a.m.ts < b.m.ts ? 1 : a.m.ts > b.m.ts ? -1 : b.i - a.i; })
      .map(function (x) { return x.m; });
    return limit ? list.slice(0, limit) : list;
  }

  /* ---------- สินค้า ---------- */
  function validate(p, ignoreId) {
    if (!p.sku || !p.name) return 'กรุณากรอกรหัสและชื่อสินค้า';
    if (p.sku.length > 30 || p.name.length > 100 || p.category.length > 40) return 'รหัส/ชื่อ/หมวดหมู่ยาวเกินกำหนด';
    if (!(p.price >= 0) || !(p.cost >= 0)) return 'ราคาและต้นทุนต้องเป็นตัวเลขไม่ติดลบ';
    if (!(p.stock >= 0) || !(p.min >= 0) || p.stock % 1 || p.min % 1) return 'สต็อกและจุดสั่งซื้อต้องเป็นจำนวนเต็มไม่ติดลบ';
    var dup = state.products.some(function (x) { return x.id !== ignoreId && x.sku.toLowerCase() === p.sku.toLowerCase(); });
    return dup ? 'รหัสสินค้านี้มีอยู่แล้ว' : '';
  }
  function clean(p) {
    return { sku: String(p.sku || '').trim(), name: String(p.name || '').trim(), category: String(p.category || '').trim() || 'ทั่วไป',
      price: Number(p.price), cost: Number(p.cost), stock: Number(p.stock), min: Number(p.min) };
  }
  function saveProduct(input, id) {
    var p = clean(input), err = validate(p, id);
    if (err) return { ok: false, error: err };
    if (id) {
      var cur = find(id);
      if (!cur) return { ok: false, error: 'ไม่พบสินค้า' };
      var before = cur.stock;
      Object.keys(p).forEach(function (k) { cur[k] = p[k]; });
      if (cur.stock !== before) logMove(cur, 'adjust', cur.stock - before, { reason: 'แก้ไขจากหน้าสินค้า' });
    } else {
      p.id = uid('p'); state.products.push(p);
      if (p.stock > 0) logMove(p, 'opening', p.stock, { reason: 'ยอดยกมา' });
    }
    save();
    return { ok: true };
  }
  function find(id) { return state.products.filter(function (p) { return p.id === id; })[0]; }
  function deleteProduct(id) {
    state.products = state.products.filter(function (p) { return p.id !== id; });
    save();
  }

  /* ---------- ขาย ---------- */
  // cart: [{pid, qty, disc}] disc = ส่วนลดรายการ (บาททั้งรายการ); bill: {type:'baht'|'pct', value}
  function quote(cart, bill) {
    if (!cart || !cart.length) return { ok: false, error: 'ตะกร้าว่าง' };
    var lines = [], gross = 0, lineDisc = 0, used = {};
    for (var i = 0; i < cart.length; i++) {
      var c = cart[i], p = find(c.pid), q = Number(c.qty);
      if (!p) return { ok: false, error: 'ไม่พบสินค้าในระบบ' };
      if (!(q >= 1) || q % 1) return { ok: false, error: 'จำนวนไม่ถูกต้อง: ' + p.name };
      used[p.id] = (used[p.id] || 0) + q;
      if (used[p.id] > p.stock) return { ok: false, error: 'สต็อกไม่พอ: ' + p.name + ' (เหลือ ' + p.stock + ')' };
      var g = round2(p.price * q), d = c.disc === '' || c.disc === undefined ? 0 : round2(Number(c.disc));
      if (!(d >= 0)) return { ok: false, error: 'ส่วนลดรายการไม่ถูกต้อง: ' + p.name };
      if (d > g) return { ok: false, error: 'ส่วนลดรายการเกินราคา: ' + p.name };
      lines.push({ pid: p.id, name: p.name, qty: q, price: p.price, cost: p.cost, discount: d, gross: g, net: round2(g - d) });
      gross += g; lineDisc += d;
    }
    gross = round2(gross); lineDisc = round2(lineDisc);
    var after = round2(gross - lineDisc);
    bill = bill || {};
    var type = bill.type === 'pct' ? 'pct' : 'baht';
    var v = bill.value === '' || bill.value === undefined ? 0 : Number(bill.value);
    if (!(v >= 0)) return { ok: false, error: 'ส่วนลดท้ายบิลไม่ถูกต้อง' };
    var billDisc;
    if (type === 'pct') {
      if (v > 100) return { ok: false, error: 'ส่วนลดท้ายบิลเกิน 100%' };
      billDisc = round2(after * v / 100);
    } else {
      if (v > after) return { ok: false, error: 'ส่วนลดท้ายบิลเกินยอดรวม' };
      billDisc = round2(v);
    }
    return { ok: true, lines: lines, subtotal: gross, lineDiscount: lineDisc, billDiscount: billDisc,
      billSpec: v > 0 ? { type: type, value: v } : null, total: round2(after - billDisc) };
  }
  // opts: {bill, payment:{method, received}, when}
  function checkout(cart, opts) {
    opts = opts || {};
    var q = quote(cart, opts.bill);
    if (!q.ok) return q;
    var pay = opts.payment || {}, method = pay.method || 'cash';
    if (METHODS.indexOf(method) < 0) return { ok: false, error: 'วิธีชำระเงินไม่ถูกต้อง' };
    var received;
    if (method === 'cash' && pay.received !== undefined && pay.received !== '') {
      received = Number(pay.received);
      if (!(received >= q.total)) return { ok: false, error: 'รับเงินไม่พอ (ต้องรับอย่างน้อย ' + q.total + ')' };
    }
    q.lines.forEach(function (l) { find(l.pid).stock -= l.qty; });
    var items = q.lines.map(function (l) { return { pid: l.pid, name: l.name, qty: l.qty, price: l.price, cost: l.cost, discount: l.discount }; });
    var cur = currentShift();
    var s = makeSale(items, opts.when || new Date(), { method: method, received: received, billDiscount: q.billDiscount, billSpec: q.billSpec, shiftId: cur ? cur.id : null });
    state.sales.push(s);
    q.lines.forEach(function (l) { logMove(find(l.pid), 'sale', -l.qty, { reason: 'ขาย #' + billNo(s.no), saleId: s.id, ts: s.ts }); });
    save();
    return { ok: true, sale: s };
  }
  function voidSale(id, reason) {
    reason = String(reason || '').trim().slice(0, 200);
    if (!reason) return { ok: false, error: 'กรุณาระบุเหตุผลการยกเลิกบิล' };
    var s = state.sales.filter(function (x) { return x.id === id; })[0];
    if (!s) return { ok: false, error: 'ไม่พบบิล' };
    if (s.voided) return { ok: false, error: 'บิลนี้ถูกยกเลิกแล้ว' };
    s.voided = true;
    s.voidReason = reason;
    s.voidedAt = new Date().toISOString();
    s.items.forEach(function (it) {
      var p = find(it.pid);
      if (p) { p.stock += it.qty; logMove(p, 'void', it.qty, { reason: 'ยกเลิกบิล #' + billNo(s.no), saleId: s.id }); }
    });
    save();
    return { ok: true };
  }
  function saleById(id) { return state.sales.filter(function (x) { return x.id === id; })[0]; }

  /* ---------- รอบขาย (shift) ---------- */
  function currentShift() { return state.shifts.filter(function (s) { return !s.closedAt; })[0] || null; }
  function liveShiftFigures(sh) {
    var mine = state.sales.filter(function (x) { return x.shiftId === sh.id && !x.voided; });
    var cash = 0, revenue = 0;
    mine.forEach(function (x) { revenue += x.total; if (x.paymentMethod === 'cash') cash += x.total; });
    return { bills: mine.length, revenue: round2(revenue), cashSales: round2(cash), expected: round2(sh.openCash + cash) };
  }
  function shiftSummary(sh) { return sh.closedAt ? sh : Object.assign({}, sh, liveShiftFigures(sh)); }
  function openShift(openCash, when) {
    if (currentShift()) return { ok: false, error: 'มีรอบขายที่เปิดอยู่แล้ว' };
    var c = openCash === '' || openCash === undefined ? 0 : Number(openCash);
    if (!(c >= 0)) return { ok: false, error: 'เงินทอนตั้งต้นต้องไม่ติดลบ' };
    when = when || new Date();
    var sh = { id: uid('h'), openedAt: when.toISOString(), date: dateKey(when), openCash: round2(c), closedAt: null };
    state.shifts.push(sh);
    save();
    return { ok: true, shift: sh };
  }
  function closeShift(counted, note, when) {
    var sh = currentShift();
    if (!sh) return { ok: false, error: 'ไม่มีรอบขายที่เปิดอยู่' };
    if (counted === '' || counted === undefined || !(Number(counted) >= 0)) return { ok: false, error: 'ยอดเงินสดที่นับได้ต้องไม่ติดลบ' };
    var f = liveShiftFigures(sh), c = round2(Number(counted));
    Object.assign(sh, f, { countedCash: c, diff: round2(c - f.expected), note: String(note || '').trim().slice(0, 200), closedAt: (when || new Date()).toISOString() });
    save();
    return { ok: true, shift: sh };
  }
  function shiftsOn(k) {
    return state.shifts.filter(function (s) { return s.date === k; }).map(shiftSummary)
      .sort(function (a, b) { return a.openedAt < b.openedAt ? -1 : 1; });
  }

  /* ---------- ตั้งค่าร้าน ---------- */
  function settings() { return Object.assign({}, state.settings); }
  function saveSettings(input) {
    state.settings = cleanSettings(Object.assign({}, state.settings, input));
    save();
    return { ok: true };
  }

  /* ---------- รายงาน ---------- */
  function salesOn(k) { return state.sales.filter(function (s) { return s.date === k && !s.voided; }); }
  function saleCost(s) { var c = 0; s.items.forEach(function (i) { c += i.qty * i.cost; }); return c; }
  function summary(k) {
    var r = { revenue: 0, bills: 0, units: 0, profit: 0, discount: 0 };
    salesOn(k).forEach(function (s) {
      r.bills++; r.revenue += s.total; r.discount += s.discount || 0; r.profit += s.total - saleCost(s);
      s.items.forEach(function (i) { r.units += i.qty; });
    });
    r.revenue = round2(r.revenue); r.profit = round2(r.profit); r.discount = round2(r.discount);
    r.avg = r.bills ? round2(r.revenue / r.bills) : 0;
    return r;
  }
  function paymentBreakdown(k) {
    var out = { cash: { bills: 0, amount: 0 }, transfer: { bills: 0, amount: 0 }, qr: { bills: 0, amount: 0 }, unknown: { bills: 0, amount: 0 } };
    salesOn(k).forEach(function (s) {
      var e = out[s.paymentMethod] || out.unknown;
      e.bills++; e.amount = round2(e.amount + s.total);
    });
    return out;
  }
  function hourly(k) {
    var h = []; for (var i = 0; i < 24; i++) h.push(0);
    salesOn(k).forEach(function (s) { h[hourOf(s.ts)] += s.total; });
    return h.map(round2);
  }
  function lastDays(k, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) { var d = addDays(k, -i); out.push({ date: d, revenue: summary(d).revenue }); }
    return out;
  }
  // ยอดสุทธิต่อรายการหลังส่วนลดรายการ และกระจายส่วนลดท้ายบิลตามสัดส่วน (เศษสตางค์ลงรายการสุดท้าย)
  function lineNets(s) {
    var nets = s.items.map(function (i) { return round2(i.qty * i.price - (i.discount || 0)); });
    var bd = s.billDiscount || 0, base = 0;
    nets.forEach(function (x) { base += x; });
    if (!bd || !base) return nets;
    var left = bd;
    return nets.map(function (x, idx) {
      var cut = idx === nets.length - 1 ? left : round2(bd * x / base);
      left = round2(left - cut);
      return round2(x - cut);
    });
  }
  function top(k, limit) {
    var m = {};
    salesOn(k).forEach(function (s) {
      var nets = lineNets(s);
      s.items.forEach(function (i, idx) {
        var e = m[i.pid] || (m[i.pid] = { name: i.name, qty: 0, revenue: 0 });
        e.qty += i.qty; e.revenue = round2(e.revenue + nets[idx]);
      });
    });
    return Object.keys(m).map(function (x) { return m[x]; })
      .sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, limit || 5);
  }
  function lowStock() {
    return state.products.filter(function (p) { return p.stock <= p.min; })
      .sort(function (a, b) { return a.stock - b.stock; });
  }

  /* ---------- นำเข้า/ส่งออก ---------- */
  function exportJSON() { return JSON.stringify(state, null, 2); }
  function importJSON(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, error: 'ไฟล์ไม่ใช่ JSON ที่ถูกต้อง' }; }
    var r = migrate(o);
    if (!r.ok) return r;
    state = r.state;
    save();
    return { ok: true };
  }

  /* ---------- นำเข้าสินค้าจาก CSV ---------- */
  var ALIAS = {
    sku: ['sku', 'รหัส', 'รหัสสินค้า'], name: ['name', 'ชื่อ', 'ชื่อสินค้า'], category: ['category', 'หมวดหมู่', 'หมวด'],
    price: ['price', 'ราคาขาย', 'ราคา'], cost: ['cost', 'ต้นทุน'], stock: ['stock', 'สต็อก', 'คงเหลือ'], min: ['min', 'จุดสั่งซื้อ']
  };
  var CSV_MAX_ROWS = 5000;
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    var rows = [], row = [], cell = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charAt(i);
      if (q) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return { rows: rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); }), unterminated: q };
  }
  function num(v) {
    var t = String(v === undefined ? '' : v).replace(/,/g, '').trim();
    return t === '' ? NaN : Number(t);
  }
  // คืน {valid:[สินค้าที่นำเข้าได้], errors:[{line,msg}], fatal}
  function parseProductsCSV(text) {
    var out = { valid: [], errors: [], fatal: '' };
    var parsed = parseCSV(text), rows = parsed.rows;
    if (parsed.unterminated) { out.fatal = 'ไฟล์ CSV ไม่สมบูรณ์ (เครื่องหมายคำพูดไม่ครบคู่)'; return out; }
    if (rows.length < 2) { out.fatal = 'ไม่พบข้อมูล (ต้องมีแถวหัวคอลัมน์และอย่างน้อย 1 แถวข้อมูล)'; return out; }
    if (rows.length - 1 > CSV_MAX_ROWS) { out.fatal = 'จำนวนแถวเกิน ' + CSV_MAX_ROWS + ' แถว'; return out; }
    var col = {}, head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    Object.keys(ALIAS).forEach(function (k) {
      for (var j = 0; j < head.length; j++) if (ALIAS[k].indexOf(head[j]) >= 0) { col[k] = j; return; }
    });
    var missing = ['sku', 'name', 'price', 'cost', 'stock'].filter(function (k) { return col[k] === undefined; });
    if (missing.length) { out.fatal = 'ไม่พบคอลัมน์ที่จำเป็น: ' + missing.join(', '); return out; }
    var seen = {}; // SKU ที่พบแล้วในไฟล์ (ซ้ำกับสินค้าเดิมตรวจโดย validate)
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r], line = r + 1;
      var get = function (k) { return col[k] === undefined ? '' : cells[col[k]]; };
      var minRaw = get('min');
      var raw = { sku: get('sku'), name: get('name'), category: get('category'),
        price: num(get('price')), cost: num(get('cost')), stock: num(get('stock')), min: String(minRaw === undefined ? '' : minRaw).trim() === '' ? 5 : num(minRaw) };
      var p = clean(raw), err = '';
      if (isNaN(p.price) || isNaN(p.cost) || isNaN(p.stock) || isNaN(p.min)) err = 'ค่าตัวเลขไม่ถูกต้องหรือว่าง';
      else err = validate(p, null) || (seen[p.sku.toLowerCase()] ? 'รหัสสินค้าซ้ำกันในไฟล์' : '');
      if (err) { out.errors.push({ line: line, sku: p.sku, msg: err }); continue; }
      seen[p.sku.toLowerCase()] = 1;
      out.valid.push(p);
    }
    return out;
  }
  function importProducts(list) {
    var added = 0;
    list.forEach(function (raw) {
      var p = clean(raw);
      if (validate(p, null)) return; // กันซ้ำ/ผิดพลาดอีกชั้น
      p.id = uid('p'); state.products.push(p); added++;
      if (p.stock > 0) logMove(p, 'opening', p.stock, { reason: 'ยอดยกมา (นำเข้า CSV)' });
    });
    save();
    return { added: added, skipped: list.length - added };
  }
  function productsTemplateCSV() {
    return csv([['SKU', 'ชื่อ', 'หมวดหมู่', 'ราคาขาย', 'ต้นทุน', 'สต็อก', 'จุดสั่งซื้อ'],
      ['EX001', 'ตัวอย่างสินค้า', 'ทั่วไป', 25, 15, 100, 20]]);
  }

  /* ---------- เตือนสำรองข้อมูล ---------- */
  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return metaMem || {}; }
  }
  function writeMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { metaMem = m; }
  }
  function markBackup(now) {
    var m = readMeta(); m.lastBackupAt = (now || new Date()).toISOString(); writeMeta(m);
  }
  function backupStatus(now) {
    now = now || new Date();
    var m = readMeta();
    if (!m.firstUseAt) { m.firstUseAt = now.toISOString(); writeMeta(m); }
    var days = Math.floor((now - new Date(m.lastBackupAt || m.firstUseAt)) / 86400000);
    return { due: days >= 7, days: days, never: !m.lastBackupAt };
  }

  function csvCell(v) {
    v = String(v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // กัน CSV/formula injection
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function csv(rows) { return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }
  var METHOD_TH = { cash: 'เงินสด', transfer: 'โอน', qr: 'QR', unknown: 'ไม่ระบุ' };
  // คอลัมน์ระดับบิล (ส่วนลดท้ายบิล/ยอดสุทธิ/วิธีชำระ) ใส่เฉพาะแถวแรกของบิล เพื่อไม่ให้รวมซ้ำเมื่อ SUM
  function salesCSV() {
    var rows = [['วันที่', 'เวลา', 'เลขบิล', 'สินค้า', 'จำนวน', 'ราคา', 'ส่วนลดรายการ', 'รวมรายการ', 'ส่วนลดท้ายบิล', 'ยอดสุทธิบิล', 'วิธีชำระ', 'สถานะ', 'เหตุผลยกเลิก']];
    state.sales.forEach(function (s) {
      s.items.forEach(function (i, idx) {
        var first = idx === 0;
        rows.push([s.date, timeLabel(s.ts), billNo(s.no), i.name, i.qty, i.price, i.discount || 0, round2(i.qty * i.price - (i.discount || 0)),
          first ? s.billDiscount || 0 : '', first ? s.total : '', first ? METHOD_TH[s.paymentMethod] || METHOD_TH.unknown : '',
          s.voided ? 'ยกเลิก' : 'ปกติ', s.voidReason || '']);
      });
    });
    return csv(rows);
  }
  function productsCSV() {
    var rows = [['SKU', 'ชื่อ', 'หมวดหมู่', 'ราคาขาย', 'ต้นทุน', 'สต็อก', 'จุดสั่งซื้อ']];
    state.products.forEach(function (p) { rows.push([p.sku, p.name, p.category, p.price, p.cost, p.stock, p.min]); });
    return csv(rows);
  }
  var MOVE_TH = { opening: 'ยอดยกมา', receive: 'รับเข้า', sale: 'ขาย', void: 'ยกเลิกบิล', adjust: 'ปรับยอด', waste: 'ชำรุด/สูญเสีย' };
  function stockMovesCSV() {
    var rows = [['วันที่', 'เวลา', 'SKU', 'สินค้า', 'ประเภท', 'จำนวน', 'คงเหลือ', 'เหตุผล', 'หมายเหตุ']];
    moves().reverse().forEach(function (m) {
      rows.push([dateKey(new Date(m.ts)), timeLabel(m.ts), m.sku, m.name, MOVE_TH[m.type] || m.type, m.qty, m.balance, m.reason, m.note]);
    });
    return csv(rows);
  }

  root.Store = {
    load: load, seed: seed, dateKey: dateKey, addDays: addDays, today: todayKey, hourOf: hourOf, timeLabel: timeLabel, at: at, billNo: billNo,
    METHODS: METHODS, METHOD_TH: METHOD_TH, MOVE_TH: MOVE_TH,
    products: function () { return state.products; }, sales: function () { return state.sales; }, shifts: function () { return state.shifts; },
    find: find, saleById: saleById,
    saveProduct: saveProduct, deleteProduct: deleteProduct, quote: quote, checkout: checkout, voidSale: voidSale,
    addStockMove: addStockMove, moves: moves,
    currentShift: currentShift, shiftSummary: shiftSummary, openShift: openShift, closeShift: closeShift, shiftsOn: shiftsOn,
    settings: settings, saveSettings: saveSettings,
    salesOn: salesOn, summary: summary, paymentBreakdown: paymentBreakdown, hourly: hourly, lastDays: lastDays, top: top, lowStock: lowStock, lineNets: lineNets,
    exportJSON: exportJSON, importJSON: importJSON,
    parseCSV: parseCSV, parseProductsCSV: parseProductsCSV, importProducts: importProducts, productsTemplateCSV: productsTemplateCSV,
    markBackup: markBackup, backupStatus: backupStatus,
    salesCSV: salesCSV, productsCSV: productsCSV, stockMovesCSV: stockMovesCSV
  };
  if (typeof module !== 'undefined') module.exports = root.Store;
})(typeof window !== 'undefined' ? window : globalThis);
