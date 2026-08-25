# RepairDesk — ระบบแจ้งซ่อม (Supabase + GitHub Pages)

แอปแจ้งซ่อม/บำรุงรักษาเครื่องจักร ย้ายจาก Google Apps Script + Google Sheets
มาเป็น **หน้าเว็บ static (index.html)** ที่คุยกับ **Supabase (Postgres)** โดยตรงจาก
เบราว์เซอร์ และโฮสต์ผ่าน **GitHub Pages** (deploy อัตโนมัติทุกครั้งที่ push ขึ้น
branch `main` ด้วย GitHub Actions)

ไม่มีระบบ login — ใครมีลิงก์ก็เข้าดู/แจ้งซ่อม/แก้ไขข้อมูลได้ทันที เหมือนแอปเดิม

## โครงสร้างโปรเจกต์

```
index.html              หน้าเว็บแอปทั้งหมด (UI + logic)
config.js                ค่า Supabase Project URL + anon key (public, ปลอดภัยที่จะฝังใน frontend)
supabase/schema.sql       สคีมาฐานข้อมูล + trigger + Row Level Security
.github/workflows/deploy.yml   GitHub Actions สำหรับ deploy ขึ้น GitHub Pages
legacy/                   ไฟล์แอปเวอร์ชันเดิม (Google Apps Script) เก็บไว้อ้างอิง
```

## 1) ตั้งค่า Supabase

1. เปิดโปรเจกต์ Supabase ของคุณ > **SQL Editor**
2. คัดลอกเนื้อหาไฟล์ [`supabase/schema.sql`](supabase/schema.sql) ทั้งหมด วางแล้วกด Run
   (สร้างตาราง `jobs`, `machines`, `techs`, `job_timeline`, `settings`,
   `pm_checklists`, `pm_schedules`, `pm_records` พร้อม trigger สร้างรหัสอัตโนมัติ
   (`RD-0001`, `TC-001`) และ Row Level Security แบบเปิดสาธารณะ ให้ตรงพฤติกรรม
   แอปเดิม — ไฟล์นี้ **รันซ้ำได้เสมอ** โดยไม่ลบข้อมูลเดิม ดังนั้นเวลามีตารางใหม่
   เพิ่มเข้ามา (เช่นตอนเพิ่มฟีเจอร์ PM) แค่รันทั้งไฟล์อีกครั้งก็พอ)
3. ไปที่ **Project Settings > API** คัดลอก **Project URL** และ **anon public key**
4. แก้ไฟล์ [`config.js`](config.js) ใส่ค่าทั้งสอง:
   ```js
   window.SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   window.SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
   ค่า anon key เป็นคีย์สาธารณะโดยออกแบบ (ปลอดภัยที่จะฝังใน frontend) —
   การควบคุมสิทธิ์เข้าถึงจริงอยู่ที่ RLS policy ใน schema.sql ไม่ใช่การซ่อนคีย์นี้
   **ห้ามใช้ `service_role` key ใน frontend เด็ดขาด**

## 2) ทดสอบก่อน deploy (ทางเลือก)

เปิด `index.html` ตรง ๆ ในเบราว์เซอร์ได้เลย (ไม่ต้องมี build step) หรือรันเซิร์ฟเวอร์
ในเครื่อง:
```bash
npx serve .
```

## 3) Push ขึ้น GitHub

```bash
git init
git add .
git commit -m "Migrate RepairDesk from Google Apps Script to Supabase"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

## 4) เปิดใช้งาน GitHub Pages

ใน repo บน GitHub: **Settings > Pages > Build and deployment > Source**
เลือก **GitHub Actions** (ไม่ใช่ "Deploy from a branch") — เวิร์กโฟลว์ที่มากับ repo
(`.github/workflows/deploy.yml`) จะ deploy อัตโนมัติทุกครั้งที่ push ขึ้น `main`
หลัง deploy เสร็จ จะได้ลิงก์รูปแบบ `https://<username>.github.io/<repo>/`

## PM เครื่องจักร (Preventive Maintenance)

ระบบ PM ในเว็บใช้โมเดลเดียวที่ยืดหยุ่นแทนฟอร์มกระดาษหลายแบบของเดิม: ตั้ง
**เช็คลิสต์แม่แบบ** (รายการตรวจของเครื่องแต่ละประเภท) → ผูกกับเครื่องจักรเป็น
**แผนงาน PM** พร้อมความถี่ (รายวัน/รายสัปดาห์/รายเดือน) → เมื่อครบกำหนด
หน้า "PM เครื่องจักร" จะแจ้งเตือน กดตรวจ ติ๊กรายการ ระบบจะเลื่อนวันครบกำหนด
ครั้งถัดไปให้อัตโนมัติ (ผลตรวจที่พบปัญหาจะถูกบันทึกไว้ในประวัติเฉยๆ ไม่ได้สร้าง
ใบแจ้งซ่อมอัตโนมัติ — ถ้าต้องซ่อม ให้เปิดใบแจ้งซ่อมเองตามปกติ)

หลังรัน `schema.sql` แล้ว ให้เพิ่มชุดเช็คลิสต์เริ่มต้น (ดึงมาจากฟอร์ม PM กระดาษ
เดิม — โฟล์คลิฟท์, รถตัก, เครน, แพล้น, ปั๊มลม, เครื่องดึงลวด, เครื่องจักรทั่วไป ฯลฯ)
ด้วยคำสั่งเดียว (รันซ้ำได้ ไม่สร้างซ้ำ):
```bash
node scripts/seed-pm-checklists.mjs
```
จากนั้นเข้าเมนู "PM เครื่องจักร" ในเว็บ กด "เพิ่มแผนงาน" เพื่อผูกเช็คลิสต์แต่ละชุด
เข้ากับเครื่องจักรจริงและตั้งความถี่ตามที่ต้องการ

## ความปลอดภัย / ข้อควรระวัง

- แอปนี้**ไม่มีระบบ login** — ใครก็ตามที่รู้ลิงก์เว็บและมี anon key (ซึ่งฝังอยู่ใน
  โค้ด frontend ที่ทุกคนเห็นได้) สามารถอ่าน/เพิ่ม/แก้ไข/ลบข้อมูลได้ทั้งหมด
  พฤติกรรมเดียวกับแอป Google Apps Script เดิม
- ถ้าต้องการจำกัดสิทธิ์ในอนาคต ให้เปิดใช้ **Supabase Auth** แล้วแก้ไข RLS policy
  ใน `supabase/schema.sql` จาก `using (true)` เป็นเงื่อนไขอิงสิทธิ์ผู้ใช้ เช่น
  `using (auth.role() = 'authenticated')`
