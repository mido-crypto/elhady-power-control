'use strict';
/* =====================================================================
   Elhady Power Control — الواجهة والتفاعل
   تعتمد على: js/store.js و js/receipt.js
   ===================================================================== */

const $ = id => document.getElementById(id);
const PAGE_TITLES = { dashboard: 'الرئيسية', orders: 'الطلبات', 'new-order': 'طلب جديد', customers: 'العملاء', reports: 'التقارير', settings: 'الإعدادات' };
const MAX_ROWS = 300;

let currentPage = 'dashboard';
let currentReceipt = null;
let payOrderId = null;
let lastFocus = null;
let confirmCancel = null;
const formState = { totalManual: false };

/* ---------- إشعارات ونوافذ ---------- */
let toastTimer;
function hideToast() { $('toast').classList.remove('show'); }
function toast(msg, opts = {}) {
  $('toastMsg').textContent = msg;
  const b = $('toastAction');
  if (opts.action) { b.hidden = false; b.textContent = opts.action; b.onclick = () => { hideToast(); opts.fn(); }; }
  else { b.hidden = true; b.onclick = null; }
  $('toast').classList.toggle('error', !!opts.error);
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.action ? 7000 : 2800);
}

function openModal(id, focusEl) {
  lastFocus = document.activeElement;
  $(id).classList.add('show');
  const f = focusEl || $(id).querySelector('input:not([hidden]):not([readonly]), .primary-btn, .print-btn, button');
  if (f) setTimeout(() => f.focus(), 30);
}
function closeModal(id) {
  $(id).classList.remove('show');
  if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
}
function closeTop(id) { if (id === 'confirmModal' && confirmCancel) confirmCancel(); else closeModal(id); }

/* نافذة تأكيد: ترجع true / false / 'alt' */
function ask({ title = 'تأكيد', message, yes = 'تأكيد', danger = false, type = null, alt = null }) {
  return new Promise(resolve => {
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = message;
    const y = $('confirmYes'), a = $('confirmAlt'), inp = $('confirmTypeInput');
    y.textContent = yes; y.className = danger ? 'danger-btn solid' : 'primary-btn';
    a.hidden = !alt; if (alt) a.textContent = alt;
    $('confirmTypeRow').hidden = !type; inp.value = '';
    if (type) { $('confirmTypeHint').textContent = `اكتب كلمة "${type}" للتأكيد`; y.disabled = true; inp.oninput = () => { y.disabled = inp.value.trim() !== type; }; }
    else { y.disabled = false; inp.oninput = null; }
    let done = false;
    const finish = v => { if (done) return; done = true; confirmCancel = null; closeModal('confirmModal'); resolve(v); };
    y.onclick = () => finish(true);
    a.onclick = () => finish('alt');
    $('confirmNo').onclick = () => finish(false);
    confirmCancel = () => finish(false);
    openModal('confirmModal', type ? inp : $('confirmNo'));
  });
}

/* ---------- التنقل ---------- */
function go(page, opts = {}) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('pageTitle').textContent = PAGE_TITLES[page] || '';
  closeSidebar();
  if (page === 'new-order' && !opts.keep) resetForm();
  if (page === 'settings') loadSettingsUI();
  renderAll();
  window.scrollTo(0, 0);
}
function closeSidebar() { $('sidebar').classList.remove('open'); $('scrim').classList.remove('show'); }
function toggleSidebar() { $('sidebar').classList.toggle('open'); $('scrim').classList.toggle('show', $('sidebar').classList.contains('open')); }

function commit() {
  const ok = persist();
  renderAll();
  if (!ok) toast('تعذّر حفظ البيانات على الجهاز! نزّل نسخة احتياطية فوراً.', { error: true });
}

/* ---------- الأيام ---------- */
const dayOrders = () => state.orders.filter(o => o.dayId === state.activeDay);

function renderDays() {
  $('daysList').innerHTML = state.days.slice().reverse().map(d => {
    const n = state.orders.filter(o => o.dayId === d.id).length;
    return `<div class="day-row"><button class="day-link ${d.id === state.activeDay ? 'active' : ''}" data-act="day" data-id="${esc(d.id)}"><span class="day-dot"></span><span>${esc(d.label)}</span><small>${n} طلب</small></button>${n === 0 && state.days.length > 1 ? `<button class="day-del" data-act="del-day" data-id="${esc(d.id)}" title="حذف اليوم الفارغ" aria-label="حذف اليوم الفارغ"><svg class="ic sm"><use href="#i-x"/></svg></button>` : ''}</div>`;
  }).join('');
}

function createDay() {
  const stamp = dayStamp();
  let n = state.days.filter(d => d.id.startsWith('day-' + stamp)).length;
  while (state.days.some(d => d.id === `day-${stamp}-${n + 1}`)) n++;
  const d = { id: `day-${stamp}-${n + 1}`, label: n === 0 ? dayLabelOf() : `${dayLabelOf()} (${n + 1})`, createdAt: new Date().toISOString() };
  state.days.push(d); state.activeDay = d.id;
  commit(); go('dashboard');
  toast('بدأنا يوم جديد، والطلبات القديمة محفوظة');
}

function selectDay(id) {
  if (!state.days.some(d => d.id === id)) return;
  state.activeDay = id; persist();
  if (currentPage === 'new-order') go('dashboard'); else { renderAll(); closeSidebar(); }
}

function deleteDay(id) {
  if (state.orders.some(o => o.dayId === id) || state.days.length < 2) return;
  state.days = state.days.filter(d => d.id !== id);
  repairDays(); commit(); toast('تم حذف اليوم الفارغ');
}

/* ---------- نموذج الطلب ---------- */
function itemTemplate(item = {}) {
  const heater = HEATER_CATEGORIES.includes(item.category);
  return `<div class="item-card" data-item>
    <div class="item-top"><strong>منتج في الطلب</strong><button type="button" class="remove-item" data-act="remove-item">حذف المنتج ✕</button></div>
    <div class="item-grid">
      <label>القسم<select data-field="category"><option value="">اختار القسم</option>${CATEGORIES.map(c => `<option ${item.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>النوع / الوصف<input data-field="type" ${heater ? 'list="heaterTypesList"' : ''} autocomplete="off" placeholder="${heater ? 'اختار أو اكتب النوع' : 'مثلاً: لوحة 3 فاز'}" value="${esc(item.type || '')}"></label>
      <label>الكمية<input data-field="qty" type="number" min="0" step="any" inputmode="decimal" placeholder="الكمية" value="${esc(item.qty ?? '')}"></label>
      <label>المقاس<input data-field="size" placeholder="المقاس" value="${esc(item.size || '')}"></label>
      <label>الفولت<input data-field="voltage" placeholder="الفولت" value="${esc(item.voltage || '')}"></label>
      <label>الأمبير<input data-field="ampere" placeholder="الأمبير" value="${esc(item.ampere || '')}"></label>
      <label>القدرة (وات)<input data-field="watt" placeholder="الوات" value="${esc(item.watt || '')}"></label>
      <label>سعر القطعة (ج.م)<input data-field="price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="سعر القطعة" value="${esc(item.price ?? '')}"></label>
      <label>إجمالي المنتج (ج.م)<input data-line-total readonly value="${esc(item.lineTotal || '')}" placeholder="الكمية × السعر"></label>
      <label>ملاحظات<input data-field="notes" placeholder="ملاحظات" value="${esc(item.notes || '')}"></label>
    </div></div>`;
}
function addItem(item) { $('itemsContainer').insertAdjacentHTML('beforeend', itemTemplate(item)); updateAccounts(); }

function updateAccounts() {
  let sum = 0, has = false;
  document.querySelectorAll('[data-item]').forEach(card => {
    const q = card.querySelector('[data-field="qty"]').value, p = card.querySelector('[data-field="price"]').value;
    const out = card.querySelector('[data-line-total]');
    if (q !== '' && p !== '') { const t = round2(Number(q) * Number(p)); out.value = t; sum += t; has = true; }
    else out.value = '';
  });
  $('subtotalView').value = has ? money(sum) : '';
  const disc = num($('discount').value) || 0;
  if (has && !formState.totalManual) $('totalPrice').value = Math.max(0, round2(sum - disc));
  $('autoCalcBtn').hidden = !(has && formState.totalManual);
  updateRemaining();
}
function updateRemaining() {
  const t = num($('totalPrice').value), p = num($('paidAmount').value) || 0;
  $('remainingView').value = t == null ? '' : money(Math.max(0, round2(t - p)));
}

function resetForm() {
  $('orderForm').reset();
  $('editOrderId').value = '';
  $('formHeading').textContent = 'تسجيل طلب جديد';
  $('formSub').textContent = 'املأ البيانات المتاحة فقط — كل الخانات اختيارية. رقم الطلب بيتحدد تلقائياً عند الحفظ.';
  $('itemsContainer').innerHTML = '';
  formState.totalManual = false;
  hideFormError();
  addItem();
}

function collectItems() {
  return [...document.querySelectorAll('[data-item]')].map(card => {
    const o = {};
    card.querySelectorAll('[data-field]').forEach(el => { o[el.dataset.field] = el.value.trim(); });
    return o;
  }).filter(o => Object.values(o).some(v => v !== '')).map(normalizeItem);
}

function showFormError(msg, elId) {
  $('formError').textContent = msg; $('formError').hidden = false;
  if (elId && $(elId)) $(elId).focus();
  $('formError').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function hideFormError() { $('formError').hidden = true; }

function validateForm(items) {
  const phone = toWestern($('customerPhone').value).trim();
  if (phone && !/^\+?[0-9\s-]{8,16}$/.test(phone)) return ['رقم التليفون غير صحيح — اكتب أرقام فقط (مثال: 01012345678).', 'customerPhone'];
  const total = num($('totalPrice').value), paid = num($('paidAmount').value), disc = num($('discount').value);
  if ([total, paid, disc].some(v => v != null && v < 0)) return ['المبالغ لازم تكون صفر أو أكبر.', 'totalPrice'];
  if (items.some(i => (i.qty !== '' && Number(i.qty) < 0) || (i.price !== '' && Number(i.price) < 0))) return ['الكمية والسعر لازم يكونوا صفر أو أكبر.', null];
  if (total != null && paid != null && paid > total) return ['المبلغ المدفوع أكبر من الإجمالي النهائي — راجع الأرقام.', 'paidAmount'];
  const empty = !$('customerName').value.trim() && !phone && !items.length && total == null && !$('orderNotes').value.trim();
  if (empty) return ['اكتب أي بيانات للطلب (عميل، منتج، مبلغ أو ملاحظة) قبل الحفظ.', 'customerName'];
  return null;
}

function saveOrder(andReceipt) {
  const items = collectItems();
  const err = validateForm(items);
  if (err) { showFormError(err[0], err[1]); return; }
  hideFormError();

  const editId = $('editOrderId').value;
  const existing = editId ? state.orders.find(o => o.id === editId) : null;
  const now = new Date().toISOString();

  const paidNew = num($('paidAmount').value) || 0;
  const prevPaid = existing ? paidOf(existing) : 0;
  const pays = existing ? existing.payments.map(p => ({ ...p })) : [];
  if (existing && !pays.length && prevPaid > 0) pays.push({ amount: prevPaid, at: existing.createdAt, note: 'دفعات سابقة' });
  const diff = round2(paidNew - prevPaid);
  if (diff !== 0) pays.push({ amount: diff, at: now, note: existing ? 'تعديل يدوي' : 'دفعة أولى' });

  const data = normalizeOrder({
    id: existing ? existing.id : nextId(),
    dayId: existing ? existing.dayId : state.activeDay,
    createdAt: existing ? existing.createdAt : now,
    dueDate: $('dueDate').value,
    customer: $('customerName').value, phone: $('customerPhone').value,
    items, discount: $('discount').value, total: $('totalPrice').value, paid: $('paidAmount').value,
    payments: pays, status: $('orderStatus').value, notes: $('orderNotes').value
  });

  if (existing) state.orders[state.orders.indexOf(existing)] = data; else state.orders.unshift(data);
  commit();
  toast(existing ? `تم تحديث الطلب ${data.id}` : `تم حفظ الطلب ${data.id}`);
  go('orders');
  if (andReceipt) showReceipt(data);
}

function editOrder(id) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  state.activeDay = o.dayId; persist();
  $('editOrderId').value = o.id;
  go('new-order', { keep: true });
  $('formHeading').textContent = 'تعديل الطلب ' + o.id;
  $('formSub').textContent = 'تاريخ الإنشاء: ' + fmtDateTime(o.createdAt);
  $('customerName').value = o.customer; $('customerPhone').value = o.phone;
  $('discount').value = o.discount ?? ''; $('totalPrice').value = o.total ?? ''; $('paidAmount').value = o.paid ?? '';
  $('orderStatus').value = o.status; $('dueDate').value = o.dueDate; $('orderNotes').value = o.notes;
  const sub = itemsSubtotal(o);
  formState.totalManual = o.total != null && sub != null && round2(Math.max(0, sub - (o.discount || 0))) !== o.total;
  $('itemsContainer').innerHTML = '';
  if (o.items.length) o.items.forEach(addItem); else addItem();
  hideFormError();
  updateAccounts();
}

/* ---------- الحذف والدفعات ---------- */
async function deleteOrder(id) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  const ok = await ask({ title: 'حذف الطلب', message: `هتحذف الطلب ${o.id}${o.customer ? ` (${o.customer})` : ''}؟\nهيتنقل لسلة المحذوفات وتقدر ترجّعه.`, yes: 'حذف', danger: true });
  if (!ok) return;
  state.orders = state.orders.filter(x => x.id !== id);
  moveToTrash([o]); commit();
  toast('تم حذف الطلب', { action: 'تراجع', fn: () => { restoreFromTrash(id); commit(); toast('تم استرجاع الطلب'); } });
}

function openPay(id) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  payOrderId = id;
  const rem = remainingOf(o);
  $('payTitle').textContent = 'تسجيل دفعة — ' + o.id;
  $('paySummary').innerHTML = `العميل: <b>${esc(o.customer || '—')}</b><br>الإجمالي: <b>${o.total != null ? money(o.total) : '—'}</b> · المدفوع: <b>${money(paidOf(o))}</b> · المتبقي: <b>${rem != null ? money(rem) : '—'}</b>`;
  $('payAmount').value = rem > 0 ? rem : ''; $('payNote').value = ''; $('payError').hidden = true;
  openModal('payModal', $('payAmount'));
}

function savePay() {
  const o = state.orders.find(x => x.id === payOrderId);
  if (!o) return;
  const amount = num($('payAmount').value), rem = remainingOf(o);
  const fail = m => { $('payError').textContent = m; $('payError').hidden = false; };
  if (!(amount > 0)) return fail('اكتب مبلغ أكبر من صفر.');
  if (rem != null && amount > rem + 0.001) return fail(`المبلغ أكبر من المتبقي (${money(rem)}).`);
  if (!o.payments.length && paidOf(o) > 0) o.payments.push({ amount: paidOf(o), at: o.createdAt, note: 'دفعات سابقة' });
  o.payments.push({ amount, at: new Date().toISOString(), note: $('payNote').value.trim() });
  o.paid = round2(paidOf(o) + amount);
  commit(); closeModal('payModal');
  toast(`تم تسجيل دفعة ${money(amount)}`);
}

/* ---------- الإيصال ---------- */
function showReceipt(o) {
  currentReceipt = o;
  $('receiptPreview').innerHTML = receiptHTML(o);
  openModal('receiptModal', $('printReceipt'));
}

/* ---------- التصفية والعرض ---------- */
function filteredOrders() {
  const q = normText($('orderSearch').value), st = $('statusFilter').value, pay = $('payFilter').value, due = $('dueFilter').value;
  const from = $('fromDate').value, to = $('toDate').value;
  const qDigits = phoneDigits(q);
  const base = $('orderScope').value === 'all' ? state.orders : dayOrders();
  return base.filter(o => {
    if (st && o.status !== st) return false;
    if (pay === 'due') { if (!(remainingOf(o) > 0) || isCancelled(o)) return false; }
    else if (pay && payState(o) !== pay) return false;
    if (due === 'overdue' && !isOverdue(o)) return false;
    const d = dayStamp(new Date(o.createdAt));
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (q) {
      const hay = normText([o.id, o.customer, o.phone, itemSummary(o), o.notes].join(' '));
      if (!hay.includes(q) && !(qDigits.length >= 4 && phoneDigits(o.phone).includes(qDigits))) return false;
    }
    return true;
  });
}

const statusClass = s => ({ 'تم التسليم': 's-done', 'جاري التصنيع': 's-work', 'جاهز للتسليم': 's-ready', 'ملغي': 's-cancel' }[s] || 's-new');
const remainCell = o => {
  if (isCancelled(o) || o.total == null) return '—';
  const r = remainingOf(o);
  return r > 0 ? `<span class="remain-due">${money(r)}</span>` : '<span class="remain-ok">مسدّد</span>';
};
const payBadge = o => { const s = payState(o); return s === 'none' ? '—' : `<span class="pay p-${s}">${PAY_LABEL[s]}</span>`; };
const statusBadge = o => `<span class="status ${statusClass(o.status)}">${esc(o.status)}</span>${isOverdue(o) ? '<span class="late">متأخر</span>' : ''}`;

function renderStats() {
  const list = dayOrders(), t = ordersTotals(list);
  $('statOrders').textContent = fmt(t.count);
  $('statPending').textContent = fmt(t.active);
  $('statDelivered').textContent = fmt(t.delivered);
  $('statSales').textContent = money(t.total);
  $('statPaid').textContent = money(t.paid);
  $('statRemaining').textContent = money(t.remaining);
  $('todayLabel').textContent = (state.days.find(d => d.id === state.activeDay) || {}).label || '';
}

function renderRecent() {
  const list = dayOrders().slice(0, 5);
  $('recentOrders').innerHTML = list.map(o => `<tr><td><b>${esc(o.id)}</b></td><td>${esc(o.customer || '—')}</td><td>${esc(itemSummary(o))}</td><td>${remainCell(o)}</td><td>${statusBadge(o)}</td><td><button class="action-btn" data-act="receipt" data-id="${esc(o.id)}">فتح</button></td></tr>`).join('');
  $('recentEmpty').style.display = list.length ? 'none' : 'block';
}

function renderOrders() {
  const list = filteredOrders();
  const shown = list.slice(0, MAX_ROWS);
  $('allOrders').innerHTML = shown.map(o => {
    const canPay = !isCancelled(o) && (o.total == null || remainingOf(o) > 0);
    return `<tr><td><b>${esc(o.id)}</b></td><td>${esc(o.customer || '—')}<small class="muted">${esc(o.phone)}</small></td><td>${fmtDate(o.createdAt)}</td><td>${esc(itemSummary(o))}</td><td class="num">${o.total != null ? money(o.total) : '—'}</td><td class="num">${remainCell(o)}</td><td>${payBadge(o)}</td><td>${statusBadge(o)}</td><td>
      <button class="action-btn" data-act="edit" data-id="${esc(o.id)}">تعديل</button>
      <button class="action-btn" data-act="receipt" data-id="${esc(o.id)}">إيصال</button>
      ${canPay ? `<button class="action-btn good" data-act="pay" data-id="${esc(o.id)}">+ دفعة</button>` : ''}
      <button class="action-btn danger" data-act="delete" data-id="${esc(o.id)}">حذف</button></td></tr>`;
  }).join('');
  $('ordersEmpty').style.display = list.length ? 'none' : 'block';
  const t = ordersTotals(list);
  $('ordersFoot').hidden = !list.length;
  $('ordersFoot').innerHTML = `<span>عدد الطلبات: <b>${fmt(t.count)}</b>${list.length > MAX_ROWS ? ` (معروض أول ${MAX_ROWS} — ضيّق البحث)` : ''}</span><span>الإجمالي: <b>${money(t.total)}</b></span><span>المدفوع: <b>${money(t.paid)}</b></span><span>المتبقي: <b>${money(t.remaining)}</b></span>${t.cancelled ? `<span>ملغي (غير محسوب): <b>${fmt(t.cancelled)}</b></span>` : ''}`;
}

function renderCustomers() {
  const arr = customersList();
  $('customersTable').innerHTML = arr.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.count}</td><td class="num">${money(c.total)}</td><td class="num">${money(c.paid)}</td><td class="num">${c.remaining > 0 ? `<span class="remain-due">${money(c.remaining)}</span>` : '<span class="remain-ok">مسدّد</span>'}</td><td><button class="action-btn" data-act="cust-orders" data-q="${esc(c.phone !== '—' ? c.phone : c.name)}">عرض الطلبات</button></td></tr>`).join('');
  $('customersEmpty').style.display = arr.length ? 'none' : 'block';
  const seen = new Set(), opts = [];
  state.orders.forEach(o => { const k = normText(o.customer); if (o.customer && !seen.has(k)) { seen.add(k); opts.push(`<option value="${esc(o.customer)}"></option>`); } });
  $('customersSuggestions').innerHTML = opts.join('');
}

function renderReports() {
  const m = $('reportMonth').value || dayStamp().slice(0, 7);
  const list = state.orders.filter(o => dayStamp(new Date(o.createdAt)).startsWith(m));
  const t = ordersTotals(list);
  const card = (icon, cls, label, val) => `<article class="stat-card"><div class="stat-icon ${cls}"><svg class="ic"><use href="#i-${icon}"/></svg></div><div><span>${label}</span><strong>${val}</strong></div></article>`;
  $('reportStats').innerHTML = card('orders', 'blue', 'عدد الطلبات', fmt(t.count)) + card('chart', 'navy', 'إجمالي المبيعات', money(t.total)) + card('wallet', 'green', 'المحصَّل', money(t.paid)) + card('alert', 'red', 'المتبقي', money(t.remaining)) + card('check', 'green', 'تم تسليمها', fmt(t.delivered)) + card('x', 'orange', 'ملغية', fmt(t.cancelled));
  const cats = {};
  list.filter(o => !isCancelled(o)).forEach(o => o.items.forEach(i => {
    const k = i.category || 'غير محدد';
    cats[k] = cats[k] || { n: 0, qty: 0, val: 0 };
    cats[k].n++; cats[k].qty += Number(i.qty) || 0; cats[k].val += Number(i.lineTotal) || 0;
  }));
  const rows = Object.entries(cats).sort((a, b) => b[1].val - a[1].val);
  $('reportCats').innerHTML = rows.length ? rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmt(v.n)}</td><td>${fmt(v.qty)}</td><td class="num">${money(v.val)}</td></tr>`).join('') : '<tr><td colspan="4" class="hint">لا توجد بيانات في هذا الشهر.</td></tr>';
  $('reportStatus').innerHTML = ORDER_STATUSES.map(s => `<tr><td><span class="status ${statusClass(s)}">${s}</span></td><td>${fmt(list.filter(o => o.status === s).length)}</td></tr>`).join('');
}

function renderBackupUI() {
  const age = backupAgeDays(), n = state.orders.length;
  let cls = '', note;
  if (age == null) { note = 'لم تُنزَّل نسخة احتياطية بعد'; cls = n ? 'bad' : ''; }
  else if (age >= 7) { note = `آخر نسخة احتياطية من ${age} يوم`; cls = 'warn'; }
  else { note = age === 0 ? 'آخر نسخة احتياطية: اليوم' : `آخر نسخة احتياطية: من ${age} يوم`; }
  const banner = $('backupBanner');
  if (n > 0 && (age == null || age >= 7)) {
    banner.hidden = false;
    banner.innerHTML = `<span>⚠ ${age == null ? 'لسه معملتش نسخة احتياطية لبياناتك' : `آخر نسخة احتياطية كانت من ${age} يوم`} — بياناتك محفوظة على هذا المتصفح فقط.</span><button data-act="backup">تنزيل نسخة الآن</button>`;
  } else banner.hidden = true;

  const od = state.orders.filter(isOverdue).length;
  const ob = $('overdueBanner');
  if (od) { ob.hidden = false; ob.innerHTML = `<span>⏰ فيه ${fmt(od)} طلب متأخر عن موعد التسليم.</span><button data-act="show-overdue">عرض الطلبات المتأخرة</button>`; }
  else ob.hidden = true;

  const sw = $('storageWarn');
  if (!state.storageOk) { sw.hidden = false; sw.textContent = 'تعذّر الحفظ على الجهاز (التخزين ممتلئ أو غير متاح). نزّل نسخة احتياطية فوراً ولا تقفل الصفحة.'; }
  else if (state.corrupt.length) { sw.hidden = false; sw.textContent = 'تم اكتشاف بيانات تالفة وتم الاحتفاظ بنسخة منها. استرجع من نسخة احتياطية لو بيانات ناقصة.'; }
  else sw.hidden = true;
}

function renderSettingsLists() {
  const age = backupAgeDays();
  $('backupStatus').innerHTML = `عدد الطلبات الحالية: <b>${fmt(state.orders.length)}</b><br>` + (state.meta.lastBackupAt ? `آخر نسخة احتياطية: <b>${fmtDateTime(state.meta.lastBackupAt)}</b>${age >= 7 ? ' — مرّ أكثر من أسبوع ⚠' : ''}` : 'لم يتم تنزيل أي نسخة احتياطية حتى الآن.');
  $('undoRestoreRow').hidden = !hasPreRestore();
  const snaps = getSnapshots();
  $('snapshotsList').innerHTML = snaps.length ? snaps.map((s, i) => `<div class="plain-row"><span>${fmtDateTime(s.at)} <small>· ${fmt(s.count)} طلب</small></span><button class="action-btn" data-act="snap-restore" data-i="${i}">استرجاع</button></div>`).join('') : '<p class="hint">لا توجد لقطات بعد — بتتكوّن تلقائياً مع أول طلب.</p>';
  $('trashList').innerHTML = state.trash.length
    ? `<div class="btn-row"><button class="danger-btn" data-act="empty-trash">إفراغ السلة نهائياً (${fmt(state.trash.length)})</button></div>` + state.trash.slice(0, 50).map(t => `<div class="plain-row"><span><b>${esc(t.order.id)}</b> ${esc(t.order.customer || '')} <small>· ${itemSummary(t.order) === '—' ? '' : esc(itemSummary(t.order)) + ' · '}حُذف ${fmtDateTime(t.deletedAt)}</small></span><span><button class="action-btn good" data-act="restore" data-id="${esc(t.order.id)}">استرجاع</button><button class="action-btn danger" data-act="purge" data-id="${esc(t.order.id)}">حذف نهائي</button></span></div>`).join('')
    : '<p class="hint">السلة فاضية.</p>';
}

function renderAll() {
  renderStats(); renderRecent(); renderOrders(); renderCustomers(); renderReports();
  renderDays(); renderBackupUI(); renderSettingsLists();
}

/* ---------- الإعدادات ---------- */
function loadSettingsUI() {
  const s = state.settings;
  $('settingFactory').value = s.factory || ''; $('settingPhone').value = s.phone || ''; $('settingAddress').value = s.address || '';
  $('settingFooter').value = s.footer || ''; $('settingTerms').value = s.terms || ''; $('settingSize').value = s.receiptSize || 'a4';
  $('appVersion').textContent = APP_VERSION;
}

async function handleRestoreFile(file) {
  const r = parseBackup(await file.text());
  if (r.error) { toast(r.error, { error: true }); return; }
  const choice = await ask({
    title: 'استرجاع نسخة احتياطية',
    message: `الملف فيه ${fmt(r.count)} طلب${r.exportedAt ? ` (بتاريخ ${fmtDateTime(r.exportedAt)})` : ''}.\n\n• دمج: يضيف الطلبات الناقصة ويبقي الحالي كما هو.\n• استبدال: يمسح البيانات الحالية ويحط بيانات الملف.\n\nبتقدر تتراجع بعد الاسترجاع.`,
    yes: 'دمج مع الحالي', alt: 'استبدال الكل'
  });
  if (!choice) return;
  restoreData(r.data, choice === 'alt' ? 'replace' : 'merge');
  commit(); loadSettingsUI();
  toast(choice === 'alt' ? 'تم استبدال البيانات من النسخة' : 'تم دمج النسخة مع البيانات الحالية');
}

/* ---------- الأحداث ---------- */
function clearFilters() {
  ['orderSearch', 'statusFilter', 'payFilter', 'dueFilter', 'fromDate', 'toDate'].forEach(id => { $(id).value = ''; });
  $('orderScope').value = 'day';
}

document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-page]');
  if (nav) { go(nav.dataset.page); return; }
  const goBtn = e.target.closest('[data-go]');
  if (goBtn) { go(goBtn.dataset.go); return; }
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeTop(closeBtn.closest('.modal-backdrop').id); return; }
  if (e.target.classList.contains('modal-backdrop')) { closeTop(e.target.id); return; }

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'day': selectDay(id); break;
    case 'del-day': deleteDay(id); break;
    case 'edit': editOrder(id); break;
    case 'receipt': { const o = state.orders.find(x => x.id === id); if (o) showReceipt(o); break; }
    case 'pay': openPay(id); break;
    case 'delete': deleteOrder(id); break;
    case 'remove-item': {
      if (document.querySelectorAll('[data-item]').length > 1) { el.closest('[data-item]').remove(); updateAccounts(); }
      else toast('لازم تسيب منتج واحد على الأقل');
      break;
    }
    case 'backup': backupNow(); renderAll(); toast('تم تنزيل النسخة الاحتياطية — احتفظ بها في مكان آمن'); break;
    case 'show-overdue': clearFilters(); $('orderScope').value = 'all'; $('dueFilter').value = 'overdue'; go('orders'); break;
    case 'cust-orders': clearFilters(); $('orderScope').value = 'all'; $('orderSearch').value = el.dataset.q; go('orders'); break;
    case 'restore': if (restoreFromTrash(id)) { commit(); toast('تم استرجاع الطلب'); } break;
    case 'purge': {
      if (await ask({ title: 'حذف نهائي', message: 'الطلب ده هيتحذف نهائياً ومش هتقدر ترجّعه.', yes: 'حذف نهائي', danger: true })) { state.trash = state.trash.filter(t => t.order.id !== id); commit(); }
      break;
    }
    case 'empty-trash': {
      if (await ask({ title: 'إفراغ السلة', message: `هيتم حذف ${state.trash.length} طلب نهائياً.`, yes: 'إفراغ', danger: true })) { state.trash = []; commit(); toast('تم إفراغ السلة'); }
      break;
    }
    case 'snap-restore': {
      const s = getSnapshots()[Number(el.dataset.i)];
      if (s && await ask({ title: 'استرجاع لقطة', message: `هيتم استبدال البيانات الحالية بلقطة ${fmtDateTime(s.at)} (${s.count} طلب).\nبتقدر تتراجع بعدها.`, yes: 'استرجاع', danger: true })) {
        restoreData(s.data, 'replace'); commit(); loadSettingsUI(); toast('تم استرجاع اللقطة');
      }
      break;
    }
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  for (const id of ['confirmModal', 'payModal', 'receiptModal']) if ($(id).classList.contains('show')) { closeTop(id); break; }
});

$('menuBtn').onclick = toggleSidebar;
$('scrim').onclick = closeSidebar;
$('topNewOrder').onclick = () => go('new-order');
$('addDayBtn').onclick = createDay;
$('addItemBtn').onclick = () => addItem();
$('cancelForm').onclick = () => go('orders');
$('savePrintBtn').onclick = () => saveOrder(true);
$('orderForm').onsubmit = e => { e.preventDefault(); saveOrder(false); };

$('itemsContainer').addEventListener('input', e => { if (e.target.matches('[data-field="qty"],[data-field="price"]')) updateAccounts(); });
$('itemsContainer').addEventListener('change', e => {
  if (!e.target.matches('[data-field="category"]')) return;
  const typeEl = e.target.closest('[data-item]').querySelector('[data-field="type"]');
  const heater = HEATER_CATEGORIES.includes(e.target.value);
  if (heater) typeEl.setAttribute('list', 'heaterTypesList'); else typeEl.removeAttribute('list');
  typeEl.placeholder = heater ? 'اختار أو اكتب النوع' : 'مثلاً: لوحة 3 فاز';
});
$('discount').addEventListener('input', updateAccounts);
$('totalPrice').addEventListener('input', () => { formState.totalManual = $('totalPrice').value !== ''; updateAccounts(); });
$('paidAmount').addEventListener('input', updateRemaining);
$('autoCalcBtn').onclick = () => { formState.totalManual = false; updateAccounts(); };
$('customerName').addEventListener('change', () => {
  const name = normText($('customerName').value);
  const match = state.orders.find(o => normText(o.customer) === name && o.phone);
  if (match && !$('customerPhone').value) $('customerPhone').value = match.phone;
});

['orderSearch', 'statusFilter', 'payFilter', 'dueFilter', 'orderScope', 'fromDate', 'toDate'].forEach(id => $(id).addEventListener(id === 'orderSearch' ? 'input' : 'change', renderOrders));
$('clearFilters').onclick = () => { clearFilters(); renderOrders(); };
$('exportCsv').onclick = () => {
  const list = filteredOrders();
  if (!list.length) { toast('مفيش طلبات للتصدير'); return; }
  downloadFile(`elhady-orders-${dayStamp()}.csv`, ordersToCSV(list), 'text/csv;charset=utf-8');
  toast(`تم تصدير ${fmt(list.length)} طلب — يفتح في Excel`);
};
$('reportMonth').addEventListener('change', renderReports);

$('printReceipt').onclick = printReceipt;
$('waReceipt').onclick = () => { if (currentReceipt) sendWhatsApp(currentReceipt); };
$('paySave').onclick = savePay;
$('payAmount').addEventListener('keydown', e => { if (e.key === 'Enter') savePay(); });

$('saveSettings').onclick = () => {
  state.settings = {
    ...state.settings,
    factory: $('settingFactory').value.trim() || DEFAULT_SETTINGS.factory,
    phone: $('settingPhone').value.trim(), address: $('settingAddress').value.trim(),
    footer: $('settingFooter').value.trim(), terms: $('settingTerms').value.trim(), receiptSize: $('settingSize').value
  };
  commit(); toast('تم حفظ الإعدادات');
};
$('backupBtn').onclick = () => { backupNow(); renderAll(); toast('تم تنزيل النسخة الاحتياطية — احتفظ بها في مكان آمن'); };
$('restoreBtn').onclick = () => $('restoreFile').click();
$('restoreFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleRestoreFile(f); };
$('undoRestoreBtn').onclick = async () => {
  if (await ask({ title: 'التراجع عن الاسترجاع', message: 'هيرجّع بياناتك زي ما كانت قبل آخر استرجاع.', yes: 'تراجع' })) { undoRestore(); commit(); loadSettingsUI(); toast('تم التراجع عن آخر استرجاع'); }
};

$('deleteDayOrders').onclick = async () => {
  const list = dayOrders();
  if (!list.length) { toast('مفيش طلبات في اليوم المحدد'); return; }
  if (!await ask({ title: 'حذف طلبات اليوم', message: `هتحذف ${list.length} طلب من اليوم المحدد فقط. باقي الأيام هتفضل محفوظة، والطلبات هتروح لسلة المحذوفات.`, yes: 'حذف', danger: true })) return;
  const ids = new Set(list.map(o => o.id));
  state.orders = state.orders.filter(o => !ids.has(o.id));
  moveToTrash(list); commit(); toast(`تم حذف ${list.length} طلب`);
};
$('deleteEveryOrder').onclick = async () => {
  const all = state.orders.slice();
  if (!all.length) { toast('مفيش طلبات محفوظة'); return; }
  if (!await ask({ title: 'حذف كل الطلبات', message: `تحذير: هيتم حذف كل الطلبات من جميع الأيام (${all.length} طلب).\nهينزل ملف نسخة احتياطية تلقائياً قبل الحذف.`, yes: 'حذف الكل', danger: true, type: 'حذف' })) return;
  backupNow();
  state.orders = []; moveToTrash(all); commit();
  toast(`تم حذف ${all.length} طلب — موجودين في سلة المحذوفات والنسخة الاحتياطية`);
};

/* ---------- التشغيل ---------- */
function init() {
  loadState();
  takeDailySnapshot();
  const opts = ORDER_STATUSES.map(s => `<option>${s}</option>`).join('');
  $('orderStatus').innerHTML = opts;
  $('statusFilter').innerHTML = '<option value="">كل الحالات</option>' + opts;
  $('heaterTypesList').innerHTML = HEATER_TYPES.map(t => `<option value="${t}"></option>`).join('');
  $('reportMonth').value = dayStamp().slice(0, 7);
  loadSettingsUI();
  resetForm();
  renderAll();
  if (state.corrupt.length) toast('تم اكتشاف بيانات تالفة وتم الاحتفاظ بنسخة منها', { error: true });
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
