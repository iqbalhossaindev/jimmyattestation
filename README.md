# Jimmy Attendance and Sales System

A complete Node.js website with backend for Jimmy store attendance, sales checkout, manual selfie review, staff profile, location warning tracking, product management, and monthly PDF report generation.

## Main features

- Responsive login page for mobile, tablet, and desktop.
- Staff/Admin ID login.
- Admin dashboard and staff dashboard.
- Admin can add, manage, and remove/deactivate merchandisers.
- Admin can add, group, and remove/deactivate stores by location group or mall, for example OASIS MALL / EMAX OASIS MALL / Sharaf DG.
- User profile with name, profile picture, Staff/Admin ID, and dashboard access.
- Staff check-in/check-out with selfie capture.
- Selfie instruction shown to staff: `Capture a clear selfie with the store background visible.`
- Admin manually approves or rejects check-in/check-out selfies from the backend.
- Store GPS location is captured automatically from the first staff check-in.
- Future check-in/check-out is checked within 0.5 KM / 500 meters.
- Outside-location attempts are recorded as warnings, not silently ignored.
- Location warning count appears in staff profile, admin dashboard, and monthly PDF reports.
- Daily logout sales report with products, quantity, value, total customers, converted customers, and conversion rate.
- Product add/disable management from admin.
- Monthly PDF attendance verification report with Jimmy logo and QR verification link.
- Selfie photos are deleted automatically after 40 days.
- Footer developer detail: www.kestford.com

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open:

```text
http://localhost:3000
```

## Required environment variables for deployment

```env
NODE_ENV=production
PORT=3000
APP_URL=https://your-live-url.onrender.com
JWT_SECRET=change_this_to_a_long_random_secret

ADMIN_ID=ADMIN-001
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_this_password

WORKER_ID=EMP-001
WORKER_EMAIL=staff@example.com
WORKER_PASSWORD=change_this_password

FACE_VERIFY_MODE=manual
FACE_PHOTO_RETENTION_DAYS=40
STORE_RADIUS_M=500
```

## Important production note

This project uses SQLite and local file storage. Free hosting is suitable for demos and testing. For real company attendance, salary, HR records, or long-term storage, move the database to PostgreSQL and photos/PDFs to persistent cloud storage.


## No-sale reason
When staff checks out with zero product quantity sold, the system asks for a professional reason. Admin can view this reason in the attendance and sales table.

## Storage folder upload
The storage folders include `_keep.txt` placeholder files so GitHub can upload the folders.
