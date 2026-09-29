(function () {
  'use strict';
  var S = window.Store;
  var $ = function (id) { return document.getElementById(id); };
  var cart = []; // [{pid, qty}]
  var selDate = S.dateKey(new Date());
  var editingId = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function baht(n) { return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
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
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }
  function stockTag(p) {
    if (p.stock <= 0) return '<span class="tag out">หมด</span>';
    if (p.stock <= p.min) return '<span class="tag warn">ใกล้หมด</span>';
    return '';
  }

  /* ---------- Dashboard ---------- */
  function bars(el, vals, labels, selIdx) {
    var max = Math.max.apply(null, vals.concat([1]));
    el.innerHTML = vals.map(function (v, i) {
      return '<div class="bar" title="' + esc(labels[i]) + ': ' + baht(v) + ' บาท"><i class="' + (i === selIdx ? 'sel' : '') +
        '" style="height:' + Math.round(v / max * 100) + '%"></i><em>' + esc(labels[i]) + '</em></div>';
    }).join('');
  }
  function renderDashboard() {
    $('d-date').value = selDate;
    var s = S.summary(selDate);
    $('kpis').innerHTML =
      '<div class="kpi"><span>ยอดขายรวม (บาท)</span><b id="k-rev">' + baht(s.revenue) + '</b></div>' +
      '<div class="kpi"><span>จำนวนบิล</span><b id="k-bills">' + s.bills + '</b></div>' +
      '<div class="kpi"><span>จำนวนชิ้น</span><b>' + s.units + '</b></div>' +
      '<div class="kpi"><span>กำไรขั้นต้น (บาท)</span><b>' + baht(s.profit) + '</b></div>';

    var h = S.hourly(selDate), from = 6, to = 22, hv = [], hl = [];
    for (var i = from; i <= to; i++) { hv.push(h[i]); hl.push(i % 2 ? '' : String(i)); }
    bars($('hourly'), hv, hl, -1);
    Array.prototype.forEach.call($('hourly').children, function (b, i) { b.title = (from + i) + ':00 น. = ' + baht(hv[i]) + ' บาท'; });

    var wk = S.lastDays(selDate, 7);
    bars($('week'), wk.map(function (d) { return d.revenue; }), wk.map(function (d) { return thDate(d.date); }), 6);

    var top = S.top(selDate, 5);
    $('top').innerHTML = top.length ? top.map(function (t, i) {
      return '<div class="item"><div class="l">' + (i + 1) + '. ' + esc(t.name) + '</div><div class="r">' + t.qty + ' ชิ้น · <b>' + baht(t.revenue) + '</b></div></div>';
    }).join('') : '<div class="empty">ยังไม่มียอดขายในวันนี้</div>';

    var bills = S.sales().filter(function (x) { return x.date === selDate; }).sort(function (a, b) { return b.ts < a.ts ? -1 : 1; });
    $('bills').innerHTML = bills.length ? bills.map(function (b) {
      var d = new Date(b.ts), tm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      return '<div class="item"><div class="l"><b class="' + (b.voided ? 'void' : '') + '">' + tm + ' น. · ' + baht(b.total) + ' บาท</b>' +
        '<div class="muted">' + esc(b.items.map(function (i) { return i.name + ' ×' + i.qty; }).join(', ')) + '</div></div>' +
        '<div class="r">' + (b.voided ? '<span class="tag out">ยกเลิก</span>' : '<button class="btn small danger" data-void="' + esc(b.id) + '">ยกเลิกบิล</button>') + '</div></div>';
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
  function renderCart() {
    var total = 0;
    var rows = cart.map(function (c) {
      var p = S.find(c.pid); if (!p) return '';
      total += p.price * c.qty;
      return '<div class="item"><div class="l"><b>' + esc(p.name) + '</b><div class="muted">฿' + baht(p.price) + '</div></div>' +
        '<div class="qty"><button data-dec="' + esc(p.id) + '" aria-label="ลด">−</button><span>' + c.qty +
        '</span><button data-inc="' + esc(p.id) + '" aria-label="เพิ่ม">+</button></div></div>';
    }).join('');
    $('cart').innerHTML = '<h2>ตะกร้า</h2>' + (rows || '<div class="empty">ยังไม่มีสินค้า แตะสินค้าด้านบนเพื่อเพิ่ม</div>') +
      '<div class="total"><span>รวม</span><span id="c-total">฿' + baht(total) + '</span></div>' +
      '<div class="row end"><button class="btn" id="c-clear"' + (cart.length ? '' : ' disabled') + '>ล้าง</button>' +
      '<button class="btn primary" id="c-pay"' + (cart.length ? '' : ' disabled') + '>ชำระเงิน</button></div>';
  }
  function addToCart(id) {
    var p = S.find(id); if (!p) return;
    var c = cart.filter(function (x) { return x.pid === id; })[0];
    if ((c ? c.qty : 0) + 1 > p.stock) return toast('สต็อกไม่พอ: ' + p.name);
    if (c) c.qty++; else cart.push({ pid: id, qty: 1 });
    renderCart();
  }
  function changeQty(id, d) {
    var c = cart.filter(function (x) { return x.pid === id; })[0]; if (!c) return;
    if (d > 0) return addToCart(id);
    c.qty--; if (c.qty <= 0) cart = cart.filter(function (x) { return x !== c; });
    renderCart();
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
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.dataset.view === name); });
    if (name === 'dashboard') renderDashboard();
    if (name === 'sell') renderSell();
    if (name === 'products') renderProducts();
    window.scrollTo(0, 0);
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
    $('d-today').onclick = function () { setDate(S.dateKey(new Date())); };
    $('d-date').onchange = function () { setDate(this.value); };
    $('bills').addEventListener('click', function (e) {
      var b = e.target.closest('[data-void]');
      if (b && confirm('ยกเลิกบิลนี้และคืนสต็อก?')) { S.voidSale(b.dataset.void); toast('ยกเลิกบิลแล้ว'); renderDashboard(); }
    });

    $('s-search').oninput = renderSell;
    $('s-list').addEventListener('click', function (e) { var b = e.target.closest('[data-add]'); if (b) addToCart(b.dataset.add); });
    $('cart').addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.inc) changeQty(t.dataset.inc, 1);
      else if (t.dataset.dec) changeQty(t.dataset.dec, -1);
      else if (t.id === 'c-clear') { cart = []; renderCart(); }
      else if (t.id === 'c-pay') {
        var r = S.checkout(cart);
        if (!r.ok) return toast(r.error);
        cart = []; toast('บันทึกการขาย ฿' + baht(r.sale.total)); selDate = r.sale.date; renderSell();
      }
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

    $('x-json').onclick = function () { download('boss-pos-' + S.dateKey(new Date()) + '.json', S.exportJSON(), 'application/json'); };
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
    $('clock').textContent = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  S.load();
  bind();
  renderDashboard();
  tick(); setInterval(tick, 30000);
})();
