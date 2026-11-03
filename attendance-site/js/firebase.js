// تهيئة Firebase المشتركة بين جميع الصفحات
import {
  initializeApp, deleteApp,
  initializeAuth, connectAuthEmulator, inMemoryPersistence,
  indexedDBLocalPersistence, browserLocalPersistence,
  createUserWithEmailAndPassword, signOut,
  getFirestore, connectFirestoreEmulator,
} from '../vendor/firebase.js';
import { firebaseConfig } from './firebase-config.js';

export const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

// على الجهاز المحلي (localhost) نستخدم محاكيات Firebase تلقائيًا للتجربة الآمنة،
// إلا إذا أُضيف ?prod إلى الرابط.
export const USE_EMULATORS = IS_LOCAL && !new URLSearchParams(location.search).has('prod');

export const CONFIG_MISSING =
  !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('PASTE') ||
  firebaseConfig.projectId === 'YOUR_PROJECT_ID';

const DEMO_CONFIG = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-smart-assembly.firebaseapp.com',
  projectId: 'demo-smart-assembly',
  appId: 'demo-app',
};

// على المحاكيات نستخدم دائمًا مشروعًا تجريبيًا (demo-) حتى لا يُلمس المشروع الحقيقي
export const activeConfig = USE_EMULATORS ? DEMO_CONFIG : firebaseConfig;

export const app = initializeApp(activeConfig);
// نستخدم الدخول بالبريد وكلمة المرور فقط، لذلك لا نحمّل مكوّنات الدخول عبر Google/النوافذ المنبثقة.
// يبقى المعلم مسجّلًا على هاتفه (تخزين دائم في المتصفح) حتى يسجّل الخروج.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
export const db = getFirestore(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/**
 * إنشاء حساب دخول جديد (معلم أو إداري) دون إخراج المديرة من حسابها.
 * نستخدم نسخة ثانية مؤقتة من تطبيق Firebase بذاكرة مؤقتة فقط، ثم نحذفها.
 * لا يحتاج ذلك إلى أي مفتاح سري.
 */
export async function createLoginAccount(email, password) {
  const tmp = initializeApp(activeConfig, 'account-creator-' + Date.now());
  try {
    const tmpAuth = initializeAuth(tmp, { persistence: inMemoryPersistence });
    if (USE_EMULATORS) connectAuthEmulator(tmpAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const cred = await createUserWithEmailAndPassword(tmpAuth, email, password);
    const uid = cred.user.uid;
    await signOut(tmpAuth);
    return uid;
  } finally {
    await deleteApp(tmp).catch(() => {});
  }
}

/** ترجمة رموز أخطاء Firebase إلى رسائل عربية مفهومة */
export function arabicError(err) {
  const code = (err && (err.code || err.message)) || '';
  const map = {
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/invalid-login-credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/wrong-password': 'كلمة المرور غير صحيحة.',
    'auth/user-not-found': 'لا يوجد حساب بهذا البريد.',
    'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
    'auth/user-disabled': 'هذا الحساب موقوف.',
    'auth/too-many-requests': 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
    'auth/network-request-failed': 'تعذّر الاتصال بالإنترنت.',
    'auth/email-already-in-use': 'يوجد حساب مسجّل بهذا البريد مسبقًا.',
    'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف على الأقل).',
    'auth/requires-recent-login': 'لأسباب أمنية، سجّل الخروج ثم الدخول مرة أخرى وأعد المحاولة.',
    'auth/missing-password': 'أدخل كلمة المرور.',
    'permission-denied': 'رفض الخادم العملية (لا توجد صلاحية أو الشروط غير مستوفاة).',
    'unavailable': 'تعذّر الوصول إلى الخادم. تحقّق من الاتصال بالإنترنت.',
    'failed-precondition': 'العملية تحتاج إلى إعداد إضافي في قاعدة البيانات (مثل فهرس قيد الإنشاء).',
    'deadline-exceeded': 'انتهت مهلة الاتصال بالخادم. أعد المحاولة.',
  };
  for (const k of Object.keys(map)) if (code.includes(k)) return map[k];
  return 'حدث خطأ غير متوقع: ' + (err && err.message ? err.message : String(err));
}
