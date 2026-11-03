// =====================================================================
//  إعدادات ربط الموقع بمشروع Firebase
//
//  انسخي القيم من: Firebase Console ← ⚙️ إعدادات المشروع (Project settings)
//  ← تبويب General ← قسم "Your apps" ← تطبيق الويب (</>) ← SDK setup and configuration ← Config
//
//  ملاحظة أمنية مهمة: هذه القيم ليست كلمات مرور ولا مفاتيح سرية؛ Firebase صمّمها
//  لتكون ظاهرة في كود الواجهة. الحماية الفعلية للبيانات تتم عبر:
//    1) تسجيل الدخول (Firebase Authentication)
//    2) قواعد الأمان (firestore.rules)
//  لا تضعي هنا أبدًا أي "Service Account" أو مفتاح خاص (private key).
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCYHnEoVbgnjxbmgiwVFG-X8wt7lTntiZA",
  authDomain: "smart-b4fe9.firebaseapp.com",
  projectId: "smart-b4fe9",
  storageBucket: "smart-b4fe9.firebasestorage.app",
  messagingSenderId: "769520001525",
  appId: "1:769520001525:web:bea3a05dc29c5a742d80bc"
};

// الاسم الافتراضي (يمكن تغييره لاحقًا من الإعدادات داخل لوحة الإدارة)
export const DEFAULT_SCHOOL_NAME = "مدرسة الطالب الذكي الخاصة";
