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

## ما الذي يُحفظ
| الجدول | المحتوى |
|---|---|
| `schools` | بيانات المدارس وحالتها، ومن عدّلها آخر مرة ومتى |
| `interactions` | الملاحظات والمكالمات ورسائل واتساب والبريد والزيارات وتغييرات الحالة، مع موعد المتابعة |
| `audit_log` | كل تعديل بقيمته قبل وبعد (للمدير فقط) |
| `team_members` | أعضاء الفريق وصلاحياتهم |

تحديد المدارس للحملة (✓) يبقى خاصاً بكل مستخدم في متصفحه.
