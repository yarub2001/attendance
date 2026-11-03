// نقطة دخول لوحة الإدارة: تسجيل الدخول، التحقق من الصلاحية، التبويبات
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, doc, getDoc } from '../../vendor/firebase.js';
import { auth, db, CONFIG_MISSING, USE_EMULATORS, arabicError } from '../firebase.js';
import { syncServerTime } from '../time.js';
import { $, h } from '../ui.js';
import { store, startStore, renderConn } from './store.js';
import * as dashboard from './dashboard.js';
import * as reports from './reports.js';
import * as teachers from './teachers.js';
import * as leaves from './leaves.js';
import * as calendar from './calendar.js';
import * as settings from './settings.js';
import * as audit from './audit.js';
import * as qr from './qr.js';
import * as users from './users.js';
import * as backup from './backup.js';
import { ROLES } from './users.js';

const TABS = [
  { id: 'dashboard', label: 'لوحة اليوم', mod: dashboard, min: 'viewer' },
  { id: 'reports', label: 'التقارير', mod: reports, min: 'viewer' },
  { id: 'teachers', label: 'المعلمون', mod: teachers, min: 'admin' },
  { id: 'leaves', label: 'الإجازات والمهام', mod: leaves, min: 'admin' },
  { id: 'calendar', label: 'أيام العمل والعطل', mod: calendar, min: 'admin' },
  { id: 'settings', label: 'إعدادات التسجيل', mod: settings, min: 'admin' },
  { id: 'audit', label: 'سجل التعديلات', mod: audit, min: 'admin' },
  { id: 'qr', label: 'رمز QR', mod: qr, min: 'admin' },
  { id: 'users', label: 'الصلاحيات', mod: users, min: 'owner' },
  { id: 'backup', label: 'النسخ الاحتياطي', mod: backup, min: 'admin' },
];
const RANK = { viewer: 1, admin: 2, owner: 3 };

let current = null;
let started = false;

function show(id) {
  for (const v of ['loginView', 'msgView', 'appView']) $('#' + v).classList.toggle('hidden', v !== id);
}

function message(title, text, actions = []) {
  $('#msgBox').replaceChildren(h('h2', {}, title), h('p', { class: 'muted' }, text), h('div', { class: 'row' }, actions));
  show('msgView');
}

if (CONFIG_MISSING && !USE_EMULATORS) {
  message('النظام غير مهيأ بعد', 'لم يتم إدخال إعدادات مشروع Firebase في الملف public/js/firebase-config.js. اتبعي الخطوة 3 في دليل التشغيل.');
} else {
  const timeReady = syncServerTime();   // "اليوم" يُحدَّد حسب ساعة الخادم لا ساعة الجهاز
  setInterval(syncServerTime, 10 * 60 * 1000); // اللوحة قد تبقى مفتوحة طوال الصباح: نعيد المزامنة كل 10 دقائق
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (started) return location.reload();
      show('loginView');
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'admins', user.uid));
      if (!snap.exists() || !RANK[snap.data().role]) {
        message('لا تملك صلاحية إدارية', `الحساب ${user.email} ليس ضمن المستخدمين الإداريين. إن كنت معلمًا فاستخدم صفحة تسجيل الحضور.`, [
          h('a', { class: 'btn btn-primary', href: 'checkin' }, 'صفحة تسجيل الحضور'),
          h('button', { class: 'btn btn-outline', onclick: () => signOut(auth) }, 'تسجيل الخروج'),
        ]);
        return;
      }
      const a = snap.data();
      store.me = { uid: user.uid, email: user.email, name: a.name || user.email, role: a.role };
      $('#whoami').textContent = `${store.me.name} · ${ROLES[a.role]?.short || a.role}`;
      await timeReady;
      show('appView');
      if (!started) { started = true; startStore(); renderConn(); }
      buildTabs();
      route();
    } catch (err) {
      message('تعذّر التحقق من الصلاحية', arabicError(err), [h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'إعادة المحاولة'),
        h('button', { class: 'btn btn-outline', onclick: () => signOut(auth) }, 'تسجيل الخروج')]);
    }
  });
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#lBtn'); const err = $('#lErr');
  err.textContent = ''; btn.disabled = true; btn.textContent = 'جارٍ الدخول…';
  try { await signInWithEmailAndPassword(auth, $('#lEmail').value.trim(), $('#lPass').value); }
  catch (ex) { err.textContent = arabicError(ex); }
  finally { btn.disabled = false; btn.textContent = 'دخول'; }
});
$('#logoutBtn').addEventListener('click', () => signOut(auth));

function allowedTabs() { return TABS.filter((t) => RANK[store.me.role] >= RANK[t.min]); }

function buildTabs() {
  $('#tabs').replaceChildren(...allowedTabs().map((t) => h('button', { class: 'tab', role: 'tab', id: 'tab-' + t.id, 'aria-selected': 'false', onclick: () => { location.hash = t.id; } }, t.label)));
}

function route() {
  const tabs = allowedTabs();
  const id = (location.hash || '#dashboard').slice(1);
  const tab = tabs.find((t) => t.id === id) || tabs[0];
  if (current === tab.id) return;
  const prev = TABS.find((t) => t.id === current);
  prev?.mod.destroy?.();
  current = tab.id;
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.id === 'tab-' + tab.id));
  const main = $('#main');
  main.replaceChildren();
  tab.mod.render(main);
  scrollTo(0, 0);
}
addEventListener('hashchange', () => { if (store.me) route(); });
