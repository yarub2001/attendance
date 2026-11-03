// حسابات الحضور (دالات نقية بلا اتصال بقاعدة البيانات)
import { minutesOf, tsToMs, weekdayOf, rangeKeys, weekRange } from '../time.js';
import { distanceM } from '../window.js';

export const EXCUSAL_TYPES = { leave: 'إجازة', duty: 'مهمة رسمية', other: 'عذر آخر' };
export const STATUS = {
  present: { label: 'حاضر', cls: 'b-ok' },
  late: { label: 'متأخر', cls: 'b-late' },
  pending: { label: 'لم يسجّل بعد', cls: '' },
  absent: { label: 'غائب', cls: 'b-bad' },
  excused: { label: 'معذور', cls: 'b-exc' },
  off: { label: 'لا دوام', cls: '' },
};

/** هل المعلم ضمن العدد المتوقع في هذا التاريخ؟ */
export function isEligible(t, D) {
  if (!t.startDate || t.startDate > D) return false;
  if (t.endDate) return D < t.endDate;
  return t.active !== false;
}

export function excusalFor(uid, D, excusals) {
  return excusals.find((e) => e.uid === uid && e.from <= D && D <= e.to) || null;
}

export function dayKind(D, settings, holidays) {
  const hol = holidays.get(D);
  if (hol) return { work: false, kind: 'holiday', label: 'عطلة: ' + (hol.name || '') };
  if (!(settings.workDays || []).includes(weekdayOf(D))) return { work: false, kind: 'weekend', label: 'ليس يوم دوام' };
  return { work: true, kind: 'work', label: 'يوم دوام' };
}

export function recordInfo(r, settings) {
  const ms = tsToMs(r.checkInAt);
  const mins = ms == null ? null : minutesOf(ms);
  const threshold = r.lateAfterMin ?? settings.lateAfterMin;
  return { ms, mins, late: mins != null && mins > threshold };
}

/**
 * حساب يوم واحد.
 * ctx = { teachers, excusals, holidays, settings }
 * records = سجلات الحضور لذلك اليوم [{ id, ...data }]
 * opts = { today, nowMin } لتمييز "لم يسجّل بعد" عن "غائب"
 */
export function computeDay(D, ctx, records, opts = {}) {
  const { teachers, excusals, holidays, settings } = ctx;
  const kind = dayKind(D, settings, holidays);
  const active = records.filter((r) => !r.voided);
  const voided = records.filter((r) => r.voided);
  const recByUid = new Map(active.map((r) => [r.uid, r]));

  // اكتشاف تسجيل أكثر من معلم من الجهاز نفسه
  const devUsers = new Map();
  for (const r of active) {
    if (!r.deviceId || r.source !== 'qr') continue;
    if (!devUsers.has(r.deviceId)) devUsers.set(r.deviceId, []);
    devUsers.get(r.deviceId).push(r.name);
  }

  const dayOver = opts.today == null || D < opts.today || (D === opts.today && opts.nowMin != null && opts.nowMin > settings.endMin);
  const geo = settings.geo || { mode: 'off' };

  const rows = [];
  const seen = new Set();
  const build = (uid, name, email, eligible) => {
    const rec = recByUid.get(uid) || null;
    const exc = excusalFor(uid, D, excusals);
    let status, info = null;
    const flags = [];
    if (rec) {
      info = recordInfo(rec, settings);
      status = info.late ? 'late' : 'present';
      if (rec.source === 'admin') flags.push({ t: 'يدوي', title: 'سجّلته الإدارة يدويًا', cls: 'b-exc' });
      const shared = rec.deviceId && devUsers.get(rec.deviceId);
      if (shared && shared.length > 1) flags.push({ t: 'جهاز مشترك', title: 'سُجّل من الجهاز نفسه: ' + shared.join('، '), cls: 'b-bad' });
      if (geo.mode !== 'off' && rec.source === 'qr') {
        if (!rec.geo) flags.push({ t: 'بلا موقع', title: 'لم يُرسل الموقع', cls: 'b-late' });
        else {
          const dist = distanceM(rec.geo, geo, geo.lngScale);
          if (dist > geo.radiusM) flags.push({ t: `خارج النطاق ${Math.round(dist)}م`, title: 'المسافة عن المدرسة', cls: 'b-bad' });
        }
      }
      if (!eligible) flags.push({ t: 'غير مدرج', title: 'المعلم غير ضمن القائمة المعتمدة في هذا التاريخ', cls: '' });
    } else if (exc) status = 'excused';
    else if (!kind.work) status = 'off';
    else status = dayOver ? 'absent' : 'pending';
    const counted = eligible && kind.work;
    rows.push({ uid, name, email, rec, exc, status, info, flags, eligible, counted,
      expected: counted && status !== 'excused' });
  };

  for (const t of ctx.teachers) {
    const eligible = isEligible(t, D);
    if (!eligible && !recByUid.has(t.id)) continue;
    seen.add(t.id);
    build(t.id, t.name, t.email, eligible);
  }
  for (const r of active) if (!seen.has(r.uid)) { seen.add(r.uid); build(r.uid, r.name, '', false); }

  const counted = rows.filter((r) => r.counted);
  const expected = rows.filter((r) => r.expected).length;
  const present = counted.filter((r) => r.status === 'present' || r.status === 'late').length;
  const late = counted.filter((r) => r.status === 'late').length;
  const missing = counted.filter((r) => r.status === 'absent' || r.status === 'pending').length;
  const excused = counted.filter((r) => r.status === 'excused').length;
  const approved = teachers.filter((t) => isEligible(t, D)).length;

  return {
    D, kind, rows, voided, dayOver,
    approved, expected, present, late, missing, excused,
    rate: expected > 0 ? Math.round((present / expected) * 1000) / 10 : null,
  };
}

/**
 * تقرير لفترة: recordsByDay = Map(dateKey -> records[])
 */
export function computeRange(A, B, ctx, recordsByDay, opts = {}) {
  const lastDay = opts.today && opts.today < B ? opts.today : B;
  const days = rangeKeys(A, lastDay).map((D) => computeDay(D, ctx, recordsByDay.get(D) || [], opts));
  const workDays = days.filter((d) => d.kind.work);

  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const totals = {
    workDays: workDays.length,
    expected: sum(workDays, 'expected'),
    present: sum(workDays, 'present'),
    late: sum(workDays, 'late'),
    missing: sum(workDays, 'missing'),
    excused: sum(workDays, 'excused'),
  };
  totals.rate = totals.expected ? Math.round((totals.present / totals.expected) * 1000) / 10 : null;

  // متوسط كل يوم من أيام الأسبوع (مجمّع)
  const byWeekday = new Map();
  for (const d of workDays) {
    const wd = weekdayOf(d.D);
    const a = byWeekday.get(wd) || { wd, days: 0, expected: 0, present: 0, late: 0 };
    a.days++; a.expected += d.expected; a.present += d.present; a.late += d.late;
    byWeekday.set(wd, a);
  }
  const weekdays = [...byWeekday.values()].sort((a, b) => a.wd - b.wd)
    .map((a) => ({ ...a, rate: a.expected ? Math.round((a.present / a.expected) * 1000) / 10 : null }));

  // تجميع أسبوعي
  const byWeek = new Map();
  for (const d of workDays) {
    const [ws, we] = weekRange(d.D);
    const a = byWeek.get(ws) || { start: ws, end: we, days: 0, expected: 0, present: 0, late: 0, missing: 0, excused: 0 };
    a.days++; a.expected += d.expected; a.present += d.present; a.late += d.late; a.missing += d.missing; a.excused += d.excused;
    byWeek.set(ws, a);
  }
  const weeks = [...byWeek.values()].map((a) => ({ ...a, rate: a.expected ? Math.round((a.present / a.expected) * 1000) / 10 : null }));

  // لكل معلم
  const perT = new Map();
  for (const d of workDays) {
    for (const r of d.rows) {
      if (!r.counted) continue;
      const a = perT.get(r.uid) || { uid: r.uid, name: r.name, expected: 0, present: 0, late: 0, missing: 0, excused: 0, lateMinutes: 0 };
      if (r.expected) a.expected++;
      if (r.status === 'present' || r.status === 'late') a.present++;
      if (r.status === 'late') { a.late++; a.lateMinutes += Math.max(0, r.info.mins - (r.rec.lateAfterMin ?? ctx.settings.lateAfterMin)); }
      if (r.status === 'absent' || r.status === 'pending') a.missing++;
      if (r.status === 'excused') a.excused++;
      perT.set(r.uid, a);
    }
  }
  const teachers = [...perT.values()].map((a) => ({ ...a, rate: a.expected ? Math.round((a.present / a.expected) * 1000) / 10 : null }))
    .sort((x, y) => (x.rate ?? 101) - (y.rate ?? 101) || x.name.localeCompare(y.name, 'ar'));

  return { A, B, days, workDays, totals, weekdays, weeks, teachers };
}
