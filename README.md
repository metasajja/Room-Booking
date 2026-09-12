# ระบบจองห้องประชุม / Meeting Room Booking

ระบบจองห้องประชุมแบบมีฐานข้อมูลกลาง ทุกคนในออฟฟิศเปิดหน้าเว็บเดียวกันแล้วเห็นการจองชุดเดียวกัน
รองรับภาษาไทย/อังกฤษ มุมมองรายวัน/รายเดือน และระบบผู้ดูแลอนุมัติ

## ติดตั้งและรัน (ครั้งแรก)

ต้องมี Node.js 18 ขึ้นไป (ดาวน์โหลดที่ https://nodejs.org)

```bash
npm install
npm start
```

เปิดเบราว์เซอร์ที่ http://localhost:3000

ให้คนอื่นในออฟฟิศเข้าใช้: ดู IP ของเครื่องที่รันเซิร์ฟเวอร์ (เช่น 192.168.1.20) แล้วให้เปิด http://192.168.1.20:3000

## การตั้งค่า (ไม่บังคับ)

ตั้งผ่าน environment variable ก่อนรัน

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `PORT` | 3000 | พอร์ตของเซิร์ฟเวอร์ |
| `ADMIN_PIN` | 1234 | รหัสผู้ดูแลตอนสร้างฐานข้อมูลครั้งแรก (เปลี่ยนได้ในหน้าเว็บภายหลัง) |
| `DB_FILE` | ./bookings.db | ตำแหน่งไฟล์ฐานข้อมูล SQLite |

ตัวอย่าง: `ADMIN_PIN=9876 PORT=8080 npm start`  (Windows PowerShell: `$env:ADMIN_PIN="9876"; npm start`)

แก้รายชื่อห้อง/ความจุ/เวลาทำการ: แก้ค่า `ROOMS`, `OPEN`, `CLOSE` ด้านบนของ `server.js` แล้วรันใหม่

## ข้อมูลเก็บที่ไหน

ทุกอย่างอยู่ในไฟล์ `bookings.db` (SQLite) ข้างไฟล์ `server.js`
สำรองข้อมูล = ก๊อปปี้ไฟล์นี้ไปเก็บ

## รันค้างไว้ตลอด (แนะนำสำหรับใช้งานจริง)

```bash
npm install -g pm2
pm2 start server.js --name room-booking
pm2 save && pm2 startup
```

## API (สำหรับต่อกับระบบอื่น)

| Method | Path | ใช้ทำอะไร |
|---|---|---|
| GET | `/api/rooms` | รายชื่อห้องและเวลาทำการ |
| GET | `/api/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD` | รายการจองในช่วงวันที่ |
| POST | `/api/bookings` | สร้างคำขอจอง (สถานะ pending) |
| PUT | `/api/bookings/:id` | แก้ไข (ทั่วไปแก้ได้เฉพาะ pending) |
| DELETE | `/api/bookings/:id` | ยกเลิก |
| POST | `/api/bookings/:id/status` | ผู้ดูแล: `{status:"approved"|"rejected", adminNote}` |
| POST | `/api/admin/login` | `{pin}` → `{token}` ใช้เป็น `Authorization: Bearer <token>` |
| POST | `/api/admin/pin` | ผู้ดูแล: เปลี่ยนรหัส |

เซิร์ฟเวอร์ตรวจการจองซ้อนและความจุห้องเองทุกครั้ง แม้จะยิง API ตรงก็ไม่จองซ้อนได้
