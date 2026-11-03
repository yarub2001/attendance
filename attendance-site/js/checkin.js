// صفحة تسجيل حضور المعلم — تُفتح بمسح رمز QR في ساحة الطابور
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  doc, getDoc, runTransaction, serverTimestamp,
} from '../vendor/firebase.js';
import { auth, db, CONFIG_MISSING, USE_EMULATORS, arabicError } from './firebase.js';
import {
  syncServerTime, clockInfo, nowMs, todayKey, minutesOf, tsToMs, addDays,
  formatTimeSec, formatDateLong, formatTime, formatMinutes, formatKeyShort,
} from './time.js';
import { evaluateWindow } from './window.js';
import { $, h, toast, formDialog, infoDialog, deviceId } from './ui.js';

const view = $('#view');
const footer = $('#footer');

const state = {
  user: null,
  teacher: null,
  settings: null,
  holiday: null,
  record: null,
  busy: false,
};

// ---------------- الساعة (بتوقيت الخادم) ----------------
function tickClock() {
  const ms = nowMs();
  $('#clockTime').textContent = formatTimeSec(ms);
  $('#clockDate').textContent = formatDateLong(ms);
}
setInterval(tickClock, 1000);
tickClock();

const timeReady = syncServerTime().then(({ synced, offsetMs }) => {
  tickClock();
  if (!synced) $('#clockNote').textContent = 'تعذّرت مزامنة الوقت مع الخادم؛ يُعرض وقت الهاتف مؤقتًا.';
  else if (Math.abs(offsetMs) > 120000) $('#clockNote').textContent = 'ملاحظة: ساعة هاتفك غير مضبوطة، لكن النظام يعتمد على وقت الخادم.';
});

// إعادة تقييم حالة الزر كل 20 ثانية (مثلاً عند بدء فترة التسجيل)
setInterval(() => { if (state.teacher && !state.record && !state.busy) render(); }, 20000);

// ---------------- البداية ----------------
if (CONFIG_MISSING && !USE_EMULATORS) {
  view.replaceChildren(
    h('h2', {}, 'النظام غير مهيأ بعد'),
    h('p', { class: 'muted' }, 'لم يتم إدخال إعدادات مشروع Firebase في الملف js/firebase-config.js. راجع دليل التشغيل.'),
  );
} else {
  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    state.teacher = state.record = null;
    if (!user) return renderLogin();
    view.replaceChildren(h('p', { class: 'muted', style: 'text-align:center' }, 'جارٍ التحقق من حسابك…'));
    try {
      await timeReady;           // لا نحدد "اليوم" قبل معرفة وقت الخادم
      await loadContext();
      render();
    } catch (err) {
      renderError('تعذّر تحميل بياناتك', arabicError(err), true);
    }
  });
}

async function loadContext() {
  const uid = state.user.uid;
  const dk = todayKey();
  const [tSnap, sSnap, hSnap, rSnap] = await Promise.all([
    getDoc(doc(db, 'teachers', uid)),
    getDoc(doc(db, 'settings', 'general')),
    getDoc(doc(db, 'holidays', dk)),
    getDoc(doc(db, 'attendance', `${dk}_${uid}`)),
  ]);
  state.teacher = tSnap.exists() ? tSnap.data() : null;
  state.settings = sSnap.exists() ? sSnap.data() : null;
  state.holiday = hSnap.exists() ? hSnap.data() : null;
  state.record = rSnap.exists() ? rSnap.data() : null;
  if (state.settings?.schoolName) $('#schoolName').textContent = state.settings.schoolName;
  if (!state.teacher) {
    // ربما المستخدم إداري وليس معلمًا
    try {
      const a = await getDoc(doc(db, 'admins', uid));
      state.isAdmin = a.exists();
    } catch { state.isAdmin = false; }
  }
}

// ---------------- العرض ----------------
function renderFooter(extra = true) {
  footer.replaceChildren();
  if (!state.user) return;
  footer.append(
    extra && state.teacher ? h('button', { class: 'btn btn-ghost btn-sm', onclick: showHistory }, 'سجلّ حضوري') : null,
    h('button', { class: 'btn btn-ghost btn-sm', onclick: changePassword }, 'تغيير كلمة المرور'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => signOut(auth) }, 'تسجيل الخروج'),
  );
}

function renderLogin() {
  footer.replaceChildren();
  const err = h('p', { class: 'form-error', role: 'alert' });
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', required: true, dir: 'ltr', inputmode: 'email', placeholder: 'name@example.com' });
  const pass = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block ci-btn', style: 'font-size:1.1rem;min-height:52px' }, 'دخول');
  const form = h('form', {},
    h('h2', {}, 'تسجيل الدخول'),
    h('p', { class: 'muted small' }, 'تسجّل الدخول مرة واحدة فقط على هاتفك، وبعدها يكفي مسح الرمز كل صباح ثم الضغط على زر التسجيل.'),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'البريد الإلكتروني'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'كلمة المرور'), pass),
    err, btn,
    h('p', { style: 'text-align:center;margin-top:.8rem' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => resetPassword(email.value) }, 'نسيت كلمة المرور؟')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'جارٍ الدخول…';
    try {
      await signInWithEmailAndPassword(auth, email.value.trim(), pass.value);
    } catch (ex) {
      err.textContent = arabicError(ex);
      btn.disabled = false; btn.textContent = 'دخول';
    }
  });
  view.replaceChildren(form);
}

async function resetPassword(email) {
  const values = await formDialog({
    title: 'استعادة كلمة المرور',
    intro: 'سيصلك بريد إلكتروني يحتوي على رابط لتعيين كلمة مرور جديدة.',
    fields: [{ name: 'email', label: 'البريد الإلكتروني', type: 'email', value: email, required: true, dir: 'ltr' }],
    submitText: 'إرسال الرابط',
    onSubmit: async (v) => {
      try { await sendPasswordResetEmail(auth, v.email); } catch (ex) { throw new Error(arabicError(ex)); }
    },
  });
  if (values) toast('إن كان البريد مسجّلًا فسيصلك رابط الاستعادة خلال دقائق.', 'ok', 6000);
}

function renderError(title, msg, retry = false) {
  view.replaceChildren(
    h('div', { class: 'ci-result bad' }, h('div', { class: 'icon' }, '!'), h('h2', {}, title), h('p', {}, msg)),
    retry ? h('button', { class: 'btn btn-outline btn-block', onclick: () => location.reload() }, 'إعادة المحاولة') : null,
  );
  renderFooter(false);
}

function render() {
  renderFooter();
  const t = state.teacher;
  if (!t) {
    if (state.isAdmin) {
      view.replaceChildren(
        h('h2', {}, 'أنتِ مسجّلة كمستخدم إداري'),
        h('p', { class: 'muted' }, 'هذا الحساب ليس ضمن قائمة المعلمين، لذلك لا يمكنه تسجيل حضور الطابور.'),
        h('a', { class: 'btn btn-primary btn-block', href: 'admin' }, 'فتح لوحة الإدارة'),
      );
    } else {
      renderError('الحساب غير مرتبط بقائمة المعلمين', 'سجّلت الدخول بنجاح، لكن حسابك غير موجود في قائمة المعلمين المعتمدين. راجع إدارة المدرسة.');
    }
    return;
  }
  if (!t.active) return renderError('الحساب موقوف', 'حسابك غير مفعّل حاليًا في نظام الحضور. راجع إدارة المدرسة.');

  if (state.record) return renderDone(state.record, false);

  const s = state.settings;
  const w = evaluateWindow(s, nowMs(), state.holiday);
  const children = [
    h('div', { class: 'ci-hello' }, `مرحبًا، ${t.name}`),
    h('div', { class: 'muted small' }, 'لم تسجّل حضورك اليوم بعد.'),
  ];
  if (s) {
    children.push(h('div', { class: 'ci-window' },
      h('span', {}, 'فترة التسجيل'),
      h('strong', { class: 'num' }, `${formatMinutes(s.startMin)} – ${formatMinutes(s.endMin)}`)));
  }
  let codeInput = null;
  if (s?.requireDailyCode) {
    codeInput = h('input', { id: 'dailyCode', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, dir: 'ltr', style: 'text-align:center;font-size:1.4rem;letter-spacing:.3rem', placeholder: '••••' });
    children.push(h('div', { class: 'field' }, h('label', { for: 'dailyCode' }, 'رمز اليوم (المعلن في ساحة الطابور)'), codeInput));
  }
  if (s?.geo?.mode && s.geo.mode !== 'off') {
    children.push(h('p', { class: 'small muted' }, '📍 سيطلب المتصفح إذن الوصول إلى موقعك للتحقق من وجودك في المدرسة.'));
  }
  if (!w.ok) children.push(h('div', { class: 'notice' + (w.code === 'ended' || w.code === 'closed' ? ' notice-bad' : '') }, w.msg));
  else if (w.late) children.push(h('div', { class: 'notice' }, `تنبيه: التسجيل الآن يُحتسب تأخيرًا (بعد ${formatMinutes(s.lateAfterMin)}).`));

  const btn = h('button', { class: 'btn btn-primary ci-btn', id: 'checkinBtn', disabled: !w.ok }, 'سجّل حضوري الآن');
  btn.addEventListener('click', () => doCheckIn(btn, codeInput));
  children.push(btn);
  view.replaceChildren(...children);
}

function renderDone(rec, justNow) {
  const ms = tsToMs(rec.checkInAt);
  const late = ms != null && minutesOf(ms) > rec.lateAfterMin;
  view.replaceChildren(
    h('div', { class: 'ci-result ' + (late ? 'late' : 'ok') },
      h('div', { class: 'icon', 'aria-hidden': 'true' }, '✓'),
      h('h2', {}, justNow ? 'تم تسجيل حضورك بنجاح' : 'حضورك مسجّل اليوم'),
      h('div', { class: 'big-time num' }, formatTimeSec(ms)),
      h('p', { class: 'muted' }, formatDateLong(ms)),
      late ? h('span', { class: 'badge b-late' }, `تسجيل متأخر (بعد ${formatMinutes(rec.lateAfterMin)})`) : h('span', { class: 'badge b-ok' }, 'في الوقت'),
      rec.voided ? h('p', { class: 'notice notice-bad', style: 'margin-top:1rem' }, 'ألغت الإدارة هذا السجل. راجع الإدارة.') : null,
    ),
  );
}

// ---------------- تنفيذ التسجيل ----------------
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('المتصفح لا يدعم تحديد الموقع.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? 'رُفض إذن الموقع. فعّل الموقع للمتصفح ثم أعد المحاولة.' : 'تعذّر تحديد موقعك. تأكد من تفعيل خدمة الموقع (GPS).')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

async function doCheckIn(btn, codeInput) {
  if (state.busy) return;
  state.busy = true;
  btn.disabled = true; btn.textContent = 'جارٍ التسجيل…';
  const uid = state.user.uid;
  try {
    // مزامنة سريعة لساعة الخادم وقراءة أحدث إعدادات قبل الإرسال
    // (قد تكون الإدارة عدّلت الإعدادات بعد فتح المعلم للصفحة)
    const [, fresh] = await Promise.all([syncServerTime(), getDoc(doc(db, 'settings', 'general'))]);
    if (fresh.exists()) state.settings = fresh.data();
    const s = state.settings;
    const dk = todayKey();
    const w = evaluateWindow(s, nowMs(), state.holiday);
    if (!w.ok) throw Object.assign(new Error(w.msg), { code: 'client-window' });

    const data = {
      uid,
      name: state.teacher.name,
      dateKey: dk,
      checkInAt: serverTimestamp(),       // وقت الخادم وليس الهاتف
      lateAfterMin: s.lateAfterMin,
      source: 'qr',
      deviceId: deviceId(),
      userAgent: navigator.userAgent.slice(0, 300),
    };
    if (s.requireDailyCode) {
      const code = (codeInput?.value || '').trim();
      if (!code) throw Object.assign(new Error('أدخل رمز اليوم المعلن في ساحة الطابور.'), { code: 'client-code' });
      data.code = code;
    }
    if (s.geo?.mode && s.geo.mode !== 'off') {
      btn.textContent = 'جارٍ تحديد الموقع…';
      try {
        data.geo = await getPosition();
      } catch (geoErr) {
        if (s.geo.mode === 'require') throw Object.assign(geoErr, { code: 'client-geo' });
      }
      btn.textContent = 'جارٍ التسجيل…';
    }

    const ref = doc(db, 'attendance', `${dk}_${uid}`);
    // معاملة آمنة: تقرأ السجل أولًا، ولا تُنشئه إلا إن لم يكن موجودًا
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw Object.assign(new Error('already'), { code: 'already' });
      tx.set(ref, data);
    });
    const saved = await getDoc(ref);
    state.record = saved.data();
    renderDone(state.record, true);
    if (navigator.vibrate) navigator.vibrate(120);
  } catch (err) {
    await handleCheckInError(err);
  } finally {
    state.busy = false;
  }
}

async function handleCheckInError(err) {
  const uid = state.user.uid;
  if (err.code === 'already') {
    const snap = await getDoc(doc(db, 'attendance', `${todayKey()}_${uid}`)).catch(() => null);
    if (snap?.exists()) { state.record = snap.data(); renderDone(state.record, false); toast('حضورك مسجّل مسبقًا اليوم، لا حاجة للتكرار.', 'warn'); return; }
  }
  if (String(err.code || '').startsWith('client-')) {
    render();
    showReject(err.message);
    return;
  }
  if (String(err.code).includes('permission-denied')) {
    // الخادم رفض: نعيد تحميل الإعدادات لتحديد السبب الأرجح
    try { await loadContext(); } catch { /* تجاهل */ }
    if (state.record) { renderDone(state.record, false); return; }
    const w = evaluateWindow(state.settings, nowMs(), state.holiday);
    let reason;
    if (!state.teacher?.active) reason = 'حسابك غير مفعّل في قائمة المعلمين.';
    else if (!w.ok) reason = w.msg;
    else if (state.settings?.requireDailyCode) reason = 'رمز اليوم غير صحيح أو لم تُحدّثه الإدارة لهذا اليوم.';
    else if (state.settings?.geo?.mode === 'require') reason = 'موقعك خارج نطاق المدرسة المسموح به.';
    else if (!clockInfo().synced) reason = 'تحقّق من ضبط التاريخ والوقت في هاتفك ثم أعد المحاولة.';
    else reason = 'لم تتحقق شروط التسجيل في الخادم. راجع الإدارة.';
    render();
    showReject(reason);
    return;
  }
  render();
  showReject(arabicError(err));
}

function showReject(msg) {
  const box = h('div', { class: 'notice notice-bad', role: 'alert', style: 'margin:.9rem 0 .4rem' }, h('strong', {}, 'لم يُسجَّل الحضور: '), msg);
  const btn = document.getElementById('checkinBtn');
  if (btn) btn.before(box); else view.append(box);
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
}

// ---------------- سجل المعلم وتغيير كلمة المرور ----------------
async function showHistory() {
  const box = h('div', { class: 'ci-history' }, h('p', { class: 'muted small' }, 'جارٍ التحميل…'));
  const p = infoDialog({ title: 'آخر سجلات حضوري', body: box });
  try {
    // قراءة مباشرة لآخر 21 يومًا (لا تحتاج فهرسًا خاصًا في قاعدة البيانات)
    const days = [];
    for (let i = 0, k = todayKey(); i < 21; i++, k = addDays(k, -1)) days.push(k);
    const snaps = await Promise.all(days.map((d) => getDoc(doc(db, 'attendance', `${d}_${state.user.uid}`))));
    const recs = snaps.filter((x) => x.exists()).map((x) => x.data());
    if (!recs.length) { box.replaceChildren(h('p', { class: 'muted' }, 'لا توجد سجلات في آخر ثلاثة أسابيع.')); return p; }
    box.replaceChildren(h('ul', {}, recs.map((r) => {
      const ms = tsToMs(r.checkInAt);
      const late = ms != null && minutesOf(ms) > r.lateAfterMin;
      return h('li', {}, h('span', {}, formatKeyShort(r.dateKey)),
        h('span', {}, r.voided ? h('span', { class: 'badge b-bad' }, 'ملغى') : [h('span', { class: 'num' }, formatTime(ms)), ' ', late ? h('span', { class: 'badge b-late' }, 'متأخر') : h('span', { class: 'badge b-ok' }, 'في الوقت')]));
    })));
  } catch (err) {
    box.replaceChildren(h('p', { class: 'muted' }, 'السجل غير متاح مؤقتًا. ' + arabicError(err)));
  }
  return p;
}

async function changePassword() {
  const ok = await formDialog({
    title: 'تغيير كلمة المرور',
    fields: [
      { name: 'current', label: 'كلمة المرور الحالية', type: 'password', required: true, autocomplete: 'current-password', dir: 'ltr' },
      { name: 'next', label: 'كلمة المرور الجديدة (8 أحرف على الأقل)', type: 'password', required: true, autocomplete: 'new-password', dir: 'ltr' },
      { name: 'confirm', label: 'تأكيد كلمة المرور الجديدة', type: 'password', required: true, autocomplete: 'new-password', dir: 'ltr' },
    ],
    validate: (v) => (v.next.length < 8 ? 'كلمة المرور الجديدة قصيرة.' : v.next !== v.confirm ? 'كلمتا المرور غير متطابقتين.' : null),
    onSubmit: async (v) => {
      try {
        const u = auth.currentUser;
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, v.current));
        await updatePassword(u, v.next);
      } catch (ex) { throw new Error(arabicError(ex)); }
    },
  });
  if (ok) toast('تم تغيير كلمة المرور.', 'ok');
}
