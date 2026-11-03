// منطق نافذة التسجيل في الواجهة — مطابق لقواعد الأمان في الخادم (firestore.rules)
// الواجهة تستخدمه لعرض سبب واضح قبل الإرسال؛ والقرار النهائي دائمًا للخادم.
import { omanParts, formatMinutes, WEEKDAYS_AR } from './time.js';

export const DEFAULT_SETTINGS = {
  startMin: 6 * 60 + 30,      // 06:30
  lateAfterMin: 7 * 60,       // بعد 07:00 يُعدّ متأخرًا
  endMin: 7 * 60 + 30,        // 07:30 آخر وقت للتسجيل
  workDays: [0, 1, 2, 3, 4],  // الأحد ← الخميس
  registrationOpen: true,
  requireDailyCode: false,
  geo: { mode: 'off' },
};

/**
 * @returns {{ok:boolean, code?:string, msg?:string, mins?:number, late?:boolean}}
 */
export function evaluateWindow(s, ms, holiday) {
  if (!s) return { ok: false, code: 'no-settings', msg: 'لم تضبط الإدارة إعدادات التسجيل بعد.' };
  const p = omanParts(ms);
  const mins = p.h * 60 + p.min;
  if (!s.registrationOpen) return { ok: false, code: 'closed', msg: 'التسجيل موقوف حاليًا من قِبل الإدارة.' };
  if (!(s.workDays || []).includes(p.wd)) return { ok: false, code: 'weekend', msg: `اليوم ${WEEKDAYS_AR[p.wd]} ليس يوم دوام.` };
  if (holiday) return { ok: false, code: 'holiday', msg: `اليوم عطلة${holiday.name ? ': ' + holiday.name : ''}.` };
  if (mins < s.startMin) return { ok: false, code: 'early', msg: `لم يبدأ التسجيل بعد. يبدأ الساعة ${formatMinutes(s.startMin)}.` };
  if (mins > s.endMin) return { ok: false, code: 'ended', msg: `انتهت فترة التسجيل الساعة ${formatMinutes(s.endMin)}. راجع الإدارة لتسجيل حضورك يدويًا.` };
  return { ok: true, mins, late: mins > s.lateAfterMin };
}

/** المسافة بالأمتار (تقريب مسطّح مطابق لقواعد الأمان) */
export function distanceM(a, b, lngScale) {
  const scale = lngScale ?? Math.cos((b.lat * Math.PI) / 180);
  const dy = (a.lat - b.lat) * 111320;
  const dx = (a.lng - b.lng) * 111320 * scale;
  return Math.sqrt(dx * dx + dy * dy);
}
