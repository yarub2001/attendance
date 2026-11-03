// مخزن بيانات لوحة الإدارة: اشتراكات مباشرة (onSnapshot) مع تتبّع حالة الاتصال
import {
  collection, doc, onSnapshot, writeBatch, serverTimestamp, Timestamp,
} from '../../vendor/firebase.js';
import { db } from '../firebase.js';
import { DEFAULT_SETTINGS } from '../window.js';
import { formatTimeSec, nowMs } from '../time.js';

const listeners = new Set();
export const store = {
  me: null,            // { uid, email, name, role }
  teachers: [],        // [{ id, ...data }]
  settings: null,
  settingsExists: false,
  holidays: new Map(), // dateKey -> { name }
  excusals: [],
  admins: [],
  conn: { online: navigator.onLine, fromCache: true, lastServerSync: null, error: null },
  ready: { teachers: false, settings: false, holidays: false, excusals: false },
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

export const can = {
  admin: () => ['owner', 'admin'].includes(store.me?.role),
  owner: () => store.me?.role === 'owner',
};

/** يُستدعى من كل اشتراك لتحديث حالة الاتصال */
export function noteSnapshot(snap) {
  const fromCache = snap.metadata ? snap.metadata.fromCache : false;
  store.conn.fromCache = fromCache;
  store.conn.error = null;
  if (!fromCache) store.conn.lastServerSync = nowMs();
  renderConn();
}
export function noteError(err) {
  store.conn.error = err;
  renderConn();
}

export function renderConn() {
  const el = document.getElementById('conn');
  const txt = document.getElementById('connText');
  if (!el) return;
  const c = store.conn;
  let cls = 'conn', label;
  if (!navigator.onLine) { cls += ' off'; label = 'غير متصل — تُعرض آخر بيانات محفوظة'; }
  else if (c.error) { cls += ' off'; label = 'تعذّرت المزامنة'; }
  else if (c.fromCache) { cls += ' wait'; label = 'جارٍ المزامنة…'; }
  else { label = 'متصل · تحديث مباشر'; }
  el.className = cls;
  txt.textContent = label;
  el.title = c.lastServerSync ? 'آخر مزامنة مع الخادم: ' + formatTimeSec(c.lastServerSync) : 'لم تتم المزامنة بعد';
  emit('conn');
}
addEventListener('online', () => { store.conn.online = true; renderConn(); });
addEventListener('offline', () => { store.conn.online = false; renderConn(); });

const opts = { includeMetadataChanges: true };

export function startStore() {
  onSnapshot(collection(db, 'teachers'), opts, (snap) => {
    noteSnapshot(snap);
    store.teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    store.ready.teachers = true; emit('teachers');
  }, noteError);

  onSnapshot(doc(db, 'settings', 'general'), opts, (snap) => {
    noteSnapshot(snap);
    store.settingsExists = snap.exists();
    store.settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    store.settings.geo = { mode: 'off', ...(store.settings.geo || {}) };
    store.ready.settings = true; emit('settings');
    const t = document.getElementById('schoolTitle');
    if (t && store.settings.schoolName) t.textContent = store.settings.schoolName;
  }, noteError);

  onSnapshot(collection(db, 'holidays'), opts, (snap) => {
    noteSnapshot(snap);
    store.holidays = new Map(snap.docs.map((d) => [d.id, d.data()]));
    store.ready.holidays = true; emit('holidays');
  }, noteError);

  onSnapshot(collection(db, 'excusals'), opts, (snap) => {
    noteSnapshot(snap);
    store.excusals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    store.ready.excusals = true; emit('excusals');
  }, noteError);

  onSnapshot(collection(db, 'admins'), opts, (snap) => {
    noteSnapshot(snap);
    store.admins = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
    emit('admins');
  }, noteError);
}

export function teacherById(uid) { return store.teachers.find((t) => t.id === uid); }

// ---------------- سجل التدقيق ----------------
/** يحوّل القيم إلى صيغة بسيطة قابلة للحفظ في سجل التدقيق */
export function plain(obj) {
  if (obj == null) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) { out[k] = null; continue; }
    if (v instanceof Timestamp || typeof v?.toMillis === 'function') { out[k] = new Date(v.toMillis()).toISOString(); continue; }
    if (typeof v === 'object' && v.constructor && v.constructor.name && /FieldValue|Sentinel/i.test(v.constructor.name)) continue;
    if (typeof v === 'object' && v._methodName) continue; // serverTimestamp()
    if (k === 'userAgent') continue;
    out[k] = typeof v === 'object' && !Array.isArray(v) ? plain(v) : v;
  }
  return out;
}

/**
 * يضيف قيد تدقيق إلى دفعة الكتابة نفسها (يُحفظان معًا أو لا يُحفظ أيٌّ منهما)
 * @returns {string} معرّف قيد التدقيق
 */
export function addAudit(batch, { action, targetId, targetName = '', before = null, after = null, reason = '' }) {
  const ref = doc(collection(db, 'auditLog'));
  batch.set(ref, {
    action, targetId, targetName,
    before: plain(before), after: plain(after),
    reason: reason || '',
    byUid: store.me.uid, byName: store.me.name || store.me.email,
    at: serverTimestamp(),
  });
  return ref.id;
}

/** تنفيذ تعديل بسيط مع قيد تدقيق في دفعة واحدة */
export async function writeWithAudit(fn, audit) {
  const batch = writeBatch(db);
  const auditId = addAudit(batch, audit);
  fn(batch, auditId);
  await batch.commit();
  return auditId;
}

/** حفظ الإعدادات كاملة مع قيد تدقيق يوضح القيم قبل التعديل وبعده */
export async function saveSettings(patch, action = 'settings.edit') {
  const { updatedAt, ...rest } = store.settings;
  const after = { ...rest, ...patch, updatedBy: store.me.uid, updatedAt: serverTimestamp() };
  const before = {};
  for (const k of Object.keys(patch)) before[k] = store.settings[k];
  const batch = writeBatch(db);
  addAudit(batch, { action, targetId: 'settings/general', targetName: 'إعدادات التسجيل', before, after: patch });
  batch.set(doc(db, 'settings', 'general'), after);
  await batch.commit();
}
