require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const cron = require('node-cron');
const dayjs = require('dayjs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, 'storage');
const DB_DIR = path.join(STORAGE_DIR, 'db');
const REPORTS_DIR = path.join(STORAGE_DIR, 'reports');
const FACES_DIR = path.join(STORAGE_DIR, 'faces');
const PROFILES_DIR = path.join(STORAGE_DIR, 'profiles');
const LOGO_PATH = path.join(ROOT, 'public', 'assets', 'jimmy-logo.jpg');
const FACE_PHOTO_RETENTION_DAYS = Number(process.env.FACE_PHOTO_RETENTION_DAYS || 40);
const FACE_VERIFY_MODE = process.env.FACE_VERIFY_MODE || 'manual';
const STORE_RADIUS_M = Number(process.env.STORE_RADIUS_M || 500);

for (const dir of [STORAGE_DIR, DB_DIR, REPORTS_DIR, FACES_DIR, PROFILES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(path.join(DB_DIR, 'jimmy.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/storage', express.static(STORAGE_DIR));
app.use(express.static(path.join(ROOT, 'public')));

function nowIso() {
  return new Date().toISOString();
}

function slugCode(value) {
  return String(value || 'store')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || `STORE-${Date.now()}`;
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      employee_code TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','manager','worker')),
      active INTEGER NOT NULL DEFAULT 1,
      assigned_store_id INTEGER,
      face_image_path TEXT,
      profile_image_path TEXT,
      last_login_at TEXT,
      last_logout_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (assigned_store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_group TEXT NOT NULL DEFAULT 'General',
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      latitude REAL NOT NULL DEFAULT 0,
      longitude REAL NOT NULL DEFAULT 0,
      radius_m INTEGER NOT NULL DEFAULT 500,
      location_locked INTEGER NOT NULL DEFAULT 0,
      location_captured_by INTEGER,
      location_captured_at TEXT,
      opening_time TEXT NOT NULL DEFAULT '10:00',
      closing_time TEXT NOT NULL DEFAULT '22:00',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      name TEXT,
      category TEXT,
      default_price REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      check_in_time TEXT NOT NULL,
      check_out_time TEXT,
      check_in_lat REAL,
      check_in_lng REAL,
      check_in_accuracy REAL,
      check_out_lat REAL,
      check_out_lng REAL,
      check_out_accuracy REAL,
      in_face_score REAL,
      out_face_score REAL,
      in_location_status TEXT,
      out_location_status TEXT,
      check_in_distance_m INTEGER,
      check_out_distance_m INTEGER,
      in_location_warning INTEGER NOT NULL DEFAULT 0,
      out_location_warning INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      total_work_minutes INTEGER DEFAULT 0,
      in_face_image_path TEXT,
      out_face_image_path TEXT,
      in_face_review_status TEXT NOT NULL DEFAULT 'pending',
      out_face_review_status TEXT,
      in_face_reviewed_by INTEGER,
      out_face_reviewed_by INTEGER,
      in_face_reviewed_at TEXT,
      out_face_reviewed_at TEXT,
      face_review_notes TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (worker_id) REFERENCES users(id),
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS daily_sales_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_id INTEGER UNIQUE NOT NULL,
      worker_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      report_date TEXT NOT NULL,
      total_customers INTEGER NOT NULL DEFAULT 0,
      converted_customers INTEGER NOT NULL DEFAULT 0,
      conversion_rate REAL NOT NULL DEFAULT 0,
      total_qty INTEGER NOT NULL DEFAULT 0,
      total_value REAL NOT NULL DEFAULT 0,
      logout_time TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (attendance_id) REFERENCES attendance(id),
      FOREIGN KEY (worker_id) REFERENCES users(id),
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );

    CREATE TABLE IF NOT EXISTS daily_sales_report_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      daily_sales_report_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name_snapshot TEXT NOT NULL,
      unit_price_snapshot REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 0,
      value REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (daily_sales_report_id) REFERENCES daily_sales_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS monthly_attendance_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT UNIQUE NOT NULL,
      worker_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      total_present_days INTEGER NOT NULL DEFAULT 0,
      total_absent_days INTEGER NOT NULL DEFAULT 0,
      late_count INTEGER NOT NULL DEFAULT 0,
      early_checkout_count INTEGER NOT NULL DEFAULT 0,
      total_work_minutes INTEGER NOT NULL DEFAULT 0,
      overtime_minutes INTEGER NOT NULL DEFAULT 0,
      total_sales_qty INTEGER NOT NULL DEFAULT 0,
      total_sales_value REAL NOT NULL DEFAULT 0,
      location_warning_count INTEGER NOT NULL DEFAULT 0,
      pdf_url TEXT NOT NULL,
      pdf_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'locked',
      generated_at TEXT NOT NULL,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(worker_id, month, year),
      FOREIGN KEY (worker_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attendance_correction_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id INTEGER NOT NULL,
      attendance_id INTEGER NOT NULL,
      requested_reason TEXT NOT NULL,
      requested_check_in TEXT,
      requested_check_out TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      approved_by INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (worker_id) REFERENCES users(id),
      FOREIGN KEY (attendance_id) REFERENCES attendance(id)
    );

    CREATE TABLE IF NOT EXISTS login_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('login','logout')),
      event_time TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}


function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureMigrations() {
  ensureColumn('attendance', 'in_face_review_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn('attendance', 'out_face_review_status', 'TEXT');
  ensureColumn('attendance', 'in_face_reviewed_by', 'INTEGER');
  ensureColumn('attendance', 'out_face_reviewed_by', 'INTEGER');
  ensureColumn('attendance', 'in_face_reviewed_at', 'TEXT');
  ensureColumn('attendance', 'out_face_reviewed_at', 'TEXT');
  ensureColumn('attendance', 'face_review_notes', 'TEXT');
  ensureColumn('attendance', 'check_in_distance_m', 'INTEGER');
  ensureColumn('attendance', 'check_out_distance_m', 'INTEGER');
  ensureColumn('attendance', 'in_location_warning', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('attendance', 'out_location_warning', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'profile_image_path', 'TEXT');
  ensureColumn('users', 'last_login_at', 'TEXT');
  ensureColumn('users', 'last_logout_at', 'TEXT');
  ensureColumn('stores', 'store_group', "TEXT NOT NULL DEFAULT 'General'");
  ensureColumn('stores', 'location_locked', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('stores', 'location_captured_by', 'INTEGER');
  ensureColumn('stores', 'location_captured_at', 'TEXT');
  ensureColumn('monthly_attendance_reports', 'location_warning_count', 'INTEGER NOT NULL DEFAULT 0');
}

function seedDb() {
  const storeCount = db.prepare('SELECT COUNT(*) AS count FROM stores').get().count;
  if (storeCount === 0) {
    const ts = nowIso();
    const insertStore = db.prepare(`INSERT INTO stores (store_group, name, code, latitude, longitude, radius_m, opening_time, closing_time, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    insertStore.run('OASIS MALL', 'EMAX OASIS MALL', 'EMAX-OASIS-MALL', 0, 0, STORE_RADIUS_M, '10:00', '22:00', ts, ts);
    insertStore.run('OASIS MALL', 'Sharaf DG Oasis Mall', 'SHARAFDG-OASIS-MALL', 0, 0, STORE_RADIUS_M, '10:00', '22:00', ts, ts);
    insertStore.run('General', 'Jimmy Demo Store', 'JIMMY-DEMO', 0, 0, STORE_RADIUS_M, '10:00', '22:00', ts, ts);
  }

  const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (productCount === 0) {
    const products = [
      ['PW 11 Pro Max', 'PW 11 Pro Max', 'Vacuum / Washer', 0, 1],
      ['PW 11 Pro', 'PW 11 Pro', 'Vacuum / Washer', 0, 2],
      ['PW 11', 'PW 11', 'Vacuum / Washer', 0, 3],
      ['JV9 Pro Aqua', 'JV9 Pro Aqua', 'Vacuum Cleaner', 0, 4],
      ['H10 Flex', 'H10 Flex', 'Vacuum Cleaner', 0, 5],
      ['H9 Pro', 'H9 Pro', 'Vacuum Cleaner', 0, 6],
      ['JV 35', 'JV 35', 'Vacuum Cleaner', 0, 7],
      ['BX6 Lite', 'BX6 Lite', 'Cleaning Product', 0, 8],
      ['BX8', 'BX8', 'Cleaning Product', 0, 9],
      ['BX7 Pro', 'BX7 Pro', 'Cleaning Product', 0, 10],
      ['F8 Hair Dryer', 'F8 Hair Dryer', 'Hair Care', 0, 11],
      ['HF9', 'HF9 Hair Multi Styler', 'Hair Care', 0, 12],
      ['F7', 'F7', 'Hair Care', 0, 13]
    ];
    const insertProduct = db.prepare(`INSERT INTO products (model, name, category, default_price, active, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)`);
    const ts = nowIso();
    products.forEach(p => insertProduct.run(p[0], p[1], p[2], p[3], p[4], ts, ts));
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    const storeId = db.prepare('SELECT id FROM stores LIMIT 1').get().id;
    const insertUser = db.prepare(`INSERT INTO users (name, email, phone, employee_code, password_hash, role, active, assigned_store_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
    const ts = nowIso();
    insertUser.run('Jimmy Admin', process.env.ADMIN_EMAIL || `admin-${crypto.randomBytes(4).toString('hex')}@local.invalid`, '', process.env.ADMIN_ID || 'ADMIN-001', bcrypt.hashSync(process.env.ADMIN_PASSWORD || crypto.randomBytes(24).toString('hex'), 10), 'admin', storeId, ts, ts);
    insertUser.run('Demo Merchandiser', process.env.WORKER_EMAIL || `merchandiser-${crypto.randomBytes(4).toString('hex')}@local.invalid`, '', process.env.WORKER_ID || 'EMP-001', bcrypt.hashSync(process.env.WORKER_PASSWORD || crypto.randomBytes(24).toString('hex'), 10), 'worker', storeId, ts, ts);
  }
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
}

function locationWarningCountForUser(userId) {
  const row = db.prepare(`SELECT COALESCE(SUM(COALESCE(in_location_warning,0) + COALESCE(out_location_warning,0)),0) AS count FROM attendance WHERE worker_id = ?`).get(userId);
  return Number(row?.count || 0);
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    employee_code: user.employee_code,
    assigned_store_id: user.assigned_store_id,
    face_enrolled: Boolean(user.face_image_path),
    profile_image_path: user.profile_image_path || null,
    last_login_at: user.last_login_at || null,
    last_logout_at: user.last_logout_at || null,
    location_warning_count: user.role === 'worker' ? locationWarningCountForUser(user.id) : 0
  };
}

function recordLoginEvent(userId, type, req) {
  const ts = nowIso();
  db.prepare(`INSERT INTO login_events (user_id, event_type, event_time, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, type, ts, req.ip || '', req.headers['user-agent'] || '', ts);
  if (type === 'login') db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, userId);
  if (type === 'logout') db.prepare('UPDATE users SET last_logout_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, userId);
  return ts;
}

function storeNeedsLocation(store) {
  return !Number(store.location_locked) || (Number(store.latitude || 0) === 0 && Number(store.longitude || 0) === 0);
}

function captureStoreLocationIfNeeded(store, userId, lat, lng) {
  if (!storeNeedsLocation(store)) return { store, captured: false };
  const ts = nowIso();
  db.prepare(`UPDATE stores SET latitude = ?, longitude = ?, radius_m = ?, location_locked = 1, location_captured_by = ?, location_captured_at = ?, updated_at = ? WHERE id = ?`)
    .run(Number(lat), Number(lng), STORE_RADIUS_M, userId, ts, ts, store.id);
  return { store: { ...store, latitude: Number(lat), longitude: Number(lng), radius_m: STORE_RADIUS_M, location_locked: 1, location_captured_by: userId, location_captured_at: ts }, captured: true };
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, phone, employee_code, role, active, assigned_store_id, face_image_path, profile_image_path, last_login_at, last_logout_at FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'User is not active or does not exist.' });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or manager permission required.' });
  }
  next();
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = v => (Number(v) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function saveDataUrlImage(dataUrl, prefix) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('A valid camera image is required.');
  }
  const matches = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!matches) throw new Error('Only PNG or JPG images are accepted.');
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const filePath = path.join(FACES_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
  return `/storage/faces/${filename}`;
}

function manualSelfieSubmission(user, capturedPath) {
  // Free manual mode: the system captures a store-background selfie and lets admin review it from the backend.
  // This is not automated biometric face recognition.
  return {
    passed: true,
    score: null,
    provider: FACE_VERIFY_MODE,
    review_status: 'pending',
    message: 'Selfie submitted for manual admin review.'
  };
}

function statusBadgeText(status) {
  const s = status || 'pending';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function storageUrlToPath(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('/storage/')) return null;
  return path.join(ROOT, url.replace(/^\//, ''));
}

function cleanupFaceImages(days = FACE_PHOTO_RETENTION_DAYS) {
  const cutoff = Date.now() - Number(days || 40) * 24 * 60 * 60 * 1000;
  const attendanceRows = db.prepare('SELECT id, in_face_image_path, out_face_image_path, in_face_review_status, out_face_review_status FROM attendance').all();
  const updateAttendancePath = db.prepare('UPDATE attendance SET in_face_image_path = ?, out_face_image_path = ?, in_face_review_status = ?, out_face_review_status = ?, updated_at = ? WHERE id = ?');
  for (const row of attendanceRows) {
    let inPath = row.in_face_image_path;
    let outPath = row.out_face_image_path;
    let inStatus = row.in_face_review_status || 'pending';
    let outStatus = row.out_face_review_status || null;
    let changed = false;
    for (const side of ['in', 'out']) {
      const url = side === 'in' ? inPath : outPath;
      const filePath = storageUrlToPath(url);
      if (!filePath) continue;
      let shouldRemove = false;
      try {
        const stat = fs.statSync(filePath);
        shouldRemove = stat.mtimeMs < cutoff;
      } catch {
        shouldRemove = true;
      }
      if (shouldRemove) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        if (side === 'in') {
          inPath = null;
          if (inStatus === 'pending') inStatus = 'expired';
        } else {
          outPath = null;
          if (outStatus === 'pending') outStatus = 'expired';
        }
        changed = true;
      }
    }
    if (changed) updateAttendancePath.run(inPath, outPath, inStatus, outStatus, nowIso(), row.id);
  }

  const users = db.prepare('SELECT id, face_image_path FROM users WHERE face_image_path IS NOT NULL').all();
  const clearUserFace = db.prepare('UPDATE users SET face_image_path = NULL, updated_at = ? WHERE id = ?');
  for (const user of users) {
    const filePath = storageUrlToPath(user.face_image_path);
    if (!filePath) continue;
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        try { fs.unlinkSync(filePath); } catch {}
        clearUserFace.run(nowIso(), user.id);
      }
    } catch {
      clearUserFace.run(nowIso(), user.id);
    }
  }

  try {
    for (const filename of fs.readdirSync(FACES_DIR)) {
      const filePath = path.join(FACES_DIR, filename);
      if (!fs.statSync(filePath).isFile()) continue;
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  } catch {}
}

function calculateLocation(store, lat, lng, accuracy) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
    throw new Error('Current location is required. Please allow GPS/location permission.');
  }
  const radius = Number(store.radius_m || STORE_RADIUS_M);
  const distance = haversineMeters(store.latitude, store.longitude, safeLat, safeLng);
  const withinRange = distance <= radius;
  return {
    passed: withinRange,
    warning: !withinRange,
    distance_m: Math.round(distance),
    allowed_radius_m: radius,
    status: withinRange ? 'passed' : 'warning'
  };
}

function minutesBetween(startIso, endIso) {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isLate(checkInIso, openingTime) {
  const d = dayjs(checkInIso);
  const [h, m] = openingTime.split(':').map(Number);
  const opening = d.hour(h).minute(m).second(0).millisecond(0);
  return d.isAfter(opening.add(15, 'minute'));
}

function isEarlyCheckout(checkOutIso, closingTime) {
  if (!checkOutIso) return false;
  const d = dayjs(checkOutIso);
  const [h, m] = closingTime.split(':').map(Number);
  const closing = d.hour(h).minute(m).second(0).millisecond(0);
  return d.isBefore(closing.subtract(15, 'minute'));
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function formatMinutes(mins) {
  const h = Math.floor(Number(mins || 0) / 60);
  const m = Number(mins || 0) % 60;
  return `${h}h ${m}m`;
}

async function generateWorkerMonthlyReport(workerId, month, year) {
  const worker = db.prepare('SELECT * FROM users WHERE id = ?').get(workerId);
  if (!worker) throw new Error('Merchandiser not found.');
  const start = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month');
  const end = start.endOf('month');
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const rows = db.prepare(`
    SELECT a.*, s.name AS store_name, s.store_group, s.opening_time, s.closing_time,
      ds.total_customers, ds.converted_customers, ds.total_qty, ds.total_value, ds.conversion_rate
    FROM attendance a
    JOIN stores s ON s.id = a.store_id
    LEFT JOIN daily_sales_reports ds ON ds.attendance_id = a.id
    WHERE a.worker_id = ? AND a.check_in_time >= ? AND a.check_in_time <= ?
    ORDER BY a.check_in_time ASC
  `).all(workerId, startIso, endIso);

  const presentDates = new Set(rows.map(r => dayjs(r.check_in_time).format('YYYY-MM-DD')));
  const presentDays = presentDates.size;
  const scheduledDays = daysInMonth(Number(year), Number(month));
  const absentDays = Math.max(0, scheduledDays - presentDays);
  const lateCount = rows.filter(r => isLate(r.check_in_time, r.opening_time || '10:00')).length;
  const earlyCount = rows.filter(r => isEarlyCheckout(r.check_out_time, r.closing_time || '22:00')).length;
  const totalWorkMinutes = rows.reduce((sum, r) => sum + Number(r.total_work_minutes || 0), 0);
  const standardMinutes = presentDays * 8 * 60;
  const overtimeMinutes = Math.max(0, totalWorkMinutes - standardMinutes);
  const totalSalesQty = rows.reduce((sum, r) => sum + Number(r.total_qty || 0), 0);
  const totalSalesValue = rows.reduce((sum, r) => sum + Number(r.total_value || 0), 0);
  const locationWarningCount = rows.reduce((sum, r) => sum + Number(r.in_location_warning || 0) + Number(r.out_location_warning || 0), 0);

  const reportId = `ATT-${year}-${String(month).padStart(2, '0')}-${String(workerId).padStart(5, '0')}`;
  const filename = `${reportId}.pdf`;
  const filePath = path.join(REPORTS_DIR, filename);
  const verifyUrl = `${APP_URL}/verify-report/${reportId}`;

  await new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 38 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      if (fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, 38, 24, { width: 135 });
      }
      doc.fontSize(18).text('Jimmy', 200, 38, { align: 'right' });
      doc.fontSize(15).text('Monthly Attendance Verification Report', 38, 105, { align: 'center' });
      doc.moveDown(1.3);
      doc.fontSize(9).fillColor('#444').text(`Report ID: ${reportId}`);
      doc.text(`Report Month: ${start.format('MMMM YYYY')}`);
      doc.text(`Generated Date: ${dayjs().format('DD MMMM YYYY, hh:mm A')}`);
      doc.text(`Verification URL: ${verifyUrl}`);
      doc.moveDown();
      doc.fillColor('#000').fontSize(11).text('Merchandiser Details', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(9).text(`Merchandiser Name: ${worker.name}`);
      doc.text(`Merchandiser ID: ${worker.employee_code || worker.id}`);
      doc.text(`Email: ${worker.email}`);
      doc.moveDown();

      doc.fontSize(11).text('Monthly Summary', { underline: true });
      doc.moveDown(0.3);
      const summary = [
        ['Scheduled Days', scheduledDays],
        ['Present Days', presentDays],
        ['Absent Days', absentDays],
        ['Late Check-ins', lateCount],
        ['Early Check-outs', earlyCount],
        ['Total Working Hours', formatMinutes(totalWorkMinutes)],
        ['Overtime', formatMinutes(overtimeMinutes)],
        ['Total Sales Quantity', totalSalesQty],
        ['Total Sales Value', totalSalesValue.toFixed(2)],
        ['Location Warnings', locationWarningCount]
      ];
      summary.forEach(([k, v]) => doc.fontSize(9).text(`${k}: ${v}`));
      doc.moveDown();

      doc.fontSize(11).text('Detailed Attendance', { underline: true });
      doc.moveDown(0.4);
      const headerY = doc.y;
      doc.fontSize(8).text('Date', 38, headerY, { width: 65 });
      doc.text('Store', 103, headerY, { width: 100 });
      doc.text('Check In', 203, headerY, { width: 65 });
      doc.text('Check Out', 268, headerY, { width: 65 });
      doc.text('Hours', 333, headerY, { width: 55 });
      doc.text('Selfie', 388, headerY, { width: 50 });
      doc.text('Location', 438, headerY, { width: 58 });
      doc.text('Sales', 496, headerY, { width: 58 });
      doc.moveTo(38, headerY + 13).lineTo(555, headerY + 13).stroke();
      doc.y = headerY + 18;

      rows.forEach(r => {
        if (doc.y > 735) {
          doc.addPage();
          doc.fontSize(11).text('Detailed Attendance Continued', { underline: true });
          doc.moveDown(0.5);
        }
        const y = doc.y;
        doc.fontSize(7.5).text(dayjs(r.check_in_time).format('DD MMM'), 38, y, { width: 65 });
        doc.text(`${r.store_group ? `${r.store_group} / ` : ''}${r.store_name || ''}`, 103, y, { width: 100 });
        doc.text(dayjs(r.check_in_time).format('hh:mm A'), 203, y, { width: 65 });
        doc.text(r.check_out_time ? dayjs(r.check_out_time).format('hh:mm A') : '-', 268, y, { width: 65 });
        doc.text(formatMinutes(r.total_work_minutes || 0), 333, y, { width: 55 });
        doc.text(`${statusBadgeText(r.in_face_review_status)} / ${r.out_face_review_status ? statusBadgeText(r.out_face_review_status) : '-'}`, 388, y, { width: 50 });
        doc.text(`${r.in_location_status || '-'} / ${r.out_location_status || '-'}${(Number(r.in_location_warning||0)+Number(r.out_location_warning||0)) ? ' *' : ''}`, 438, y, { width: 58 });
        doc.text(`${Number(r.total_qty || 0)} / ${Number(r.total_value || 0).toFixed(2)}`, 496, y, { width: 58 });
        doc.y = y + 17;
      });

      doc.moveDown();
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 105 });
      const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      const footerY = Math.min(doc.y + 18, 690);
      doc.image(qrBuffer, 38, footerY, { width: 85 });
      doc.fontSize(8).fillColor('#444').text('Scan the QR code to verify this report online.', 135, footerY + 8, { width: 360 });
      doc.text('This report was generated automatically by the Jimmy attendance system.', 135, footerY + 22, { width: 360 });
      doc.text('Developer: www.kestford.com', 135, footerY + 36, { width: 360 });
      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });

  const pdfHash = hashFile(filePath);
  const pdfUrl = `/storage/reports/${filename}`;
  const ts = nowIso();
  db.prepare(`
    INSERT INTO monthly_attendance_reports
      (report_id, worker_id, month, year, total_present_days, total_absent_days, late_count, early_checkout_count,
       total_work_minutes, overtime_minutes, total_sales_qty, total_sales_value, location_warning_count, pdf_url, pdf_hash, status, generated_at, locked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'locked', ?, ?, ?, ?)
    ON CONFLICT(worker_id, month, year) DO UPDATE SET
      total_present_days=excluded.total_present_days,
      total_absent_days=excluded.total_absent_days,
      late_count=excluded.late_count,
      early_checkout_count=excluded.early_checkout_count,
      total_work_minutes=excluded.total_work_minutes,
      overtime_minutes=excluded.overtime_minutes,
      total_sales_qty=excluded.total_sales_qty,
      total_sales_value=excluded.total_sales_value,
      location_warning_count=excluded.location_warning_count,
      pdf_url=excluded.pdf_url,
      pdf_hash=excluded.pdf_hash,
      status='locked',
      generated_at=excluded.generated_at,
      locked_at=excluded.locked_at,
      updated_at=excluded.updated_at
  `).run(reportId, workerId, month, year, presentDays, absentDays, lateCount, earlyCount,
    totalWorkMinutes, overtimeMinutes, totalSalesQty, totalSalesValue, locationWarningCount, pdfUrl, pdfHash, ts, ts, ts, ts);

  return db.prepare('SELECT * FROM monthly_attendance_reports WHERE report_id = ?').get(reportId);
}

async function generateMonthlyReports(month, year, workerId = null) {
  const workers = workerId
    ? db.prepare("SELECT * FROM users WHERE id = ? AND role = 'worker'").all(workerId)
    : db.prepare("SELECT * FROM users WHERE role = 'worker' AND active = 1").all();
  const reports = [];
  for (const worker of workers) {
    reports.push(await generateWorkerMonthlyReport(worker.id, Number(month), Number(year)));
  }
  return reports;
}

app.post('/api/auth/login', (req, res) => {
  const { identifier, email, password } = req.body || {};
  const loginId = String(identifier || email || '').trim();
  if (!loginId || !password) return res.status(400).json({ error: 'Staff/Admin ID and password are required.' });
  const normalizedId = loginId.toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ? OR lower(employee_code) = ?').get(normalizedId, normalizedId);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid login details.' });
  }
  if (!user.active) return res.status(403).json({ error: 'This account is inactive.' });
  recordLoginEvent(user.id, 'login', req);
  const freshUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ token: signToken(freshUser), user: serializeUser(freshUser) });
});

app.post('/api/auth/logout', auth, (req, res) => {
  const loggedOutAt = recordLoginEvent(req.user.id, 'logout', req);
  res.json({ ok: true, logged_out_at: loggedOutAt });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: serializeUser(user) });
});

app.post('/api/profile/photo', auth, (req, res) => {
  try {
    const imagePath = saveDataUrlImage(req.body.image, `profile-user-${req.user.id}`);
    db.prepare('UPDATE users SET profile_image_path = ?, updated_at = ? WHERE id = ?').run(imagePath, nowIso(), req.user.id);
    res.json({ ok: true, profile_image_path: imagePath });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/products', auth, (req, res) => {
  res.json({ products: db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY display_order ASC, model ASC').all() });
});

app.get('/api/stores', auth, (req, res) => {
  let stores;
  if (req.user.role === 'worker' && req.user.assigned_store_id) {
    stores = db.prepare('SELECT * FROM stores WHERE active = 1 AND id = ?').all(req.user.assigned_store_id);
  } else {
    stores = db.prepare('SELECT * FROM stores WHERE active = 1 ORDER BY name ASC').all();
  }
  res.json({ stores });
});

app.post('/api/worker/face/enroll', auth, (req, res) => {
  if (req.user.role !== 'worker') return res.status(403).json({ error: 'Only merchandisers can enroll their face from merchandiser dashboard.' });
  try {
    const imagePath = saveDataUrlImage(req.body.image, `enroll-worker-${req.user.id}`);
    db.prepare('UPDATE users SET face_image_path = ?, updated_at = ? WHERE id = ?').run(imagePath, nowIso(), req.user.id);
    res.json({ ok: true, face_image_path: imagePath });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/worker/attendance/open', auth, (req, res) => {
  const open = db.prepare(`SELECT a.*, s.name AS store_name FROM attendance a JOIN stores s ON s.id = a.store_id WHERE a.worker_id = ? AND a.status = 'open' ORDER BY a.id DESC LIMIT 1`).get(req.user.id);
  res.json({ attendance: open || null });
});

app.get('/api/worker/attendance', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, s.name AS store_name, s.store_group, ds.total_customers, ds.converted_customers, ds.total_qty, ds.total_value
    FROM attendance a
    JOIN stores s ON s.id = a.store_id
    LEFT JOIN daily_sales_reports ds ON ds.attendance_id = a.id
    WHERE a.worker_id = ?
    ORDER BY a.check_in_time DESC LIMIT 80
  `).all(req.user.id);
  res.json({ attendance: rows });
});

app.post('/api/attendance/check-in', auth, (req, res) => {
  if (req.user.role !== 'worker') return res.status(403).json({ error: 'Only merchandisers can check in.' });
  const { store_id, latitude, longitude, accuracy, image } = req.body || {};
  const open = db.prepare("SELECT id FROM attendance WHERE worker_id = ? AND status = 'open'").get(req.user.id);
  if (open) return res.status(409).json({ error: 'You already have an open check-in. Please check out first.' });
  const store = db.prepare('SELECT * FROM stores WHERE id = ? AND active = 1').get(store_id);
  if (!store) return res.status(400).json({ error: 'Invalid store.' });
  if (req.user.assigned_store_id && Number(req.user.assigned_store_id) !== Number(store.id)) {
    return res.status(403).json({ error: 'This merchandiser is not assigned to the selected store.' });
  }
  try {
    const imagePath = saveDataUrlImage(image, `checkin-worker-${req.user.id}`);
    const capture = captureStoreLocationIfNeeded(store, req.user.id, latitude, longitude);
    const location = calculateLocation(capture.store, latitude, longitude, accuracy);
    if (capture.captured) {
      location.status = 'captured';
      location.warning = false;
      location.passed = true;
      location.distance_m = 0;
      location.store_location_captured = true;
    }
    const face = manualSelfieSubmission(req.user, imagePath);
    const ts = nowIso();
    const info = db.prepare(`
      INSERT INTO attendance (worker_id, store_id, check_in_time, check_in_lat, check_in_lng, check_in_accuracy,
        in_face_score, in_location_status, check_in_distance_m, in_location_warning, status, in_face_image_path, in_face_review_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 'pending', ?, ?)
    `).run(req.user.id, store.id, ts, latitude, longitude, accuracy || null, face.score, location.status, location.distance_m, location.warning ? 1 : 0, imagePath, ts, ts);
    res.json({ ok: true, attendance_id: info.lastInsertRowid, check_in_time: ts, face, location });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/attendance/check-out', auth, (req, res) => {
  if (req.user.role !== 'worker') return res.status(403).json({ error: 'Only merchandisers can check out.' });
  const { latitude, longitude, accuracy, image, total_customers, converted_customers, items } = req.body || {};
  const open = db.prepare(`
    SELECT a.*, s.latitude AS store_lat, s.longitude AS store_lng, s.radius_m, s.name AS store_name, s.location_locked, s.location_captured_by, s.location_captured_at
    FROM attendance a JOIN stores s ON s.id = a.store_id
    WHERE a.worker_id = ? AND a.status = 'open'
    ORDER BY a.id DESC LIMIT 1
  `).get(req.user.id);
  if (!open) return res.status(404).json({ error: 'No open check-in found.' });
  const store = { id: open.store_id, latitude: open.store_lat, longitude: open.store_lng, radius_m: open.radius_m, location_locked: open.location_locked, location_captured_by: open.location_captured_by, location_captured_at: open.location_captured_at };
  try {
    const imagePath = saveDataUrlImage(image, `checkout-worker-${req.user.id}`);
    const capture = captureStoreLocationIfNeeded(store, req.user.id, latitude, longitude);
    const location = calculateLocation(capture.store, latitude, longitude, accuracy);
    if (capture.captured) {
      location.status = 'captured';
      location.warning = false;
      location.passed = true;
      location.distance_m = 0;
      location.store_location_captured = true;
    }
    const face = manualSelfieSubmission(req.user, imagePath);

    const safeItems = Array.isArray(items) ? items : [];
    let totalQty = 0;
    let totalValue = 0;
    const preparedItems = [];
    for (const item of safeItems) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
      if (!product) continue;
      const qty = Math.max(0, Number.parseInt(item.quantity || 0, 10));
      const unitPrice = Number(item.unit_price ?? product.default_price ?? 0);
      const value = Number((qty * unitPrice).toFixed(2));
      totalQty += qty;
      totalValue += value;
      preparedItems.push({ product, qty, unitPrice, value });
    }
    const customers = Math.max(0, Number.parseInt(total_customers || 0, 10));
    const converted = Math.max(0, Number.parseInt(converted_customers || 0, 10));
    const conversionRate = customers > 0 ? Number(((converted / customers) * 100).toFixed(2)) : 0;
    const checkoutTime = nowIso();
    const workMinutes = minutesBetween(open.check_in_time, checkoutTime);

    const updateTx = db.transaction(() => {
      db.prepare(`
        UPDATE attendance SET check_out_time = ?, check_out_lat = ?, check_out_lng = ?, check_out_accuracy = ?,
          out_face_score = ?, out_location_status = ?, check_out_distance_m = ?, out_location_warning = ?, status = 'closed', total_work_minutes = ?, out_face_image_path = ?, out_face_review_status = 'pending', updated_at = ?
        WHERE id = ?
      `).run(checkoutTime, latitude, longitude, accuracy || null, face.score, location.status, location.distance_m, location.warning ? 1 : 0, workMinutes, imagePath, checkoutTime, open.id);

      const reportInfo = db.prepare(`
        INSERT INTO daily_sales_reports (attendance_id, worker_id, store_id, report_date, total_customers, converted_customers,
          conversion_rate, total_qty, total_value, logout_time, submitted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(open.id, req.user.id, open.store_id, dayjs(checkoutTime).format('YYYY-MM-DD'), customers, converted, conversionRate,
        totalQty, totalValue, dayjs(checkoutTime).format('HH:mm'), checkoutTime, checkoutTime, checkoutTime);

      const insertItem = db.prepare(`
        INSERT INTO daily_sales_report_items (daily_sales_report_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, value, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of preparedItems) {
        insertItem.run(reportInfo.lastInsertRowid, row.product.id, row.product.model, row.unitPrice, row.qty, row.value, checkoutTime, checkoutTime);
      }
    });
    updateTx();
    res.json({ ok: true, check_out_time: checkoutTime, total_work_minutes: workMinutes, total_qty: totalQty, total_value: totalValue, conversion_rate: conversionRate, face, location });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/worker/reports/monthly', auth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM monthly_attendance_reports WHERE worker_id = ? ORDER BY year DESC, month DESC`).all(req.user.id);
  res.json({ reports: rows });
});

app.get('/api/reports/:reportId/download', auth, (req, res) => {
  const report = db.prepare('SELECT * FROM monthly_attendance_reports WHERE report_id = ?').get(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (req.user.role === 'worker' && Number(report.worker_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'You can only download your own reports.' });
  }
  const fullPath = path.join(ROOT, report.pdf_url.replace(/^\//, ''));
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'PDF file missing from storage.' });
  res.download(fullPath);
});

app.get('/verify-report/:reportId', (req, res) => {
  const report = db.prepare(`
    SELECT mr.*, u.name AS worker_name, u.employee_code
    FROM monthly_attendance_reports mr JOIN users u ON u.id = mr.worker_id
    WHERE mr.report_id = ?
  `).get(req.params.reportId);
  if (!report) {
    return res.status(404).send('<h1>Report not found</h1><p>This report ID does not exist.</p>');
  }
  const fullPath = path.join(ROOT, report.pdf_url.replace(/^\//, ''));
  const currentHash = fs.existsSync(fullPath) ? hashFile(fullPath) : null;
  const valid = currentHash === report.pdf_hash;
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify Report</title>
<style>body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;padding:35px;color:#111}.card{max-width:760px;background:#fff;margin:auto;padding:28px;border-radius:18px;box-shadow:0 10px 30px #0001}.valid{color:#087a2e}.bad{color:#b00020}img{width:160px;background:#050505;border-radius:12px;padding:10px}</style></head>
<body><div class="card"><img src="/assets/jimmy-logo.jpg" alt="Jimmy logo"><h1>Attendance Report Verification</h1>
<p><strong>Report ID:</strong> ${report.report_id}</p><p><strong>Merchandiser:</strong> ${report.worker_name} (${report.employee_code || report.worker_id})</p>
<p><strong>Month:</strong> ${String(report.month).padStart(2, '0')}/${report.year}</p><p><strong>Status:</strong> <span class="${valid ? 'valid' : 'bad'}">${valid ? 'Valid and not modified' : 'Invalid or modified'}</span></p>
<p><strong>Generated:</strong> ${dayjs(report.generated_at).format('DD MMM YYYY, hh:mm A')}</p><p><strong>Developer:</strong> www.kestford.com</p></div></body></html>`);
});

// Admin APIs
app.get('/api/admin/users', auth, requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.employee_code, u.role, u.active, u.assigned_store_id, u.face_image_path, u.profile_image_path, u.last_login_at, u.last_logout_at, s.name AS store_name, s.store_group, COALESCE((SELECT SUM(COALESCE(in_location_warning,0) + COALESCE(out_location_warning,0)) FROM attendance a WHERE a.worker_id = u.id),0) AS location_warning_count
    FROM users u LEFT JOIN stores s ON s.id = u.assigned_store_id ORDER BY u.created_at DESC`).all();
  res.json({ users: rows });
});

app.post('/api/admin/users', auth, requireAdmin, (req, res) => {
  const { name, email, password, phone, employee_code, role, assigned_store_id, profile_image } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  const safeRole = ['admin', 'manager', 'worker'].includes(role) ? role : 'worker';
  try {
    const ts = nowIso();
    let profileImagePath = null;
    if (profile_image) profileImagePath = saveDataUrlImage(profile_image, `profile-user-new`);
    const info = db.prepare(`INSERT INTO users (name, email, phone, employee_code, password_hash, role, active, assigned_store_id, profile_image_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(name, String(email).toLowerCase().trim(), phone || '', employee_code || null, bcrypt.hashSync(password, 10), safeRole, assigned_store_id || null, profileImagePath, ts, ts);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/admin/users/:id', auth, requireAdmin, (req, res) => {
  const { name, phone, employee_code, role, assigned_store_id, active, password, profile_image } = req.body || {};
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'User not found.' });
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries({ name, phone, employee_code, role, assigned_store_id, active })) {
    if (value !== undefined) { fields.push(`${key} = ?`); values.push(value); }
  }
  if (password) { fields.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10)); }
  if (profile_image) { fields.push('profile_image_path = ?'); values.push(saveDataUrlImage(profile_image, `profile-user-${req.params.id}`)); }
  if (fields.length === 0) return res.json({ ok: true });
  fields.push('updated_at = ?'); values.push(nowIso(), req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (Number(target.id) === Number(req.user.id)) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  db.prepare('UPDATE users SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  res.json({ ok: true, message: 'User deactivated. Old records are preserved.' });
});

app.get('/api/admin/products', auth, requireAdmin, (req, res) => {
  res.json({ products: db.prepare('SELECT * FROM products ORDER BY active DESC, display_order ASC, model ASC').all() });
});

app.post('/api/admin/products', auth, requireAdmin, (req, res) => {
  const { model, name, category, default_price, display_order } = req.body || {};
  if (!model) return res.status(400).json({ error: 'Product model is required.' });
  const ts = nowIso();
  const info = db.prepare(`INSERT INTO products (model, name, category, default_price, active, display_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).run(model, name || model, category || '', Number(default_price || 0), Number(display_order || 0), ts, ts);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/admin/products/:id', auth, requireAdmin, (req, res) => {
  const { model, name, category, default_price, display_order, active } = req.body || {};
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries({ model, name, category, default_price, display_order, active })) {
    if (value !== undefined) { fields.push(`${key} = ?`); values.push(value); }
  }
  if (!fields.length) return res.json({ ok: true });
  fields.push('updated_at = ?'); values.push(nowIso(), req.params.id);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

app.delete('/api/admin/products/:id', auth, requireAdmin, (req, res) => {
  db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  res.json({ ok: true, message: 'Product disabled. Old report history is preserved.' });
});

app.get('/api/admin/stores', auth, requireAdmin, (req, res) => {
  res.json({ stores: db.prepare('SELECT * FROM stores ORDER BY active DESC, store_group ASC, name ASC').all() });
});

app.post('/api/admin/stores', auth, requireAdmin, (req, res) => {
  const { store_group, name, code, latitude, longitude, radius_m, opening_time, closing_time } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Store name is required.' });
  const safeGroup = String(store_group || 'General').trim() || 'General';
  const safeCode = String(code || slugCode(`${safeGroup}-${name}`)).trim();
  const ts = nowIso();
  const hasLocation = latitude !== undefined && longitude !== undefined && String(latitude) !== '' && String(longitude) !== '';
  const info = db.prepare(`INSERT INTO stores (store_group, name, code, latitude, longitude, radius_m, location_locked, opening_time, closing_time, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(safeGroup, name, safeCode, hasLocation ? Number(latitude) : 0, hasLocation ? Number(longitude) : 0, Number(radius_m || STORE_RADIUS_M), hasLocation ? 1 : 0, opening_time || '10:00', closing_time || '22:00', ts, ts);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/admin/stores/:id', auth, requireAdmin, (req, res) => {
  const { store_group, name, code, latitude, longitude, radius_m, opening_time, closing_time, active, location_locked } = req.body || {};
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries({ store_group, name, code, latitude, longitude, radius_m, opening_time, closing_time, active, location_locked })) {
    if (value !== undefined) { fields.push(`${key} = ?`); values.push(value); }
  }
  if (!fields.length) return res.json({ ok: true });
  fields.push('updated_at = ?'); values.push(nowIso(), req.params.id);
  db.prepare(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});


app.patch('/api/admin/attendance/:id/face-review', auth, requireAdmin, (req, res) => {
  const { check_type, status, note } = req.body || {};
  const side = check_type === 'out' ? 'out' : 'in';
  const safeStatus = ['pending', 'approved', 'rejected', 'expired'].includes(status) ? status : null;
  if (!safeStatus) return res.status(400).json({ error: 'Status must be pending, approved, rejected, or expired.' });
  const attendance = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
  if (!attendance) return res.status(404).json({ error: 'Attendance record not found.' });
  const statusColumn = side === 'in' ? 'in_face_review_status' : 'out_face_review_status';
  const reviewedByColumn = side === 'in' ? 'in_face_reviewed_by' : 'out_face_reviewed_by';
  const reviewedAtColumn = side === 'in' ? 'in_face_reviewed_at' : 'out_face_reviewed_at';
  const ts = nowIso();
  const existingNotes = attendance.face_review_notes ? `${attendance.face_review_notes}\n` : '';
  const newNote = `${existingNotes}${dayjs(ts).format('YYYY-MM-DD HH:mm')} ${side.toUpperCase()} selfie ${safeStatus} by ${req.user.name}${note ? `: ${note}` : ''}`;
  db.prepare(`UPDATE attendance SET ${statusColumn} = ?, ${reviewedByColumn} = ?, ${reviewedAtColumn} = ?, face_review_notes = ?, updated_at = ? WHERE id = ?`)
    .run(safeStatus, req.user.id, ts, newNote, ts, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/stores/:id', auth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Store not found.' });
  db.prepare('UPDATE stores SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  res.json({ ok: true, message: 'Store removed from active lists. Old attendance and sales history are preserved.' });
});

app.get('/api/admin/attendance', auth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS worker_name, u.employee_code, s.name AS store_name, s.store_group, ds.total_customers, ds.converted_customers, ds.total_qty, ds.total_value
    FROM attendance a
    JOIN users u ON u.id = a.worker_id
    JOIN stores s ON s.id = a.store_id
    LEFT JOIN daily_sales_reports ds ON ds.attendance_id = a.id
    ORDER BY a.check_in_time DESC LIMIT 300
  `).all();
  res.json({ attendance: rows });
});

app.get('/api/admin/reports/monthly', auth, requireAdmin, (req, res) => {
  const { month, year } = req.query;
  let rows;
  if (month && year) {
    rows = db.prepare(`SELECT mr.*, u.name AS worker_name, u.employee_code FROM monthly_attendance_reports mr JOIN users u ON u.id = mr.worker_id WHERE mr.month = ? AND mr.year = ? ORDER BY u.name`).all(month, year);
  } else {
    rows = db.prepare(`SELECT mr.*, u.name AS worker_name, u.employee_code FROM monthly_attendance_reports mr JOIN users u ON u.id = mr.worker_id ORDER BY mr.year DESC, mr.month DESC, u.name`).all();
  }
  res.json({ reports: rows });
});

app.post('/api/admin/reports/monthly/generate', auth, requireAdmin, async (req, res) => {
  try {
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!month || !year || month < 1 || month > 12) return res.status(400).json({ error: 'Valid month and year are required.' });
    const reports = await generateMonthlyReports(month, year, req.body.worker_id || null);
    res.json({ ok: true, reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

cron.schedule('30 2 * * *', () => {
  try {
    cleanupFaceImages(FACE_PHOTO_RETENTION_DAYS);
    console.log(`Face selfie cleanup finished. Retention: ${FACE_PHOTO_RETENTION_DAYS} days.`);
  } catch (error) {
    console.error('Face selfie cleanup failed:', error);
  }
});

cron.schedule('5 0 1 * *', async () => {
  const previousMonth = dayjs().subtract(1, 'month');
  try {
    await generateMonthlyReports(previousMonth.month() + 1, previousMonth.year());
    console.log('Monthly reports generated successfully.');
  } catch (error) {
    console.error('Monthly report generation failed:', error);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

initDb();
ensureMigrations();
seedDb();
cleanupFaceImages(FACE_PHOTO_RETENTION_DAYS);
app.listen(PORT, () => {
  console.log(`Jimmy attendance system running at ${APP_URL}`);
  console.log('Login credentials are not printed. Use environment variables or the private login note.');
  console.log(`Manual selfie verification is enabled. Selfie retention: ${FACE_PHOTO_RETENTION_DAYS} days.`);
  console.log('Merchandiser credentials are not printed. Use environment variables or the private login note.');
});
