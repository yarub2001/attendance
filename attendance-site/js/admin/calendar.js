// أيام العمل والعطل الرسمية
import { doc, writeBatch, serverTimestamp } from '../../vendor/firebase.js';
import { db, arabicError } from '../firebase.js';
import { todayKey, rangeKeys, formatKeyLong, formatKeyShort, WEEKDAYS_AR, addDays } from '../time.js';
import { $, h, toast, confirmDialog } from '../ui.js';
import { store, subscribe, addAudit, saveSettings } from './store.js';

let root, unsub, showPast = false;

export function render(container) {
  root = container;
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('h2', {}, 'أيام العمل والعطل')),
    h('section', { class: 'card' },
      h('h3', {}, 'أيام الدوام الأسبوعية'),
      h('p', { class: 'muted small' }, 'التسجيل مسموح في هذه الأيام فقط، وتُحتسب النسب عليها.'),
      h('div', { class: 'weekdays', id: 'wdBox' }),
      h('button', { class: 'btn btn-primary', style: 'margin-top:.8rem', onclick: saveWorkDays }, 'حفظ أيام الدوام')),
    h('section', { class: 'card' },
      h('h3', {}, 'إضافة عطلة رسمية'),
      h('p', { class: 'muted small' }, 'مثل: العيد الوطني، عيد الفطر، عيد الأضحى، رأس السنة الهجرية، إجازة منتصف العام. يُمنع التسجيل فيها ولا تدخل في النسب.'),
      h('form', { id: 'holForm', class: 'grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'hName' }, 'اسم العطلة'), h('input', { id: 'hName', required: true, placeholder: 'مثال: العيد الوطني' })),
        h('div', { class: 'field' }, h('label', { for: 'hFrom' }, 'من تاريخ'), h('input', { id: 'hFrom', type: 'date', required: true, value: todayKey() })),
        h('div', { class: 'field' }, h('label', { for: 'hTo' }, 'إلى تاريخ (شامل)'), h('input', { id: 'hTo', type: 'date', required: true, value: todayKey() })),
        h('div', { class: 'field', style: 'justify-content:flex-end' }, h('label', {}, ' '), h('button', { class: 'btn btn-primary', type: 'submit' }, 'إضافة العطلة')))),
    h('section', { class: 'card' },
      h('div', { class: 'card-title' }, h('h3', {}, 'العطل المسجّلة'),
        h('label', { class: 'check-row', style: 'margin:0' }, h('input', { type: 'checkbox', checked: showPast, onchange: (e) => { showPast = e.target.checked; drawHolidays(); } }), ' عرض العطل السابقة')),
      h('div', { id: 'holList' })),
  );
  $('#holForm').addEventListener('submit', addHoliday);
  unsub = subscribe((w) => { if (w === 'settings') drawWorkDays(); if (w === 'holidays') drawHolidays(); });
  drawWorkDays(); drawHolidays();
}
export function destroy() { unsub?.(); }

function drawWorkDays() {
  const s = store.settings; if (!s) return;
  $('#wdBox').replaceChildren(...WEEKDAYS_AR.map((n, i) => h('label', { class: 'check-row', style: 'margin:0' },
    h('input', { type: 'checkbox', value: i, checked: s.workDays.includes(i) }), ' ' + n)));
}

async function saveWorkDays() {
  const days = [...root.querySelectorAll('#wdBox input:checked')].map((x) => Number(x.value));
  if (!days.length) return toast('اختاري يومًا واحدًا على الأقل.', 'warn');
  try { await saveSettings({ workDays: days }, 'settings.workDays'); toast('تم حفظ أيام الدوام.', 'ok'); }
  catch (err) { toast(arabicError(err), 'bad'); }
}

async function addHoliday(e) {
  e.preventDefault();
  const name = $('#hName').value.trim();
  let a = $('#hFrom').value, b = $('#hTo').value;
  if (!name || !a || !b) return;
  if (a > b) [a, b] = [b, a];
  const keys = rangeKeys(a, b);
  if (keys.length > 60) return toast('المدة أطول من 60 يومًا. قسّميها إلى فترات.', 'warn');
  try {
    const batch = writeBatch(db);
    addAudit(batch, { action: 'holiday.add', targetId: `holidays/${a}..${b}`, targetName: name, after: { name, from: a, to: b } });
    for (const k of keys) batch.set(doc(db, 'holidays', k), { name, createdBy: store.me.uid, createdAt: serverTimestamp() });
    await batch.commit();
    $('#hName').value = '';
    toast(`أُضيفت العطلة (${keys.length} يوم).`, 'ok');
  } catch (err) { toast(arabicError(err), 'bad'); }
}

/** تجميع الأيام المتتالية ذات الاسم نفسه في فترة واحدة للعرض */
function groups() {
  const keys = [...store.holidays.keys()].sort();
  const out = [];
  for (const k of keys) {
    const name = store.holidays.get(k).name;
    const last = out[out.length - 1];
    if (last && last.name === name && addDays(last.to, 1) === k) { last.to = k; last.keys.push(k); }
    else out.push({ name, from: k, to: k, keys: [k] });
  }
  return out;
}

function drawHolidays() {
  const box = $('#holList'); if (!box) return;
  const t = todayKey();
  const list = groups().filter((g) => showPast || g.to >= t);
  if (!list.length) { box.replaceChildren(h('div', { class: 'empty' }, 'لا توجد عطل ' + (showPast ? '' : 'قادمة ') + 'مسجّلة.')); return; }
  box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['العطلة', 'من', 'إلى', 'الأيام', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, list.map((g) => h('tr', {},
      h('td', { style: 'font-weight:500' }, g.name), h('td', {}, formatKeyShort(g.from)), h('td', {}, formatKeyShort(g.to)), h('td', { class: 'num' }, g.keys.length),
      h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => removeHoliday(g) }, 'حذف'))))))));
}

async function removeHoliday(g) {
  const ok = await confirmDialog({ title: `حذف عطلة «${g.name}»؟`, message: `${formatKeyLong(g.from)}${g.from !== g.to ? ' — ' + formatKeyLong(g.to) : ''}`, confirmText: 'حذف', danger: true });
  if (!ok) return;
  try {
    const batch = writeBatch(db);
    addAudit(batch, { action: 'holiday.remove', targetId: `holidays/${g.from}..${g.to}`, targetName: g.name, before: { name: g.name, from: g.from, to: g.to } });
    for (const k of g.keys) batch.delete(doc(db, 'holidays', k));
    await batch.commit();
    toast('حُذفت العطلة.', 'ok');
  } catch (err) { toast(arabicError(err), 'bad'); }
}
