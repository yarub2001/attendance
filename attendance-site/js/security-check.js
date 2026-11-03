// فحص عملي لقواعد الأمان بحساب معلم: يحاول عمليات ممنوعة ويتأكد أن الخادم يرفضها
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where, limit, serverTimestamp, Timestamp,
} from '../vendor/firebase.js';
import { auth, db, arabicError } from './firebase.js';
import { syncServerTime, todayKey } from './time.js';
import { $, h } from './ui.js';

const box = $('#box');

onAuthStateChanged(auth, async (user) => {
  if (!user) return loginForm();
  const a = await getDoc(doc(db, 'admins', user.uid)).catch(() => null);
  if (a?.exists()) {
    box.replaceChildren(h('p', { class: 'notice' }, 'أنتِ مسجّلة بحساب إداري. هذا الفحص مخصص لحساب معلم عادي (غير إداري). أنشئي معلمًا تجريبيًا من لوحة الإدارة ثم سجّلي الدخول به هنا.'),
      h('button', { class: 'btn btn-outline', onclick: () => signOut(auth) }, 'تسجيل الخروج'));
    return;
  }
  box.replaceChildren(h('p', {}, 'الحساب: ', h('span', { class: 'ltr' }, user.email)),
    h('button', { class: 'btn btn-primary', onclick: () => run(user) }, 'ابدئي الفحص'),
    ' ', h('button', { class: 'btn btn-ghost', onclick: () => signOut(auth) }, 'تسجيل الخروج'));
});

function loginForm() {
  const e = h('input', { type: 'email', dir: 'ltr', placeholder: 'بريد المعلم التجريبي' });
  const p = h('input', { type: 'password', dir: 'ltr', placeholder: 'كلمة المرور' });
  const err = h('p', { class: 'form-error' });
  box.replaceChildren(h('h3', {}, 'سجّلي الدخول بحساب معلم تجريبي'), h('div', { class: 'field' }, e), h('div', { class: 'field' }, p), err,
    h('button', { class: 'btn btn-primary', onclick: async () => { try { await signInWithEmailAndPassword(auth, e.value, p.value); } catch (x) { err.textContent = arabicError(x); } } }, 'دخول'));
}

async function run(user) {
  await syncServerTime();
  const uid = user.uid;
  const today = todayKey();
  const ownId = `${today}_${uid}`;
  const settingsSnap = await getDoc(doc(db, 'settings', 'general')).catch(() => null);
  const ownSnap = await getDoc(doc(db, 'attendance', ownId)).catch(() => null);
  const teacherSnap = await getDoc(doc(db, 'teachers', uid)).catch(() => null);
  const myName = teacherSnap?.data()?.name || 'x';

  // [الوصف, دالة, هل يجب أن يُسمح؟]
  const tests = [
    ['قراءة بيانات حسابي في قائمة المعلمين', () => getDoc(doc(db, 'teachers', uid)), true],
    ['قراءة إعدادات التسجيل', () => getDoc(doc(db, 'settings', 'general')), true],
    ['قراءة سجل حضوري اليوم', () => getDoc(doc(db, 'attendance', ownId)), true],
    ['قراءة قائمة جميع المعلمين', () => getDocs(query(collection(db, 'teachers'), limit(5))), false],
    ['قراءة قائمة المستخدمين الإداريين', () => getDocs(query(collection(db, 'admins'), limit(5))), false],
    ['قراءة سجلات حضور الآخرين لليوم', () => getDocs(query(collection(db, 'attendance'), where('dateKey', '==', today), limit(5))), false],
    ['قراءة سجل التعديلات', () => getDocs(query(collection(db, 'auditLog'), limit(5))), false],
    ['قراءة «رمز اليوم» السري', () => getDoc(doc(db, 'secrets', 'dailyCode')), false],
    ['تعديل إعدادات التسجيل', () => setDoc(doc(db, 'settings', 'general'), settingsSnap?.data() || { startMin: 0, endMin: 1439, lateAfterMin: 0, workDays: [0, 1, 2, 3, 4, 5, 6], registrationOpen: true }), false],
    ['منح نفسي صلاحية المديرة', () => setDoc(doc(db, 'admins', uid), { name: 'test', email: user.email, role: 'owner' }), false],
    ['تعديل بيانات حسابي (الاسم/التفعيل)', () => setDoc(doc(db, 'teachers', uid), { ...(teacherSnap?.data() || {}), name: myName + ' (معدّل)', active: true }), false],
    ['تسجيل حضور باسم معلم آخر', () => setDoc(doc(db, 'attendance', `${today}_SECURITYTESTFAKEUID`), { uid: 'SECURITYTESTFAKEUID', name: 'وهمي', dateKey: today, checkInAt: serverTimestamp(), lateAfterMin: 420, source: 'qr' }), false],
    ['تسجيل حضور لتاريخ سابق', () => setDoc(doc(db, 'attendance', `2000-01-02_${uid}`), { uid, name: myName, dateKey: '2000-01-02', checkInAt: serverTimestamp(), lateAfterMin: 420, source: 'qr' }), false],
    ['تسجيل حضور بوقت مزيّف من الهاتف', () => setDoc(doc(db, 'attendance', ownId), { uid, name: myName, dateKey: today, checkInAt: Timestamp.fromMillis(Date.now() - 3600000), lateAfterMin: settingsSnap?.data()?.lateAfterMin ?? 420, source: 'qr' }), false],
    ['تسجيل حضور باسم مختلف عن اسمي', () => setDoc(doc(db, 'attendance', ownId), { uid, name: 'اسم آخر', dateKey: today, checkInAt: serverTimestamp(), lateAfterMin: settingsSnap?.data()?.lateAfterMin ?? 420, source: 'qr' }), false],
    ['تعديل سجل حضوري بعد إنشائه', () => (ownSnap?.exists() ? setDoc(doc(db, 'attendance', ownId), { ...ownSnap.data(), checkInAt: Timestamp.fromMillis(Date.now() - 7200000) }) : Promise.reject({ code: 'skip' })), false],
    ['حذف سجل حضوري', () => deleteDoc(doc(db, 'attendance', ownId)), false],
    ['إضافة عطلة', () => setDoc(doc(db, 'holidays', '2099-01-01'), { name: 'اختبار' }), false],
    ['كتابة قيد مزيّف في سجل التعديلات', () => setDoc(doc(db, 'auditLog', 'fake-' + uid), { action: 'x', byUid: uid, at: serverTimestamp() }), false],
  ];

  const tbody = h('tbody');
  box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'العملية'), h('th', {}, 'المتوقع'), h('th', {}, 'النتيجة'))), tbody)), h('p', { id: 'sum', style: 'margin-top:1rem' }));
  let pass = 0, fail = 0, skip = 0;
  for (const [label, fn, shouldAllow] of tests) {
    const res = h('td', {}, '…');
    tbody.append(h('tr', {}, h('td', {}, label), h('td', {}, shouldAllow ? 'مسموح' : 'ممنوع'), res));
    let allowed, code = '';
    try { await fn(); allowed = true; } catch (e) { allowed = false; code = e.code || e.message || ''; }
    if (code === 'skip') { skip++; res.replaceChildren(h('span', { class: 'badge' }, 'تُخطّي (لا يوجد سجل اليوم)')); continue; }
    const denied = !allowed && String(code).includes('permission-denied');
    if (shouldAllow ? allowed : denied) { pass++; res.replaceChildren(h('span', { class: 'badge b-ok' }, shouldAllow ? 'مسموح ✅' : 'مرفوض ✅')); }
    else if (!allowed && !denied) { skip++; res.replaceChildren(h('span', { class: 'badge b-late' }, '⚠️ ' + arabicError({ code }))); }
    else { fail++; res.replaceChildren(h('span', { class: 'badge b-bad' }, shouldAllow ? 'مرفوض ❌' : 'نُفّذ! ❌ خطر')); }
  }
  $('#sum').replaceChildren(fail
    ? h('div', { class: 'notice notice-bad' }, `فشل ${fail} اختبار. لا تستخدمي النظام قبل مراجعة قواعد الأمان (هل نُشر الملف firestore.rules؟). إن نُفّذت عملية ممنوعة احذفي أثرها من Firebase Console.`)
    : h('div', { class: 'notice notice-ok' }, `نجحت جميع الاختبارات (${pass})${skip ? `، وتُخطّي ${skip}` : ''}. قواعد الحماية تعمل كما ينبغي.`));
}
