// لوحة المتابعة اليومية — تتحدث مباشرة عند تسجيل أي معلم
import {
  collection, doc, query, where, onSnapshot, writeBatch, serverTimestamp, Timestamp, setDoc,
} from '../../vendor/firebase.js';
import { db, arabicError } from '../firebase.js';
import {
  todayKey, nowMs, minutesOf, keyToMs, formatKeyLong, formatTime, formatTimeSec, formatMinutes,
  formatDateTime, hmToMin, minToHm, addDays,
} from '../time.js';
import { evaluateWindow } from '../window.js';
import { $, h, toast, formDialog, confirmDialog, infoDialog, toCSV, downloadFile, normalizeArabic, fmtPct } from '../ui.js';
import { store, subscribe, can, noteSnapshot, noteError, addAudit } from './store.js';
import { computeDay, STATUS, EXCUSAL_TYPES } from './stats.js';

let root, unsubDay, unsubStore, unsubCode, tick;
let D = null;
let records = [];
let firstSnap = true;
let knownIds = new Set();
let flashIds = new Set();
let lastServerUpdate = null;
let search = '';
let dailyCode = null;

export function render(container) {
  root = container;
  D = D || todayKey();
  root.replaceChildren(
    h('div', { class: 'print-only' }, h('h2', { id: 'pTitle' }), h('p', { class: 'muted', id: 'pSub' })),
    h('div', { class: 'section-head no-print' },
      h('div', {}, h('h2', {}, 'لوحة المتابعة'), h('div', { class: 'muted', id: 'dTitle' })),
      h('div', { class: 'toolbar', style: 'margin:0' },
        h('input', { type: 'date', id: 'dDate', value: D, 'aria-label': 'اختيار التاريخ', onchange: (e) => setDate(e.target.value) }),
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => setDate(addDays(D, -1)), title: 'اليوم السابق' }, '→'),
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => setDate(addDays(D, 1)), title: 'اليوم التالي' }, '←'),
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => setDate(todayKey()) }, 'اليوم'),
        h('input', { type: 'search', id: 'dSearch', placeholder: 'بحث باسم المعلم…', value: search, oninput: (e) => { search = e.target.value; draw(); } }),
        h('button', { class: 'btn btn-outline btn-sm', onclick: exportCSV }, 'تصدير CSV'),
        h('button', { class: 'btn btn-outline btn-sm', onclick: () => window.print() }, 'طباعة'),
      )),
    h('div', { id: 'dSetup' }),
    h('div', { id: 'dStatus' }),
    h('div', { id: 'dCode' }),
    h('div', { class: 'kpis', id: 'dKpis' }),
    h('div', { class: 'cols-2' },
      h('section', { class: 'card' }, h('div', { class: 'card-title' }, h('h3', { id: 'presentTitle' }, 'المسجّلون'), h('span', { class: 'updated', id: 'dUpdated' })),
        h('div', { class: 'list-scroll', id: 'presentList' })),
      h('div', {},
        h('section', { class: 'card' }, h('div', { class: 'card-title' }, h('h3', { id: 'missingTitle' }, 'لم يسجّلوا بعد')), h('div', { class: 'list-scroll', id: 'missingList' })),
        h('section', { class: 'card' }, h('div', { class: 'card-title' }, h('h3', { id: 'excusedTitle' }, 'في إجازة أو مهمة رسمية')), h('div', { id: 'excusedList' })),
        h('section', { class: 'card hidden', id: 'voidCard' }, h('div', { class: 'card-title' }, h('h3', {}, 'سجلات ألغتها الإدارة')), h('div', { id: 'voidList' })),
      )),
  );
  unsubStore = subscribe((what) => { if (what !== 'conn' && what !== 'admins') draw(); });
  listenDay();
  listenCode();
  tick = setInterval(() => { if (D === todayKey()) draw(); else updateTimes(); }, 30000);
}

addEventListener('beforeprint', () => { const el = document.getElementById('pSub'); if (el && D) el.textContent = `${formatKeyLong(D)} · طُبع في ${formatDateTime(nowMs())}`; });

export function destroy() {
  unsubDay?.(); unsubStore?.(); unsubCode?.(); clearInterval(tick);
  unsubDay = unsubStore = unsubCode = null;
}

function setDate(k) {
  if (!k || k === D) return;
  D = k; $('#dDate').value = k;
  listenDay();
  draw();
}

function listenDay() {
  unsubDay?.();
  records = []; firstSnap = true; knownIds = new Set(); flashIds = new Set();
  const q = query(collection(db, 'attendance'), where('dateKey', '==', D));
  unsubDay = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    noteSnapshot(snap);
    if (!snap.metadata.fromCache) lastServerUpdate = nowMs();
    records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ids = new Set(records.map((r) => r.id));
    if (!firstSnap) {
      for (const r of records) if (!knownIds.has(r.id)) {
        flashIds.add(r.id);
        if (r.source === 'qr' && !r.voided) toast(`سجّل الآن: ${r.name}`, 'ok', 3500);
      }
    }
    knownIds = ids; firstSnap = false;
    draw();
  }, (err) => { noteError(err); toast('تعذّر تحميل سجلات اليوم: ' + arabicError(err), 'bad'); });
}

function listenCode() {
  unsubCode?.();
  if (!can.admin()) return;
  unsubCode = onSnapshot(doc(db, 'secrets', 'dailyCode'), (snap) => {
    dailyCode = snap.exists() ? snap.data() : null;
    drawCode();
  }, () => {});
}

function ctx() {
  return { teachers: store.teachers, excusals: store.excusals, holidays: store.holidays, settings: store.settings };
}

function ready() { return store.ready.teachers && store.ready.settings && store.ready.holidays && store.ready.excusals; }

function updateTimes() {
  const u = $('#dUpdated');
  if (u) u.textContent = lastServerUpdate ? 'آخر تحديث للبيانات: ' + formatTimeSec(lastServerUpdate) : 'بانتظار الخادم…';
}

let lastDay = null;
function draw() {
  if (!root || !ready()) return;
  const today = todayKey();
  const nowMin = minutesOf(nowMs());
  const day = computeDay(D, ctx(), records, { today, nowMin });
  lastDay = day;
  const s = store.settings;
  const isToday = D === today;

  $('#dTitle').textContent = formatKeyLong(D) + (isToday ? ' — اليوم' : '');
  $('#pTitle').textContent = `تقرير حضور الطابور الصباحي — ${s.schoolName || ''}`;
  $('#pSub').textContent = `${formatKeyLong(D)} · طُبع في ${formatDateTime(nowMs())}`;
  document.title = isToday && day.kind.work ? `(${day.present}/${day.expected}) لوحة الحضور` : 'لوحة الحضور';

  drawSetup();
  drawStatus(day, isToday);
  drawCode();

  // ---------- المؤشرات ----------
  const kp = $('#dKpis');
  const pendingLabel = day.dayOver ? 'الغائبون' : 'لم يسجّلوا بعد';
  kp.replaceChildren(
    kpi('المعلمون المعتمدون', day.approved, 'ضمن القائمة في هذا التاريخ'),
    kpi('المتوقع حضورهم', day.kind.work ? day.expected : '—', day.excused ? `بعد استبعاد ${day.excused} معذورين` : 'بعد استبعاد الإجازات والمهام'),
    kpi('سجّلوا حضورهم', day.present, day.late ? `منهم ${day.late} متأخرون` : 'لا يوجد متأخرون'),
    kpi(pendingLabel, day.kind.work ? day.missing : '—', ''),
    (() => {
      const k = kpi('نسبة الحضور', fmtPct(day.rate), day.kind.work ? `${day.present} من ${day.expected}` : day.kind.label);
      k.classList.add('accent');
      k.append(h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: `width:${day.rate || 0}%` })));
      return k;
    })(),
  );

  const term = normalizeArabic(search);
  const match = (r) => !term || normalizeArabic(r.name).includes(term) || (r.email || '').toLowerCase().includes(term);

  // ---------- المسجّلون ----------
  const present = day.rows.filter((r) => r.rec && match(r))
    .sort((a, b) => (isToday ? b.info.ms - a.info.ms : a.info.ms - b.info.ms));
  $('#presentTitle').textContent = `المسجّلون (${day.rows.filter((r) => r.rec).length})`;
  $('#presentList').replaceChildren(...(present.length ? present.map(personPresent) : [h('div', { class: 'empty' }, search ? 'لا نتائج مطابقة.' : 'لم يسجّل أحد بعد.')]));

  // ---------- لم يسجّلوا ----------
  const missing = day.rows.filter((r) => (r.status === 'pending' || r.status === 'absent') && match(r));
  $('#missingTitle').textContent = `${pendingLabel} (${day.rows.filter((r) => r.status === 'pending' || r.status === 'absent').length})`;
  $('#missingList').replaceChildren(...(missing.length ? missing.map(personMissing)
    : [h('div', { class: 'empty' }, !day.kind.work ? day.kind.label : (search ? 'لا نتائج مطابقة.' : 'سجّل الجميع حضورهم 🎉'))]));

  // ---------- المعذورون ----------
  const exc = day.rows.filter((r) => r.status === 'excused' && match(r));
  $('#excusedTitle').textContent = `في إجازة أو مهمة رسمية (${day.rows.filter((r) => r.status === 'excused').length})`;
  $('#excusedList').replaceChildren(...(exc.length ? exc.map((r) => h('div', { class: 'person' },
    h('div', { class: 'who' }, avatar(r.name), h('div', {}, h('div', { class: 'name' }, r.name), h('div', { class: 'meta' }, r.exc.note || ''))),
    h('span', { class: 'badge b-exc' }, EXCUSAL_TYPES[r.exc.type] || 'معذور'))) : [h('div', { class: 'empty' }, 'لا يوجد.')]));

  // ---------- الملغاة ----------
  const vc = $('#voidCard');
  vc.classList.toggle('hidden', !day.voided.length);
  $('#voidList').replaceChildren(...day.voided.map((r) => h('div', { class: 'person' },
    h('div', { class: 'who' }, avatar(r.name), h('div', {}, h('div', { class: 'name' }, r.name), h('div', { class: 'meta' }, r.note || ''))),
    can.admin() ? h('button', { class: 'btn btn-outline btn-sm no-print', onclick: () => restoreRecord(r) }, 'استعادة') : null)));

  updateTimes();
  flashIds.clear();
}

function kpi(label, value, hint) {
  return h('div', { class: 'kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value num' }, String(value)), hint ? h('div', { class: 'hint' }, hint) : null);
}

function avatar(name) {
  const parts = String(name || '؟').replace(/^(أ\.|ا\.|الأستاذة?|المعلمة?)\s*/, '').trim().split(/\s+/);
  return h('div', { class: 'avatar', 'aria-hidden': 'true' }, (parts[0]?.[0] || '؟') + (parts[1]?.[0] || ''));
}

function personPresent(r) {
  const st = STATUS[r.status];
  const el = h('div', { class: 'person' + (flashIds.has(r.rec.id) ? ' flash' : '') },
    h('div', { class: 'who' }, avatar(r.name),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'name' }, r.name),
        h('div', { class: 'meta' }, r.flags.map((f) => h('span', { class: 'badge flag ' + f.cls, title: f.title, style: 'margin-left:.25rem' }, f.t))))),
    h('div', { class: 'row', style: 'gap:.4rem;flex-wrap:nowrap' },
      h('span', { class: 'num', style: 'font-weight:600' }, formatTime(r.info.ms)),
      h('span', { class: 'badge ' + st.cls }, st.label),
      can.admin() ? h('button', { class: 'btn btn-ghost btn-sm no-print', title: 'تصحيح', onclick: () => correctRecord(r) }, 'تعديل') : null));
  return el;
}

function personMissing(r) {
  const st = STATUS[r.status];
  return h('div', { class: 'person' },
    h('div', { class: 'who' }, avatar(r.name), h('div', {}, h('div', { class: 'name' }, r.name))),
    h('div', { class: 'row', style: 'gap:.4rem;flex-wrap:nowrap' },
      h('span', { class: 'badge ' + st.cls }, st.label),
      can.admin() ? h('button', { class: 'btn btn-outline btn-sm no-print', onclick: () => correctRecord(r) }, 'تسجيل يدوي') : null));
}

// ---------- لافتات الحالة ----------
function drawSetup() {
  const box = $('#dSetup');
  if (!box) return;
  const steps = [];
  if (!store.settingsExists) steps.push('احفظي إعدادات التسجيل مرة واحدة على الأقل (تبويب «إعدادات التسجيل»). بدونها لن يستطيع المعلمون التسجيل.');
  if (!store.teachers.length) steps.push('أضيفي المعلمين (تبويب «المعلمون»).');
  box.replaceChildren(...(steps.length && can.admin() ? [h('div', { class: 'notice notice-info no-print', style: 'margin-bottom:1rem' },
    h('strong', {}, 'خطوات التهيئة الأولى:'), h('ol', { style: 'margin:.4rem 0 0' }, steps.map((s) => h('li', {}, s))))] : []));
}

function drawStatus(day, isToday) {
  const box = $('#dStatus');
  const s = store.settings;
  const items = [];
  if (!day.kind.work) items.push(h('div', { class: 'notice banner-holiday' }, `${formatKeyLong(D)}: ${day.kind.label}. لا يدخل هذا اليوم في نسب الحضور.`));
  if (isToday && day.kind.work) {
    const w = evaluateWindow(s, nowMs(), store.holidays.get(D));
    const text = w.ok ? `التسجيل مفتوح الآن حتى ${formatMinutes(s.endMin)} (يُحتسب التأخير بعد ${formatMinutes(s.lateAfterMin)})` : w.msg;
    items.push(h('div', { class: 'notice no-print ' + (w.ok ? 'notice-ok' : ''), style: 'margin-bottom:1rem' },
      h('div', { class: 'row-between' }, h('span', {}, text),
        can.admin() ? h('button', { class: 'btn btn-sm ' + (s.registrationOpen ? 'btn-danger' : 'btn-primary'), onclick: toggleRegistration },
          s.registrationOpen ? 'إيقاف التسجيل فورًا' : 'إعادة فتح التسجيل') : null)));
  }
  box.replaceChildren(...items);
}

function drawCode() {
  const box = $('#dCode');
  if (!box) return;
  const s = store.settings;
  if (!s?.requireDailyCode || !can.admin() || D !== todayKey()) { box.replaceChildren(); return; }
  const valid = dailyCode && dailyCode.dateKey === todayKey();
  box.replaceChildren(h('div', { class: 'card no-print', style: 'margin-bottom:1rem' },
    h('div', { class: 'row-between' },
      h('div', {}, h('h3', { style: 'margin:0' }, 'رمز اليوم'), h('div', { class: 'muted small' }, 'يُعلن في ساحة الطابور أو يُكتب على السبورة؛ يُطلب من المعلم مع التسجيل.')),
      valid ? h('div', { class: 'code-display', style: 'font-size:2rem' }, dailyCode.code) : h('span', { class: 'badge b-bad' }, 'لم يُولَّد رمز اليوم بعد'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-gold btn-sm', onclick: generateCode }, valid ? 'توليد رمز جديد' : 'توليد رمز اليوم'),
        valid ? h('button', { class: 'btn btn-outline btn-sm', onclick: () => infoDialog({ title: 'رمز اليوم', wide: true, body: h('div', { class: 'code-display', style: 'font-size:7rem;padding:2rem 0' }, dailyCode.code) }) }, 'عرض كبير') : null))));
}

async function generateCode() {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  try {
    const batch = writeBatch(db);
    addAudit(batch, { action: 'dailyCode.set', targetId: 'secrets/dailyCode', targetName: 'رمز اليوم', after: { dateKey: todayKey() } });
    batch.set(doc(db, 'secrets', 'dailyCode'), { code, dateKey: todayKey(), updatedBy: store.me.uid, updatedAt: serverTimestamp() });
    await batch.commit();
    toast('تم توليد رمز اليوم.', 'ok');
  } catch (err) { toast(arabicError(err), 'bad'); }
}

async function toggleRegistration() {
  const s = store.settings;
  const next = !s.registrationOpen;
  const ok = await confirmDialog({
    title: next ? 'إعادة فتح التسجيل؟' : 'إيقاف التسجيل الآن؟',
    message: next ? 'سيتمكن المعلمون من التسجيل ضمن الفترة الزمنية المحددة.' : 'لن يستطيع أي معلم التسجيل حتى تعيدي فتحه.',
    confirmText: next ? 'فتح التسجيل' : 'إيقاف', danger: !next,
  });
  if (!ok) return;
  try {
    const { updatedAt, ...rest } = s;
    const after = { ...rest, registrationOpen: next, updatedBy: store.me.uid, updatedAt: serverTimestamp() };
    const batch = writeBatch(db);
    addAudit(batch, { action: next ? 'settings.open' : 'settings.close', targetId: 'settings/general', targetName: 'التسجيل', before: { registrationOpen: s.registrationOpen }, after: { registrationOpen: next } });
    batch.set(doc(db, 'settings', 'general'), after);
    await batch.commit();
    toast(next ? 'تم فتح التسجيل.' : 'تم إيقاف التسجيل.', 'ok');
  } catch (err) { toast(arabicError(err), 'bad'); }
}

// ---------- التصحيح اليدوي ----------
async function correctRecord(r) {
  const s = store.settings;
  const rec = r.rec;
  const curMin = rec ? r.info.mins : Math.min(s.lateAfterMin, s.endMin);
  const fields = [
    rec ? { name: 'action', label: 'نوع التصحيح', type: 'select', value: 'edit', options: [
      { value: 'edit', label: 'تعديل وقت الحضور' },
      { value: 'void', label: 'إلغاء السجل (لم يحضر فعليًا / سُجّل بالخطأ)' },
    ] } : null,
    { name: 'time', label: 'وقت الحضور الفعلي (بتوقيت عُمان)', type: 'time', value: minToHm(curMin), required: true, hint: `يُحتسب متأخرًا بعد ${formatMinutes(rec?.lateAfterMin ?? s.lateAfterMin)}` },
    { name: 'reason', label: 'سبب التصحيح (إلزامي — يُحفظ في سجل التعديلات)', type: 'textarea', rows: 3, required: true, placeholder: 'مثال: نفدت بطارية هاتف المعلم وحضر الطابور فعليًا' },
  ].filter(Boolean);
  await formDialog({
    title: (rec ? 'تصحيح سجل: ' : 'تسجيل حضور يدوي: ') + r.name,
    intro: formatKeyLong(D),
    fields,
    submitText: 'حفظ التصحيح',
    validate: (v) => (v.reason.length < 5 ? 'اكتبي سببًا واضحًا للتصحيح.' : null),
    onSubmit: async (v) => {
      const action = rec ? (v.action === 'void' ? 'attendance.void' : 'attendance.edit') : 'attendance.manual';
      await saveAttendance({ r, minutes: hmToMin(v.time), voided: v.action === 'void', reason: v.reason, action });
    },
  }).then((ok) => ok && toast('تم حفظ التصحيح وتوثيقه في سجل التعديلات.', 'ok'));
}

async function restoreRecord(rec) {
  const v = await formDialog({
    title: 'استعادة سجل: ' + rec.name,
    fields: [{ name: 'reason', label: 'سبب الاستعادة', type: 'textarea', rows: 2, required: true }],
    validate: (v) => (v.reason.length < 3 ? 'اكتبي السبب.' : null),
    onSubmit: async (v) => {
      await saveAttendance({ r: { uid: rec.uid, name: rec.name, rec }, minutes: null, voided: false, reason: v.reason, action: 'attendance.restore' });
    },
  });
  if (v) toast('تمت الاستعادة.', 'ok');
}

async function saveAttendance({ r, minutes, voided, reason, action }) {
  const id = `${D}_${r.uid}`;
  const before = r.rec ? { ...r.rec } : null;
  if (before) delete before.id;
  const base = before ? { ...before } : { uid: r.uid, name: r.name, dateKey: D, source: 'admin', lateAfterMin: store.settings.lateAfterMin };
  const after = {
    ...base,
    checkInAt: minutes != null ? Timestamp.fromMillis(keyToMs(D) + minutes * 60000) : base.checkInAt,
    voided: !!voided,
    note: reason,
    updatedBy: store.me.uid,
    updatedAt: serverTimestamp(),
  };
  if (!before) after.source = 'admin';
  const batch = writeBatch(db);
  after.auditId = addAudit(batch, { action, targetId: id, targetName: r.name, before, after, reason });
  batch.set(doc(db, 'attendance', id), after);
  try { await batch.commit(); } catch (err) { throw new Error(arabicError(err)); }
}

// ---------- التصدير ----------
function exportCSV() {
  if (!lastDay) return;
  const rows = [['التاريخ', 'الاسم', 'البريد', 'الحالة', 'وقت التسجيل', 'المصدر', 'تنبيهات', 'ملاحظة']];
  for (const r of lastDay.rows) {
    rows.push([D, r.name, r.email || '', STATUS[r.status].label + (r.exc && r.status === 'excused' ? ` (${EXCUSAL_TYPES[r.exc.type]})` : ''),
      r.info ? formatTime(r.info.ms) : '', r.rec ? (r.rec.source === 'admin' ? 'يدوي' : 'رمز QR') : '',
      r.flags.map((f) => f.t).join(' | '), r.rec?.note || r.exc?.note || '']);
  }
  for (const v of lastDay.voided) rows.push([D, v.name, '', 'سجل ملغى', formatTime(v.checkInAt?.toMillis?.()), '', '', v.note || '']);
  downloadFile(`حضور-الطابور-${D}.csv`, toCSV(rows));
}
