// رمز QR لصفحة التسجيل — يُنشأ من رابط الموقع المنشور فعليًا
import { h, toast, downloadFile } from '../ui.js';
import { store } from './store.js';

// رابط صفحة التسجيل نسبةً إلى مكان الموقع (يعمل على Firebase Hosting و GitHub Pages)
export function checkinUrl() { return new URL('checkin', location.href).href; }

export function isPublicUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !['localhost', '127.0.0.1', '0.0.0.0'].includes(x.hostname) && !x.hostname.endsWith('.local');
  } catch { return false; }
}

export function qrSvg(text, cell = 8) {
  if (!window.qrcode) throw new Error('مكتبة QR لم تُحمّل بعد');
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}

export function render(root) {
  const url = checkinUrl();
  const ok = isPublicUrl(url);
  const box = h('div', { class: 'qr-box' });
  try { box.innerHTML = qrSvg(url); } catch (e) { box.textContent = e.message; }
  const s = store.settings || {};
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'رمز QR لساحة الطابور'),
      h('div', { class: 'muted' }, 'يُطبع مرة واحدة ويُثبّت في الساحة. الرابط ثابت ولن يتغير عند تحديث الموقع.'))),
    !ok ? h('div', { class: 'notice notice-bad', style: 'margin-bottom:1rem' },
      h('strong', {}, 'لا تطبعي هذا الرمز! '),
      'الصفحة مفتوحة الآن من رابط محلي (', h('span', { class: 'ltr' }, location.origin), '). الرمز يجب أن يشير إلى الموقع المنشور على الإنترنت مثل ',
      h('span', { class: 'ltr' }, 'https://your-project.web.app/checkin'), ' أو ', h('span', { class: 'ltr' }, 'https://your-name.github.io/attendance/checkin'), '. هواتف المعلمين لا تستطيع فتح localhost أو ملف على جهازك. افتحي لوحة الإدارة من الرابط المنشور ثم عودي إلى هذه الصفحة.') : null,
    h('div', { class: 'cols-2' },
      h('section', { class: 'card' },
        box,
        h('p', { style: 'text-align:center;margin-top:.8rem' }, h('span', { class: 'ltr kbd' }, url)),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn btn-primary', disabled: !ok, onclick: () => window.open('poster?name=' + encodeURIComponent(s.schoolName || ''), '_blank') }, 'طباعة ملصق A4'),
          h('button', { class: 'btn btn-outline', onclick: () => downloadFile('qr-checkin.svg', box.innerHTML, 'image/svg+xml') }, 'تنزيل SVG'),
          h('button', { class: 'btn btn-outline', onclick: () => downloadPng(box) }, 'تنزيل PNG'),
          h('button', { class: 'btn btn-outline', onclick: () => navigator.clipboard?.writeText(url).then(() => toast('نُسخ الرابط', 'ok')) }, 'نسخ الرابط'))),
      h('section', { class: 'card' },
        h('h3', {}, 'قبل الطباعة: اختبري الرمز'),
        h('ol', {},
          h('li', {}, 'امسحي الرمز من الشاشة بكاميرا هاتف معلم.'),
          h('li', {}, 'تأكدي أن صفحة «تسجيل حضور الطابور» تفتح عبر https.'),
          h('li', {}, 'سجّلي الدخول بحساب معلم تجريبي وجرّبي التسجيل داخل الفترة وخارجها.')),
        h('h3', { style: 'margin-top:1rem' }, 'تنبيه مهم'),
        h('p', {}, 'الرمز الثابت وحده لا يثبت أن المعلم موجود في الساحة؛ يمكن تصويره وإرساله. ما يحمي النظام فعليًا:'),
        h('ul', {},
          h('li', {}, 'لكل معلم حساب خاص — لا يمكنه التسجيل باسم غيره.'),
          h('li', {}, `نافذة زمنية قصيرة يفرضها الخادم (حاليًا ${s.endMin - s.startMin || '—'} دقيقة).`),
          h('li', {}, 'تنبيه «جهاز مشترك» إذا سُجّل أكثر من معلم من هاتف واحد.'),
          h('li', {}, s.requireDailyCode ? '✅ «رمز اليوم» مفعّل.' : 'اختياري: تفعيل «رمز اليوم» من الإعدادات (يُعلن في الساحة).'),
          h('li', {}, s.geo?.mode && s.geo.mode !== 'off' ? '✅ التحقق من الموقع مفعّل.' : 'اختياري: تفعيل التحقق من الموقع الجغرافي من الإعدادات.')))),
  );
}

function downloadPng(box) {
  const svg = box.querySelector('svg');
  if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => downloadFile('qr-checkin.png', b));
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}
