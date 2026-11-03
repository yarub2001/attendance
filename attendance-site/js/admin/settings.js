// إعدادات التسجيل: النافذة الزمنية، الإيقاف، التحقق الإضافي (رمز اليوم / الموقع)
import { arabicError } from '../firebase.js';
import { hmToMin, minToHm, formatMinutes } from '../time.js';
import { $, h, toast } from '../ui.js';
import { store, subscribe, saveSettings } from './store.js';

let root, unsub, dirty = false;

export function render(container) {
  root = container;
  dirty = false;
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'إعدادات التسجيل'),
      h('div', { class: 'muted' }, 'تُطبَّق هذه الإعدادات في الخادم نفسه (قواعد الأمان)، وليس في هاتف المعلم فقط.'))),
    h('form', { id: 'sForm' },
      h('section', { class: 'card' },
        h('h3', {}, 'اسم المدرسة'),
        h('div', { class: 'field' }, h('input', { id: 'sName', required: true }))),
      h('section', { class: 'card' },
        h('h3', {}, 'فترة التسجيل (بتوقيت سلطنة عُمان)'),
        h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('label', { for: 'sStart' }, 'بداية التسجيل'), h('input', { id: 'sStart', type: 'time', required: true })),
          h('div', { class: 'field' }, h('label', { for: 'sLate' }, 'يُحتسب متأخرًا بعد'), h('input', { id: 'sLate', type: 'time', required: true })),
          h('div', { class: 'field' }, h('label', { for: 'sEnd' }, 'نهاية التسجيل (آخر دقيقة مسموحة)'), h('input', { id: 'sEnd', type: 'time', required: true }))),
        h('p', { class: 'small muted', id: 'sPreview' }),
        h('p', { class: 'small notice notice-info' }, 'نصيحة: اجعلي الفترة قصيرة (مثل 30–45 دقيقة حول وقت الطابور) لتقليل إمكانية التسجيل من خارج المدرسة.')),
      h('section', { class: 'card' },
        h('h3', {}, 'حالة التسجيل'),
        h('label', { class: 'switch' }, h('input', { id: 'sOpen', type: 'checkbox' }), ' التسجيل مفعّل (عند إلغاء التحديد يُرفض أي تسجيل فورًا حتى داخل الفترة)')),
      h('section', { class: 'card' },
        h('h3', {}, 'تحقق إضافي (اختياري)'),
        h('p', { class: 'muted small' }, 'رمز QR الثابت وحده لا يثبت وجود المعلم في الساحة؛ فقد تُصوَّر الصورة وتُرسل. فعّلي وسيلة أو أكثر مما يلي حسب الحاجة.'),
        h('label', { class: 'check-row' }, h('input', { id: 'sCode', type: 'checkbox' }), ' طلب «رمز اليوم»: رمز من 4 أرقام تولّدينه كل صباح من لوحة اليوم وتعلنينه في الساحة'),
        h('div', { class: 'grid-2', style: 'margin-top:.6rem' },
          h('div', { class: 'field' }, h('label', { for: 'sGeo' }, 'التحقق من الموقع الجغرافي'),
            h('select', { id: 'sGeo' },
              h('option', { value: 'off' }, 'متوقف'),
              h('option', { value: 'record' }, 'تسجيل الموقع وتنبيه الإدارة (لا يمنع التسجيل)'),
              h('option', { value: 'require' }, 'إلزامي: رفض التسجيل خارج نطاق المدرسة'))),
          h('div', { class: 'field' }, h('label', { for: 'sRadius' }, 'نصف قطر النطاق (متر)'), h('input', { id: 'sRadius', type: 'number', min: 20, max: 5000, step: 10 })),
          h('div', { class: 'field' }, h('label', { for: 'sLat' }, 'خط العرض (Latitude)'), h('input', { id: 'sLat', type: 'number', step: 'any', dir: 'ltr' })),
          h('div', { class: 'field' }, h('label', { for: 'sLng' }, 'خط الطول (Longitude)'), h('input', { id: 'sLng', type: 'number', step: 'any', dir: 'ltr' }))),
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: useMyLocation }, '📍 استخدام موقعي الحالي (قفي في ساحة الطابور)'),
        h('p', { class: 'small muted', style: 'margin-top:.6rem' }, 'تنبيه: الموقع يُرسل من متصفح الهاتف ويمكن لشخص متمكن تقنيًا تزييفه، ودقة GPS داخل المباني قد تصل إلى 50–100 متر. لذلك ننصح بنصف قطر لا يقل عن 150 مترًا، وباستخدام «تسجيل وتنبيه» أولًا لمدة أسبوع قبل جعله إلزاميًا.')),
      h('p', { class: 'form-error', id: 'sErr', role: 'alert' }),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'submit', id: 'sSave' }, 'حفظ الإعدادات'), h('span', { class: 'muted small', id: 'sDirty' }))),
  );
  fill();
  const form = $('#sForm');
  form.addEventListener('input', () => { dirty = true; $('#sDirty').textContent = 'توجد تغييرات غير محفوظة'; preview(); });
  form.addEventListener('submit', save);
  unsub = subscribe((w) => { if (w === 'settings' && !dirty) fill(); });
}
export function destroy() { unsub?.(); }

function fill() {
  const s = store.settings; if (!s || !$('#sName')) return;
  $('#sName').value = s.schoolName || 'مدرسة الطالب الذكي الخاصة';
  $('#sStart').value = minToHm(s.startMin);
  $('#sLate').value = minToHm(s.lateAfterMin);
  $('#sEnd').value = minToHm(s.endMin);
  $('#sOpen').checked = !!s.registrationOpen;
  $('#sCode').checked = !!s.requireDailyCode;
  $('#sGeo').value = s.geo?.mode || 'off';
  $('#sRadius').value = s.geo?.radiusM || 200;
  $('#sLat').value = s.geo?.lat ?? '';
  $('#sLng').value = s.geo?.lng ?? '';
  preview();
  if (!store.settingsExists) $('#sDirty').textContent = 'لم تُحفظ الإعدادات بعد — اضغطي «حفظ الإعدادات» مرة واحدة على الأقل.';
}

function preview() {
  const a = hmToMin($('#sStart').value || '0:0'), l = hmToMin($('#sLate').value || '0:0'), e = hmToMin($('#sEnd').value || '0:0');
  $('#sPreview').textContent = `يُسمح بالتسجيل من ${formatMinutes(a)} حتى ${formatMinutes(e)} (مدة ${e - a} دقيقة)، ويُعدّ التسجيل بعد ${formatMinutes(l)} تأخيرًا.`;
}

function useMyLocation() {
  if (!navigator.geolocation) return toast('المتصفح لا يدعم تحديد الموقع.', 'bad');
  toast('جارٍ تحديد الموقع…');
  navigator.geolocation.getCurrentPosition((p) => {
    $('#sLat').value = p.coords.latitude.toFixed(6);
    $('#sLng').value = p.coords.longitude.toFixed(6);
    dirty = true; $('#sDirty').textContent = 'توجد تغييرات غير محفوظة';
    toast(`تم (دقة تقريبية ${Math.round(p.coords.accuracy)} م).`, 'ok');
  }, () => toast('تعذّر تحديد الموقع. اسمحي للمتصفح بالوصول إلى الموقع.', 'bad'), { enableHighAccuracy: true, timeout: 15000 });
}

async function save(e) {
  e.preventDefault();
  const err = $('#sErr'); err.textContent = '';
  const startMin = hmToMin($('#sStart').value), lateAfterMin = hmToMin($('#sLate').value), endMin = hmToMin($('#sEnd').value);
  if (!(startMin < endMin)) return (err.textContent = 'يجب أن تكون بداية التسجيل قبل نهايته.');
  if (lateAfterMin < startMin || lateAfterMin > endMin) return (err.textContent = 'وقت التأخير يجب أن يقع بين بداية التسجيل ونهايته.');
  const mode = $('#sGeo').value;
  const geo = { mode };
  if (mode !== 'off') {
    const lat = parseFloat($('#sLat').value), lng = parseFloat($('#sLng').value), radiusM = parseInt($('#sRadius').value, 10);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return (err.textContent = 'أدخلي إحداثيات المدرسة أو استخدمي زر «موقعي الحالي».');
    if (!(radiusM >= 20 && radiusM <= 5000)) return (err.textContent = 'نصف القطر بين 20 و5000 متر.');
    Object.assign(geo, { lat, lng, radiusM, lngScale: Math.cos((lat * Math.PI) / 180) });
  }
  const btn = $('#sSave'); btn.disabled = true;
  try {
    await saveSettings({
      schoolName: $('#sName').value.trim() || 'مدرسة الطالب الذكي الخاصة',
      startMin, lateAfterMin, endMin,
      registrationOpen: $('#sOpen').checked,
      requireDailyCode: $('#sCode').checked,
      workDays: store.settings.workDays,
      geo,
    }, 'settings.edit');
    dirty = false; $('#sDirty').textContent = '';
    toast('تم حفظ الإعدادات وتطبيقها فورًا.', 'ok');
  } catch (ex) { err.textContent = arabicError(ex); }
  finally { btn.disabled = false; }
}
