// الصلاحيات الإدارية (للمديرة فقط)
import { doc, writeBatch, serverTimestamp } from '../../vendor/firebase.js';
import { db, createLoginAccount, arabicError } from '../firebase.js';
import { $, h, toast, formDialog, confirmDialog, randomPassword, infoDialog } from '../ui.js';
import { store, subscribe, addAudit } from './store.js';

export const ROLES = {
  owner: { label: 'المديرة (كل الصلاحيات)', short: 'مديرة' },
  admin: { label: 'إداري: إدارة المعلمين والإعدادات والتصحيحات', short: 'إداري' },
  viewer: { label: 'مشاهد: لوحة المتابعة والتقارير فقط', short: 'مشاهد' },
};

let root, unsub;

export function render(container) {
  root = container;
  root.replaceChildren(
    h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, 'المستخدمون والصلاحيات'),
      h('div', { class: 'muted' }, 'من يستطيع فتح لوحة الإدارة وماذا يستطيع أن يفعل.'))),
    h('div', { class: 'toolbar' }, h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-primary', onclick: addNew }, '+ مستخدم إداري جديد'),
      h('button', { class: 'btn btn-outline', onclick: grantTeacher }, 'منح صلاحية لمعلم موجود')),
    h('div', { id: 'uList' }),
    h('section', { class: 'card', style: 'margin-top:1rem' }, h('h3', {}, 'الأدوار'),
      h('ul', {}, Object.values(ROLES).map((r) => h('li', {}, r.label)))),
  );
  unsub = subscribe((w) => { if (w === 'admins') draw(); });
  draw();
}
export function destroy() { unsub?.(); }

function draw() {
  const box = $('#uList'); if (!box) return;
  box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['الاسم', 'البريد', 'الدور', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, store.admins.map((a) => h('tr', {},
      h('td', { style: 'font-weight:500' }, a.name, a.id === store.me.uid ? h('span', { class: 'badge b-gold', style: 'margin-right:.4rem' }, 'أنتِ') : null),
      h('td', { class: 'ltr', style: 'text-align:right' }, a.email || ''),
      h('td', {}, h('span', { class: 'badge' }, ROLES[a.role]?.short || a.role)),
      h('td', {}, a.id === store.me.uid ? h('span', { class: 'muted small' }, 'لا يمكنك تعديل صلاحيتك') : h('div', { class: 'row', style: 'gap:.3rem' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => changeRole(a) }, 'تغيير الدور'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => revoke(a) }, 'سحب الصلاحية'))))))),
  ));
}

const roleOptions = Object.entries(ROLES).map(([value, r]) => ({ value, label: r.label }));

async function writeAdmin(uid, data, action, before = null) {
  const batch = writeBatch(db);
  addAudit(batch, { action, targetId: 'admins/' + uid, targetName: data?.name || before?.name, before, after: data });
  if (data) batch.set(doc(db, 'admins', uid), data); else batch.delete(doc(db, 'admins', uid));
  await batch.commit();
}

async function addNew() {
  let created = null;
  await formDialog({
    title: 'مستخدم إداري جديد',
    fields: [
      { name: 'name', label: 'الاسم', required: true },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email', required: true, dir: 'ltr' },
      { name: 'password', label: 'كلمة مرور مؤقتة', value: randomPassword(12), required: true, dir: 'ltr' },
      { name: 'role', label: 'الدور', type: 'select', value: 'viewer', options: roleOptions },
    ],
    validate: (v) => (v.password.length < 8 ? 'كلمة المرور 8 أحرف على الأقل.' : null),
    onSubmit: async (v) => {
      let uid;
      try { uid = await createLoginAccount(v.email.toLowerCase(), v.password); } catch (ex) { throw new Error(arabicError(ex) + (ex.code === 'auth/email-already-in-use' ? ' — إن كان معلمًا مسجّلًا استخدمي «منح صلاحية لمعلم موجود».' : '')); }
      try {
        await writeAdmin(uid, { name: v.name, email: v.email.toLowerCase(), role: v.role, createdAt: serverTimestamp(), createdBy: store.me.uid, updatedAt: serverTimestamp() }, 'admin.grant');
      } catch (ex) { throw new Error(arabicError(ex)); }
      created = v;
    },
  });
  if (created) infoDialog({ title: 'تم إنشاء الحساب', body: h('div', {}, h('p', {}, 'سلّمي البيانات التالية للمستخدم:'),
    h('p', {}, 'الرابط: ', h('span', { class: 'ltr' }, new URL('admin', location.href).href)), h('p', {}, 'البريد: ', h('span', { class: 'ltr' }, created.email)),
    h('p', {}, 'كلمة المرور: ', h('span', { class: 'kbd' }, created.password))) });
}

async function grantTeacher() {
  const candidates = store.teachers.filter((t) => !store.admins.some((a) => a.id === t.id));
  if (!candidates.length) return toast('لا يوجد معلمون بلا صلاحيات.', 'warn');
  await formDialog({
    title: 'منح صلاحية لمعلم موجود',
    intro: 'يدخل المعلم إلى لوحة الإدارة بنفس بريده وكلمة مروره، ويبقى قادرًا على تسجيل حضوره.',
    fields: [
      { name: 'uid', label: 'المعلم', type: 'select', options: candidates.map((t) => ({ value: t.id, label: t.name })) },
      { name: 'role', label: 'الدور', type: 'select', value: 'viewer', options: roleOptions },
    ],
    onSubmit: async (v) => {
      const t = store.teachers.find((x) => x.id === v.uid);
      try { await writeAdmin(t.id, { name: t.name, email: t.email, role: v.role, createdAt: serverTimestamp(), createdBy: store.me.uid, updatedAt: serverTimestamp() }, 'admin.grant'); }
      catch (ex) { throw new Error(arabicError(ex)); }
    },
  }).then((ok) => ok && toast('تم منح الصلاحية.', 'ok'));
}

async function changeRole(a) {
  await formDialog({
    title: 'تغيير دور ' + a.name,
    fields: [{ name: 'role', label: 'الدور', type: 'select', value: a.role, options: roleOptions }],
    onSubmit: async (v) => {
      const { id, ...before } = a;
      try { await writeAdmin(a.id, { ...before, role: v.role, updatedAt: serverTimestamp() }, 'admin.change', before); }
      catch (ex) { throw new Error(arabicError(ex)); }
    },
  }).then((ok) => ok && toast('تم.', 'ok'));
}

async function revoke(a) {
  const ok = await confirmDialog({ title: `سحب صلاحية ${a.name}؟`, message: 'لن يستطيع فتح لوحة الإدارة. حساب الدخول نفسه يبقى (إن كان معلمًا يستمر في تسجيل حضوره).', confirmText: 'سحب', danger: true });
  if (!ok) return;
  const { id, ...before } = a;
  try { await writeAdmin(a.id, null, 'admin.revoke', before); toast('تم.', 'ok'); } catch (ex) { toast(arabicError(ex), 'bad'); }
}
