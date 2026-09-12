// Meeting room booking server — Express + SQLite (central database)
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'bookings.db');
const DEFAULT_PIN = process.env.ADMIN_PIN || '1234';
const OPEN = 8, CLOSE = 18; // office hours

const ROOMS = [
  { id: 'r1', th: 'ห้องประชุม 1', en: 'Meeting Room 1', cap: 15, color: '#0F766E' },
  { id: 'r2', th: 'ห้องประชุม 2', en: 'Meeting Room 2', cap: 7,  color: '#2563EB' },
  { id: 'r3', th: 'ห้องประชุม 3', en: 'Meeting Room 3', cap: 4,  color: '#7C3AED' },
  { id: 'r4', th: 'ห้องรับแขก',   en: 'Guest Room',     cap: 4,  color: '#B45309' },
  { id: 'r5', th: 'ห้องอบรม',     en: 'Training Room',  cap: 30, color: '#BE185D' },
];

// ---------- database ----------
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    title TEXT NOT NULL,
    name TEXT NOT NULL,
    dept TEXT DEFAULT '',
    attend INTEGER,
    note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
if (!db.prepare('SELECT 1 FROM settings WHERE key=?').get('admin_pin')) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('admin_pin', hash(DEFAULT_PIN));
}

// ---------- helpers ----------
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = s => /^\d{2}:\d{2}$/.test(s);
const row2json = r => r && ({
  id: r.id, roomId: r.room_id, date: r.date, start: r.start, end: r.end, title: r.title,
  name: r.name, dept: r.dept, attend: r.attend, note: r.note, status: r.status,
  adminNote: r.admin_note, createdAt: r.created_at, updatedAt: r.updated_at,
});
function findConflict(b) {
  return db.prepare(`SELECT * FROM bookings WHERE room_id=? AND date=? AND status!='rejected' AND id!=? AND start<? AND end>?`)
    .get(b.roomId, b.date, b.id || '', b.end, b.start);
}
function validate(b) {
  const room = ROOMS.find(r => r.id === b.roomId);
  if (!room) return 'invalid_room';
  if (!isDate(b.date)) return 'invalid_date';
  if (!isTime(b.start) || !isTime(b.end)) return 'invalid_time';
  if (toMin(b.end) <= toMin(b.start)) return 'end_before_start';
  if (toMin(b.start) < OPEN * 60 || toMin(b.end) > CLOSE * 60) return 'outside_hours';
  if (!b.title || !b.title.trim()) return 'title_required';
  if (!b.name || !b.name.trim()) return 'name_required';
  if (b.attend && Number(b.attend) > room.cap) return 'over_capacity';
  return null;
}

// ---------- admin sessions (in-memory tokens) ----------
const sessions = new Map(); // token -> expiry
const SESSION_MS = 8 * 60 * 60 * 1000;
function isAdmin(req) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  const exp = sessions.get(tok);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(tok); return false; }
  return true;
}
const requireAdmin = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'admin_required' });

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/rooms', (req, res) => res.json({ rooms: ROOMS, open: OPEN, close: CLOSE }));

// list bookings in a date range (inclusive). Rejected ones only visible to admin.
app.get('/api/bookings', (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from/to required (YYYY-MM-DD)' });
  const admin = isAdmin(req);
  const rows = db.prepare(`SELECT * FROM bookings WHERE date BETWEEN ? AND ? ${admin ? '' : "AND status!='rejected'"} ORDER BY date, start`).all(from, to);
  res.json(rows.map(row2json));
});

app.post('/api/bookings', (req, res) => {
  const b = req.body || {};
  const err = validate(b); if (err) return res.status(400).json({ error: err });
  const c = findConflict(b); if (c) return res.status(409).json({ error: 'conflict', conflict: row2json(c) });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO bookings(id,room_id,date,start,end,title,name,dept,attend,note,status,admin_note,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,'pending','',?,?)`)
    .run(id, b.roomId, b.date, b.start, b.end, b.title.trim(), b.name.trim(), (b.dept || '').trim(), b.attend ? Number(b.attend) : null, (b.note || '').trim(), now, now);
  res.status(201).json(row2json(db.prepare('SELECT * FROM bookings WHERE id=?').get(id)));
});

app.put('/api/bookings/:id', (req, res) => {
  const old = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  const admin = isAdmin(req);
  if (!admin && old.status !== 'pending') return res.status(403).json({ error: 'locked' });
  const b = { ...req.body, id: old.id };
  const err = validate(b); if (err) return res.status(400).json({ error: err });
  const c = findConflict(b); if (c) return res.status(409).json({ error: 'conflict', conflict: row2json(c) });
  const status = admin ? old.status : 'pending';
  db.prepare(`UPDATE bookings SET room_id=?,date=?,start=?,end=?,title=?,name=?,dept=?,attend=?,note=?,status=?,admin_note=?,updated_at=? WHERE id=?`)
    .run(b.roomId, b.date, b.start, b.end, b.title.trim(), b.name.trim(), (b.dept || '').trim(), b.attend ? Number(b.attend) : null, (b.note || '').trim(),
         status, admin ? (b.adminNote || '') : old.admin_note, new Date().toISOString(), old.id);
  res.json(row2json(db.prepare('SELECT * FROM bookings WHERE id=?').get(old.id)));
});

app.delete('/api/bookings/:id', (req, res) => {
  const old = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req) && old.status !== 'pending') return res.status(403).json({ error: 'locked' });
  db.prepare('DELETE FROM bookings WHERE id=?').run(old.id);
  res.json({ ok: true });
});

// admin: approve / reject
app.post('/api/bookings/:id/status', requireAdmin, (req, res) => {
  const { status, adminNote = '' } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'bad_status' });
  const old = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  if (status === 'approved') {
    const c = findConflict(row2json(old));
    if (c && c.status === 'approved') return res.status(409).json({ error: 'conflict', conflict: row2json(c) });
  }
  db.prepare('UPDATE bookings SET status=?, admin_note=?, updated_at=? WHERE id=?').run(status, adminNote, new Date().toISOString(), old.id);
  res.json(row2json(db.prepare('SELECT * FROM bookings WHERE id=?').get(old.id)));
});

app.get('/api/admin/pending-count', (req, res) => {
  res.json({ count: db.prepare("SELECT COUNT(*) c FROM bookings WHERE status='pending'").get().c });
});

app.post('/api/admin/login', (req, res) => {
  const pin = String((req.body || {}).pin || '');
  const stored = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_pin').value;
  if (hash(pin) !== stored) return res.status(401).json({ error: 'wrong_pin' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  res.json({ token });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete((req.headers.authorization || '').replace('Bearer ', ''));
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));
app.post('/api/admin/pin', requireAdmin, (req, res) => {
  const pin = String((req.body || {}).pin || '');
  if (pin.length < 4) return res.status(400).json({ error: 'pin_too_short' });
  db.prepare('UPDATE settings SET value=? WHERE key=?').run(hash(pin), 'admin_pin');
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Room booking server running at http://localhost:${PORT}  (db: ${DB_FILE})`));
