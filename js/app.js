(function () {
  'use strict';
  var S = window.Store;
  var $ = function (id) { return document.getElementById(id); };
  var cart = []; // [{pid, qty, disc}]
  var selDate = S.today();
  var voidId = null, importRows = [], stockPid = null, stockType = 'receive';
  var editingId = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function baht(n) { n = Number(n); var d = Math.abs(n % 1) > 1e-9 ? 2 : 0; return n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: 2 }); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function thDate(k) {
    var p = k.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function stockTag(p) {
    if (p.stock <= 0) return '<span class="tag out">หมด</span>';
    if (p.stock <= p.min) return '<span class="tag warn">ใกล้หมด</span>';
    return '';
  }

  /* ---------- Dashboard ---------- */
  function bars(el, vals, labels, selIdx, desc) {
    var max = Math.max.apply(null, vals.concat([1]));
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', desc);
    el.innerHTML = vals.map(function (v, i) {
      return '<div class="bar" title="' + esc(labels[i]) + ': ' + baht(v) + ' บาท"><i class="' + (i === selIdx ? 'sel' : '') +
        '" style="height:' + Math.round(v / max * 100) + '%"></i><em>' + esc(labels[i]) + '</em></div>';
    }).join('');
  }
  function renderBackupBanner() {
    var st = S.backupStatus(), el = $('backup-banner');
    el.hidden = !st.due;
    if (st.due) {
      el.querySelector('span').textContent = st.never ? 'ยังไม่เคยสำรองข้อมูล (ใช้งานมา ' + st.days + ' วัน)' : 'ไม่ได้สำรองข้อมูลมา ' + st.days + ' วัน';
    }
  }
  function renderDashboard() {
    renderBackupBanner();
    $('d-date').value = selDate;
    var s = S.summary(selDate);
    $('kpis').innerHTML =
      '<div class="kpi"><span>ยอดขายรวม (บาท)</span><b id="k-rev">' + baht(s.revenue) + '</b></div>' +
      '<div class="kpi"><span>จำนวนบิล</span><b id="k-bills">' + s.bills + '</b></div>' +
      '<div class="kpi"><span>จำนวนชิ้น</span><b>' + s.units + '</b></div>' +
      '<div class="kpi"><span>กำไรขั้นต้น (บาท)</span><b>' + baht(s.profit) + '</b></div>';

    var h = S.hourly(selDate), hl = h.map(function (_, i) { return i % 3 === 0 ? String(i) : ''; });
    var peak = h.indexOf(Math.max.apply(null, h));
    bars($('hourly'), h, hl, -1, s.revenue ? 'ยอดขายรายชั่วโมง 24 ชั่วโมง ช่วงขายดีสุดเวลา ' + peak + ':00 น. รวม ' + baht(s.revenue) + ' บาท' : 'ยังไม่มียอดขาย');
    Array.prototype.forEach.call($('hourly').children, function (b, i) { b.title = i + ':00 น. = ' + baht(h[i]) + ' บาท'; });

    var wk = S.lastDays(selDate, 7);
    bars($('week'), wk.map(function (d) { return d.revenue; }), wk.map(function (d) { return thDate(d.date); }), 6,
      '7 วันล่าสุด: ' + wk.map(function (d) { return thDate(d.date) + ' ' + baht(d.revenue); }).join(', ') + ' บาท');

    var top = S.top(selDate, 5);
    $('top').innerHTML = top.length ? top.map(function (t, i) {
      return '<div class="item"><div class="l">' + (i + 1) + '. ' + esc(t.name) + '</div><div class="r">' + t.qty + ' ชิ้น · <b>' + baht(t.revenue) + '</b></div></div>';
    }).join('') : '<div class="empty">ยังไม่มียอดขายในวันนี้</div>';

    var pb = S.paymentBreakdown(selDate);
    $('pay').innerHTML = s.bills ? ['cash', 'transfer', 'qr', 'unknown'].filter(function (k) { return pb[k].bills; }).map(function (k) {
      return '<div class="item"><div class="l">' + S.METHOD_TH[k] + '</div><div class="r">' + pb[k].bills + ' บิล · <b>' + baht(pb[k].amount) + '</b></div></div>';
    }).join('') + (s.discount ? '<div class="item"><div class="l muted">ส่วนลดรวมที่ให้ไป</div><div class="r">' + baht(s.discount) + '</div></div>' : '')
      : '<div class="empty">ยังไม่มียอดขาย</div>';

    var shs = S.shiftsOn(selDate);
    $('shifts').innerHTML = shs.length ? shs.map(function (h) {
      var open = !h.closedAt;
      return '<div class="item"><div class="l"><b>' + S.timeLabel(h.openedAt) + (open ? ' – (เปิดอยู่)' : ' – ' + S.timeLabel(h.closedAt)) + '</b>' +
        '<div class="muted">เงินทอนตั้งต้น ' + baht(h.openCash) + ' · ขายเงินสด ' + baht(h.cashSales) + ' · ' + h.bills + ' บิล · รวม ' + baht(h.revenue) + '</div>' +
        (open ? '' : '<div class="muted">ควรมี ' + baht(h.expected) + ' · นับได้ ' + baht(h.countedCash) + (h.note ? ' · ' + esc(h.note) : '') + '</div>') + '</div>' +
        '<div class="r">' + (open ? '<span class="tag warn">กำลังเปิด</span>' : '<b class="' + (h.diff === 0 ? '' : h.diff > 0 ? 'pos' : 'neg') + '">' + (h.diff > 0 ? '+' : '') + baht(h.diff) + '</b><div class="muted">' + (h.diff === 0 ? 'ตรง' : h.diff > 0 ? 'เกิน' : 'ขาด') + '</div>') + '</div></div>';
    }).join('') : '<div class="empty">ไม่มีรอบขายในวันนี้</div>';

    var bills = S.sales().filter(function (x) { return x.date === selDate; }).sort(function (a, b) { return b.ts < a.ts ? -1 : 1; });
    $('bills').innerHTML = bills.length ? bills.map(function (b) {
      var tm = S.timeLabel(b.ts), no = S.billNo(b.no);
      return '<div class="item"><div class="l"><b class="' + (b.voided ? 'void' : '') + '">#' + no + ' · ' + tm + ' น. · ' + baht(b.total) + ' บาท</b> <span class="tag">' + S.METHOD_TH[b.paymentMethod] + '</span>' +
        '<div class="muted">' + esc(b.items.map(function (i) { return i.name + ' ×' + i.qty; }).join(', ')) + (b.discount ? ' · ลด ' + baht(b.discount) : '') + '</div>' +
        (b.voided && b.voidReason ? '<div class="muted">เหตุผล: ' + esc(b.voidReason) + '</div>' : '') + '</div>' +
        '<div class="r"><button class="btn small" data-reprint="' + esc(b.id) + '" aria-label="พิมพ์ใบเสร็จบิล ' + no + '">ใบเสร็จ</button> ' +
        (b.voided ? '<span class="tag out">ยกเลิก</span>' : '<button class="btn small danger" data-void="' + esc(b.id) + '" aria-label="ยกเลิกบิล ' + no + '">ยกเลิกบิล</button>') + '</div></div>';
    }).join('') : '<div class="empty">ไม่มีบิลในวันที่เลือก</div>';

    var low = S.lowStock();
    $('lowcard').style.display = low.length ? '' : 'none';
    $('low').innerHTML = low.map(function (p) {
      return '<div class="item"><div class="l">' + esc(p.name) + '</div><div class="r">เหลือ ' + p.stock + ' / ขั้นต่ำ ' + p.min + ' ' + stockTag(p) + '</div></div>';
    }).join('');
  }

  /* ---------- ขาย ---------- */
  function renderSell() {
    var q = $('s-search').value.trim().toLowerCase();
    var list = S.products().filter(function (p) { return !q || (p.name + ' ' + p.sku).toLowerCase().indexOf(q) >= 0; });
    $('s-list').innerHTML = list.length ? list.map(function (p) {
      return '<button class="pcard" data-add="' + esc(p.id) + '"' + (p.stock <= 0 ? ' disabled' : '') + '><b>' + esc(p.name) + '</b><span>' +
        esc(p.sku) + ' · เหลือ ' + p.stock + '</span><div><b>฿' + baht(p.price) + '</b></div></button>';
    }).join('') : '<div class="empty">ไม่พบสินค้า</div>';
    renderCart();
  }
  function renderShiftBar() {
    var sh = S.currentShift(), el = $('shift-bar');
    el.classList.toggle('open', !!sh);
    if (!sh) {
      el.innerHTML = '<span class="muted">ยังไม่ได้เปิดรอบขาย (ขายได้ แต่ยอดจะไม่ถูกนับในการปิดรอบ)</span><button class="btn small primary" id="sh-open">เปิดรอบขาย</button>';
    } else {
      var f = S.shiftSummary(sh);
      el.innerHTML = '<span>รอบขายเปิดตั้งแต่ <b>' + S.timeLabel(sh.openedAt) + '</b> · เงินสดที่ควรมี <b id="sh-expected">฿' + baht(f.expected) + '</b></span><button class="btn small" id="sh-close">ปิดรอบ</button>';
    }
  }
  function cartQuote() { return S.quote(cart, null); }
  function renderCart() {
    renderShiftBar();
    var q = cart.length ? cartQuote() : null, gross = 0;
    var rows = cart.map(function (c) {
      var p = S.find(c.pid); if (!p) return '';
      gross += p.price * c.qty;
      return '<div class="item"><div class="l"><b>' + esc(p.name) + '</b><div class="muted">฿' + baht(p.price) + ' × ' + c.qty + ' = ฿' + baht(p.price * c.qty) + '</div>' +
        '<label class="inl">ส่วนลดรายการ ฿<input type="number" min="0" step="0.01" inputmode="decimal" data-disc="' + esc(p.id) + '" value="' + (c.disc ? esc(c.disc) : '') + '" aria-label="ส่วนลดรายการ ' + esc(p.name) + '"></label></div>' +
        '<div class="qty"><button data-dec="' + esc(p.id) + '" aria-label="ลด">−</button><span>' + c.qty +
        '</span><button data-inc="' + esc(p.id) + '" aria-label="เพิ่ม">+</button></div></div>';
    }).join('');
    var ok = q && q.ok;
    $('cart').innerHTML = '<h2>ตะกร้า</h2>' + (rows || '<div class="empty">ยังไม่มีสินค้า แตะสินค้าด้านบนเพื่อเพิ่ม</div>') +
      (q && !q.ok ? '<p class="err" role="alert">' + esc(q.error) + '</p>' : '') +
      '<div class="total"><span>รวม</span><span id="c-total">฿' + baht(ok ? q.total : gross) + '</span></div>' +
      '<div class="row end"><button class="btn" id="c-clear"' + (cart.length ? '' : ' disabled') + '>ล้าง</button>' +
      '<button class="btn primary" id="c-pay"' + (ok ? '' : ' disabled') + '>ชำระเงิน</button></div>';
  }
  function addToCart(id) {
    var p = S.find(id); if (!p) return;
    var c = cart.filter(function (x) { return x.pid === id; })[0];
    if ((c ? c.qty : 0) + 1 > p.stock) return toast('สต็อกไม่พอ: ' + p.name);
    if (c) c.qty++; else cart.push({ pid: id, qty: 1, disc: 0 });
    renderCart();
  }
  function changeQty(id, d) {
    var c = cart.filter(function (x) { return x.pid === id; })[0]; if (!c) return;
    if (d > 0) return addToCart(id);
    c.qty--; if (c.qty <= 0) cart = cart.filter(function (x) { return x !== c; });
    renderCart();
  }

  /* ---------- ชำระเงิน ---------- */
  function cfValues() {
    var f = $('cf').elements;
    return { bill: { type: f.btype.value, value: f.bdisc.value }, method: f.method.value, received: f.received.value };
  }
  function refreshCheckout() {
    var v = cfValues(), q = S.quote(cart, v.bill), el = $('c-sum');
    $('c-cash').hidden = v.method !== 'cash';
    if (!q.ok) { el.innerHTML = ''; $('c-err').textContent = q.error; $('c-ok').disabled = true; $('c-change').textContent = '–'; $('c-quick').innerHTML = ''; delete $('c-quick').dataset.total; return; }
    el.innerHTML = '<div class="sumrow"><span>รวม</span><span>฿' + baht(q.subtotal) + '</span></div>' +
      (q.lineDiscount ? '<div class="sumrow"><span>ส่วนลดรายการ</span><span>−฿' + baht(q.lineDiscount) + '</span></div>' : '') +
      (q.billDiscount ? '<div class="sumrow"><span>ส่วนลดท้ายบิล' + (q.billSpec && q.billSpec.type === 'pct' ? ' (' + q.billSpec.value + '%)' : '') + '</span><span>−฿' + baht(q.billDiscount) + '</span></div>' : '') +
      '<div class="sumrow big"><span>ยอดสุทธิ</span><span id="cd-total">฿' + baht(q.total) + '</span></div>';
    var err = '', ch = '–';
    if (v.method === 'cash') {
      if (v.received === '') ch = '฿0';
      else if (Number(v.received) >= q.total) ch = '฿' + baht(Math.round((Number(v.received) - q.total) * 100) / 100);
      else err = 'รับเงินไม่พอ (ขาด ฿' + baht(Math.round((q.total - Number(v.received)) * 100) / 100) + ')';
    }
    $('c-change').textContent = ch; $('c-err').textContent = err; $('c-ok').disabled = !!err;
    // วาดปุ่มลัดใหม่เฉพาะเมื่อยอดเปลี่ยน ไม่งั้นการ re-render ตอน blur ช่องรับเงินจะแทนที่ปุ่มก่อนคลิกเสร็จ (คลิกหลุด)
    if ($('c-quick').dataset.total === String(q.total)) return;
    $('c-quick').dataset.total = String(q.total);
    var amounts = [q.total];
    [20, 50, 100, 500, 1000].forEach(function (d) { var a = Math.ceil(q.total / d) * d; if (amounts.indexOf(a) < 0 && a > q.total) amounts.push(a); });
    $('c-quick').innerHTML = amounts.slice(0, 5).map(function (a, i) {
      return '<button type="button" class="btn small" data-recv="' + a + '">' + (i === 0 ? 'พอดี ' : '') + baht(a) + '</button>';
    }).join('');
  }
  function openCheckout() {
    if (!cart.length || !cartQuote().ok) return;
    $('cf').reset(); $('c-err').textContent = ''; delete $('c-quick').dataset.total;
    $('cdlg').showModal();
    refreshCheckout();
  }

  /* ---------- ใบเสร็จ ---------- */
  function receiptHTML(sale) {
    var st = S.settings(), d = new Date(sale.ts);
    var dt = d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
    var h = '<div class="rc w' + st.receiptWidth + '"><h3>' + esc(st.shopName) + '</h3>' +
      (st.taxId ? '<div class="c">เลขประจำตัวผู้เสียภาษี ' + esc(st.taxId) + '</div>' : '') +
      '<div class="c">ใบเสร็จรับเงิน</div><div class="c">เลขที่ ' + S.billNo(sale.no) + '</div><div class="c">' + esc(dt) + '</div>' +
      (sale.voided ? '<div class="c"><b>*** ยกเลิกแล้ว ***</b></div>' + (sale.voidReason ? '<div class="c">' + esc(sale.voidReason) + '</div>' : '') : '') + '<hr>';
    sale.items.forEach(function (i) {
      h += '<div>' + esc(i.name) + '</div><div class="r2 sub"><span>' + i.qty + ' × ' + baht(i.price) + '</span><span>' + baht(i.qty * i.price) + '</span></div>';
      if (i.discount) h += '<div class="r2 sub"><span>ส่วนลด</span><span>−' + baht(i.discount) + '</span></div>';
    });
    h += '<hr><div class="r2"><span>รวม</span><span>' + baht(sale.subtotal) + '</span></div>';
    var ld = sale.discount - (sale.billDiscount || 0);
    if (ld) h += '<div class="r2"><span>ส่วนลดรายการ</span><span>−' + baht(ld) + '</span></div>';
    if (sale.billDiscount) h += '<div class="r2"><span>ส่วนลดท้ายบิล' + (sale.billDiscountSpec && sale.billDiscountSpec.type === 'pct' ? ' ' + sale.billDiscountSpec.value + '%' : '') + '</span><span>−' + baht(sale.billDiscount) + '</span></div>';
    h += '<div class="r2"><b>ยอดสุทธิ</b><b>' + baht(sale.total) + '</b></div><hr>' +
      '<div class="r2"><span>ชำระโดย</span><span>' + S.METHOD_TH[sale.paymentMethod] + '</span></div>';
    if (sale.paymentMethod === 'cash') h += '<div class="r2"><span>รับเงิน</span><span>' + baht(sale.paid) + '</span></div><div class="r2"><span>เงินทอน</span><span>' + baht(sale.change) + '</span></div>';
    if (st.footer) h += '<hr><div class="c">' + esc(st.footer) + '</div>';
    return h + '</div>';
  }
  var receiptId = null;
  function showReceipt(id) {
    var sale = S.saleById(id); if (!sale) return;
    receiptId = id;
    $('r-body').innerHTML = receiptHTML(sale);
    $('rdlg').showModal();
  }
  function printReceipt() {
    var sale = S.saleById(receiptId); if (!sale) return;
    var w = S.settings().receiptWidth;
    $('print-page').textContent = '@page{size:' + w + 'mm auto;margin:2mm}';
    $('receipt-print').innerHTML = receiptHTML(sale);
    window.print();
  }

  /* ---------- รอบขาย ---------- */
  function refreshCloseShift() {
    var sh = S.currentShift(); if (!sh) return;
    var f = S.shiftSummary(sh), v = $('xf').elements.counted.value, diff = $('x-diff');
    if (v === '' || isNaN(Number(v))) { diff.textContent = '–'; diff.className = ''; return; }
    var d = Math.round((Number(v) - f.expected) * 100) / 100;
    diff.textContent = (d > 0 ? '+' : '') + baht(d) + (d === 0 ? ' (ตรง)' : d > 0 ? ' (เกิน)' : ' (ขาด)');
    diff.className = d === 0 ? '' : d > 0 ? 'pos' : 'neg';
  }
  function openCloseShift() {
    var sh = S.currentShift(); if (!sh) return;
    var f = S.shiftSummary(sh);
    $('xf').reset(); $('x-err').textContent = '';
    $('x-sum').innerHTML = '<div class="sumrow"><span>เงินทอนตั้งต้น</span><span>฿' + baht(sh.openCash) + '</span></div>' +
      '<div class="sumrow"><span>ขายเงินสดในรอบ (' + f.bills + ' บิลรวมทุกวิธี)</span><span>฿' + baht(f.cashSales) + '</span></div>' +
      '<div class="sumrow big"><span>เงินสดที่ควรมี</span><span id="x-expected">฿' + baht(f.expected) + '</span></div>';
    refreshCloseShift();
    $('xdlg').showModal();
  }

  /* ---------- สต็อก ---------- */
  function renderStock() {
    var q = $('st-search').value.trim().toLowerCase();
    var list = S.products().filter(function (p) { return !q || (p.name + ' ' + p.sku).toLowerCase().indexOf(q) >= 0; });
    $('st-list').innerHTML = '<div class="card">' + (list.length ? list.map(function (p) {
      return '<div class="item wrap"><div class="l"><b>' + esc(p.name) + '</b> ' + stockTag(p) + '<div class="muted">' + esc(p.sku) + ' · คงเหลือ <b>' + p.stock + '</b> (ขั้นต่ำ ' + p.min + ')</div></div>' +
        '<div class="r"><button class="btn small" data-mv="receive" data-pid="' + esc(p.id) + '">รับเข้า</button> ' +
        '<button class="btn small" data-mv="adjust" data-pid="' + esc(p.id) + '">นับ/ปรับยอด</button> ' +
        '<button class="btn small danger" data-mv="waste" data-pid="' + esc(p.id) + '">ชำรุด</button></div></div>';
    }).join('') : '<div class="empty">ไม่พบสินค้า</div>') + '</div>';
    var mv = S.moves().filter(function (m) { return !q || (m.name + ' ' + m.sku).toLowerCase().indexOf(q) >= 0; }).slice(0, 50);
    $('st-moves').innerHTML = mv.length ? mv.map(function (m) {
      var d = S.dateKey(new Date(m.ts));
      return '<div class="item"><div class="l"><b>' + esc(m.name) + '</b> <span class="tag">' + (S.MOVE_TH[m.type] || m.type) + '</span>' +
        '<div class="muted">' + thDate(d) + ' ' + S.timeLabel(m.ts) + (m.reason ? ' · ' + esc(m.reason) : '') + (m.note ? ' · ' + esc(m.note) : '') + '</div></div>' +
        '<div class="r"><b class="' + (m.qty > 0 ? 'pos' : 'neg') + '">' + (m.qty > 0 ? '+' : '') + m.qty + '</b><div class="muted">คงเหลือ ' + m.balance + '</div></div></div>';
    }).join('') : '<div class="empty">ยังไม่มีรายการ</div>';
  }
  var MOVE_TITLE = { receive: 'รับสินค้าเข้า', adjust: 'นับสต็อก / ปรับยอด', waste: 'ตัดสินค้าชำรุด / สูญเสีย' };
  function openStockForm(pid, type) {
    var p = S.find(pid); if (!p) return;
    stockPid = pid; stockType = type;
    var f = $('sf').elements;
    $('sf').reset(); $('s-err').textContent = '';
    $('s-title').textContent = MOVE_TITLE[type];
    $('s-prod').textContent = p.name + ' (' + p.sku + ') · คงเหลือในระบบ ' + p.stock;
    $('s-qty-l').hidden = type === 'adjust';
    $('s-counted-l').hidden = type !== 'adjust';
    f.qty.required = type !== 'adjust'; f.counted.required = type === 'adjust';
    $('reasons').innerHTML = (type === 'waste' ? ['ชำรุด', 'หมดอายุ', 'สูญหาย'] : type === 'adjust' ? ['นับสต็อก', 'ของขาด/เกิน'] : ['รับของจากซัพพลายเออร์', 'ลูกค้าคืนสินค้า']).map(function (x) { return '<option value="' + x + '">'; }).join('');
    f.reason.required = type === 'waste';
    $('sdlg').showModal();
  }

  /* ---------- สินค้า ---------- */
  function renderCats() {
    var cats = [], seen = {};
    S.products().forEach(function (p) { if (!seen[p.category]) { seen[p.category] = 1; cats.push(p.category); } });
    var cur = $('p-cat').value;
    $('p-cat').innerHTML = '<option value="">ทุกหมวด</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    if (seen[cur]) $('p-cat').value = cur;
    $('cats').innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
  }
  function renderProducts() {
    renderCats();
    var q = $('p-search').value.trim().toLowerCase(), cat = $('p-cat').value;
    var list = S.products().filter(function (p) {
      return (!cat || p.category === cat) && (!q || (p.name + ' ' + p.sku).toLowerCase().indexOf(q) >= 0);
    });
    $('p-list').innerHTML = '<div class="card">' + (list.length ? list.map(function (p) {
      return '<div class="item"><div class="l"><b>' + esc(p.name) + '</b> ' + stockTag(p) +
        '<div class="muted">' + esc(p.sku) + ' · ' + esc(p.category) + ' · ต้นทุน ฿' + baht(p.cost) + '</div></div>' +
        '<div class="r"><b>฿' + baht(p.price) + '</b><div class="muted">สต็อก ' + p.stock + '</div>' +
        '<button class="btn small" data-edit="' + esc(p.id) + '">แก้ไข</button> ' +
        '<button class="btn small danger" data-del="' + esc(p.id) + '">ลบ</button></div></div>';
    }).join('') : '<div class="empty">ไม่พบสินค้า</div>') + '</div>';
  }
  function openForm(id) {
    editingId = id || null;
    var f = $('pf'), p = id ? S.find(id) : { sku: '', name: '', category: '', price: '', cost: '', stock: '', min: 5 };
    $('pf-title').textContent = id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า';
    ['sku', 'name', 'category', 'price', 'cost', 'stock', 'min'].forEach(function (k) { f.elements[k].value = p[k]; });
    $('pf-err').textContent = '';
    $('dlg').showModal();
  }

  /* ---------- เมนู ---------- */
  function showView(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      var on = b.dataset.view === name;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (name === 'dashboard') renderDashboard();
    if (name === 'sell') renderSell();
    if (name === 'products') renderProducts();
    if (name === 'stock') renderStock();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }
  function renderSettings() {
    var st = S.settings(), f = $('shf').elements;
    f.shopName.value = st.shopName; f.taxId.value = st.taxId; f.footer.value = st.footer; f.receiptWidth.value = String(st.receiptWidth);
  }
  function refresh() {
    var v = document.querySelector('.view.active').id.replace('view-', '');
    showView(v);
  }
  function setDate(k) { if (k) { selDate = k; renderDashboard(); } }

  function bind() {
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) showView(b.dataset.view); });
    $('d-prev').onclick = function () { setDate(S.addDays(selDate, -1)); };
    $('d-next').onclick = function () { setDate(S.addDays(selDate, 1)); };
    $('d-today').onclick = function () { setDate(S.today()); };
    $('d-date').onchange = function () { setDate(this.value); };
    $('bills').addEventListener('click', function (e) {
      var b = e.target.closest('[data-void]');
      if (b) {
        voidId = b.dataset.void;
        $('vf').elements.reason.value = ''; $('vf-err').textContent = '';
        $('vdlg').showModal();
      }
    });
    $('vf-cancel').onclick = function () { $('vdlg').close(); };
    $('vf').addEventListener('submit', function (e) {
      e.preventDefault();
      var r = S.voidSale(voidId, e.target.elements.reason.value);
      if (!r.ok) { $('vf-err').textContent = r.error; return; }
      $('vdlg').close(); toast('ยกเลิกบิลและคืนสต็อกแล้ว'); renderDashboard();
    });

    $('s-search').oninput = renderSell;
    $('s-search').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = $('s-list').querySelector('[data-add]:not(:disabled)');
        if (first) { addToCart(first.dataset.add); this.select(); } else toast('ไม่พบสินค้าที่ขายได้');
      } else if (e.key === 'Escape') { this.value = ''; renderSell(); }
    });
    $('s-list').addEventListener('click', function (e) { var b = e.target.closest('[data-add]'); if (b) addToCart(b.dataset.add); });
    $('cart').addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.inc) changeQty(t.dataset.inc, 1);
      else if (t.dataset.dec) changeQty(t.dataset.dec, -1);
      else if (t.id === 'c-clear') { cart = []; renderCart(); }
      else if (t.id === 'c-pay') openCheckout();
    });
    $('cart').addEventListener('change', function (e) {
      var t = e.target.closest('[data-disc]'); if (!t) return;
      var c = cart.filter(function (x) { return x.pid === t.dataset.disc; })[0];
      if (c) { c.disc = t.value === '' ? 0 : Number(t.value); renderCart(); }
    });
    $('shift-bar').addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.id === 'sh-open') { $('of').reset(); $('o-err').textContent = ''; $('odlg').showModal(); }
      if (t.id === 'sh-close') openCloseShift();
    });
    $('o-cancel').onclick = function () { $('odlg').close(); };
    $('of').addEventListener('submit', function (e) {
      e.preventDefault();
      var r = S.openShift(e.target.elements.openCash.value);
      if (!r.ok) { $('o-err').textContent = r.error; return; }
      $('odlg').close(); toast('เปิดรอบขายแล้ว'); renderSell();
    });
    $('x-cancel').onclick = function () { $('xdlg').close(); };
    $('xf').elements.counted.addEventListener('input', refreshCloseShift);
    $('xf').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target.elements, r = S.closeShift(f.counted.value, f.note.value);
      if (!r.ok) { $('x-err').textContent = r.error; return; }
      $('xdlg').close();
      toast('ปิดรอบขายแล้ว ส่วนต่าง ' + (r.shift.diff > 0 ? '+' : '') + baht(r.shift.diff));
      selDate = r.shift.date; renderSell();
    });

    $('cf').addEventListener('input', refreshCheckout);
    $('cf').addEventListener('change', refreshCheckout);
    $('c-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-recv]'); if (!b) return;
      $('cf').elements.received.value = b.dataset.recv; refreshCheckout();
    });
    $('c-cancel').onclick = function () { $('cdlg').close(); };
    $('cf').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = cfValues();
      var r = S.checkout(cart, { bill: v.bill, payment: { method: v.method, received: v.received } });
      if (!r.ok) { $('c-err').textContent = r.error; return; }
      cart = []; $('cdlg').close();
      toast('บันทึกการขาย ฿' + baht(r.sale.total));
      selDate = r.sale.date; renderSell(); showReceipt(r.sale.id);
    });
    $('r-close').onclick = function () { $('rdlg').close(); };
    $('r-print').onclick = printReceipt;
    $('bills').addEventListener('click', function (e) {
      var b = e.target.closest('[data-reprint]'); if (b) showReceipt(b.dataset.reprint);
    });

    $('st-search').oninput = renderStock;
    $('st-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-mv]'); if (b) openStockForm(b.dataset.pid, b.dataset.mv);
    });
    $('st-csv').onclick = function () { download('stock-moves.csv', S.stockMovesCSV(), 'text/csv;charset=utf-8'); };
    $('x-csv-moves').onclick = $('st-csv').onclick;
    $('s-cancel').onclick = function () { $('sdlg').close(); };
    $('sf').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target.elements;
      var r = S.addStockMove(stockPid, { type: stockType, qty: f.qty.value, counted: f.counted.value, reason: f.reason.value, note: f.note.value });
      if (!r.ok) { $('s-err').textContent = r.error; return; }
      $('sdlg').close(); toast('บันทึกรายการสต็อกแล้ว'); renderStock();
    });

    $('shf').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target.elements;
      S.saveSettings({ shopName: f.shopName.value, taxId: f.taxId.value, footer: f.footer.value, receiptWidth: f.receiptWidth.value });
      renderSettings(); toast('บันทึกข้อมูลร้านแล้ว');
    });

    $('p-search').oninput = renderProducts;
    $('p-cat').onchange = renderProducts;
    $('p-add').onclick = function () { openForm(); };
    $('p-list').addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.edit) openForm(t.dataset.edit);
      if (t.dataset.del) {
        var p = S.find(t.dataset.del);
        if (p && confirm('ลบสินค้า "' + p.name + '" ?\n(ประวัติการขายเดิมยังคงอยู่)')) {
          cart = cart.filter(function (c) { return c.pid !== p.id; });
          S.deleteProduct(p.id); toast('ลบสินค้าแล้ว'); renderProducts();
        }
      }
    });
    $('pf-cancel').onclick = function () { $('dlg').close(); };
    $('pf').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target.elements, data = {};
      ['sku', 'name', 'category', 'price', 'cost', 'stock', 'min'].forEach(function (k) { data[k] = f[k].value; });
      var r = S.saveProduct(data, editingId);
      if (!r.ok) { $('pf-err').textContent = r.error; return; }
      $('dlg').close(); toast('บันทึกสินค้าแล้ว'); renderProducts();
    });

    $('x-json').onclick = function () {
      download('boss-pos-' + S.today() + '.json', S.exportJSON(), 'application/json');
      S.markBackup(); renderBackupBanner(); toast('สำรองข้อมูลแล้ว');
    };
    $('backup-now').onclick = function () { $('x-json').click(); };
    $('x-import-btn').onclick = function () { $('x-import').click(); };
    $('x-csv-import-btn').onclick = function () { $('x-csv-import').click(); };
    $('x-csv-tpl').onclick = function () { download('products-template.csv', S.productsTemplateCSV(), 'text/csv;charset=utf-8'); };
    $('x-csv-import').onchange = function () {
      var file = this.files[0], input = this; if (!file) return;
      if (file.size > 1048576) { toast('ไฟล์ใหญ่เกิน 1 MB'); input.value = ''; return; }
      var rd = new FileReader();
      rd.onload = function () {
        var r = S.parseProductsCSV(String(rd.result));
        input.value = '';
        if (r.fatal) return toast(r.fatal);
        importRows = r.valid;
        $('i-summary').textContent = 'นำเข้าได้ ' + r.valid.length + ' รายการ · ข้ามเพราะผิดพลาด/ซ้ำ ' + r.errors.length + ' รายการ';
        $('i-errors').innerHTML = r.errors.slice(0, 10).map(function (x) {
          return '<li>แถว ' + x.line + (x.sku ? ' (' + esc(x.sku) + ')' : '') + ': ' + esc(x.msg) + '</li>';
        }).join('') + (r.errors.length > 10 ? '<li>…และอีก ' + (r.errors.length - 10) + ' รายการ</li>' : '');
        $('i-ok').disabled = !r.valid.length;
        $('idlg').showModal();
      };
      rd.readAsText(file, 'UTF-8');
    };
    $('i-cancel').onclick = function () { importRows = []; $('idlg').close(); };
    $('i-ok').onclick = function () {
      var r = S.importProducts(importRows); importRows = [];
      $('idlg').close(); toast('นำเข้าสินค้า ' + r.added + ' รายการ'); refresh();
    };
    $('x-csv-sales').onclick = function () { download('sales.csv', S.salesCSV(), 'text/csv;charset=utf-8'); };
    $('x-csv-prod').onclick = function () { download('products.csv', S.productsCSV(), 'text/csv;charset=utf-8'); };
    $('x-import').onchange = function () {
      var file = this.files[0], input = this; if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        var r = S.importJSON(String(rd.result));
        toast(r.ok ? 'นำเข้าข้อมูลสำเร็จ' : r.error);
        if (r.ok) { cart = []; refresh(); }
        input.value = '';
      };
      rd.readAsText(file);
    };
    $('x-reset').onclick = function () {
      if (confirm('ล้างข้อมูลทั้งหมดและโหลดข้อมูลตัวอย่าง?')) { S.seed(); cart = []; toast('โหลดข้อมูลตัวอย่างแล้ว'); refresh(); }
    };
  }

  function tick() {
    $('clock').textContent = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
  }

  S.load();
  bind();
  renderDashboard();
  tick(); setInterval(tick, 30000);
})();
