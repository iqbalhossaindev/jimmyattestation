# Jimmy Attendance and Sales System

This is a complete runnable Node.js website with backend for Jimmy store attendance, sales checkout, product control, manual selfie review, and monthly PDF report generation.

## Included features

- Merchandiser login and admin login using Staff/Admin ID
- Multi-store setup with GPS coordinates and allowed geofence radius
- Free manual selfie verification instead of paid biometric API
- Check-in with store-background selfie capture and GPS verification
- Check-out with store-background selfie capture, GPS verification, and daily sales report
- Admin can manually approve or reject check-in and check-out selfies from the backend
- Selfie photos are automatically deleted after 40 days
- Logout sales report with:
  - Total customer
  - Converted customer
  - Product model
  - Quantity
  - Unit price
  - Total value
  - Logout time
- Admin backend dashboard
- Admin can add merchandisers, managers, admins
- Admin can add stores
- Admin can add, update, disable, and reorder products
- Admin can view all attendance, selfies, selfie review statuses, and sales records
- Merchandiser can view only their own attendance and monthly reports
- Admin can generate monthly attendance verification PDF reports
- Monthly PDF report includes Jimmy logo, summary, detailed attendance, sales totals, manual selfie review status, QR verification, and footer developer details
- Public report verification page using report ID and PDF hash
- Automatic monthly report generation at 12:05 AM on the first day of every month
- Automatic selfie cleanup every day at 2:30 AM

## Important note about face verification

This version does **not** use paid automated face recognition.

The system works like this:

1. Merchandiser captures a clear selfie at check-in.
2. The selfie should show the merchandiser's face and the store background.
3. The system saves the selfie and marks it as `pending`.
4. Admin opens the backend attendance page.
5. Admin views the submitted selfie and manually approves or rejects it.
6. The same process happens again during check-out.
7. Selfie photos are deleted automatically after 40 days.

This is a free manual verification workflow. It is not automated biometric matching or liveness detection.

## Requirements

- Node.js 20 LTS recommended
- npm

## Setup

1. Extract the zip file.
2. Open the folder in terminal.
3. Install dependencies:

```bash
npm install
```

4. Create environment file:

```bash
cp .env.example .env
```

5. Start the website:

```bash
npm start
```

6. Open:

```text
http://localhost:3000
```

## Login credentials

The login page uses **Staff or Admin ID** plus password. Demo credentials are intentionally not written in this project because this folder may be uploaded to GitHub or a hosting provider.

Use the separate private file named:

```text
JIMMY_PRIVATE_LOGIN_NOTE_DO_NOT_UPLOAD.txt
```

Do not upload that private note to GitHub, Koyeb, Render, or any public hosting service.

## First test flow

1. Login as admin.
2. Open Admin Dashboard > Stores.
3. Make sure the demo store latitude and longitude match your testing location, or increase radius for testing.
4. Open Products and set product prices.
5. Login as merchandiser.
6. Start camera.
7. Capture a clear store-background selfie.
8. Click `Get Current Location`.
9. Click `Check In`.
10. Add sales quantity in logout sales form.
11. Capture another clear store-background selfie.
12. Click `Submit Sales, Selfie and Log Out`.
13. Login as admin.
14. Open Attendance.
15. View the check-in and check-out selfie photos.
16. Approve or reject the selfies manually.
17. Open Reports.
18. Select month and year.
19. Click Generate.
20. Download the PDF or open the verify link.

## Storage

- SQLite database: `storage/db/jimmy.sqlite`
- Selfie photos: `storage/faces`
- Generated PDF reports: `storage/reports`

Selfie photos are deleted automatically after 40 days. PDF reports and database records are kept.

Back up the whole `storage` folder regularly if using this outside of a demo environment.

## Environment variables

```text
PORT=3000
APP_URL=http://localhost:3000
JWT_SECRET=replace_with_a_long_random_secret
ADMIN_EMAIL=
ADMIN_PASSWORD=
WORKER_EMAIL=
WORKER_PASSWORD=
FACE_VERIFY_MODE=manual
FACE_PHOTO_RETENTION_DAYS=40
```

## Footer developer details

The website footer and PDF report footer include:

```text
Developer: www.kestford.com
```

## Security recommendations before live use

- Change `JWT_SECRET` in `.env`.
- Change all default passwords.
- Use HTTPS only.
- Keep the private login note offline.
- Add employee consent and privacy notice before collecting selfies.
- Make sure merchandisers know selfies are deleted after 40 days.
- Add role-based permissions based on your business rules.
- Host in a region suitable for your legal and company requirements.
- Keep audit logs for attendance corrections and selfie approvals.
- Do not permanently delete old products used in sales reports. Disable them instead.
