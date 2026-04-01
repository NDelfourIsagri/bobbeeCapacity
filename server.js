/**
 * bobbee Capacity Planner — Backend
 * Node.js + Express + MySQL + JWT
 */

const express = require('express');
const mysql   = require('mysql2/promise');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));

// ── Sert le frontend (www/) ─────────────────────────────
app.use(express.static(path.join(__dirname, 'www')));

// ── Pool MySQL ──────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
});

// ── Middleware auth JWT ─────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token invalide' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { fname, lname, email, pwd } = req.body;
  if (!fname || !lname || !email || !pwd)
    return res.status(400).json({ error: 'Champs manquants' });
  if (pwd.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court' });
  const [rows] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
  if (rows.length) return res.status(409).json({ error: 'Email déjà utilisé' });
  const hash = await bcrypt.hash(pwd, 10);
  const [r] = await pool.query(
    'INSERT INTO users (fname,lname,email,pwd,role) VALUES (?,?,?,?,?)',
    [fname, lname, email, hash, 'consultant']
  );
  const user = { id: r.insertId, fname, lname, email, role: 'consultant' };
  res.json({ token: makeToken(user), user });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, pwd } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
  if (!rows.length) return res.status(401).json({ error: 'Identifiants incorrects' });
  const u = rows[0];
  const ok = await bcrypt.compare(pwd, u.pwd);
  if (!ok) return res.status(401).json({ error: 'Identifiants incorrects' });
  const user = { id: u.id, fname: u.fname, lname: u.lname, email: u.email, role: u.role };
  res.json({ token: makeToken(user), user });
});

// PUT /api/auth/password
app.put('/api/auth/password', auth, async (req, res) => {
  const { current, next } = req.body;
  const [rows] = await pool.query('SELECT pwd FROM users WHERE id=?', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!await bcrypt.compare(current, rows[0].pwd))
    return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  if (next.length < 6) return res.status(400).json({ error: 'Trop court' });
  await pool.query('UPDATE users SET pwd=? WHERE id=?', [await bcrypt.hash(next, 10), req.user.id]);
  res.json({ ok: true });
});

function makeToken(user) {
  return jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// ═══════════════════════════════════════════════════════
// USERS (admin)
// ═══════════════════════════════════════════════════════

app.get('/api/users', auth, adminOnly, async (req, res) => {
  const [rows] = await pool.query('SELECT id,fname,lname,email,role,created_at FROM users');
  res.json(rows);
});

app.put('/api/users/:id/role', auth, adminOnly, async (req, res) => {
  const { role } = req.body;
  if (!['admin','consultant'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  await pool.query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// TEAM (membres)
// ═══════════════════════════════════════════════════════

app.get('/api/team', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM team ORDER BY position ASC');
  res.json(rows);
});

app.post('/api/team', auth, adminOnly, async (req, res) => {
  const { fname, lname, role, level, know, adapt, meetings } = req.body;
  const [max] = await pool.query('SELECT COALESCE(MAX(position),0)+1 as pos FROM team');
  const pos = max[0].pos;
  const [r] = await pool.query(
    'INSERT INTO team (fname,lname,role,level,know,adapt,meetings,position) VALUES (?,?,?,?,?,?,?,?)',
    [fname, lname, role, level, know||70, adapt||80, meetings||20, pos]
  );
  const [rows] = await pool.query('SELECT * FROM team WHERE id=?', [r.insertId]);
  res.json(rows[0]);
});

app.put('/api/team/:id', auth, adminOnly, async (req, res) => {
  const { fname, lname, role, level, know, adapt, meetings } = req.body;
  await pool.query(
    'UPDATE team SET fname=?,lname=?,role=?,level=?,know=?,adapt=?,meetings=? WHERE id=?',
    [fname, lname, role, level, know, adapt, meetings, req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/team/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM team WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// PUT /api/team/reorder  body: { ids: [1,3,2,...] }
app.put('/api/team/reorder', auth, adminOnly, async (req, res) => {
  const { ids } = req.body;
  await Promise.all(ids.map((id, i) =>
    pool.query('UPDATE team SET position=? WHERE id=?', [i, id])
  ));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// CONFIG (grilles vélocité / réunions)
// ═══════════════════════════════════════════════════════

app.get('/api/config', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT cfg_key, cfg_value FROM config');
  const out = {};
  rows.forEach(r => { try { out[r.cfg_key] = JSON.parse(r.cfg_value); } catch { out[r.cfg_key] = r.cfg_value; } });
  res.json(out);
});

app.put('/api/config/:key', auth, adminOnly, async (req, res) => {
  const val = JSON.stringify(req.body.value);
  await pool.query(
    'INSERT INTO config (cfg_key,cfg_value) VALUES (?,?) ON DUPLICATE KEY UPDATE cfg_value=?',
    [req.params.key, val, val]
  );
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// SPRINTS
// ═══════════════════════════════════════════════════════

app.get('/api/sprints', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM sprints ORDER BY start_date DESC');
  rows.forEach(r => { r.objectives = JSON.parse(r.objectives || '[]'); });
  res.json(rows);
});

app.post('/api/sprints', auth, adminOnly, async (req, res) => {
  const { name, start, end, velocityPlanned, confidence, objectives } = req.body;
  const [r] = await pool.query(
    'INSERT INTO sprints (name,start_date,end_date,velocity_planned,confidence,objectives) VALUES (?,?,?,?,?,?)',
    [name, start, end, velocityPlanned||0, confidence||0, JSON.stringify(objectives||[])]
  );
  res.json({ id: r.insertId });
});

app.put('/api/sprints/:id', auth, adminOnly, async (req, res) => {
  const { name, start, end, velocityPlanned, velocityCurrent, velocityActual, confidence, objectives, closed } = req.body;
  await pool.query(
    `UPDATE sprints SET name=?,start_date=?,end_date=?,velocity_planned=?,
     velocity_current=?,velocity_actual=?,confidence=?,objectives=?,closed=? WHERE id=?`,
    [name, start, end, velocityPlanned, velocityCurrent||null, velocityActual||null,
     confidence, JSON.stringify(objectives||[]), closed?1:0, req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/sprints/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM sprints WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// LEAVES (congés)
// ═══════════════════════════════════════════════════════

app.get('/api/leaves', auth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  if (isAdmin) {
    const [rows] = await pool.query('SELECT * FROM leaves ORDER BY leave_date ASC');
    return res.json(rows.map(dbToLeave));
  }
  // consultant : uniquement ses propres congés (via email → team)
  const [tm] = await pool.query('SELECT id FROM team WHERE email=?', [req.user.email]);
  if (!tm.length) return res.json([]);
  const [rows] = await pool.query('SELECT * FROM leaves WHERE team_id=? ORDER BY leave_date ASC', [tm[0].id]);
  res.json(rows.map(dbToLeave));
});

// POST /api/leaves  body: { memberId, date, type, reason }
app.post('/api/leaves', auth, async (req, res) => {
  const { memberId, date, type, reason } = req.body;
  // check permission
  if (req.user.role !== 'admin') {
    const [tm] = await pool.query('SELECT id FROM team WHERE email=?', [req.user.email]);
    if (!tm.length || tm[0].id != memberId)
      return res.status(403).json({ error: 'Accès refusé' });
  }
  // upsert (replace if same member+date)
  await pool.query(
    'INSERT INTO leaves (team_id,leave_date,leave_type,reason) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE leave_type=?,reason=?',
    [memberId, date, type, reason||'', type, reason||'']
  );
  res.json({ ok: true });
});

// DELETE /api/leaves  body: { ids: [...] }
app.delete('/api/leaves', auth, async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.json({ ok: true });
  if (req.user.role !== 'admin') {
    const [tm] = await pool.query('SELECT id FROM team WHERE email=?', [req.user.email]);
    if (!tm.length) return res.status(403).json({ error: 'Accès refusé' });
    // only own leaves
    await pool.query(
      `DELETE FROM leaves WHERE id IN (${ids.map(()=>'?').join(',')}) AND team_id=?`,
      [...ids, tm[0].id]
    );
    return res.json({ ok: true });
  }
  await pool.query(`DELETE FROM leaves WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
  res.json({ ok: true });
});

function dbToLeave(r) {
  return { id: r.id, memberId: r.team_id, date: r.leave_date, type: r.leave_type, reason: r.reason };
}

// ── Fallback SPA ────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'www', 'capa', 'index.html')));

// ── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`bobbee backend running on :${PORT}`));