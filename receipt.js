'use strict';
/* =====================================================================
   الإيصال: العرض، الطباعة (A4 أو حراري 80mm)، وإرسال واتساب
   ===================================================================== */

function itemTitle(i) { return [i.category, i.type].filter(Boolean).join(' - ') || 'منتج'; }

function receiptHTML(o) {
  const s = state.settings;
  const thermal = s.receiptSize === '80mm';
  const showName = s.factory && s.factory.trim() && s.factory.trim() !== DEFAULT_SETTINGS.factory;

  const rows = (o.items || []).map((i, idx) => {
    const details = [i.size && `المقاس: ${esc(i.size)}`, i.voltage && `الفولت: ${esc(i.voltage)}`, i.ampere && `الأمبير: ${esc(i.ampere)}`, i.watt && `القدرة: ${esc(i.watt)} وات`, i.notes && esc(i.notes)].filter(Boolean).join(' | ');
    return `<tr><td class="c">${idx + 1}</td><td>${esc(itemTitle(i))}${details ? `<div class="muted">${details}</div>` : ''}</td><td class="c">${i.qty ? esc(i.qty) : '—'}</td><td>${i.price !== '' ? money(i.price) : '—'}</td><td>${i.lineTotal !== '' ? money(i.lineTotal) : '—'}</td></tr>`;
  }).join('');

  const subtotal = itemsSubtotal(o);
  const remaining = remainingOf(o);
  const hasMoney = o.total != null || o.paid != null;
  const lines = [];
  if (o.discount && subtotal != null) lines.push(`<p><span>المجموع قبل الخصم</span><b>${money(subtotal)}</b></p>`);
  if (o.discount) lines.push(`<p><span>الخصم</span><b>- ${money(o.discount)}</b></p>`);
  if (o.total != null) lines.push(`<p class="grand"><span>الإجمالي</span><b>${money(o.total)}</b></p>`);
  if (o.paid != null) lines.push(`<p><span>المدفوع</span><b>${money(o.paid)}</b></p>`);
  if (remaining != null) lines.push(`<p class="${remaining > 0 ? 'due' : 'ok'}"><span>المتبقي</span><b>${remaining > 0 ? money(remaining) : 'لا يوجد — مدفوع بالكامل'}</b></p>`);

  const payRows = (o.payments || []).length >= 2
    ? `<div class="pay-log"><b>سجل الدفعات</b><table><tbody>${o.payments.map(p => `<tr><td>${fmtDate(p.at)}</td><td>${esc(p.note || '')}</td><td>${p.amount < 0 ? '- ' : ''}${money(Math.abs(p.amount))}</td></tr>`).join('')}</tbody></table></div>` : '';

  return `<div class="receipt ${thermal ? 'thermal' : ''}">
    <div class="r-head"><img src="assets/logo.png" alt="Elhady Power Control" class="r-logo">
      ${showName ? `<h2>${esc(s.factory)}</h2>` : ''}
      <div class="sub">إيصال طلب</div>
      ${s.phone ? `<p class="muted c">تليفون: ${esc(s.phone)}</p>` : ''}
      ${s.address ? `<p class="muted c">${esc(s.address)}</p>` : ''}
    </div>
    <div class="rline"></div>
    <div class="meta">
      <p><b>رقم الطلب:</b> ${esc(o.id)}</p>
      <p><b>التاريخ:</b> ${fmtDateTime(o.createdAt)}</p>
      ${o.customer ? `<p><b>اسم العميل:</b> ${esc(o.customer)}</p>` : ''}
      ${o.phone ? `<p><b>التليفون:</b> ${esc(o.phone)}</p>` : ''}
      ${o.dueDate ? `<p><b>موعد التسليم المتوقع:</b> ${fmtDate(o.dueDate)}</p>` : ''}
    </div>
    ${rows ? `<table class="r-items"><thead><tr><th>#</th><th>المنتج / التفاصيل</th><th>الكمية</th><th>سعر القطعة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${o.notes ? `<p class="notes"><b>ملاحظات:</b> ${esc(o.notes)}</p>` : ''}
    ${hasMoney ? `<div class="total-lines">${lines.join('')}</div>` : ''}
    ${payRows}
    ${s.terms ? `<div class="terms"><b>الضمان والشروط</b><div>${esc(s.terms)}</div></div>` : ''}
    <div class="sign"><div>توقيع المستلم<span></span></div><div>ختم / توقيع المصنع<span></span></div></div>
    <div class="rline"></div>
    <div class="rfoot">${esc(s.footer || '')}</div>
  </div>`;
}

function printReceipt() {
  let st = document.getElementById('pageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  st.textContent = state.settings.receiptSize === '80mm' ? '@page{size:80mm auto;margin:3mm}' : '@page{size:A4;margin:12mm}';
  window.print();
}

function waNumber(phone) {
  let d = phoneDigits(phone);
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '20' + d.slice(1);
  return d.length >= 8 ? d : '';
}

function whatsappText(o) {
  const s = state.settings;
  const L = [];
  L.push(`*${s.factory || 'Elhady Power Control'}*`);
  L.push(`إيصال طلب رقم ${o.id}`);
  L.push(`التاريخ: ${fmtDate(o.createdAt)}`);
  if (o.customer) L.push(`العميل: ${o.customer}`);
  if ((o.items || []).length) {
    L.push('', 'المنتجات:');
    o.items.forEach((i, n) => L.push(`${n + 1}) ${itemTitle(i)}${i.qty ? ` × ${i.qty}` : ''}${i.lineTotal !== '' ? ` — ${money(i.lineTotal)}` : ''}`));
  }
  L.push('');
  if (o.discount) L.push(`الخصم: ${money(o.discount)}`);
  if (o.total != null) L.push(`الإجمالي: ${money(o.total)}`);
  if (o.paid != null) L.push(`المدفوع: ${money(o.paid)}`);
  const r = remainingOf(o);
  if (r != null) L.push(`المتبقي: ${r > 0 ? money(r) : 'لا يوجد'}`);
  if (o.dueDate) L.push(`موعد التسليم: ${fmtDate(o.dueDate)}`);
  if (s.phone) L.push('', `للتواصل: ${s.phone}`);
  if (s.footer) L.push(s.footer);
  return L.join('\n');
}

function sendWhatsApp(o) {
  const n = waNumber(o.phone);
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(whatsappText(o))}`, '_blank', 'noopener');
}
