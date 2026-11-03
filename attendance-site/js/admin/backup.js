// النسخ الاحتياطي وتصدير السجلات
import { collection, doc, getDoc, getDocs, query, where } from '../../vendor/firebase.js';
import { db, arabicError } from '../firebase.js';
import { todayKey, addDays, tsToMs, formatDateTime, formatTime, nowMs } from '../time.js';
import { $, h, toast, toCSV, downloadFile } from '../ui.js';
import { store, can } from './store.js';

export function render(root) {
  const t = todayKey();
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'النسخ الاحتياطي والتصدير'),
      h('div', { class: 'muted' }, 'البيانات محفوظة في خوادم Google، لكن يُنصح بتنزيل نسخة احتياطية أسبوعيًا وحفظها في مكان آمن (مثل Google Drive المدرسي).'))),
    h('section', { class: 'card' },
      h('h3', {}, 'نسخة احتياطية كاملة (JSON)'),
      h('p', { class: 'muted small' }, 'تشمل: الإعدادات، المعلمين، الصلاحيات، العطل، الإجازات، سجلات الحضور للفترة المختارة، وسجل التعديلات. الملف يحتوي على بيانات شخصية — احفظيه بأمان.'),
      h('div', { class: 'toolbar' },
        h('label', { class: 'small' }, 'سجلات الحضور من'), h('input', { type: 'date', id: 'bA', value: addDays(t, -365) }),
        h('label', { class: 'small' }, 'إلى'), h('input', { type: 'date', id: 'bB', value: t }),
        h('button', { class: 'btn btn-primary', id: 'bBtn', onclick: fullBackup }, 'تنزيل النسخة الاحتياطية')),
      h('p', { class: 'small muted', id: 'bStatus' })),
    h('section', { class: 'card' },
      h('h3', {}, 'تصدير سجلات الحضور الخام (CSV لبرنامج Excel)'),
      h('div', { class: 'toolbar' },
        h('label', { class: 'small' }, 'من'), h('input', { type: 'date', id: 'cA', value: addDays(t, -30) }),
        h('label', { class: 'small' }, 'إلى'), h('input', { type: 'date', id: 'cB', value: t }),
        h('button', { class: 'btn btn-outline', onclick: rawCsv }, 'تنزيل CSV'))),
    h('section', { class: 'card' },
      h('h3', {}, 'نسخ احتياطي تلقائي (اختياري — يتطلب خطة Blaze المدفوعة)'),
      h('p', { class: 'small' }, 'يمكن تفعيل «النسخ الاحتياطي المجدول» لقاعدة Firestore من Google Cloud Console (Firestore ← Disaster recovery ← Backups). يتطلب ربط بطاقة دفع، وتُحتسب تكلفة تخزين النسخ. التفاصيل في دليل التشغيل.')),
  );
}

function plainValue(v) {
  if (v == null) return v;
  if (typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString();
  if (Array.isArray(v)) return v.map(plainValue);
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = plainValue(x); return o; }
  return v;
}

async function dumpCollection(name, q) {
  const snap = await getDocs(q || collection(db, name));
  return snap.docs.map((d) => ({ _id: d.id, ...plainValue(d.data()) }));
}

async function fullBackup() {
  const btn = $('#bBtn'); const st = $('#bStatus');
  const A = $('#bA').value, B = $('#bB').value;
  btn.disabled = true;
  try {
    const out = { _meta: { app: 'smart-assembly-attendance', version: 1, exportedAt: new Date(nowMs()).toISOString(), exportedBy: store.me.email, attendanceRange: [A, B] } };
    st.textContent = 'جارٍ قراءة الإعدادات…';
    const s = await getDoc(doc(db, 'settings', 'general'));
    out.settings = s.exists() ? plainValue(s.data()) : null;
    for (const c of ['teachers', 'admins', 'holidays', 'excusals']) { st.textContent = `جارٍ قراءة ${c}…`; out[c] = await dumpCollection(c); }
    st.textContent = 'جارٍ قراءة سجلات الحضور…';
    out.attendance = await dumpCollection('attendance', query(collection(db, 'attendance'), where('dateKey', '>=', A), where('dateKey', '<=', B)));
    if (can.admin()) { st.textContent = 'جارٍ قراءة سجل التعديلات…'; out.auditLog = await dumpCollection('auditLog'); }
    downloadFile(`نسخة-احتياطية-الحضور-${todayKey()}.json`, JSON.stringify(out, null, 1), 'application/json');
    st.textContent = `تم: ${out.teachers.length} معلمًا، ${out.attendance.length} سجل حضور، ${out.auditLog?.length ?? 0} قيد تعديل. (${formatDateTime(nowMs())})`;
    toast('تم تنزيل النسخة الاحتياطية.', 'ok');
  } catch (err) { st.textContent = ''; toast(arabicError(err), 'bad'); }
  finally { btn.disabled = false; }
}

async function rawCsv() {
  const A = $('#cA').value, B = $('#cB').value;
  try {
    const snap = await getDocs(query(collection(db, 'attendance'), where('dateKey', '>=', A), where('dateKey', '<=', B)));
    const rows = [['التاريخ', 'المعلم', 'وقت التسجيل', 'المصدر', 'ملغى', 'متأخر بعد', 'ملاحظة', 'معرّف الجهاز', 'خط العرض', 'خط الطول', 'دقة الموقع م']];
    const list = snap.docs.map((d) => d.data()).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (tsToMs(a.checkInAt) - tsToMs(b.checkInAt)));
    for (const r of list) rows.push([r.dateKey, r.name, formatTime(tsToMs(r.checkInAt)), r.source === 'admin' ? 'يدوي' : 'QR', r.voided ? 'نعم' : '', r.lateAfterMin != null ? `${Math.floor(r.lateAfterMin / 60)}:${String(r.lateAfterMin % 60).padStart(2, '0')}` : '', r.note || '', r.deviceId || '', r.geo?.lat ?? '', r.geo?.lng ?? '', r.geo?.acc ?? '']);
    downloadFile(`سجلات-الحضور-${A}_${B}.csv`, toCSV(rows));
    toast(`تم تصدير ${list.length} سجلًا.`, 'ok');
  } catch (err) { toast(arabicError(err), 'bad'); }
}
