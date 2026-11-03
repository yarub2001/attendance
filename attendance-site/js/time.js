// =====================================================================
//  أدوات الوقت بتوقيت سلطنة عُمان (Asia/Muscat = UTC+4 دون توقيت صيفي)
//
//  لا نثق بساعة الهاتف: نقرأ ساعة الخادم من ترويسة Date في استجابة الاستضافة
//  ونحسب الفرق. هذا للعرض والتنبيه فقط؛ أما القرار النهائي فتتخذه قواعد الأمان
//  في الخادم باستخدام request.time.
// =====================================================================

export const OMAN_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 86400000;

let serverOffsetMs = 0;     // (وقت الخادم − وقت الجهاز)
let serverSynced = false;

export async function syncServerTime() {
  try {
    const t0 = Date.now();
    // طلب HEAD خفيف لملف صغير موجود؛ المعامل العشوائي يتجاوز ذاكرة التخزين المؤقت
    const res = await fetch('favicon.svg?t=' + t0, { method: 'HEAD', cache: 'no-store' });
    const t1 = Date.now();
    const h = res.headers.get('date');
    if (h) {
      // ترويسة Date بدقة ثانية واحدة؛ نضيف نصف ثانية لتقليل الانحياز
      const server = Date.parse(h) + 500;
      serverOffsetMs = server - Math.round((t0 + t1) / 2);
      serverSynced = true;
    }
  } catch { /* نستخدم ساعة الجهاز مؤقتًا */ }
  return { offsetMs: serverOffsetMs, synced: serverSynced };
}

export function clockInfo() { return { offsetMs: serverOffsetMs, synced: serverSynced }; }

/** الوقت الحالي المقدّر حسب الخادم (ملّي ثانية UTC) */
export function nowMs() { return Date.now() + serverOffsetMs; }

/** مكونات التاريخ والوقت بتوقيت عُمان */
export function omanParts(ms) {
  const d = new Date(ms + OMAN_OFFSET_MS);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    wd: d.getUTCDay(),            // 0 = الأحد
    h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds(),
  };
}

const p2 = (n) => String(n).padStart(2, '0');

/** مفتاح التاريخ بصيغة YYYY-MM-DD بتوقيت عُمان */
export function dateKeyOf(ms) {
  const p = omanParts(ms);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}

export function todayKey() { return dateKeyOf(nowMs()); }

/** الدقائق منذ منتصف الليل بتوقيت عُمان */
export function minutesOf(ms) { const p = omanParts(ms); return p.h * 60 + p.min; }

/** يحوّل مفتاح تاريخ إلى ملّي ثانية لمنتصف ليل ذلك اليوم بتوقيت عُمان */
export function keyToMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - OMAN_OFFSET_MS;
}

export function addDays(key, n) { return dateKeyOf(keyToMs(key) + n * DAY_MS + 3600000); }

export function weekdayOf(key) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }

/** قائمة التواريخ من a إلى b (شاملة) */
export function rangeKeys(a, b) {
  const out = [];
  for (let k = a; k <= b && out.length < 400; k = addDays(k, 1)) out.push(k);
  return out;
}

/** بداية الأسبوع (الأحد) ونهايته (السبت) للتاريخ المعطى */
export function weekRange(key) {
  const wd = weekdayOf(key);
  const start = addDays(key, -wd);
  return [start, addDays(start, 6)];
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${y}-${p2(m)}-01`, `${y}-${p2(m)}-${p2(last)}`];
}

/** "07:30" ⇐⇒ 450 */
export function hmToMin(hm) { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; }
export function minToHm(min) { return `${p2(Math.floor(min / 60))}:${p2(min % 60)}`; }

/** وقت الحضور الحقيقي (Timestamp من Firestore أو ms) ⇒ ms */
export function tsToMs(ts) {
  if (!ts) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds != null) return ts.seconds * 1000 + Math.round((ts.nanoseconds || 0) / 1e6);
  return null;
}

const LOCALE = 'ar-OM-u-nu-latn';
const fmtTime = new Intl.DateTimeFormat(LOCALE, { timeZone: 'Asia/Muscat', hour: 'numeric', minute: '2-digit' });
const fmtTimeSec = new Intl.DateTimeFormat(LOCALE, { timeZone: 'Asia/Muscat', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const fmtDateLong = new Intl.DateTimeFormat(LOCALE, { timeZone: 'Asia/Muscat', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatTime = (ms) => (ms == null ? '—' : fmtTime.format(ms));
export const formatTimeSec = (ms) => (ms == null ? '—' : fmtTimeSec.format(ms));
export const formatDateLong = (ms) => fmtDateLong.format(ms);
export const formatDateTime = (ms) => {
  if (ms == null) return '—';
  const p = omanParts(ms);
  return `${p.d}/${p.m}/${p.y} ${fmtTime.format(ms)}`;
};
/** تنسيق مفتاح تاريخ (نستخدم منتصف النهار لتجنب حواف اليوم) */
export const formatKeyLong = (key) => fmtDateLong.format(keyToMs(key) + 12 * 3600000);
export const formatKeyShort = (key) => { const [, m, d] = key.split('-').map(Number); return `${WEEKDAYS_AR[weekdayOf(key)]} ${d}/${m}`; };

/** "7:05 ص" من دقائق اليوم */
export function formatMinutes(min) {
  return fmtTime.format(keyToMs('2000-01-01') + min * 60000);
}

export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
