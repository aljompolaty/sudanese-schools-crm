# ربط منصة CRM بقاعدة البيانات (Supabase) — المرحلة الأولى

## 1. إنشاء المشروع
1. ادخل إلى https://supabase.com وأنشئ حساباً مجانياً.
2. **New project** ← اسم المشروع: `sudanese-schools-crm` ← المنطقة: أقرب منطقة (مثل Frankfurt).

## 2. إنشاء الجداول وتحميل المدارس
1. من القائمة الجانبية: **SQL Editor** ← **New query**.
2. الصق محتوى `schema.sql` كاملاً ← **Run**.
3. استعلام جديد ← الصق محتوى `seed.sql` ← **Run** (يحمّل الـ 49 مدرسة).

> `schema.sql` يضيف `aljompolaty@gmail.com` كمدير. لتغييره عدّل آخر سطر قبل التشغيل.

## 3. تأمين تسجيل الدخول
1. **Authentication → Sign In / Providers → Email**: أوقف **Allow new users to sign up** (لا يسجّل أحد بنفسه).
2. **Authentication → Users → Add user → Create new user**: أدخل بريدك وكلمة مرور، وفعّل **Auto Confirm User**.

## 4. إضافة أعضاء الفريق
لكل عضو جديد:
1. أنشئ له مستخدماً من **Authentication → Users → Add user**.
2. في **SQL Editor** شغّل:
   ```sql
   insert into team_members (email, full_name, role) values ('member@example.com', 'اسم العضو', 'marketer');
   ```
   (`admin` للمدير: يرى سجل التعديلات ويحذف المدارس — `marketer` للمسوّق).

أي حساب غير موجود في `team_members` لا يرى أي بيانات حتى لو سجّل دخوله.

## 5. ربط الموقع
**Project Settings → API**: انسخ **Project URL** و **anon public key** وضعهما في `config.js`.
لا تضع مفتاح `service_role` أبداً.

## تحديث المرحلة الثانية (لمشروع قائم)
شغّل `phase2.sql` مرة واحدة في **SQL Editor**. يضيف: جداول الحملات، وحالة «تمت المتابعة»، وتحسين سجل التعديلات.
آمن لإعادة التشغيل. (المشروع الجديد يكفيه `setup-all.sql` لأنه يتضمن كل شيء.)

## تحديث المرحلة الثالثة: رابط الفيديو في الحملة
شغّل `phase3.sql` مرة واحدة في **SQL Editor** (يضيف عمود `video_url` للحملات). آمن لإعادة التشغيل.

## إرسال البريد الجماعي (Brevo)
زر «✉️ إرسال بريد للجميع» يرسل عبر دالة على Supabase اسمها `send-campaign-email`. مرة واحدة فقط:

1. **حساب Brevo:** أنشئ حساباً مجانياً على https://www.brevo.com
   - **Senders, Domains & Dedicated IPs → Senders → Add a sender**: أضف البريد الذي سترسل منه وأكّده من الرسالة التي تصلك.
   - **SMTP & API → API Keys → Generate a new API key**: انسخ المفتاح (يظهر مرة واحدة).
2. **إنشاء الدالة في Supabase:** **Edge Functions → Deploy a new function → Via Editor**
   - الاسم بالضبط: `send-campaign-email`
   - احذف الكود الافتراضي والصق محتوى `supabase/functions/send-campaign-email/index.ts` ثم **Deploy**.
3. **الأسرار:** **Edge Functions → Secrets → Add new secret** وأضف:
   | الاسم | القيمة |
   |---|---|
   | `BREVO_API_KEY` | مفتاح Brevo |
   | `SENDER_EMAIL` | البريد الذي أكّدته في Brevo |
   | `SENDER_NAME` | `Experience Media` |

مفتاح Brevo يبقى في الخادم فقط ولا يظهر في الصفحة. الدالة تقرأ بريد كل مدرسة من القاعدة، ولا ترسل إلا لمن سجّل دخوله من فريق العمل.

> للوصول الأفضل إلى صندوق الوارد: الإرسال من بريد على نطاق خاص بك (مثل `info@experience-media.com`) أفضل من Gmail. يمكن إضافة النطاق لاحقاً من Brevo → Domains.

## ما الذي يُحفظ
| الجدول | المحتوى |
|---|---|
| `schools` | بيانات المدارس وحالتها، ومن عدّلها آخر مرة ومتى |
| `interactions` | الملاحظات والمكالمات ورسائل واتساب والبريد والزيارات وتغييرات الحالة، مع موعد المتابعة |
| `audit_log` | كل تعديل بقيمته قبل وبعد (للمدير فقط) |
| `team_members` | أعضاء الفريق وصلاحياتهم |
| `campaigns` | الحملات: الاسم والقناة ونص الرسالة |
| `campaign_targets` | كل مدرسة في كل حملة وحالتها: لم تُرسل، أُرسلت، ردّت، مهتمة، غير مهتمة |

تحديد المدارس للحملة (✓) يبقى خاصاً بكل مستخدم في متصفحه.
