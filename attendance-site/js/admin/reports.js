// التقارير اليومية والأسبوعية والشهرية + مقارنة نسب الحضور بين الأيام
import { collection, query, where, getDocs } from '../../vendor/firebase.js';
import { db, arabicError } from '../firebase.js';
import {
  todayKey, nowMs, minutesOf, addDays, weekRange, monthRange, formatKeyLong, formatKeyShort,
  formatTime, formatDateTime, weekdayOf, WEEKDAYS_AR, rangeKeys,
} from '../time.js';
import { $, h, toast, toCSV, downloadFile, fmtPct, infoDialog, normalizeArabic } from '../ui.js';
import { store, subscribe } from './store.js';
import { computeRange, STATUS, EXCUSAL_TYPES } from './stats.js';

let root, unsub;
let A, B, preset = 'week';
let recordsByDay = new Map();
let rawRecords = [];
let report = null;
let loadedKey = '';
let tSearch = '';

const PRESETS = [
  ['today', 'اليوم'], ['week', 'هذا الأسبوع'], ['lastweek', 'الأسبوع الماضي'],
  ['month', 'هذا الشهر'], ['lastmonth', 'الشهر الماضي'], ['custom', 'فترة مخصصة'],
];

function presetRange(p) {
  const t = todayKey();
  switch (p) {
    case 'today': return [t, t];
    case 'week': return weekRange(t);
    case 'lastweek': return weekRange(addDays(t, -7));
    case 'month': return monthRange(t);
    case 'lastmonth': return monthRange(addDays(monthRange(t)[0], -1));
    default: return [A, B];
  }
}

export function render(container) {
  root = container;
  if (!A) [A, B] = presetRange(preset);
  root.replaceChildren(
    h('div', { class: 'print-only' }, h('h2', { id: 'rpTitle' }), h('p', { class: 'muted', id: 'rpSub' })),
    h('div', { class: 'section-head no-print' }, h('div', {}, h('h2', {}, 'التقارير'), h('div', { class: 'muted', id: 'rTitle' }))),
    h('div', { class: 'toolbar no-print' },
      h('select', { id: 'rPreset', 'aria-label': 'الفترة', onchange: (e) => { preset = e.target.value; if (preset !== 'custom') { [A, B] = presetRange(preset); syncInputs(); load(); } } },
        PRESETS.map(([v, l]) => h('option', { value: v, selected: v === preset }, l))),
      h('label', { class: 'small' }, 'من'), h('input', { type: 'date', id: 'rA', value: A, onchange: onCustom }),
      h('label', { class: 'small' }, 'إلى'), h('input', { type: 'date', id: 'rB', value: B, onchange: onCustom }),
      h('button', { class: 'btn btn-outline btn-sm', onclick: () => load(true) }, 'تحديث'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-outline btn-sm', onclick: exportDaily }, 'CSV: ملخص الأيام'),
      h('button', { class: 'btn btn-outline btn-sm', onclick: exportTeachers }, 'CSV: ملخص المعلمين'),
      h('button', { class: 'btn btn-outline btn-sm', onclick: exportRaw }, 'CSV: السجلات التفصيلية'),
      h('button', { class: 'btn btn-outline btn-sm', onclick: () => window.print() }, 'طباعة')),
    h('div', { id: 'rBody' }, h('p', { class: 'muted' }, 'جارٍ التحميل…')),
  );
  unsub = subscribe((w) => { if (['teachers', 'excusals', 'holidays', 'settings'].includes(w)) draw(); });
  load();
}

addEventListener('beforeprint', () => { const el = document.getElementById('rpSub'); if (el && A) el.textContent = `${A === B ? formatKeyLong(A) : `من ${formatKeyLong(A)} إلى ${formatKeyLong(B)}`} · طُبع في ${formatDateTime(nowMs())}`; });

export function destroy() { unsub?.(); unsub = null; }

function syncInputs() { $('#rA').value = A; $('#rB').value = B; $('#rPreset').value = preset; }

function onCustom() {
  const a = $('#rA').value, b = $('#rB').value;
  if (!a || !b) return;
  preset = 'custom'; $('#rPreset').value = 'custom';
  [A, B] = a <= b ? [a, b] : [b, a];
  syncInputs(); load();
}

async function load(force = false) {
  const span = rangeKeys(A, B).length;
  if (span > 186) { toast('أقصى مدة للتقرير الواحد ستة أشهر.', 'warn'); return; }
  const key = A + '|' + B;
  if (!force && key === loadedKey) return draw();
  $('#rBody').replaceChildren(h('p', { class: 'muted' }, 'جارٍ تحميل السجلات…'));
  try {
    const snap = await getDocs(query(collection(db, 'attendance'), where('dateKey', '>=', A), where('dateKey', '<=', B)));
    rawRecords = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    recordsByDay = new Map();
    for (const r of rawRecords) {
      if (!recordsByDay.has(r.dateKey)) recordsByDay.set(r.dateKey, []);
      recordsByDay.get(r.dateKey).push(r);
    }
    loadedKey = key;
    draw();
  } catch (err) {
    $('#rBody').replaceChildren(h('div', { class: 'notice notice-bad' }, 'تعذّر تحميل التقرير: ' + arabicError(err)));
  }
}

function draw() {
  if (!root || !loadedKey || !store.ready.teachers || !store.ready.settings) return;
  const ctx = { teachers: store.teachers, excusals: store.excusals, holidays: store.holidays, settings: store.settings };
  const today = todayKey();
  report = computeRange(A, B, ctx, recordsByDay, { today, nowMin: minutesOf(nowMs()) });
  const t = report.totals;
  const title = A === B ? formatKeyLong(A) : `من ${formatKeyLong(A)} إلى ${formatKeyLong(B)}`;
  $('#rTitle').textContent = title;
  $('#rpTitle').textContent = `تقرير حضور الطابور الصباحي — ${store.settings.schoolName || ''}`;
  $('#rpSub').textContent = `${title} · طُبع في ${formatDateTime(nowMs())}`;

  const body = $('#rBody');
  if (!report.workDays.length) {
    body.replaceChildren(h('div', { class: 'notice' }, B > today && A > today ? 'الفترة المختارة في المستقبل.' : 'لا توجد أيام دوام في هذه الفترة (عطل أو نهاية أسبوع).'));
    return;
  }
  const best = report.workDays.filter((d) => d.rate != null).reduce((m, d) => (!m || d.rate > m.rate ? d : m), null);
  const worst = report.workDays.filter((d) => d.rate != null).reduce((m, d) => (!m || d.rate < m.rate ? d : m), null);

  body.replaceChildren(
    h('div', { class: 'kpis' },
      kpiAccent('متوسط نسبة الحضور', fmtPct(t.rate), `${t.present} حضورًا من ${t.expected} متوقعًا`),
      kpi('أيام الدوام', t.workDays, `من ${rangeKeys(A, B).length} يومًا في الفترة`),
      kpi('حالات التأخير', t.late, t.present ? `${Math.round((t.late / t.present) * 100)}% من الحضور` : ''),
      kpi('حالات الغياب / عدم التسجيل', t.missing, ''),
      kpi('أيام إجازات ومهام', t.excused, 'مستبعدة من المتوقع'),
    ),
    report.workDays.length > 1 ? h('section', { class: 'card' },
      h('div', { class: 'card-title' }, h('h3', {}, 'نسبة الحضور اليومية'),
        best && worst && best !== worst ? h('span', { class: 'muted small' }, `الأعلى: ${formatKeyShort(best.D)} (${fmtPct(best.rate)}) · الأدنى: ${formatKeyShort(worst.D)} (${fmtPct(worst.rate)})`) : null),
      barChart(report.workDays)) : null,
    report.weekdays.length > 1 ? h('section', { class: 'card' },
      h('h3', {}, 'مقارنة أيام الأسبوع'),
      h('p', { class: 'muted small' }, 'نسبة الحضور المجمّعة لكل يوم من أيام الأسبوع خلال الفترة.'),
      table(['اليوم', 'عدد الأيام', 'الحضور / المتوقع', 'المتأخرون', 'النسبة'],
        report.weekdays.map((w) => [WEEKDAYS_AR[w.wd], w.days, `${w.present} / ${w.expected}`, w.late, inlineBar(w.rate)]))) : null,
    report.weeks.length > 1 ? h('section', { class: 'card' },
      h('h3', {}, 'الملخص الأسبوعي'),
      table(['الأسبوع', 'أيام الدوام', 'المتوقع', 'الحاضرون', 'المتأخرون', 'الغائبون', 'المعذورون', 'النسبة'],
        report.weeks.map((w) => [`${formatKeyShort(w.start)} – ${formatKeyShort(w.end)}`, w.days, w.expected, w.present, w.late, w.missing, w.excused, inlineBar(w.rate)]))) : null,
    h('section', { class: 'card' },
      h('h3', {}, 'الملخص اليومي'),
      table(['التاريخ', 'المعتمدون', 'المتوقع', 'الحاضرون', 'المتأخرون', 'الغائبون', 'المعذورون', 'النسبة'],
        report.days.map((d) => d.kind.work
          ? [formatKeyShort(d.D) + (d.D === today ? ' (جارٍ)' : ''), d.approved, d.expected, d.present, d.late, d.missing, d.excused, inlineBar(d.rate)]
          : [formatKeyShort(d.D), { colspan: 7, v: h('span', { class: 'muted' }, d.kind.label) }]))),
    h('section', { class: 'card' },
      h('div', { class: 'card-title' }, h('h3', {}, 'ملخص المعلمين'),
        h('input', { type: 'search', class: 'no-print', placeholder: 'بحث باسم المعلم…', style: 'width:auto', value: tSearch, oninput: (e) => { tSearch = e.target.value; drawTeacherTable(); } })),
      h('p', { class: 'muted small no-print' }, 'مرتّب من الأقل حضورًا. اضغطي على اسم المعلم لعرض تفاصيل أيامه.'),
      h('div', { id: 'rTeachers' })),
  );
  drawTeacherTable();
}

function drawTeacherTable() {
  const box = $('#rTeachers');
  if (!box || !report) return;
  const term = normalizeArabic(tSearch);
  const list = report.teachers.filter((t) => !term || normalizeArabic(t.name).includes(term));
  box.replaceChildren(table(['المعلم', 'الأيام المتوقعة', 'الحضور', 'التأخير', 'دقائق التأخير', 'الغياب', 'إجازات/مهام', 'النسبة'],
    list.map((t) => [h('button', { class: 'btn btn-ghost btn-sm', style: 'padding:0;min-height:0;font-weight:600', onclick: () => teacherDetail(t) }, t.name),
      t.expected, t.present, t.late, t.lateMinutes, t.missing, t.excused, inlineBar(t.rate)])));
}

function teacherDetail(t) {
  const rows = [];
  for (const d of report.workDays) {
    const r = d.rows.find((x) => x.uid === t.uid);
    if (!r || !r.counted) continue;
    rows.push([formatKeyShort(d.D), h('span', { class: 'badge ' + STATUS[r.status].cls }, STATUS[r.status].label + (r.status === 'excused' ? ` (${EXCUSAL_TYPES[r.exc.type]})` : '')),
      r.info ? formatTime(r.info.ms) : '—', r.flags.map((f) => f.t).join('، ') || '']);
  }
  infoDialog({ title: `${t.name} — ${fmtPct(t.rate)}`, wide: true, body: table(['التاريخ', 'الحالة', 'وقت التسجيل', 'ملاحظات'], rows) });
}

function kpi(label, value, hint) {
  return h('div', { class: 'kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value num' }, String(value)), hint ? h('div', { class: 'hint' }, hint) : null);
}
function kpiAccent(label, value, hint) { const k = kpi(label, value, hint); k.classList.add('accent'); return k; }

function inlineBar(rate) {
  if (rate == null) return '—';
  return h('div', { class: 'row', style: 'gap:.5rem;flex-wrap:nowrap' },
    h('div', { style: 'flex:1;min-width:60px;height:8px;border-radius:99px;background:var(--brand-soft);overflow:hidden' },
      h('div', { style: `width:${rate}%;height:100%;background:var(--brand);border-radius:99px` })),
    h('span', { class: 'num', style: 'min-width:3.2em' }, fmtPct(rate)));
}

function table(headers, rows) {
  if (!rows.length) return h('div', { class: 'empty' }, 'لا توجد بيانات.');
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => (c && c.colspan ? h('td', { colspan: c.colspan }, c.v) : h('td', {}, c ?? '—'))))))));
}

// ---------- مخطط الأعمدة (SVG) ----------
function barChart(days) {
  const n = days.length;
  const padL = 12, padR = 44, padT = 22, padB = 34;
  const W = Math.max(1000, padL + padR + n * 30);
  const slot = (W - padL - padR) / n;
  const H = 240;
  const plotH = H - padT - padB;
  const bw = Math.min(24, Math.floor(slot * 0.62));
  const ns = 'http://www.w3.org/2000/svg';
  const S = (tag, attrs = {}, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;min-width:560px;height:auto', role: 'img', 'aria-label': 'مخطط أعمدة لنسبة الحضور اليومية' });
  const y = (v) => padT + plotH - (v / 100) * plotH;

  const axis = S('g', { class: 'axis' });
  for (const v of [0, 25, 50, 75, 100]) {
    axis.append(S('line', { class: 'gridline', x1: padL, x2: W - padR + 6, y1: y(v), y2: y(v) }));
    axis.append(S('text', { x: W - padR + 10, y: y(v) + 4, 'text-anchor': 'start' }, v + '%'));
  }
  svg.append(axis);

  const rated = days.filter((d) => d.rate != null);
  const maxD = rated.reduce((m, d) => (!m || d.rate > m.rate ? d : m), null);
  const minD = rated.reduce((m, d) => (!m || d.rate < m.rate ? d : m), null);
  const lastD = rated[rated.length - 1];

  const tip = h('div', { role: 'tooltip', style: 'position:absolute;pointer-events:none;background:var(--ink);color:#fff;padding:.4rem .6rem;border-radius:8px;font-size:.82rem;display:none;white-space:nowrap;z-index:5' });
  const wrap = h('div', { class: 'chart', style: 'position:relative' });

  days.forEach((d, i) => {
    // من اليمين إلى اليسار: أقدم يوم على اليمين
    const cx = W - padR - (i + 0.5) * slot;
    const g = S('g', { tabindex: '0', 'aria-label': `${formatKeyLong(d.D)}: ${fmtPct(d.rate)}` });
    if (d.rate != null && d.rate > 0) {
      const top = y(d.rate), base = y(0), x0 = cx - bw / 2, r = Math.min(4, (base - top) / 2);
      g.append(S('path', { class: 'bar', d: `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z` }));
    }
    if (d === maxD || d === minD || d === lastD) {
      g.append(S('text', { class: 'vlabel', x: cx, y: y(d.rate ?? 0) - 6, 'text-anchor': 'middle' }, fmtPct(d.rate)));
    }
    const [, m, dd] = d.D.split('-');
    if (n <= 24 || i % Math.ceil(n / 24) === 0) {
      g.append(S('text', { x: cx, y: H - padB + 16, 'text-anchor': 'middle', class: 'axis-lbl', style: 'font-size:11px;fill:var(--muted)' }, `${+dd}/${+m}`));
    }
    const hit = S('rect', { x: cx - slot / 2, y: padT, width: slot, height: plotH + 4, fill: 'transparent' });
    g.prepend(hit);
    const show = () => {
      tip.replaceChildren(h('div', { style: 'font-weight:600' }, formatKeyShort(d.D)), h('div', {}, `النسبة: ${fmtPct(d.rate)}`), h('div', {}, `الحضور ${d.present} من ${d.expected}${d.late ? ` · متأخرون ${d.late}` : ''}`));
      tip.style.display = 'block';
      const box = wrap.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      const k = svgBox.width / W; // المخطط يتمدد مع عرض البطاقة
      const left = svgBox.left - box.left + cx * k - tip.offsetWidth / 2 + wrap.scrollLeft;
      tip.style.left = Math.min(Math.max(0, left), wrap.scrollWidth - tip.offsetWidth) + 'px';
      tip.style.top = Math.max(0, y(d.rate ?? 0) * k - 64) + 'px';
      g.querySelector('.bar')?.setAttribute('opacity', '.8');
    };
    const hide = () => { tip.style.display = 'none'; g.querySelector('.bar')?.removeAttribute('opacity'); };
    g.addEventListener('pointerenter', show); g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', show); g.addEventListener('blur', hide);
    svg.append(g);
  });
  wrap.append(svg, tip);
  return wrap;
}

// ---------- التصدير ----------
function exportDaily() {
  if (!report) return;
  const rows = [['التاريخ', 'اليوم', 'نوع اليوم', 'المعتمدون', 'المتوقع', 'الحاضرون', 'المتأخرون', 'الغائبون', 'المعذورون', 'النسبة %']];
  for (const d of report.days) rows.push([d.D, WEEKDAYS_AR[weekdayOf(d.D)], d.kind.label, d.approved, d.kind.work ? d.expected : '', d.present, d.late, d.kind.work ? d.missing : '', d.excused, d.rate ?? '']);
  rows.push([]);
  rows.push(['الإجمالي', '', '', '', report.totals.expected, report.totals.present, report.totals.late, report.totals.missing, report.totals.excused, report.totals.rate ?? '']);
  downloadFile(`ملخص-الأيام-${A}_${B}.csv`, toCSV(rows));
}

function exportTeachers() {
  if (!report) return;
  const rows = [['المعلم', 'الأيام المتوقعة', 'الحضور', 'التأخير', 'دقائق التأخير', 'الغياب', 'إجازات/مهام', 'النسبة %']];
  for (const t of report.teachers) rows.push([t.name, t.expected, t.present, t.late, t.lateMinutes, t.missing, t.excused, t.rate ?? '']);
  downloadFile(`ملخص-المعلمين-${A}_${B}.csv`, toCSV(rows));
}

function exportRaw() {
  if (!report) return;
  const rows = [['التاريخ', 'المعلم', 'الحالة', 'وقت التسجيل', 'المصدر', 'تنبيهات', 'ملاحظة']];
  for (const d of report.days) {
    for (const r of d.rows) {
      if (!r.rec && r.status === 'off') continue;
      rows.push([d.D, r.name, STATUS[r.status].label, r.info ? formatTime(r.info.ms) : '', r.rec ? (r.rec.source === 'admin' ? 'يدوي' : 'رمز QR') : '',
        r.flags.map((f) => f.t).join(' | '), r.rec?.note || r.exc?.note || '']);
    }
  }
  downloadFile(`السجلات-التفصيلية-${A}_${B}.csv`, toCSV(rows));
}
