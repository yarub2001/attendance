// سجل التعديلات (للقراءة فقط — لا يمكن تعديله أو حذفه حتى من الإدارة)
import { collection, query, orderBy, limit, onSnapshot } from '../../vendor/firebase.js';
import { db, arabicError } from '../firebase.js';
import { tsToMs, formatDateTime } from '../time.js';
import { $, h, infoDialog, toCSV, downloadFile, normalizeArabic } from '../ui.js';
import { noteSnapshot } from './store.js';

export const ACTIONS = {
  'attendance.manual': 'تسجيل حضور يدوي',
  'attendance.edit': 'تعديل وقت حضور',
  'attendance.void': 'إلغاء سجل حضور',
  'attendance.restore': 'استعادة سجل حضور',
  'teacher.create': 'إضافة معلم',
  'teacher.edit': 'تعديل بيانات معلم',
  'teacher.disable': 'إيقاف معلم',
  'teacher.enable': 'تفعيل معلم',
  'excusal.add': 'إضافة إجازة/مهمة',
  'excusal.edit': 'تعديل إجازة/مهمة',
  'excusal.remove': 'حذف إجازة/مهمة',
  'holiday.add': 'إضافة عطلة',
  'holiday.remove': 'حذف عطلة',
  'settings.edit': 'تعديل الإعدادات',
  'settings.workDays': 'تعديل أيام الدوام',
  'settings.open': 'فتح التسجيل',
  'settings.close': 'إيقاف التسجيل',
  'dailyCode.set': 'توليد رمز اليوم',
  'admin.grant': 'منح صلاحية',
  'admin.change': 'تغيير صلاحية',
  'admin.revoke': 'سحب صلاحية',
};

let root, unsub, items = [], search = '';

export function render(container) {
  root = container;
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'سجل التعديلات'),
      h('div', { class: 'muted' }, 'يُحفظ كل تصحيح أو تعديل إداري هنا تلقائيًا مع اسم من قام به ووقته وسببه. لا يمكن تعديل هذا السجل أو حذفه.'))),
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'بحث (اسم، إجراء، سبب)…', oninput: (e) => { search = e.target.value; draw(); } }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-outline btn-sm', onclick: exportCSV }, 'تصدير CSV')),
    h('div', { id: 'auList' }, h('p', { class: 'muted' }, 'جارٍ التحميل…')),
  );
  unsub = onSnapshot(query(collection(db, 'auditLog'), orderBy('at', 'desc'), limit(300)), { includeMetadataChanges: true }, (snap) => {
    noteSnapshot(snap);
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    draw();
  }, (err) => { $('#auList').replaceChildren(h('div', { class: 'notice notice-bad' }, arabicError(err))); });
}
export function destroy() { unsub?.(); }

function draw() {
  const box = $('#auList'); if (!box) return;
  const term = normalizeArabic(search);
  const list = items.filter((a) => !term || normalizeArabic([a.targetName, a.byName, ACTIONS[a.action] || a.action, a.reason].join(' ')).includes(term));
  if (!list.length) { box.replaceChildren(h('div', { class: 'card empty' }, 'لا توجد تعديلات بعد.')); return; }
  box.replaceChildren(h('p', { class: 'small muted' }, `آخر ${items.length} عملية.`), h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['الوقت', 'بواسطة', 'الإجراء', 'على', 'السبب', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, list.map((a) => h('tr', {},
      h('td', { class: 'num', style: 'white-space:nowrap' }, formatDateTime(tsToMs(a.at))),
      h('td', {}, a.byName || ''),
      h('td', {}, h('span', { class: 'badge' }, ACTIONS[a.action] || a.action)),
      h('td', {}, a.targetName || a.targetId),
      h('td', {}, a.reason || ''),
      h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => details(a) }, 'التفاصيل'))))))));
}

function fmtVal(v) {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join('، ');
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(Date.parse(v));
  return String(v);
}

function details(a) {
  const keys = [...new Set([...Object.keys(a.before || {}), ...Object.keys(a.after || {})])]
    .filter((k) => !['updatedAt', 'updatedBy', 'createdBy', 'createdAt', 'auditId', 'deviceId'].includes(k));
  infoDialog({
    title: ACTIONS[a.action] || a.action, wide: true,
    body: h('div', {},
      h('p', { class: 'muted' }, `${a.byName} · ${formatDateTime(tsToMs(a.at))} · ${a.targetName || ''}`),
      a.reason ? h('p', {}, h('strong', {}, 'السبب: '), a.reason) : null,
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['الحقل', 'قبل', 'بعد'].map((x) => h('th', {}, x)))),
        h('tbody', {}, keys.map((k) => {
          const b = fmtVal(a.before?.[k]), af = fmtVal(a.after?.[k]);
          return h('tr', { style: b !== af ? 'background:#fffaf0' : '' }, h('td', {}, k), h('td', {}, b), h('td', {}, af));
        }))))),
  });
}

function exportCSV() {
  const rows = [['الوقت', 'بواسطة', 'الإجراء', 'على', 'المعرّف', 'السبب', 'قبل', 'بعد']];
  for (const a of items) rows.push([formatDateTime(tsToMs(a.at)), a.byName, ACTIONS[a.action] || a.action, a.targetName, a.targetId, a.reason || '', JSON.stringify(a.before || {}), JSON.stringify(a.after || {})]);
  downloadFile('سجل-التعديلات.csv', toCSV(rows));
}
