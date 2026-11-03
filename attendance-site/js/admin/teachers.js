// إدارة المعلمين: إضافة، إضافة جماعية، تعديل، إيقاف/تفعيل، استعادة كلمة المرور
import { doc, writeBatch, serverTimestamp, sendPasswordResetEmail } from '../../vendor/firebase.js';
import { db, auth, createLoginAccount, arabicError } from '../firebase.js';
import { todayKey, formatKeyShort } from '../time.js';
import { $, h, toast, formDialog, confirmDialog, infoDialog, toCSV, downloadFile, randomPassword, normalizeArabic } from '../ui.js';
import { store, subscribe, addAudit } from './store.js';

let root, unsub, search = '', filter = 'active';

export function render(container) {
  root = container;
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'المعلمون المعتمدون'),
      h('div', { class: 'muted' }, 'كل معلم له حساب دخول خاص به؛ لا يمكن لأحد التسجيل باسم غيره.'))),
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'بحث بالاسم أو البريد…', value: search, oninput: (e) => { search = e.target.value; draw(); } }),
      h('select', { onchange: (e) => { filter = e.target.value; draw(); } },
        h('option', { value: 'active', selected: filter === 'active' }, 'المفعّلون'),
        h('option', { value: 'inactive', selected: filter === 'inactive' }, 'الموقوفون'),
        h('option', { value: 'all', selected: filter === 'all' }, 'الكل')),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-primary', onclick: addTeacher }, '+ إضافة معلم'),
      h('button', { class: 'btn btn-outline', onclick: bulkAdd }, 'إضافة جماعية'),
      h('button', { class: 'btn btn-outline', onclick: exportList }, 'تصدير القائمة')),
    h('div', { id: 'tCount', class: 'muted small', style: 'margin-bottom:.5rem' }),
    h('div', { id: 'tTable' }),
  );
  unsub = subscribe((w) => { if (w === 'teachers') draw(); });
  draw();
}
export function destroy() { unsub?.(); }

function draw() {
  if (!root) return;
  const term = normalizeArabic(search);
  const list = store.teachers.filter((t) => (filter === 'all' || (filter === 'active' ? t.active : !t.active))
    && (!term || normalizeArabic(t.name).includes(term) || (t.email || '').toLowerCase().includes(term)));
  const act = store.teachers.filter((t) => t.active).length;
  $('#tCount').textContent = `المفعّلون: ${act} · الموقوفون: ${store.teachers.length - act}`;
  const box = $('#tTable');
  if (!list.length) { box.replaceChildren(h('div', { class: 'card empty' }, store.teachers.length ? 'لا نتائج.' : 'لم تُضف أي معلمين بعد. ابدئي بزر «إضافة معلم».')); return; }
  box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['الاسم', 'البريد الإلكتروني', 'الحالة', 'ضمن العدد منذ', 'الهاتف', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, list.map((t) => h('tr', {},
      h('td', { style: 'font-weight:500' }, t.name),
      h('td', { class: 'ltr', style: 'text-align:right' }, t.email),
      h('td', {}, t.active ? h('span', { class: 'badge b-ok' }, 'مفعّل') : h('span', { class: 'badge b-bad' }, 'موقوف' + (t.endDate ? ' منذ ' + formatKeyShort(t.endDate) : ''))),
      h('td', {}, t.startDate ? formatKeyShort(t.startDate) : '—'),
      h('td', { class: 'ltr', style: 'text-align:right' }, t.phone || ''),
      h('td', {}, h('div', { class: 'row', style: 'gap:.3rem;flex-wrap:nowrap' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => editTeacher(t) }, 'تعديل'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => resetPw(t) }, 'رابط كلمة مرور'),
        h('button', { class: 'btn btn-sm ' + (t.active ? 'btn-outline' : 'btn-primary'), onclick: () => toggleActive(t) }, t.active ? 'إيقاف' : 'تفعيل'))),
    )))),
  ));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function saveTeacherDoc(uid, data, action, before = null) {
  const batch = writeBatch(db);
  addAudit(batch, { action, targetId: 'teachers/' + uid, targetName: data.name, before, after: data });
  batch.set(doc(db, 'teachers', uid), data);
  await batch.commit();
}

async function addTeacher() {
  let created = null;
  await formDialog({
    title: 'إضافة معلم',
    intro: 'سيُنشأ للمعلم حساب دخول بالبريد وكلمة المرور أدناه. سلّميه البيانات، ويمكنه تغيير كلمة المرور من صفحة التسجيل.',
    fields: [
      { name: 'name', label: 'الاسم الكامل', required: true, placeholder: 'أ. ...' },
      { name: 'email', label: 'البريد الإلكتروني (يُستخدم للدخول ولاستعادة كلمة المرور)', type: 'email', required: true, dir: 'ltr' },
      { name: 'password', label: 'كلمة مرور مؤقتة', value: randomPassword(), required: true, dir: 'ltr' },
      { name: 'phone', label: 'رقم الهاتف (اختياري)', type: 'tel', dir: 'ltr' },
      { name: 'startDate', label: 'يُحتسب ضمن العدد المتوقع ابتداءً من', type: 'date', value: todayKey(), required: true },
      { name: 'uid', label: 'متقدم: ربط بحساب موجود مسبقًا (UID) — اتركيه فارغًا عادةً', dir: 'ltr' },
    ],
    submitText: 'إنشاء الحساب',
    validate: (v) => (v.name.length < 2 ? 'أدخلي الاسم.' : !EMAIL_RE.test(v.email) ? 'البريد غير صحيح.' : !v.uid && v.password.length < 8 ? 'كلمة المرور 8 أحرف على الأقل.' : null),
    onSubmit: async (v) => {
      const email = v.email.toLowerCase();
      if (store.teachers.some((t) => t.email === email)) throw new Error('يوجد معلم بهذا البريد في القائمة.');
      let uid = v.uid;
      if (!uid) {
        try { uid = await createLoginAccount(email, v.password); } catch (ex) { throw new Error(arabicError(ex) + (ex.code === 'auth/email-already-in-use' ? ' (يمكنك ربطه عبر خانة UID إن كان الحساب يخصه)' : '')); }
      }
      const data = { name: v.name, email, active: true, startDate: v.startDate, endDate: null, phone: v.phone || '',
        notes: '', createdAt: serverTimestamp(), createdBy: store.me.uid, updatedAt: serverTimestamp(), updatedBy: store.me.uid };
      try { await saveTeacherDoc(uid, data, 'teacher.create'); } catch (ex) { throw new Error('أُنشئ حساب الدخول لكن تعذّر حفظ المعلم: ' + arabicError(ex) + ' — UID: ' + uid); }
      created = { name: v.name, email, password: v.uid ? '(حساب موجود)' : v.password };
    },
  });
  if (created) showCredentials([created]);
}

function showCredentials(list) {
  const url = new URL('checkin', location.href).href;
  infoDialog({
    title: 'بيانات دخول المعلمين',
    wide: true,
    body: h('div', {},
      h('p', { class: 'notice' }, 'سلّمي كل معلم بياناته بشكل خاص. لن تظهر كلمات المرور مرة أخرى بعد إغلاق هذه النافذة.'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['الاسم', 'البريد', 'كلمة المرور', 'الحالة'].map((x) => h('th', {}, x)))),
        h('tbody', {}, list.map((c) => h('tr', {}, h('td', {}, c.name), h('td', { class: 'ltr' }, c.email), h('td', { class: 'ltr kbd' }, c.password || '—'),
          h('td', {}, c.error ? h('span', { class: 'badge b-bad' }, c.error) : h('span', { class: 'badge b-ok' }, 'تم'))))))),
      h('p', { class: 'small muted', style: 'margin-top:.6rem' }, 'رابط الدخول: ', h('span', { class: 'ltr' }, url)),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => downloadFile('بيانات-دخول-المعلمين.csv', toCSV([['الاسم', 'البريد', 'كلمة المرور', 'الحالة'], ...list.map((c) => [c.name, c.email, c.password || '', c.error || 'تم'])])) }, 'تنزيل CSV (احذفيه بعد التوزيع)'),
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => navigator.clipboard?.writeText(list.map((c) => `${c.name}\nالرابط: ${url}\nالبريد: ${c.email}\nكلمة المرور: ${c.password}`).join('\n\n')).then(() => toast('نُسخ', 'ok')) }, 'نسخ كنص'))),
  });
}

async function bulkAdd() {
  const v = await formDialog({
    title: 'إضافة جماعية للمعلمين',
    intro: 'سطر لكل معلم: الاسم ثم فاصلة ثم البريد الإلكتروني. مثال:  أ. مريم البلوشية, maryam@example.com — تُولَّد كلمات مرور تلقائيًا.',
    fields: [
      { name: 'lines', label: 'قائمة المعلمين', type: 'textarea', rows: 10, required: true, placeholder: 'أ. مريم البلوشية, maryam@example.com\nأ. خالد الحارثي, khalid@example.com' },
      { name: 'startDate', label: 'يُحتسبون ضمن العدد ابتداءً من', type: 'date', value: todayKey(), required: true },
    ],
    submitText: 'متابعة',
    wide: true,
    validate: (x) => (parseLines(x.lines).bad.length ? 'أسطر غير صحيحة: ' + parseLines(x.lines).bad.slice(0, 3).join(' | ') : null),
  });
  if (!v) return;
  const { good } = parseLines(v.lines);
  if (!good.length) return;
  const ok = await confirmDialog({ title: `إنشاء ${good.length} حسابًا؟`, message: 'قد تستغرق العملية دقيقة. لا تغلقي الصفحة حتى تنتهي. (حد Firebase: نحو 100 حساب جديد في الساعة من نفس الشبكة)', confirmText: 'ابدئي' });
  if (!ok) return;
  const results = [];
  const prog = h('p', {}, 'جارٍ الإنشاء…');
  const dlgBody = h('div', {}, prog);
  infoDialog({ title: 'إضافة جماعية', body: dlgBody });
  for (const [i, row] of good.entries()) {
    prog.textContent = `جارٍ إنشاء ${i + 1} من ${good.length}: ${row.name}`;
    const email = row.email.toLowerCase();
    if (store.teachers.some((t) => t.email === email)) { results.push({ ...row, email, error: 'موجود مسبقًا' }); continue; }
    const password = randomPassword();
    try {
      const uid = await createLoginAccount(email, password);
      await saveTeacherDoc(uid, { name: row.name, email, active: true, startDate: v.startDate, endDate: null, phone: '', notes: '',
        createdAt: serverTimestamp(), createdBy: store.me.uid, updatedAt: serverTimestamp(), updatedBy: store.me.uid }, 'teacher.create');
      results.push({ ...row, email, password });
    } catch (ex) { results.push({ ...row, email, error: arabicError(ex) }); }
  }
  document.querySelector('dialog[open]')?.close();
  showCredentials(results);
}

function parseLines(text) {
  const good = [], bad = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,،\t;؛]/).map((x) => x.trim()).filter(Boolean);
    const email = parts.find((p) => EMAIL_RE.test(p));
    const name = parts.filter((p) => p !== email).join(' ');
    if (!email || name.length < 2) bad.push(line); else good.push({ name, email });
  }
  return { good, bad };
}

async function editTeacher(t) {
  await formDialog({
    title: 'تعديل بيانات المعلم',
    intro: 'لتغيير البريد الإلكتروني: أضيفي المعلم من جديد بالبريد الجديد ثم أوقفي الحساب القديم.',
    fields: [
      { name: 'name', label: 'الاسم', value: t.name, required: true },
      { name: 'phone', label: 'الهاتف', value: t.phone || '', dir: 'ltr' },
      { name: 'startDate', label: 'ضمن العدد المتوقع ابتداءً من', type: 'date', value: t.startDate, required: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', rows: 2, value: t.notes || '' },
    ],
    validate: (v) => (v.name.length < 2 ? 'الاسم قصير.' : null),
    onSubmit: async (v) => {
      const { id, ...before } = t;
      const after = { ...before, name: v.name, phone: v.phone, startDate: v.startDate, notes: v.notes, updatedAt: serverTimestamp(), updatedBy: store.me.uid };
      try { await saveTeacherDoc(t.id, after, 'teacher.edit', before); } catch (ex) { throw new Error(arabicError(ex)); }
    },
  }).then((ok) => ok && toast('تم الحفظ.', 'ok'));
}

async function toggleActive(t) {
  const next = !t.active;
  const ok = await confirmDialog({
    title: next ? `تفعيل ${t.name}؟` : `إيقاف ${t.name}؟`,
    message: next ? 'سيعود ضمن العدد المتوقع ويستطيع التسجيل.' : 'لن يستطيع التسجيل، ولن يُحتسب ضمن العدد المتوقع من اليوم. تبقى سجلاته السابقة محفوظة.',
    confirmText: next ? 'تفعيل' : 'إيقاف', danger: !next,
  });
  if (!ok) return;
  const { id, ...before } = t;
  const after = { ...before, active: next, endDate: next ? null : todayKey(), updatedAt: serverTimestamp(), updatedBy: store.me.uid };
  try { await saveTeacherDoc(t.id, after, next ? 'teacher.enable' : 'teacher.disable', before); toast('تم.', 'ok'); }
  catch (ex) { toast(arabicError(ex), 'bad'); }
}

async function resetPw(t) {
  const ok = await confirmDialog({ title: 'إرسال رابط تعيين كلمة المرور', message: `سيُرسل بريد إلى ${t.email} يحتوي على رابط لتعيين كلمة مرور جديدة.`, confirmText: 'إرسال' });
  if (!ok) return;
  try { await sendPasswordResetEmail(auth, t.email); toast('أُرسل الرابط إلى بريد المعلم.', 'ok'); }
  catch (ex) { toast(arabicError(ex), 'bad'); }
}

function exportList() {
  const rows = [['الاسم', 'البريد', 'الحالة', 'ضمن العدد منذ', 'موقوف منذ', 'الهاتف', 'UID']];
  for (const t of store.teachers) rows.push([t.name, t.email, t.active ? 'مفعّل' : 'موقوف', t.startDate || '', t.endDate || '', t.phone || '', t.id]);
  downloadFile('قائمة-المعلمين.csv', toCSV(rows));
}
