// الإجازات والمهام الرسمية — تُستبعد من العدد المتوقع
import { collection, doc, writeBatch, serverTimestamp } from '../../vendor/firebase.js';
import { db, arabicError } from '../firebase.js';
import { todayKey, formatKeyShort, rangeKeys } from '../time.js';
import { $, h, toast, formDialog, confirmDialog, normalizeArabic } from '../ui.js';
import { store, subscribe, addAudit, teacherById } from './store.js';
import { EXCUSAL_TYPES } from './stats.js';

let root, unsub, view = 'current', search = '';

export function render(container) {
  root = container;
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'الإجازات والمهام الرسمية'),
      h('div', { class: 'muted' }, 'المعلم المعذور لا يدخل ضمن العدد المتوقع في تلك الأيام. إن سجّل حضوره رغم ذلك يُحتسب حاضرًا.'))),
    h('div', { class: 'toolbar' },
      h('select', { onchange: (e) => { view = e.target.value; draw(); } },
        h('option', { value: 'current' }, 'الحالية والقادمة'), h('option', { value: 'past' }, 'السابقة'), h('option', { value: 'all' }, 'الكل')),
      h('input', { type: 'search', placeholder: 'بحث باسم المعلم…', oninput: (e) => { search = e.target.value; draw(); } }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-primary', onclick: () => addExcusal() }, '+ إضافة إجازة / مهمة')),
    h('div', { id: 'lvList' }),
  );
  unsub = subscribe((w) => { if (w === 'excusals' || w === 'teachers') draw(); });
  draw();
}
export function destroy() { unsub?.(); }

function draw() {
  const box = $('#lvList'); if (!box) return;
  const t = todayKey();
  const term = normalizeArabic(search);
  const list = store.excusals
    .filter((e) => (view === 'all' || (view === 'current' ? e.to >= t : e.to < t)))
    .filter((e) => !term || normalizeArabic(e.name || teacherById(e.uid)?.name).includes(term))
    .sort((a, b) => (view === 'past' ? b.from.localeCompare(a.from) : a.from.localeCompare(b.from)));
  if (!list.length) { box.replaceChildren(h('div', { class: 'card empty' }, 'لا توجد سجلات.')); return; }
  box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['المعلم', 'النوع', 'من', 'إلى', 'الأيام', 'ملاحظة', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, list.map((e) => h('tr', {},
      h('td', { style: 'font-weight:500' }, teacherById(e.uid)?.name || e.name || '—'),
      h('td', {}, h('span', { class: 'badge b-exc' }, EXCUSAL_TYPES[e.type] || e.type)),
      h('td', {}, formatKeyShort(e.from)), h('td', {}, formatKeyShort(e.to)),
      h('td', { class: 'num' }, rangeKeys(e.from, e.to).length),
      h('td', {}, e.note || ''),
      h('td', {}, h('div', { class: 'row', style: 'gap:.3rem;flex-wrap:nowrap' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => addExcusal(e) }, 'تعديل'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => remove(e) }, 'حذف')))))))));
}

async function addExcusal(existing = null) {
  const teachers = store.teachers.filter((t) => t.active || t.id === existing?.uid);
  if (!teachers.length) return toast('أضيفي المعلمين أولًا.', 'warn');
  await formDialog({
    title: existing ? 'تعديل إجازة / مهمة' : 'إضافة إجازة / مهمة رسمية',
    fields: [
      { name: 'uid', label: 'المعلم', type: 'select', value: existing?.uid, required: true, options: teachers.map((t) => ({ value: t.id, label: t.name })) },
      { name: 'type', label: 'النوع', type: 'select', value: existing?.type || 'leave', options: Object.entries(EXCUSAL_TYPES).map(([value, label]) => ({ value, label })) },
      { name: 'from', label: 'من تاريخ', type: 'date', value: existing?.from || todayKey(), required: true },
      { name: 'to', label: 'إلى تاريخ (شامل)', type: 'date', value: existing?.to || todayKey(), required: true },
      { name: 'note', label: 'ملاحظة (مثل: إجازة مرضية، ورشة تدريبية في المديرية)', value: existing?.note || '' },
    ],
    validate: (v) => (v.from > v.to ? 'تاريخ البداية بعد تاريخ النهاية.' : rangeKeys(v.from, v.to).length > 366 ? 'المدة طويلة جدًا.' : null),
    onSubmit: async (v) => {
      const t = teacherById(v.uid);
      const ref = existing ? doc(db, 'excusals', existing.id) : doc(collection(db, 'excusals'));
      const data = { uid: v.uid, name: t?.name || '', type: v.type, from: v.from, to: v.to, note: v.note,
        createdBy: existing?.createdBy || store.me.uid, createdAt: existing?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() };
      try {
        const batch = writeBatch(db);
        const { id, ...before } = existing || {};
        addAudit(batch, { action: existing ? 'excusal.edit' : 'excusal.add', targetId: 'excusals/' + ref.id, targetName: data.name, before: existing ? before : null, after: data });
        batch.set(ref, data);
        await batch.commit();
      } catch (ex) { throw new Error(arabicError(ex)); }
    },
  }).then((ok) => ok && toast('تم الحفظ.', 'ok'));
}

async function remove(e) {
  const ok = await confirmDialog({ title: 'حذف هذا السجل؟', message: `${e.name} — ${EXCUSAL_TYPES[e.type]} من ${formatKeyShort(e.from)} إلى ${formatKeyShort(e.to)}`, confirmText: 'حذف', danger: true });
  if (!ok) return;
  try {
    const batch = writeBatch(db);
    const { id, ...before } = e;
    addAudit(batch, { action: 'excusal.remove', targetId: 'excusals/' + e.id, targetName: e.name, before });
    batch.delete(doc(db, 'excusals', e.id));
    await batch.commit();
    toast('حُذف.', 'ok');
  } catch (err) { toast(arabicError(err), 'bad'); }
}
