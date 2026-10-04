/* ชั้นข้อมูลและตรรกะธุรกิจ (ไม่ผูกกับ DOM) เก็บข้อมูลใน localStorage */
(function (root) {
  'use strict';
  var KEY = 'bosspos.v1';
  var state = { products: [], sales: [], seq: 1 };
  var mem = null, metaMem = null; // fallback เมื่อ localStorage ใช้ไม่ได้
  var META_KEY = 'bosspos.meta';

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

  function save() {
    var s = JSON.stringify(state);
    try { localStorage.setItem(KEY, s); } catch (e) { mem = s; }
  }
  function load() {
    var s = null;
    try { s = localStorage.getItem(KEY); } catch (e) { s = mem; }
    if (s) {
      try {
        var o = JSON.parse(s);
        if (o && Array.isArray(o.products) && Array.isArray(o.sales)) {
          state = { products: o.products, sales: o.sales, seq: o.seq || 1 };
          normalize();
          return false;
        }
      } catch (e) { /* ข้อมูลเสีย -> seed ใหม่ */ }
    }
    seed();
    return true;
  }

  // คำนวณวันที่ของบิลใหม่จากเวลา (ts) ตามเขตเวลาร้าน แก้ข้อมูลที่บันทึกด้วยเขตเวลาเครื่องเดิม
  function normalize() {
    state.sales.forEach(function (s) { s.date = dateKey(new Date(s.ts)); });
  }

  function seed() {
    state = { products: [], sales: [], seq: 1 };
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
      state.products.push({ id: uid('p'), sku: r[0], name: r[1], category: r[2], price: r[3], cost: r[4], stock: r[5], min: r[6] });
    });
    // ยอดขายย้อนหลัง 6 วัน + วันนี้ (ค่าคงที่ เพื่อให้ผลซ้ำได้)
    var today = todayKey(), n = 0;
    for (var back = 6; back >= 0; back--) {
      var day = addDays(today, -back);
      var bills = back === 0 ? 5 : 8 + (back * 3) % 7;
      for (var b = 0; b < bills; b++) {
        n++;
        var items = [], cnt = 1 + n % 3;
        for (var i = 0; i < cnt; i++) {
          var p = state.products[(n * 3 + i * 5) % state.products.length];
          items.push({ pid: p.id, name: p.name, qty: 1 + (n + i) % 3, price: p.price, cost: p.cost });
        }
        var t = at(day, 8 + (n * 2) % 12, (n * 7) % 60);
        if (back === 0 && t > new Date()) t = new Date(Date.now() - (6 - b) * 600000);
        state.sales.push(makeSale(items, t));
      }
    }
    save();
  }

  function makeSale(items, when) {
    var total = 0;
    items.forEach(function (i) { total += i.qty * i.price; });
    return { id: uid('s'), ts: when.toISOString(), date: dateKey(when), items: items, total: round2(total), voided: false };
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
      Object.keys(p).forEach(function (k) { cur[k] = p[k]; });
    } else { p.id = uid('p'); state.products.push(p); }
    save();
    return { ok: true };
  }
  function find(id) { return state.products.filter(function (p) { return p.id === id; })[0]; }
  function deleteProduct(id) {
    state.products = state.products.filter(function (p) { return p.id !== id; });
    save();
  }

  /* ---------- ขาย ---------- */
  // cart: [{pid, qty}]
  function checkout(cart, when) {
    if (!cart.length) return { ok: false, error: 'ตะกร้าว่าง' };
    var items = [];
    for (var i = 0; i < cart.length; i++) {
      var p = find(cart[i].pid), q = cart[i].qty;
      if (!p) return { ok: false, error: 'ไม่พบสินค้าในระบบ' };
      if (!(q >= 1) || q % 1) return { ok: false, error: 'จำนวนไม่ถูกต้อง: ' + p.name };
      if (q > p.stock) return { ok: false, error: 'สต็อกไม่พอ: ' + p.name + ' (เหลือ ' + p.stock + ')' };
      items.push({ pid: p.id, name: p.name, qty: q, price: p.price, cost: p.cost });
    }
    items.forEach(function (it) { find(it.pid).stock -= it.qty; });
    var s = makeSale(items, when || new Date());
    state.sales.push(s);
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
    s.items.forEach(function (it) { var p = find(it.pid); if (p) p.stock += it.qty; });
    save();
    return { ok: true };
  }

  /* ---------- รายงาน ---------- */
  function salesOn(k) { return state.sales.filter(function (s) { return s.date === k && !s.voided; }); }
  function summary(k) {
    var r = { revenue: 0, bills: 0, units: 0, profit: 0 };
    salesOn(k).forEach(function (s) {
      r.bills++;
      s.items.forEach(function (i) { r.units += i.qty; r.revenue += i.qty * i.price; r.profit += i.qty * (i.price - i.cost); });
    });
    r.revenue = round2(r.revenue); r.profit = round2(r.profit);
    r.avg = r.bills ? round2(r.revenue / r.bills) : 0;
    return r;
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
  function top(k, limit) {
    var m = {};
    salesOn(k).forEach(function (s) { s.items.forEach(function (i) {
      var e = m[i.pid] || (m[i.pid] = { name: i.name, qty: 0, revenue: 0 });
      e.qty += i.qty; e.revenue += i.qty * i.price;
    }); });
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
    if (!o || !Array.isArray(o.products) || !Array.isArray(o.sales)) return { ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' };
    state = { products: o.products, sales: o.sales, seq: o.seq || 1 };
    normalize();
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
    text = String(text).replace(/^\uFEFF/, '');
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
  function salesCSV() {
    var rows = [['วันที่', 'เวลา', 'เลขบิล', 'สินค้า', 'จำนวน', 'ราคา', 'รวม', 'สถานะ', 'เหตุผลยกเลิก']];
    state.sales.forEach(function (s) {
      s.items.forEach(function (i) {
        rows.push([s.date, timeLabel(s.ts), s.id, i.name, i.qty, i.price, i.qty * i.price, s.voided ? 'ยกเลิก' : 'ปกติ', s.voidReason || '']);
      });
    });
    return csv(rows);
  }
  function productsCSV() {
    var rows = [['SKU', 'ชื่อ', 'หมวดหมู่', 'ราคาขาย', 'ต้นทุน', 'สต็อก', 'จุดสั่งซื้อ']];
    state.products.forEach(function (p) { rows.push([p.sku, p.name, p.category, p.price, p.cost, p.stock, p.min]); });
    return csv(rows);
  }

  root.Store = {
    load: load, seed: seed, dateKey: dateKey, addDays: addDays, today: todayKey, hourOf: hourOf, timeLabel: timeLabel, at: at,
    products: function () { return state.products; }, sales: function () { return state.sales; }, find: find,
    saveProduct: saveProduct, deleteProduct: deleteProduct, checkout: checkout, voidSale: voidSale,
    salesOn: salesOn, summary: summary, hourly: hourly, lastDays: lastDays, top: top, lowStock: lowStock,
    exportJSON: exportJSON, importJSON: importJSON,
    parseCSV: parseCSV, parseProductsCSV: parseProductsCSV, importProducts: importProducts, productsTemplateCSV: productsTemplateCSV,
    markBackup: markBackup, backupStatus: backupStatus, salesCSV: salesCSV, productsCSV: productsCSV
  };
  if (typeof module !== 'undefined') module.exports = root.Store;
})(typeof window !== 'undefined' ? window : globalThis);
