// أدوات واجهة مشتركة: إنشاء عناصر آمنة، تنبيهات، نوافذ حوار، تصدير CSV

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** إنشاء عنصر HTML بأمان (النصوص تُدرج كنص، لا كـ HTML) */
// عند بناء الصفحات نمرّر أحيانًا أجزاءً اختيارية قيمتها null؛ المتصفح يطبعها
// كلمة "null". هنا نتجاهلها في replaceChildren و append كما يفعل h().
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['replaceChildren', 'append']) {
    const original = proto[name];
    proto[name] = function (...nodes) {
      return original.apply(this, nodes.flat(Infinity).filter((n) => n != null && n !== false));
    };
  }
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // يُستخدم فقط مع نص ثابت من الكود
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- تنبيهات منبثقة ----------------
let toastBox;
export function toast(msg, type = 'info', ms = 4000) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const t = h('div', { class: `toast toast-${type}` }, msg);
  toastBox.append(t);
  while (toastBox.children.length > 3) toastBox.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------------- نوافذ حوار ----------------
function openDialog(content, { wide = false } = {}) {
  const dlg = h('dialog', { class: 'dlg' + (wide ? ' dlg-wide' : '') }, content);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 50));
  return dlg;
}

export function confirmDialog({ title, message, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const dlg = openDialog(h('form', { method: 'dialog', class: 'dlg-body' },
      h('h3', {}, title),
      message ? h('p', { class: 'muted' }, message) : null,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, cancelText),
        h('button', { type: 'submit', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { result = true; } }, confirmText),
      ),
    ));
    dlg.addEventListener('close', () => resolve(result));
  });
}

/**
 * نموذج إدخال عام.
 * fields: [{ name, label, type, value, required, options:[{value,label}], placeholder, hint, min, max, rows }]
 * validate(values) ⇒ رسالة خطأ أو null
 * onSubmit(values) ⇒ Promise (إن رمت خطأً يظهر داخل النموذج ولا يُغلق)
 */
export function formDialog({ title, intro, fields, submitText = 'حفظ', validate, onSubmit, wide = false }) {
  return new Promise((resolve) => {
    let done = null;
    const err = h('p', { class: 'form-error', role: 'alert' });
    const inputs = {};
    const rows = fields.map((f) => {
      let input;
      const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 7);
      if (f.type === 'select') {
        input = h('select', { id, name: f.name, required: f.required },
          (f.options || []).map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value ?? '') }, o.label)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { id, name: f.name, rows: f.rows || 4, required: f.required, placeholder: f.placeholder || '' });
        input.value = f.value ?? '';
      } else if (f.type === 'checkbox') {
        input = h('input', { id, name: f.name, type: 'checkbox', checked: !!f.value });
        inputs[f.name] = input;
        return h('label', { class: 'check-row', for: id }, input, ' ', f.label);
      } else {
        input = h('input', { id, name: f.name, type: f.type || 'text', required: f.required, placeholder: f.placeholder || '',
          min: f.min, max: f.max, step: f.step, autocomplete: f.autocomplete || 'off', dir: f.dir });
        input.value = f.value ?? '';
      }
      inputs[f.name] = input;
      return h('div', { class: 'field' }, h('label', { for: id }, f.label), input, f.hint ? h('small', { class: 'muted' }, f.hint) : null);
    });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, submitText);
    const form = h('form', { class: 'dlg-body' },
      h('h3', {}, title), intro ? h('p', { class: 'muted' }, intro) : null, rows, err,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'إلغاء'), submit));
    const dlg = openDialog(form, { wide });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = {};
      for (const [k, el] of Object.entries(inputs)) values[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
      const v = validate && validate(values);
      if (v) { err.textContent = v; return; }
      err.textContent = '';
      if (onSubmit) {
        submit.disabled = true; submit.textContent = 'جارٍ الحفظ…';
        try { await onSubmit(values); } catch (ex) { err.textContent = ex.message || String(ex); submit.disabled = false; submit.textContent = submitText; return; }
      }
      done = values; dlg.close();
    });
    dlg.addEventListener('close', () => resolve(done));
  });
}

export function infoDialog({ title, body, wide = false }) {
  return new Promise((resolve) => {
    const dlg = openDialog(h('div', { class: 'dlg-body' }, h('h3', {}, title), body,
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn btn-primary', onclick: () => dlg.close() }, 'إغلاق'))), { wide });
    dlg.addEventListener('close', () => resolve());
  });
}

// ---------------- تصدير ----------------
export function toCSV(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // BOM حتى يعرض Excel الحروف العربية بشكل صحيح
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function setBusy(btn, busy, busyText = 'جارٍ التنفيذ…') {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = busyText; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

export function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : null; }
export function fmtPct(v) { return v == null ? '—' : `${v}%`; }

/** معرّف عشوائي للجهاز يُحفظ في المتصفح لاكتشاف تسجيل عدة معلمين من جهاز واحد */
export function deviceId() {
  try {
    let id = localStorage.getItem('sa_device_id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 24);
      localStorage.setItem('sa_device_id', id);
    }
    return id;
  } catch { return 'no-storage'; }
}

export function randomPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(len); crypto.getRandomValues(arr);
  return [...arr].map((n) => chars[n % chars.length]).join('');
}

export function normalizeArabic(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')       // التشكيل والتطويل
    .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
}
