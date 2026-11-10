'use strict';
/* =====================================================================
   Elhady Power Control — طبقة البيانات
   التخزين الآمن، الترقيم المتسلسل، النسخ الاحتياطي، سلة المحذوفات، الحسابات
   ===================================================================== */

const APP_VERSION = '3.0.0';
const BACKUP_APP_ID = 'elhady-power-control';

const KEYS = {
  orders: 'factory_manager_orders_v1',
  settings: 'factory_manager_settings_v1',
  days: 'factory_manager_days_v1',
  activeDay: 'factory_manager_active_day_v1',
  meta: 'factory_manager_meta_v1',
  trash: 'factory_manager_trash_v1',
  snapshots: 'factory_manager_snapshots_v1',
  preRestore: 'factory_manager_prerestore_v1'
};

const DEFAULT_SETTINGS = {
  factory: 'Elhady Power Control',
  phone: '',
  address: '',
  footer: 'شكراً لثقتكم بنا',
  terms: '',
  receiptSize: 'a4'
};

const ORDER_STATUSES = ['جديد', 'جاري التصنيع', 'جاهز للتسليم', 'تم التسليم', 'ملغي'];
const ACTIVE_STATUSES = ['جديد', 'جاري التصنيع', 'جاهز للتسليم'];
const CATEGORIES = ['سخان صاج', 'سخان سيراميك', 'لوحة باور كنترول', 'إصلاح موتور', 'أخرى'];
const HEATER_CATEGORIES = ['سخان صاج', 'سخان سيراميك'];
const HEATER_TYPES = ['سخان هيد', 'سخان شنب', 'سخان قميص', 'سخان فتح غازات', 'سخان خزنة', 'سخان حلة'];
const PAY_LABEL = { paid: 'مدفوع', partial: 'مدفوع جزئياً', unpaid: 'غير مدفوع', none: '—' };

/* ---------- أدوات عامة ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const money = n => `${fmt(n)} ج.م`;
const pad = n => String(n).padStart(2, '0');
const dayStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayLabelOf = (d = new Date()) => d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('ar-EG'); };
const fmtDateTime = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('ar-EG'); };
const num = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round2 = n => Math.round(n * 100) / 100;
const toWestern = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const normText = s => toWestern(s).toLowerCase().trim();
const phoneDigits = s => toWestern(s).replace(/\D/g, '');

/* ---------- التخزين (آمن ضد الأعطال) ---------- */
const memStore = {};
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return memStore[k] ?? null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { memStore[k] = v; return false; } }

const state = {
  orders: [], days: [], settings: { ...DEFAULT_SETTINGS }, meta: { seq: 0 },
  trash: [], activeDay: '', corrupt: [], storageOk: true
};

function readJSON(key, fallback) {
  const raw = lsGet(key);
  if (raw == null || raw === '') return fallback;
  try { return JSON.parse(raw); }
  catch (e) {
    // البيانات تالفة: نحتفظ بنسخة من النص الأصلي بدل ما نضيّعه ونكمل بقيمة افتراضية
    lsSet(key + '_corrupt_' + Date.now(), raw);
    state.corrupt.push(key);
    return fallback;
  }
}

function persist() {
  const results = [
    lsSet(KEYS.orders, JSON.stringify(state.orders)),
    lsSet(KEYS.days, JSON.stringify(state.days)),
    lsSet(KEYS.settings, JSON.stringify(state.settings)),
    lsSet(KEYS.meta, JSON.stringify(state.meta)),
    lsSet(KEYS.trash, JSON.stringify(state.trash)),
    lsSet(KEYS.activeDay, state.activeDay)
  ];
  state.storageOk = results.every(Boolean);
  return state.storageOk;
}

/* ---------- تطبيع البيانات ---------- */
function normalizeItem(i) {
  i = i || {};
  const s = v => String(v ?? '').trim();
  const it = { category: s(i.category), type: s(i.type), qty: s(i.qty), size: s(i.size), voltage: s(i.voltage), ampere: s(i.ampere), watt: s(i.watt), price: s(i.price), notes: s(i.notes) };
  it.lineTotal = (it.qty !== '' && it.price !== '' && Number.isFinite(Number(it.qty)) && Number.isFinite(Number(it.price)))
    ? String(round2(Number(it.qty) * Number(it.price))) : '';
  return it;
}

function normalizeOrder(o) {
  const created = o.createdAt || o.date || new Date().toISOString();
  const payments = Array.isArray(o.payments)
    ? o.payments.map(p => ({ amount: num(p.amount) || 0, at: p.at || created, note: String(p.note || '') })) : [];
  return {
    id: String(o.id || ('EPC-X' + Math.random().toString(36).slice(2, 7).toUpperCase())),
    dayId: o.dayId || '',
    createdAt: created,
    dueDate: o.dueDate || '',
    customer: String(o.customer || '').trim(),
    phone: toWestern(o.phone || '').trim(),
    items: (Array.isArray(o.items) ? o.items : []).map(normalizeItem),
    discount: num(o.discount),
    total: num(o.total),
    paid: num(o.paid),
    payments,
    status: ORDER_STATUSES.includes(o.status) ? o.status : 'جديد',
    notes: String(o.notes || '')
  };
}

function seqFromOrders(list) {
  let max = 0;
  list.forEach(o => { const m = /^EPC-(\d+)$/.exec(String(o.id || '')); if (m) max = Math.max(max, Number(m[1])); });
  return max;
}

function nextId() {
  let id;
  do { state.meta.seq++; id = 'EPC-' + String(state.meta.seq).padStart(4, '0'); }
  while (state.orders.some(o => o.id === id));
  lsSet(KEYS.meta, JSON.stringify(state.meta));
  return id;
}

/* ---------- الأيام ---------- */
function newDay(d = new Date(), suffix = 1) {
  return { id: `day-${dayStamp(d)}-${suffix}`, label: dayLabelOf(d), createdAt: d.toISOString() };
}

function repairDays() {
  state.days = (Array.isArray(state.days) ? state.days : []).filter(d => d && d.id).map(d => ({ id: String(d.id), label: String(d.label || ''), createdAt: d.createdAt || new Date().toISOString() }));
  state.orders.forEach(o => {
    if (o.dayId && state.days.some(d => d.id === o.dayId)) return;
    const d = new Date(o.createdAt); const dt = isNaN(d) ? new Date() : d;
    const key = `day-${dayStamp(dt)}-1`;
    let day = state.days.find(x => x.id === key);
    if (!day) { day = newDay(dt); state.days.push(day); }
    o.dayId = day.id;
  });
  if (!state.days.length) state.days.push(newDay());
  state.days.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!state.days.some(d => d.id === state.activeDay)) state.activeDay = state.days[state.days.length - 1].id;
}

/* ---------- التحميل ---------- */
function loadState() {
  const rawOrders = readJSON(KEYS.orders, []);
  const orders = Array.isArray(rawOrders) ? rawOrders : [];
  const settings = readJSON(KEYS.settings, {});
  state.settings = { ...DEFAULT_SETTINGS, ...(settings && typeof settings === 'object' ? settings : {}) };
  const meta = readJSON(KEYS.meta, {});
  state.meta = { seq: 0, ...(meta && typeof meta === 'object' ? meta : {}) };
  state.meta.seq = Math.max(Number(state.meta.seq) || 0, seqFromOrders(orders));
  state.orders = orders.map(normalizeOrder);
  const trash = readJSON(KEYS.trash, []);
  state.trash = (Array.isArray(trash) ? trash : []).filter(t => t && t.order).map(t => ({ order: normalizeOrder(t.order), deletedAt: t.deletedAt || new Date().toISOString() }));
  state.days = readJSON(KEYS.days, []);
  state.activeDay = lsGet(KEYS.activeDay) || '';
  repairDays();
  persist();
}

/* ---------- حسابات الطلب ---------- */
const itemsSubtotal = o => {
  let s = 0, has = false;
  (o.items || []).forEach(i => { if (i.lineTotal !== '' && i.lineTotal != null) { s += Number(i.lineTotal); has = true; } });
  return has ? round2(s) : null;
};
const paidOf = o => o.paid || 0;
const remainingOf = o => (o.total == null ? null : Math.max(0, round2(o.total - paidOf(o))));
const isCancelled = o => o.status === 'ملغي';
const isOverdue = o => !!o.dueDate && o.dueDate < dayStamp() && ACTIVE_STATUSES.includes(o.status);

function payState(o) {
  if (isCancelled(o) || o.total == null || o.total <= 0) return 'none';
  if (paidOf(o) >= o.total) return 'paid';
  if (paidOf(o) > 0) return 'partial';
  return 'unpaid';
}

function ordersTotals(list) {
  const t = { count: list.length, active: 0, delivered: 0, total: 0, paid: 0, remaining: 0, cancelled: 0 };
  list.forEach(o => {
    if (isCancelled(o)) { t.cancelled++; return; }
    if (o.status === 'تم التسليم') t.delivered++;
    if (ACTIVE_STATUSES.includes(o.status)) t.active++;
    t.total += o.total || 0;
    t.paid += paidOf(o);
    t.remaining += remainingOf(o) || 0;
  });
  t.total = round2(t.total); t.paid = round2(t.paid); t.remaining = round2(t.remaining);
  return t;
}

const itemSummary = o => (o.items || []).map(i => [i.category, i.type].filter(Boolean).join(' - ')).filter(Boolean).join('، ') || '—';

function customersList() {
  const map = new Map();
  state.orders.forEach(o => {
    if (!o.customer && !o.phone) return;
    const key = phoneDigits(o.phone) || normText(o.customer);
    if (!map.has(key)) map.set(key, { key, name: o.customer || '—', phone: o.phone || '—', count: 0, total: 0, paid: 0, remaining: 0 });
    const c = map.get(key);
    if (o.customer && c.name === '—') c.name = o.customer;
    if (o.phone && c.phone === '—') c.phone = o.phone;
    c.count++;
    if (!isCancelled(o)) { c.total += o.total || 0; c.paid += paidOf(o); c.remaining += remainingOf(o) || 0; }
  });
  return [...map.values()].sort((a, b) => b.remaining - a.remaining || b.count - a.count);
}

/* ---------- سلة المحذوفات ---------- */
function moveToTrash(list) {
  const at = new Date().toISOString();
  state.trash = [...list.map(order => ({ order, deletedAt: at })), ...state.trash].slice(0, 300);
}
function restoreFromTrash(id) {
  const i = state.trash.findIndex(t => t.order.id === id);
  if (i < 0) return false;
  const order = state.trash.splice(i, 1)[0].order;
  if (state.orders.some(o => o.id === order.id)) order.id = nextId();
  state.orders.unshift(order);
  repairDays();
  return true;
}

/* ---------- النسخ الاحتياطي ---------- */
function exportData() {
  return { app: BACKUP_APP_ID, version: APP_VERSION, exportedAt: new Date().toISOString(), orders: state.orders, days: state.days, settings: state.settings, meta: state.meta, trash: state.trash };
}

function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function backupNow() {
  downloadFile(`elhady-backup-${dayStamp()}.json`, JSON.stringify(exportData(), null, 2), 'application/json');
  state.meta.lastBackupAt = new Date().toISOString();
  persist();
}

function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { error: 'الملف ده مش بصيغة JSON صحيحة.' }; }
  if (!obj || obj.app !== BACKUP_APP_ID || !Array.isArray(obj.orders)) return { error: 'الملف ده مش نسخة احتياطية من البرنامج.' };
  return { data: obj, count: obj.orders.length, exportedAt: obj.exportedAt || '' };
}

function restoreData(obj, mode) {
  // حفظ الوضع الحالي قبل الاستيراد عشان نقدر نتراجع لو حصل غلط
  lsSet(KEYS.preRestore, JSON.stringify({ at: new Date().toISOString(), orders: state.orders, days: state.days, settings: state.settings, meta: state.meta }));
  const incoming = obj.orders.map(normalizeOrder);
  if (mode === 'replace') {
    state.orders = incoming;
    state.days = Array.isArray(obj.days) ? obj.days : [];
    if (obj.settings && typeof obj.settings === 'object') state.settings = { ...DEFAULT_SETTINGS, ...obj.settings };
    if (Array.isArray(obj.trash)) state.trash = obj.trash.filter(t => t && t.order).map(t => ({ order: normalizeOrder(t.order), deletedAt: t.deletedAt || new Date().toISOString() }));
  } else {
    const have = new Set(state.orders.map(o => o.id));
    incoming.forEach(o => { if (!have.has(o.id)) state.orders.push(o); });
    const dayIds = new Set(state.days.map(d => d.id));
    (Array.isArray(obj.days) ? obj.days : []).forEach(d => { if (d && d.id && !dayIds.has(d.id)) state.days.push(d); });
  }
  state.orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  state.meta.seq = Math.max(Number(state.meta.seq) || 0, Number(obj.meta && obj.meta.seq) || 0, seqFromOrders(state.orders));
  repairDays();
  persist();
}

function hasPreRestore() { return !!lsGet(KEYS.preRestore); }
function undoRestore() {
  const snap = readJSON(KEYS.preRestore, null);
  if (!snap) return false;
  state.orders = (snap.orders || []).map(normalizeOrder);
  state.days = snap.days || [];
  state.settings = { ...DEFAULT_SETTINGS, ...(snap.settings || {}) };
  state.meta = { seq: 0, ...(snap.meta || {}) };
  state.meta.seq = Math.max(state.meta.seq, seqFromOrders(state.orders));
  repairDays(); persist();
  try { localStorage.removeItem(KEYS.preRestore); } catch (e) { /* تجاهل */ }
  return true;
}

/* لقطة تلقائية مرة كل يوم (آخر 3 لقطات) — داخل نفس المتصفح */
function takeDailySnapshot() {
  if (!state.orders.length) return;
  const today = dayStamp();
  if (state.meta.lastSnapshot === today) return;
  const snaps = readJSON(KEYS.snapshots, []);
  snaps.unshift({ at: new Date().toISOString(), count: state.orders.length, data: { app: BACKUP_APP_ID, orders: state.orders, days: state.days, settings: state.settings, meta: state.meta } });
  if (lsSet(KEYS.snapshots, JSON.stringify(snaps.slice(0, 3)))) { state.meta.lastSnapshot = today; lsSet(KEYS.meta, JSON.stringify(state.meta)); }
}
const getSnapshots = () => { const s = readJSON(KEYS.snapshots, []); return Array.isArray(s) ? s : []; };

function backupAgeDays() {
  if (!state.meta.lastBackupAt) return null;
  return Math.floor((Date.now() - new Date(state.meta.lastBackupAt).getTime()) / 86400000);
}

/* ---------- تصدير CSV (يفتح في Excel) ---------- */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // منع تنفيذ معادلات داخل Excel
  return '"' + s.replace(/"/g, '""') + '"';
}
function ordersToCSV(list) {
  const head = ['رقم الطلب', 'التاريخ', 'العميل', 'التليفون', 'المنتجات', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة', 'تاريخ التسليم', 'ملاحظات'];
  const rows = list.map(o => [o.id, fmtDate(o.createdAt), o.customer, o.phone, itemSummary(o), o.total ?? '', o.paid ?? '', remainingOf(o) ?? '', o.status, o.dueDate, o.notes]);
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}
