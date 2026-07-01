/**
 * bobbee Capacity Planner — Backend
 * Node.js + Express + MySQL + JWT
 */

const express    = require('express');
const mysql      = require('mysql2/promise');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const cors       = require('cors');
const path       = require('path');
const https      = require('https');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ── Mailer ──────────────────────────────────────────────
// Utilise sendmail (binaire local) si SMTP_USER est vide,
// sinon SMTP avec authentification
const _useSmtp = !!process.env.SMTP_USER;
console.log(`[Mailer] transport: ${_useSmtp ? 'SMTP ('+process.env.SMTP_HOST+':'+process.env.SMTP_PORT+')' : 'sendmail'}`);
let mailer;
if (!_useSmtp) {
  // Cherche sendmail dans les emplacements courants
  const fs = require('fs');
  const _smPaths = ['/usr/sbin/sendmail', '/usr/bin/sendmail', '/usr/lib/sendmail', 'sendmail'];
  const _smPath  = _smPaths.find(p => { try { return p === 'sendmail' || fs.existsSync(p); } catch { return false; } }) || 'sendmail';
  console.log(`[Mailer] sendmail path: ${_smPath}`);
  mailer = nodemailer.createTransport({ sendmail: true, newline: 'unix', path: _smPath });
} else {
  mailer = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendResetMail(to, token) {
  const link = `${process.env.APP_URL}/bobbeeCapacity/?token=${token}`;
  await mailer.sendMail({
    from:    process.env.SMTP_FROM,
    to,
    subject: '🐝 bobbee Capacity — Réinitialisation de votre mot de passe',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#fdf8f0;border-radius:16px">
        <div style="text-align:center;margin-bottom:32px">
          <span style="font-size:48px">🐝</span>
          <h1 style="font-size:22px;font-weight:700;color:#ffac10;margin:8px 0 4px">bobbee Capacity</h1>
          <p style="color:#8888aa;font-size:13px;margin:0">Réinitialisation de mot de passe</p>
        </div>
        <p style="color:#1a1a2e;font-size:14px;line-height:1.6">
          Vous avez demandé la réinitialisation de votre mot de passe.<br>
          Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Le lien est valable <strong>1 heure</strong>.
        </p>
        <div style="text-align:center;margin:32px 0">
          <a href="${link}" style="background:#ffac10;color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:600;font-size:15px;display:inline-block">
            Réinitialiser mon mot de passe
          </a>
        </div>
        <p style="color:#8888aa;font-size:12px;text-align:center">
          Si vous n'avez pas fait cette demande, ignorez cet email.<br>
          Ce lien expirera automatiquement dans 1 heure.
        </p>
      </div>
    `,
  });
}

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
  dateStrings: true,
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
  if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
  next();
}
function superAdminOnly(req, res, next) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Accès réservé au Super Admin' });
  next();
}

// Wrap les handlers async pour transmettre les erreurs au middleware global
const aw = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Helpers Jira ────────────────────────────────────────
function jiraRequest(urlPath) {
  return new Promise((resolve, reject) => {
    const token = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    const base  = new URL(process.env.JIRA_BASE_URL);
    const target = new URL(urlPath, process.env.JIRA_BASE_URL);
    const options = {
      hostname: base.hostname,
      path: target.pathname + target.search,
      headers: { 'Authorization': `Basic ${token}`, 'Accept': 'application/json' }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg = parsed.errorMessages?.join(', ') || parsed.message || data.slice(0, 300);
            return reject(new Error(`Jira HTTP ${res.statusCode}: ${msg}`));
          }
          resolve(parsed);
        } catch (e) { reject(new Error('Jira parse error: ' + data.slice(0, 300))); }
      });
    }).on('error', reject);
  });
}

function jiraPost(urlPath, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const token = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    const base   = new URL(process.env.JIRA_BASE_URL);
    const target = new URL(urlPath, process.env.JIRA_BASE_URL);
    const payload = JSON.stringify(body);
    const options = {
      hostname: base.hostname,
      path:     target.pathname + target.search,
      method,
      headers: {
        'Authorization':  `Basic ${token}`,
        'Accept':         'application/json',
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 204 || data.trim() === '') return resolve({});
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg = parsed.errorMessages?.join(', ') || parsed.message || data.slice(0, 300);
            return reject(new Error(`Jira HTTP ${res.statusCode}: ${msg}`));
          }
          resolve(parsed);
        } catch (e) { reject(new Error('Jira parse error: ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Extrait le texte brut d'un nœud Atlassian Document Format (ADF)
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.content) return node.content.map(adfToText).join(' ');
  return '';
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/create', async (req, res) => {
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
  // Associer aux équipes choisies à l'inscription
  const { teamIds } = req.body;
  if (teamIds?.length) {
    await Promise.all(teamIds.map(tid =>
      pool.query('INSERT IGNORE INTO user_teams (user_id, team_id) VALUES (?,?)', [r.insertId, tid])
    ));
  }
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
  const teamIds = await getUserTeamIds(u.id);
  const user = { id: u.id, fname: u.fname, lname: u.lname, email: u.email, role: u.role, teamIds };
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
async function getUserTeamIds(userId) {
  const [rows] = await pool.query(
    'SELECT ut.team_id FROM user_teams ut JOIN teams t ON t.id=ut.team_id WHERE ut.user_id=? ORDER BY t.name ASC',
    [userId]
  );
  return rows.map(r => r.team_id);
}

// GET /api/auth/me — relit le profil depuis la DB et réemet un token frais
app.get('/api/auth/me', auth, aw(async (req, res) => {
  const [rows] = await pool.query('SELECT id,fname,lname,email,role FROM users WHERE id=?', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const u = rows[0];
  const teamIds = await getUserTeamIds(u.id);
  const user = { id: u.id, fname: u.fname, lname: u.lname, email: u.email, role: u.role, teamIds };
  res.json({ token: makeToken(user), user });
}));

// POST /api/auth/forgot — demande de réinitialisation de mot de passe
app.post('/api/auth/forgot', aw(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const [rows] = await pool.query('SELECT id, fname FROM users WHERE email=?', [email.toLowerCase().trim()]);

  // Réponse identique que l'email existe ou non (anti-énumération)
  if (!rows.length) return res.json({ ok: true });

  // Générer un token unique de 32 octets
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // +1h

  // Supprimer les anciennes demandes pour cet utilisateur, puis insérer
  await pool.query('DELETE FROM password_resets WHERE user_id=?', [rows[0].id]);
  await pool.query(
    'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?,?,?)',
    [rows[0].id, token, expires]
  );

  try {
    await sendResetMail(email, token);
  } catch (e) {
    console.error('[Reset] Erreur envoi email:', e.message);
    return res.status(502).json({ error: 'Impossible d\'envoyer l\'email. Vérifiez la configuration SMTP.' });
  }

  res.json({ ok: true });
}));

// POST /api/auth/reset — réinitialisation effective du mot de passe
app.post('/api/auth/reset', aw(async (req, res) => {
  const { token, pwd } = req.body;
  if (!token || !pwd) return res.status(400).json({ error: 'Données manquantes' });
  if (pwd.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères)' });

  // Vérifier le token et son expiration
  const [rows] = await pool.query(
    'SELECT pr.user_id, pr.expires_at, u.fname, u.lname, u.email, u.role FROM password_resets pr JOIN users u ON u.id=pr.user_id WHERE pr.token=?',
    [token]
  );
  if (!rows.length) return res.status(400).json({ error: 'Lien invalide ou déjà utilisé.' });
  if (new Date(rows[0].expires_at) < new Date()) return res.status(400).json({ error: 'Lien expiré. Faites une nouvelle demande.' });

  const u = rows[0];
  const hash = await bcrypt.hash(pwd, 10);

  // Mettre à jour le mot de passe et supprimer le token
  await pool.query('UPDATE users SET pwd=? WHERE id=?', [hash, u.user_id]);
  await pool.query('DELETE FROM password_resets WHERE user_id=?', [u.user_id]);

  // Connecter automatiquement l'utilisateur
  const teamIds = await getUserTeamIds(u.user_id);
  const user = { id: u.user_id, fname: u.fname, lname: u.lname, email: u.email, role: u.role, teamIds };
  res.json({ token: makeToken(user), user });
}));

// GET /api/auth/check-reset-token — vérifie la validité d'un token avant d'afficher le formulaire
app.get('/api/auth/check-reset-token', aw(async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false });
  const [rows] = await pool.query(
    'SELECT expires_at FROM password_resets WHERE token=?', [token]
  );
  if (!rows.length || new Date(rows[0].expires_at) < new Date())
    return res.json({ valid: false });
  res.json({ valid: true });
}));

// ═══════════════════════════════════════════════════════
// USERS (admin)
// ═══════════════════════════════════════════════════════

app.get('/api/users', auth, adminOnly, async (req, res) => {
  if (req.user.role === 'super_admin') {
    // Super admin : tous les utilisateurs sans exception
    const [rows] = await pool.query('SELECT id,fname,lname,email,role,created_at FROM users ORDER BY fname,lname');
    return res.json(rows);
  }
  // Admin : uniquement les utilisateurs partageant au moins une équipe avec lui
  const [rows] = await pool.query(`
    SELECT DISTINCT u.id, u.fname, u.lname, u.email, u.role, u.created_at
    FROM users u
    JOIN user_teams ut ON u.id = ut.user_id
    WHERE ut.team_id IN (SELECT team_id FROM user_teams WHERE user_id = ?)
    ORDER BY u.fname, u.lname
  `, [req.user.id]);
  res.json(rows);
});

app.put('/api/users/:id/role', auth, aw(async (req, res) => {
  const { role } = req.body;
  const callerRole = req.user.role;
  if (!['admin','super_admin'].includes(callerRole)) return res.status(403).json({ error: 'Accès refusé' });
  if (req.params.id == req.user.id) return res.status(400).json({ error: 'Impossible de modifier son propre rôle' });
  // Seul le super_admin peut attribuer le rôle super_admin
  const allowed = callerRole === 'super_admin' ? ['super_admin','admin','consultant'] : ['admin','consultant'];
  if (!allowed.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  await pool.query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
  res.json({ ok: true });
}));

// GET /api/users/:id/teams — équipes visibles pour un utilisateur
app.get('/api/users/:id/teams', auth, adminOnly, aw(async (req, res) => {
  const [rows] = await pool.query('SELECT team_id FROM user_teams WHERE user_id=?', [req.params.id]);
  res.json(rows.map(r => r.team_id));
}));

// PUT /api/users/:id/teams — remplace les équipes d'un utilisateur (admin)
app.put('/api/users/:id/teams', auth, adminOnly, aw(async (req, res) => {
  const { teamIds } = req.body;
  await pool.query('DELETE FROM user_teams WHERE user_id=?', [req.params.id]);
  if (teamIds?.length) {
    await Promise.all(teamIds.map(tid =>
      pool.query('INSERT IGNORE INTO user_teams (user_id, team_id) VALUES (?,?)', [req.params.id, tid])
    ));
  }
  res.json({ ok: true });
}));

app.delete('/api/users/:id', auth, superAdminOnly, aw(async (req, res) => {
  if (req.params.id == req.user.id) return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════
// TEAM (membres)
// ═══════════════════════════════════════════════════════

app.get('/api/team', auth, async (req, res) => {
  const { teamId } = req.query;
  if (teamId) {
    // Retourne tous les membres ayant appartenu à cette équipe + leurs périodes d'affectation
    const [rows] = await pool.query(
      `SELECT t.*, mt.id as mt_id, mt.start_date, mt.end_date
       FROM team t JOIN member_teams mt ON t.id=mt.member_id
       WHERE mt.team_id=? ORDER BY t.position ASC, mt.start_date ASC`,
      [teamId]
    );
    // Regrouper par membre en préservant l'ordre SQL (position ASC)
    // IMPORTANT: ne pas utiliser un objet plain avec clés numériques (tri auto JS)
    const members = [];
    const idx = {};
    for (const r of rows) {
      if (idx[r.id] === undefined) {
        const { mt_id, start_date, end_date, ...member } = r;
        idx[r.id] = members.length;
        members.push({ ...member, teamPeriods: [] });
      }
      members[idx[r.id]].teamPeriods.push({ id: r.mt_id, startDate: r.start_date, endDate: r.end_date });
    }
    return res.json(members);
  }
  const [rows] = await pool.query('SELECT * FROM team ORDER BY position ASC');
  res.json(rows);
});

// GET /api/team/all-with-teams — tous les membres avec leurs équipes actives (page Paramètres)
app.get('/api/team/all-with-teams', auth, aw(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.id, t.fname, t.lname, t.role, t.level, t.meetings, t.velocity,
            t.know, t.adapt, t.country, t.position,
            mt.team_id, te.name AS team_name
     FROM team t
     LEFT JOIN member_teams mt ON t.id = mt.member_id
       AND (mt.end_date IS NULL OR mt.end_date >= CURDATE())
     LEFT JOIN teams te ON te.id = mt.team_id
     ORDER BY t.position ASC, te.name ASC`
  );
  const members = [];
  const idx = {};
  for (const r of rows) {
    if (idx[r.id] === undefined) {
      const { team_id, team_name, ...base } = r;
      idx[r.id] = members.length;
      members.push({ ...base, teams: [] });
    }
    if (r.team_id) members[idx[r.id]].teams.push({ id: r.team_id, name: r.team_name });
  }
  res.json(members);
}));

// GET /api/team/:id/teams — historique d'affectations d'un membre (toutes équipes)
app.get('/api/team/:id/teams', auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT mt.id, mt.team_id as teamId, mt.start_date as startDate, mt.end_date as endDate, t.name as teamName
     FROM member_teams mt JOIN teams t ON t.id=mt.team_id
     WHERE mt.member_id=? ORDER BY mt.start_date DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// PUT /api/team/:id/teams — remplace toutes les affectations d'un membre (admin)
app.put('/api/team/:id/teams', auth, adminOnly, aw(async (req, res) => {
  const { periods } = req.body; // [{teamId, startDate, endDate}]
  await pool.query('DELETE FROM member_teams WHERE member_id=?', [req.params.id]);
  if (periods?.length) {
    await Promise.all(periods.map(p =>
      pool.query('INSERT INTO member_teams (member_id, team_id, start_date, end_date) VALUES (?,?,?,?)',
        [req.params.id, p.teamId, p.startDate || null, p.endDate || null])
    ));
  }
  res.json({ ok: true });
}));

app.post('/api/team', auth, adminOnly, async (req, res) => {
  const { fname, lname, role, level, know, adapt, meetings, velocity, country } = req.body;
  const [max] = await pool.query('SELECT COALESCE(MAX(position),0)+1 as pos FROM team');
  const pos = max[0].pos;
  const [r] = await pool.query(
    'INSERT INTO team (fname,lname,role,level,know,adapt,meetings,velocity,position,country) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [fname, lname, role, level, know||70, adapt||80, meetings||20, velocity??null, pos, country||'FR']
  );
  const [rows] = await pool.query('SELECT * FROM team WHERE id=?', [r.insertId]);
  res.json(rows[0]);
});

// PUT /api/team/reorder  body: { ids: [1,3,2,...] }
app.put('/api/team/reorder', auth, adminOnly, async (req, res) => {
  const { ids } = req.body;
  await Promise.all(ids.map((id, i) =>
    pool.query('UPDATE team SET position=? WHERE id=?', [i, id])
  ));
  res.json({ ok: true });
});

app.put('/api/team/:id', auth, adminOnly, aw(async (req, res) => {
  const { fname, lname, role, level, know, adapt, meetings, velocity, country } = req.body;
  await pool.query(
    'UPDATE team SET fname=?,lname=?,role=?,level=?,know=?,adapt=?,meetings=?,velocity=?,country=? WHERE id=?',
    [fname, lname, role, level, know, adapt, meetings, velocity??null, country||'FR', req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/team/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM team WHERE id=?', [req.params.id]);
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

app.put('/api/config/:key', auth, superAdminOnly, async (req, res) => {
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
  const { teamId } = req.query;
  let rows;
  if (teamId) {
    [rows] = await pool.query(`
      SELECT s.id, s.name, s.start_date, s.end_date, s.closed, s.convergence, s.created_at,
        COALESCE(std.velocity_planned, 0)   AS velocity_planned,
        std.velocity_current,
        std.velocity_actual,
        COALESCE(std.confidence, 0)         AS confidence,
        COALESCE(std.objectives, '[]')      AS objectives
      FROM sprints s
      LEFT JOIN sprint_team_data std ON std.sprint_id = s.id AND std.team_id = ?
      ORDER BY s.start_date DESC
    `, [teamId]);
  } else {
    [rows] = await pool.query('SELECT * FROM sprints ORDER BY start_date DESC');
  }
  rows.forEach(r => { r.objectives = JSON.parse(r.objectives || '[]'); });
  res.json(rows);
});

app.post('/api/sprints', auth, adminOnly, async (req, res) => {
  const { name, start, end, velocityPlanned, confidence, objectives, teamId, convergence } = req.body;
  const [r] = await pool.query(
    'INSERT INTO sprints (name, start_date, end_date, closed, convergence) VALUES (?,?,?,0,?)',
    [name, start, end, convergence !== false ? 1 : 0]
  );
  if (teamId) {
    await pool.query(
      'INSERT INTO sprint_team_data (sprint_id,team_id,velocity_planned,confidence,objectives) VALUES (?,?,?,?,?)',
      [r.insertId, teamId, velocityPlanned||0, confidence||0, JSON.stringify(objectives||[])]
    );
  }
  res.json({ id: r.insertId });
});

app.put('/api/sprints/:id', auth, adminOnly, async (req, res) => {
  const { name, start, end, velocityPlanned, velocityCurrent, velocityActual,
          confidence, objectives, closed, teamId, convergence } = req.body;
  // Mise à jour de la définition partagée
  await pool.query(
    'UPDATE sprints SET name=?, start_date=?, end_date=?, closed=?, convergence=? WHERE id=?',
    [name, start, end, closed?1:0, convergence !== false ? 1 : 0, req.params.id]
  );
  // Upsert des données propres à l'équipe
  if (teamId) {
    await pool.query(`
      INSERT INTO sprint_team_data
        (sprint_id, team_id, velocity_planned, velocity_current, velocity_actual, confidence, objectives)
      VALUES (?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        velocity_planned = VALUES(velocity_planned),
        velocity_current = VALUES(velocity_current),
        velocity_actual  = VALUES(velocity_actual),
        confidence       = VALUES(confidence),
        objectives       = VALUES(objectives)
    `, [req.params.id, teamId, velocityPlanned||0, velocityCurrent||null,
        velocityActual||null, confidence||0, JSON.stringify(objectives||[])]);
  }
  res.json({ ok: true });
});

app.delete('/api/sprints/:id', auth, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM sprint_team_data WHERE sprint_id=?', [req.params.id]);
  await pool.query('DELETE FROM sprints WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// LEAVES (congés)
// ═══════════════════════════════════════════════════════

app.get('/api/leaves', auth, async (_req, res) => {
  // Tout le monde voit tous les congés (lecture) — la restriction porte uniquement sur l'ajout/suppression
  const [rows] = await pool.query('SELECT * FROM leaves ORDER BY leave_date ASC');
  res.json(rows.map(dbToLeave));
});

// POST /api/leaves  body: { memberId, date, type, reason }
app.post('/api/leaves', auth, async (req, res) => {
  const { memberId, date, type, reason } = req.body;
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
  await pool.query(`DELETE FROM leaves WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
  res.json({ ok: true });
});

function dbToLeave(r) {
  return { id: r.id, memberId: r.team_id, date: r.leave_date, type: r.leave_type, reason: r.reason };
}

// ═══════════════════════════════════════════════════════
// API PUBLIQUE — Absences
// GET /bobbeCapacity/api/public/absences
//   ?teamId=X          filtre par équipe (optionnel)
//   ?from=YYYY-MM-DD   date de début (optionnel)
//   ?to=YYYY-MM-DD     date de fin (optionnel)
//
// Réponse : tableau de membres, chacun avec ses absences
// {
//   id, firstName, lastName,
//   absences: [{ date, type, reason }]
// }
// type: "full" = journée entière | "am" = matin | "pm" = après-midi
// ═══════════════════════════════════════════════════════
app.get('/bobbeCapacity/api/public/absences', aw(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { teamId, from, to } = req.query;

  // 1. Récupérer les membres (filtrés par équipe si teamId)
  let memberSql = 'SELECT DISTINCT t.id, t.fname, t.lname FROM team t';
  const memberParams = [];
  if (teamId) {
    memberSql += ' JOIN member_teams mt ON mt.member_id = t.id AND mt.team_id = ?';
    memberParams.push(teamId);
  }
  memberSql += ' ORDER BY t.lname ASC, t.fname ASC';
  const [memberRows] = await pool.query(memberSql, memberParams);

  if (!memberRows.length) return res.json([]);

  // 2. Récupérer les absences (filtrées par membres de l'équipe + plage de dates)
  const memberIds = memberRows.map(m => m.id);
  let leaveSql = `SELECT team_id, leave_date, leave_type, reason
                  FROM leaves
                  WHERE team_id IN (${memberIds.map(() => '?').join(',')})`;
  const leaveParams = [...memberIds];
  if (from) { leaveSql += ' AND leave_date >= ?'; leaveParams.push(from); }
  if (to)   { leaveSql += ' AND leave_date <= ?'; leaveParams.push(to); }
  leaveSql += ' ORDER BY leave_date ASC';
  const [leaveRows] = await pool.query(leaveSql, leaveParams);

  // 3. Grouper par membre
  const leaveMap = new Map();
  for (const l of leaveRows) {
    if (!leaveMap.has(l.team_id)) leaveMap.set(l.team_id, []);
    leaveMap.get(l.team_id).push({
      date:   l.leave_date instanceof Date ? l.leave_date.toISOString().slice(0, 10) : l.leave_date,
      type:   l.leave_type,
      reason: l.reason || ''
    });
  }

  const result = memberRows.map(m => ({
    id:        m.id,
    firstName: m.fname,
    lastName:  m.lname,
    absences:  leaveMap.get(m.id) || []
  }));

  res.json(result);
}));

// ═══════════════════════════════════════════════════════
// TEAMS (entités équipes)
// ═══════════════════════════════════════════════════════

// Route publique pour l'inscription (pas d'auth requise)
app.get('/api/teams/public', async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name FROM teams ORDER BY name ASC');
  res.json(rows);
});

app.get('/api/teams', auth, async (req, res) => {
  if (req.user.role === 'super_admin') {
    const [rows] = await pool.query('SELECT * FROM teams ORDER BY name ASC');
    return res.json(rows);
  }
  // Admin et consultant : uniquement ses équipes assignées (sidebar)
  const [rows] = await pool.query(
    'SELECT t.* FROM teams t JOIN user_teams ut ON t.id=ut.team_id WHERE ut.user_id=? ORDER BY t.name ASC',
    [req.user.id]
  );
  res.json(rows);
});

// Toutes les équipes pour le modal d'affectation membre (admin+)
app.get('/api/teams/all', auth, adminOnly, async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM teams ORDER BY name ASC');
  res.json(rows);
});

app.post('/api/teams', auth, superAdminOnly, aw(async (req, res) => {
  const { name, jiraTeamId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
  const [r] = await pool.query(
    'INSERT INTO teams (name, jira_team_id) VALUES (?,?)',
    [name.trim(), jiraTeamId?.trim() || null]
  );
  res.json({ id: r.insertId, name: name.trim(), jira_team_id: jiraTeamId?.trim() || null });
}));

app.put('/api/teams/:id', auth, adminOnly, aw(async (req, res) => {
  const { name, jiraTeamId, scoringMethod } = req.body;
  const method = scoringMethod === 'rricce' ? 'rricce' : 'rice';
  // L'admin peut uniquement changer la méthode de scoring de son équipe
  // Le super_admin peut aussi renommer l'équipe et changer l'UID Jira
  if (req.user.role !== 'super_admin') {
    await pool.query('UPDATE teams SET scoring_method=? WHERE id=?', [method, req.params.id]);
  } else {
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis' });
    await pool.query(
      'UPDATE teams SET name=?, jira_team_id=?, scoring_method=? WHERE id=?',
      [name.trim(), jiraTeamId?.trim() || null, method, req.params.id]
    );
  }
  res.json({ ok: true });
}));

app.delete('/api/teams/:id', auth, superAdminOnly, aw(async (req, res) => {
  await pool.query('DELETE FROM teams WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════
// BACKLOG (RICE)
// ═══════════════════════════════════════════════════════

app.get('/api/backlog', auth, aw(async (req, res) => {
  const { teamId, source, syncSprints } = req.query;
  if (!teamId) return res.status(400).json({ error: 'teamId requis' });
  let rows;
  if (source) {
    const src = source === 'jira' ? 'jira' : 'manual';
    [rows] = await pool.query(
      'SELECT * FROM backlog WHERE team_id=? AND source=? ORDER BY position ASC, id ASC',
      [teamId, src]
    );
  } else {
    [rows] = await pool.query(
      'SELECT * FROM backlog WHERE team_id=? ORDER BY position ASC, id ASC',
      [teamId]
    );
  }

  // Sync sprint Jira → DB (Jira prioritaire, déclenché par syncSprints=1)
  if (syncSprints === '1' && process.env.JIRA_BASE_URL) {
    const jiraItems = rows.filter(r => r.source === 'jira' && r.jira_id);
    if (jiraItems.length) {
      try {
        const keys = jiraItems.map(r => r.jira_id);
        const jql = `issue in (${keys.map(k => `"${k}"`).join(',')})`;
        const data = await jiraRequest(
          `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=customfield_10020&maxResults=500`
        );
        // Mapping nom sprint → { id, jira_sprint_id } dans notre DB
        const [spRows] = await pool.query('SELECT id, name, jira_sprint_id FROM sprints');
        const spByName = Object.fromEntries(spRows.map(s => [s.name, s]));

        const updates = [];
        for (const issue of (data.issues || [])) {
          const sf = issue.fields?.customfield_10020;
          if (!Array.isArray(sf) || !sf.length) continue;
          const jiraSp = sf.find(s => s.state === 'active') || sf[sf.length - 1];
          if (!jiraSp?.name) continue;
          const sp = spByName[jiraSp.name];
          if (!sp) continue;
          // Stocker l'ID Jira du sprint pour éviter la recherche JQL dans move-sprint
          if (jiraSp.id && sp.jira_sprint_id !== jiraSp.id) {
            updates.push(pool.query('UPDATE sprints SET jira_sprint_id=? WHERE id=?', [jiraSp.id, sp.id]));
            sp.jira_sprint_id = jiraSp.id; // maj en mémoire pour la suite
          }
          const item = rows.find(r => r.jira_id === issue.key);
          // N'écrase que si le sprint n'est pas encore défini dans bobbee
          if (item && item.sprint_id == null) {
            item.sprint_id = sp.id;
            updates.push(pool.query('UPDATE backlog SET sprint_id=? WHERE id=?', [sp.id, item.id]));
          }
        }
        if (updates.length) await Promise.all(updates);
      } catch (e) {
        console.warn('Jira sprint sync:', e.message);
      }
    }
  }

  res.json(rows);
}));

app.post('/api/backlog', auth, adminOnly, aw(async (req, res) => {
  const { teamId, jiraId, label, sprintId, reach, impact, confidence, effort } = req.body;
  if (!teamId) return res.status(400).json({ error: 'teamId requis' });
  const [max] = await pool.query('SELECT COALESCE(MAX(position),0)+1 as pos FROM backlog WHERE team_id=?', [teamId]);
  const pos = max[0].pos;
  const [r] = await pool.query(
    'INSERT INTO backlog (team_id,jira_id,label,sprint_id,reach,impact,confidence,effort,position) VALUES (?,?,?,?,?,?,?,?,?)',
    [teamId, jiraId||'', label||'', sprintId||null, reach||0, impact||0, confidence||0, effort||0, pos]
  );
  const [rows] = await pool.query('SELECT * FROM backlog WHERE id=?', [r.insertId]);
  res.json(rows[0]);
}));

app.put('/api/backlog/:id', auth, adminOnly, aw(async (req, res) => {
  const { jiraId, label, sprintId, reach, impact, confidence, effort, risk, criticality, devValidated } = req.body;

  // Détection de report : sprint déplacé depuis un sprint déjà commencé vers un sprint ultérieur
  const [curRows] = await pool.query('SELECT sprint_id, carry_over_count, original_sprint_id FROM backlog WHERE id=?', [req.params.id]);
  const cur = curRows[0];
  let carryOverCount = cur?.carry_over_count ?? 0;
  let originalSprintId = cur?.original_sprint_id ?? null;

  if (cur && sprintId !== undefined && sprintId !== null && String(cur.sprint_id || '') !== String(sprintId || '')) {
    const oldSprintId = cur.sprint_id;
    const newSprintId = sprintId || null;
    if (oldSprintId && newSprintId) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [spRows] = await pool.query('SELECT id, start FROM sprints WHERE id IN (?, ?)', [oldSprintId, newSprintId]);
      const oldSp = spRows.find(s => String(s.id) === String(oldSprintId));
      const newSp = spRows.find(s => String(s.id) === String(newSprintId));
      if (oldSp && newSp && new Date(oldSp.start) <= today && new Date(newSp.start) > new Date(oldSp.start)) {
        carryOverCount++;
        if (!originalSprintId) originalSprintId = oldSprintId;
      }
    }
  }

  await pool.query(
    'UPDATE backlog SET jira_id=?,label=?,sprint_id=?,reach=?,impact=?,confidence=?,effort=?,risk=?,criticality=?,dev_validated=?,carry_over_count=?,original_sprint_id=? WHERE id=?',
    [jiraId??'', label??'', sprintId||null, reach||0, impact||0, confidence||0, effort||0, risk||0, criticality||0, devValidated?1:0, carryOverCount, originalSprintId, req.params.id]
  );
  res.json({ ok: true, carryOverCount });
}));

// PUT /api/backlog/:id/note — sauvegarde dédiée de la note WYSIWYG
app.put('/api/backlog/:id/note', auth, adminOnly, aw(async (req, res) => {
  const { note } = req.body;
  await pool.query('UPDATE backlog SET note=? WHERE id=?', [note??null, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/backlog/:id', auth, adminOnly, aw(async (req, res) => {
  await pool.query('DELETE FROM backlog WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════
// JIRA SYNC
// ═══════════════════════════════════════════════════════

// POST /api/jira/sync — importe les Features Jira non terminées
// - Identifie le champ Team dynamiquement
// - Matching nom d'équipe insensible à la casse + strip "pôle "
// - Skip si jira_id déjà présent source=manual ; update si source=jira
app.post('/api/jira/sync', auth, adminOnly, aw(async (req, res) => {
  const { teamId } = req.body;
  if (!teamId) return res.status(400).json({ error: 'teamId requis' });

  // 1. Récupérer l'UID Jira de l'équipe active
  const [teamRows] = await pool.query('SELECT name, jira_team_id FROM teams WHERE id=?', [teamId]);
  if (!teamRows.length) return res.status(404).json({ error: 'Équipe introuvable' });
  if (!teamRows[0].jira_team_id)
    return res.status(400).json({ error: `L'équipe "${teamRows[0].name}" n'a pas d'UID Jira configuré. Renseignez-le dans les Paramètres.` });

  const jiraUid = teamRows[0].jira_team_id;

  // 2. Requête Jira filtrée sur l'équipe active via son UID (+ champ sprint)
  const rawJql = `project IN (10259) AND type IN (10467) AND status != "10 - termine" AND "Team[Team]" = "${jiraUid}" ORDER BY created DESC`;
  const data = await jiraRequest(`/rest/api/3/search/jql?jql=${encodeURIComponent(rawJql)}&fields=summary,description,customfield_10020&maxResults=500`);

  if (!data?.issues?.length) return res.json({ imported: 0, updated: 0, skipped: 0, sprints_synced: 0 });

  // 3. Récupérer les jira_id déjà présents pour cette équipe (toutes sources)
  const [existing] = await pool.query(
    "SELECT id, jira_id, source, sprint_id FROM backlog WHERE team_id=? AND jira_id IS NOT NULL AND jira_id != ''",
    [teamId]
  );
  const manualIds = new Set(existing.filter(r => r.source === 'manual').map(r => r.jira_id));
  const jiraItems = new Map(existing.filter(r => r.source === 'jira').map(r => [r.jira_id, r]));

  // Mapping nom sprint Jira → sprint bobbee (id + jira_sprint_id + end_date pour push)
  const [spRows] = await pool.query('SELECT id, name, jira_sprint_id, end_date FROM sprints');
  const spByName = Object.fromEntries(spRows.map(s => [s.name, s]));
  const spById   = Object.fromEntries(spRows.map(s => [String(s.id), s]));

  // Helper : extraire le sprint actif (ou dernier) depuis customfield_10020
  const extractSprint = fields => {
    const sf = fields?.customfield_10020;
    if (!Array.isArray(sf) || !sf.length) return null;
    return sf.find(s => s.state === 'active') || sf[sf.length - 1];
  };

  let imported = 0, updated = 0, skipped = 0, sprints_synced = 0, pushed_to_jira = 0;

  for (const issue of data.issues) {
    const jiraId = issue.key;

    // Doublon manuel → skip total
    if (manualIds.has(jiraId)) { skipped++; continue; }

    const label   = (issue.fields?.summary || jiraId).slice(0, 500);
    const note    = issue.fields?.description ? adfToText(issue.fields.description).slice(0, 3000) : null;
    const jiraSp  = extractSprint(issue.fields);
    const ourSp   = jiraSp?.name ? spByName[jiraSp.name] : null;

    // Mettre en cache jira_sprint_id si on le découvre
    if (ourSp && jiraSp.id && ourSp.jira_sprint_id !== jiraSp.id) {
      await pool.query('UPDATE sprints SET jira_sprint_id=? WHERE id=?', [jiraSp.id, ourSp.id]);
      ourSp.jira_sprint_id = jiraSp.id;
    }

    // sprint_id à affecter :
    //   - Jira a un sprint ET on le connaît → on prend celui de Jira
    //   - Jira n'a pas de sprint             → null (signal "garder l'existant" pour un update)
    const jiraSprintId = ourSp ? ourSp.id : null;

    if (jiraItems.has(jiraId)) {
      const existingItem = jiraItems.get(jiraId);

      if (jiraSprintId !== null) {
        // ── Jira a un sprint → bobbee se met à jour si différent ──────────
        if (String(existingItem.sprint_id) !== String(jiraSprintId)) {
          await pool.query(
            'UPDATE backlog SET label=?, note=?, sprint_id=? WHERE jira_id=? AND team_id=? AND source="jira"',
            [label, note, jiraSprintId, jiraId, teamId]
          );
          sprints_synced++;
        } else {
          await pool.query(
            'UPDATE backlog SET label=?, note=? WHERE jira_id=? AND team_id=? AND source="jira"',
            [label, note, jiraId, teamId]
          );
        }

      } else if (existingItem.sprint_id) {
        // ── Jira n'a pas de sprint + bobbee en a un → push vers Jira ──────
        await pool.query(
          'UPDATE backlog SET label=?, note=? WHERE jira_id=? AND team_id=? AND source="jira"',
          [label, note, jiraId, teamId]
        );
        const bobbeeSpRow = spById[String(existingItem.sprint_id)];
        if (bobbeeSpRow) {
          // Récupérer l'ID Jira du sprint (cache ou JQL fallback)
          let jsid = bobbeeSpRow.jira_sprint_id || null;
          if (!jsid) {
            try {
              const jql2 = `sprint = "${bobbeeSpRow.name.replace(/"/g, '\\"')}" ORDER BY created ASC`;
              const s2 = await jiraRequest(
                `/rest/api/3/search/jql?jql=${encodeURIComponent(jql2)}&fields=customfield_10020&maxResults=1`
              );
              const i2 = (s2.issues || [])[0];
              if (i2) {
                const sf2 = i2.fields?.customfield_10020;
                const sp2 = Array.isArray(sf2) ? (sf2.find(s => s.name === bobbeeSpRow.name) || sf2[0]) : sf2;
                jsid = sp2?.id ?? null;
                if (jsid) {
                  await pool.query('UPDATE sprints SET jira_sprint_id=? WHERE id=?', [jsid, bobbeeSpRow.id]);
                  bobbeeSpRow.jira_sprint_id = jsid;
                }
              }
            } catch { /* log silencieux, on continue */ }
          }
          if (jsid) {
            try {
              await jiraPost(`/rest/agile/1.0/sprint/${jsid}/issue`, { issues: [jiraId] });
              // Mettre à jour la due date avec la fin du sprint bobbee
              if (bobbeeSpRow.end_date) {
                const due = new Date(bobbeeSpRow.end_date).toISOString().slice(0, 10);
                try { await jiraPost(`/rest/api/3/issue/${jiraId}`, { fields: { duedate: due } }, 'PUT'); } catch {}
              }
              pushed_to_jira++;
            } catch (e) {
              console.warn(`Push sprint Jira échoué pour ${jiraId}:`, e.message);
            }
          }
        }

      } else {
        // ── Ni Jira ni bobbee n'ont de sprint → juste label + note ─────────
        await pool.query(
          'UPDATE backlog SET label=?, note=? WHERE jira_id=? AND team_id=? AND source="jira"',
          [label, note, jiraId, teamId]
        );
      }

      updated++;
      continue;
    }

    // Nouveau ticket → insert avec sprint si disponible
    const [max] = await pool.query(
      'SELECT COALESCE(MAX(position),0)+1 AS pos FROM backlog WHERE team_id=? AND source="jira"',
      [teamId]
    );
    await pool.query(
      'INSERT INTO backlog (team_id,jira_id,label,note,sprint_id,source,position) VALUES (?,?,?,?,?,"jira",?)',
      [teamId, jiraId, label, note, jiraSprintId, max[0].pos]
    );
    jiraItems.set(jiraId, { jira_id: jiraId, sprint_id: jiraSprintId });
    if (jiraSprintId) sprints_synced++;
    imported++;
  }

  res.json({ imported, updated, skipped, sprints_synced, pushed_to_jira });
}));

// POST /api/jira/sync-velocities — met à jour velocity_current et velocity_actual
// depuis Jira pour tous les sprints ouverts de l'équipe
app.post('/api/jira/sync-velocities', auth, adminOnly, aw(async (req, res) => {
  if (!process.env.JIRA_BASE_URL) return res.json({ synced: 0 });

  const { teamId } = req.body;
  if (!teamId) return res.status(400).json({ error: 'teamId requis' });

  const [teamRows] = await pool.query('SELECT jira_team_id FROM teams WHERE id=?', [teamId]);
  if (!teamRows.length) return res.status(404).json({ error: 'Équipe introuvable' });
  if (!teamRows[0].jira_team_id) return res.json({ synced: 0 }); // pas de Jira configuré

  const jiraTeamId = teamRows[0].jira_team_id;

  // Sprints ouverts qui ont des données pour cette équipe
  const [sprints] = await pool.query(
    'SELECT s.id, s.name FROM sprints s JOIN sprint_team_data std ON std.sprint_id=s.id WHERE std.team_id=? AND s.closed=0',
    [teamId]
  );
  if (!sprints.length) return res.json({ synced: 0 });

  const IN_PROGRESS = `"3 - En cours", "3 BIS - A TESTER ENV EPHEMERE", "4 - Pull Request", "5 - A livrer en dev", "6 - A tester en dev"`;
  const DONE        = `"7 - A LIVRER EN STAGING", "8 - A TESTER EN STAGING", "9 - A LIVRER EN PROD", "10 - Termine"`;

  const sumPoints = async (jql) => {
    const data = await jiraRequest(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=customfield_10016&maxResults=500`
    );
    if (!data?.issues) return 0;
    return data.issues.reduce((s, i) => s + (Number(i.fields?.customfield_10016) || 0), 0);
  };

  let synced = 0;
  await Promise.all(sprints.map(async sprint => {
    const base = `project IN (10259) AND Sprint = "${sprint.name}" AND "Team[Team]" = "${jiraTeamId}"`;
    const [cur, done] = await Promise.all([
      sumPoints(`${base} AND status in (${IN_PROGRESS})`),
      sumPoints(`${base} AND status in (${DONE})`),
    ]);
    await pool.query(
      'UPDATE sprint_team_data SET velocity_current=?, velocity_actual=? WHERE sprint_id=? AND team_id=?',
      [cur || null, done || null, sprint.id, teamId]
    );
    synced++;
  }));

  res.json({ synced });
}));

// GET /api/jira/no-timespent?teamId=X — US sans temps saisi (hors statuts terminés/non démarrés)
app.get('/api/jira/no-timespent', auth, aw(async (req, res) => {
  const { teamId } = req.query;
  if (!teamId) return res.status(400).json({ error: 'teamId requis' });

  const [teamRows] = await pool.query('SELECT jira_team_id FROM teams WHERE id=?', [teamId]);
  if (!teamRows.length) return res.status(404).json({ error: 'Équipe introuvable' });
  if (!teamRows[0].jira_team_id) return res.json({ total: 0, issues: [] });

  const jiraUid = teamRows[0].jira_team_id;
  const jql = `type = "User Story" AND timespent is EMPTY AND Status not in ("10 - Termine", "0 - A affecter référent", "0- A PRIORISER PO", "1 - A spécifier", "2 - Affectation") AND "Team[Team]" = "${jiraUid}" ORDER BY status DESC`;

  const data = await jiraRequest(
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,assignee&maxResults=200`
  );

  if (!data?.issues) return res.json({ total: 0, issues: [] });

  const issues = data.issues.map(i => ({
    jira_id: i.key,
    assignee_name: i.fields?.assignee?.displayName || '—',
  }));

  res.json({ total: issues.length, issues });
}));

// GET /api/jira/sprint-breakdown?teamId=X&sprintName=Y
// Répartition par type et par statut pour les tickets du sprint (hors Feature/Tache)
app.get('/api/jira/sprint-breakdown', auth, aw(async (req, res) => {
  const { teamId, sprintName } = req.query;
  if (!teamId || !sprintName) return res.status(400).json({ error: 'teamId et sprintName requis' });

  const [teamRows] = await pool.query('SELECT jira_team_id FROM teams WHERE id=?', [teamId]);
  if (!teamRows.length) return res.status(404).json({ error: 'Équipe introuvable' });
  if (!teamRows[0].jira_team_id) return res.json({ byType: [], byStatus: [], byMember: [], total: 0 });

  const jiraUid = teamRows[0].jira_team_id;
  const jql = `type NOT IN (Features, Taches) AND "Team[Team]" = "${jiraUid}" AND Sprint = "${sprintName}"`;

  const data = await jiraRequest(
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=issuetype,status,customfield_10016,assignee&maxResults=500`
  );

  if (!data?.issues?.length) return res.json({ byType: [], byStatus: [], byMember: [], total: 0, totalPoints: 0, sprint: sprintName });

  const IN_PROG_ST = ['3 - En cours','3 BIS - A TESTER ENV EPHEMERE','4 - Pull Request','5 - A livrer en dev','6 - A tester en dev'];
  const DONE_ST    = ['7 - A LIVRER EN STAGING','8 - A TESTER EN STAGING','9 - A LIVRER EN PROD','10 - Termine'];

  const typeCount = {}, typePoints = {}, statusCount = {}, statusPoints = {}, memberMap = {};
  let totalPoints = 0;
  for (const issue of data.issues) {
    const type   = issue.fields?.issuetype?.name || 'Inconnu';
    const status = issue.fields?.status?.name    || 'Inconnu';
    const pts    = Number(issue.fields?.customfield_10016) || 0;
    const member = issue.fields?.assignee?.displayName   || '—';
    typeCount[type]      = (typeCount[type]      || 0) + 1;
    typePoints[type]     = (typePoints[type]     || 0) + pts;
    statusCount[status]  = (statusCount[status]  || 0) + 1;
    statusPoints[status] = (statusPoints[status] || 0) + pts;
    totalPoints += pts;
    if (!memberMap[member]) memberMap[member] = { doneCount: 0, donePoints: 0, inProgressCount: 0, inProgressPoints: 0 };
    if (DONE_ST.includes(status))    { memberMap[member].doneCount++;       memberMap[member].donePoints       += pts; }
    else if (IN_PROG_ST.includes(status)) { memberMap[member].inProgressCount++; memberMap[member].inProgressPoints += pts; }
  }

  const byType = Object.keys(typeCount)
    .sort((a, b) => typeCount[b] - typeCount[a])
    .map(name => ({ name, count: typeCount[name], points: typePoints[name] }));

  const byStatus = Object.keys(statusCount)
    .sort((a, b) => statusCount[b] - statusCount[a])
    .map(name => ({ name, count: statusCount[name], points: statusPoints[name] }));

  const byMember = Object.entries(memberMap)
    .filter(([, v]) => v.doneCount + v.inProgressCount > 0)
    .sort((a, b) => (b[1].doneCount + b[1].inProgressCount) - (a[1].doneCount + a[1].inProgressCount))
    .map(([name, v]) => ({ name, ...v }));

  res.json({ byType, byStatus, byMember, total: data.issues.length, totalPoints, sprint: sprintName });
}));

// ═══════════════════════════════════════════════════════
// OBJECTIFS
// ═══════════════════════════════════════════════════════

// Cache des IDs de champs Jira (durée de vie du process)
let _jiraFieldIds = null;

// Cache process des noms d'objectifs (ARI → name|null)
const _goalNameCache = {};

// Cache OAuth Atlas (durée de vie du process)
let _atlasToken = null;
let _atlasTokenExpiry = 0;

// Extrait { cloudId, goalId } d'un ARI Atlassian
// Format : ari:cloud:townsquare:{cloudId}:goal/{goalId}
function parseGoalAri(ari) {
  const m = String(ari).match(/^ari:cloud:townsquare:([^:]+):goal\/(.+)$/);
  return m ? { cloudId: m[1], goalId: m[2] } : null;
}

// Obtient un token OAuth 2.0 Client Credentials pour l'API Atlas
// Nécessite ATLAS_CLIENT_ID + ATLAS_CLIENT_SECRET dans .env
async function getAtlasToken() {
  const clientId     = process.env.ATLAS_CLIENT_ID;
  const clientSecret = process.env.ATLAS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (_atlasToken && Date.now() < _atlasTokenExpiry) return _atlasToken;

  return new Promise(resolve => {
    const body = JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      audience:      'api.atlassian.com',
    });
    const req = https.request({
      hostname: 'auth.atlassian.com',
      path:     '/oauth/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.access_token) {
            _atlasToken       = json.access_token;
            _atlasTokenExpiry = Date.now() + ((json.expires_in || 3600) - 60) * 1000;
            console.log('[Atlas OAuth] Token obtenu, expire dans', json.expires_in, 's');
            resolve(_atlasToken);
          } else {
            console.warn('[Atlas OAuth] Erreur token:', JSON.stringify(json).slice(0, 200));
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', e => { console.warn('[Atlas OAuth] Erreur réseau:', e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// Appel REST à api.atlassian.com avec Bearer OAuth
function atlasRequest(path, token) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.atlassian.com',
      path,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (r.statusCode < 200 || r.statusCode >= 300)
            return reject(new Error(`Atlas HTTP ${r.statusCode}: ${JSON.stringify(parsed).slice(0, 200)}`));
          resolve(parsed);
        } catch { reject(new Error('Atlas parse error')); }
      });
    }).on('error', reject);
  });
}

// Résout les noms d'objectifs pour un lot d'ARIs.
// Priorité : surcharge DB → cache process → API Atlas OAuth → null
async function resolveGoalNames(aris) {
  const unique = [...new Set(aris.filter(Boolean))];
  if (!unique.length) return;

  // 1. Charger les surcharges manuelles depuis la DB pour les ARIs non encore en cache process
  const uncachedByDb = unique.filter(a => !(a in _goalNameCache));
  if (uncachedByDb.length) {
    try {
      const placeholders = uncachedByDb.map(() => '?').join(',');
      const [rows] = await pool.query(`SELECT ari, name FROM goal_names WHERE ari IN (${placeholders})`, uncachedByDb);
      for (const row of rows) _goalNameCache[row.ari] = row.name || null;
    } catch { /* table peut ne pas encore exister */ }
  }

  // 2. Pour ceux encore non résolus, tenter l'API Atlas OAuth
  const uncachedByApi = unique.filter(a => !(a in _goalNameCache) || _goalNameCache[a] === null);
  const newlyUncached = uncachedByApi.filter(a => !(a in _goalNameCache));
  if (!newlyUncached.length) return;

  const token = await getAtlasToken();
  if (!token) {
    // Pas de credentials OAuth → marquer null pour ne pas re-tenter
    for (const ari of newlyUncached) _goalNameCache[ari] = null;
    return;
  }

  await Promise.allSettled(newlyUncached.map(async ari => {
    const p = parseGoalAri(ari);
    if (!p) { _goalNameCache[ari] = null; return; }
    try {
      const data = await atlasRequest(`/townsquare/s/${p.cloudId}/goal/${p.goalId}`, token);
      const name = data?.name || data?.title || data?.displayName || null;
      _goalNameCache[ari] = name;
      // Persister en DB pour les prochains redémarrages
      if (name) {
        await pool.query(
          'INSERT INTO goal_names (ari, name) VALUES (?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
          [ari, name]
        ).catch(() => {});
      }
    } catch (e) {
      console.warn('[Atlas] goal fetch failed:', e.message.slice(0, 100));
      _goalNameCache[ari] = null;
    }
  }));
}

async function getJiraFieldIds() {
  if (_jiraFieldIds) return _jiraFieldIds;
  const fields = await jiraRequest('/rest/api/3/field');
  const find = (name) => fields.find(f =>
    f.name === name ||
    (Array.isArray(f.clauseNames) && f.clauseNames.some(c => c.replace(/['"]/g, '') === name))
  );
  _jiraFieldIds = {
    objectives: find('Objectifs[Goals]')?.id || null,
    team:       find('Team[Team]')?.id        || null,
  };
  return _jiraFieldIds;
}

// GET /api/objectives — Features Jira groupées par objectif (champ Objectifs[Goals])
// PUT /api/goal-names — surcharge manuelle d'un nom d'objectif (admin)
app.put('/api/goal-names', auth, adminOnly, aw(async (req, res) => {
  const { ari, name } = req.body;
  if (!ari) return res.status(400).json({ error: 'ari requis' });
  const safeName = (name || '').trim() || null;
  await pool.query(
    'INSERT INTO goal_names (ari, name) VALUES (?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
    [ari, safeName]
  );
  // Invalider le cache process pour forcer le rechargement
  delete _goalNameCache[ari];
  res.json({ ok: true });
}));

// GET /api/objectives — Features Jira groupées par objectif (champ Objectifs[Goals])
app.get('/api/objectives', auth, aw(async (_req, res) => {
  // 1. Équipes en base pour le mapping jira_team_id → équipe locale
  const [teams]    = await pool.query('SELECT id, name, jira_team_id FROM teams');
  const [allTeams] = await pool.query('SELECT id, name FROM teams ORDER BY name');
  const teamByJiraId = Object.fromEntries(
    teams.filter(t => t.jira_team_id).map(t => [t.jira_team_id, t])
  );

  // 2. Découverte des IDs de champs custom
  let fieldIds;
  try {
    fieldIds = await getJiraFieldIds();
  } catch (e) {
    return res.status(502).json({ error: 'Impossible de contacter Jira : ' + e.message });
  }
  if (!fieldIds.objectives)
    return res.status(500).json({ error: 'Champ "Objectifs[Goals]" introuvable dans Jira. Vérifiez le nom du champ.' });
  if (!fieldIds.team)
    return res.status(500).json({ error: 'Champ "Team[Team]" introuvable dans Jira.' });

  // 3. Requête JQL — toutes les Features du projet MP (actives + terminées) avec pagination
  // /rest/api/3/search/jql utilise la pagination par curseur (nextPageToken)
  const jql = `project = MP AND type = Features`;
  const issues = [];
  const PAGE = 100;
  const MAX_PAGES = 50; // garde-fou : 50 × 100 = 5000 features max
  try {
    let nextPageToken = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      let url = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,${fieldIds.objectives},${fieldIds.team}&maxResults=${PAGE}`;
      if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;
      const data = await jiraRequest(url);
      const batch = data.issues || [];
      issues.push(...batch);
      // Pas de page suivante si nextPageToken absent ou batch incomplet
      if (!data.nextPageToken || batch.length < PAGE) break;
      nextPageToken = data.nextPageToken;
    }
  } catch (e) {
    return res.status(502).json({ error: 'Erreur Jira : ' + e.message });
  }

  // 4. Résolution des noms d'objectifs (DB cache → API Atlas OAuth)
  const allAris = issues.flatMap(issue => {
    const goalsRaw = issue.fields[fieldIds.objectives];
    return Array.isArray(goalsRaw) ? goalsRaw.map(g => g?.id).filter(Boolean) : [];
  });
  await resolveGoalNames(allAris);

  // 5. Groupement par objectif
  const byObjective = {};

  for (const issue of issues) {
    const teamRaw  = issue.fields[fieldIds.team];
    const goalsRaw = issue.fields[fieldIds.objectives];
    const team     = teamRaw?.id ? teamByJiraId[teamRaw.id] : null;

    const statusNameRaw = (issue.fields.status?.name || '').trim();
    const done = statusNameRaw.toLowerCase() === '10 - termine';

    const feature = {
      jira_id:   issue.key,
      label:     (issue.fields.summary || issue.key).slice(0, 300),
      team_id:   team?.id   || null,
      team_name: team?.name || null,
      done,
    };

    const goals = Array.isArray(goalsRaw) ? goalsRaw : [];
    if (!goals.length) {
      if (!byObjective['__orphan__']) byObjective['__orphan__'] = [];
      byObjective['__orphan__'].push(feature);
    } else {
      for (const g of goals) {
        const ari  = g?.id;
        const p    = parseGoalAri(ari);
        // Cache (DB ou OAuth) → ARI tronqué lisible comme ultime fallback
        const name = _goalNameCache[ari]
          || (p ? `__unresolved__${ari}` : ari || '?');
        if (!byObjective[name]) byObjective[name] = [];
        byObjective[name].push(feature);
      }
    }
  }

  res.json({ objectives: byObjective, teams: allTeams });
}));

// GET /api/jira/children?key=MP-1515 — tickets enfants d'une feature
app.get('/api/jira/children', auth, aw(async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'key requis' });
  if (!process.env.JIRA_BASE_URL) return res.json([]);

  const jql = `project = MP AND parent = "${key}" AND issuetype != RSD`;
  let data;
  try {
    data = await jiraRequest(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status,issuetype,customfield_10016,customfield_10020&maxResults=100`
    );
  } catch (e) {
    return res.status(502).json({ error: 'Erreur Jira : ' + e.message });
  }

  const issues = data.issues || [];
  const children = issues.map(i => {
    const sprints = i.fields.customfield_10020;
    const sp = Array.isArray(sprints)
      ? (sprints.find(s => s.state === 'active') || sprints[sprints.length - 1])
      : null;
    return {
      jira_id:     i.key,
      label:       (i.fields.summary || i.key).slice(0, 200),
      type:        i.fields.issuetype?.name || 'Story',
      status:      i.fields.status?.name   || '',
      sprint_name: sp?.name || null,
      points:      Number(i.fields.customfield_10016) || 0,
    };
  });
  res.json(children);
}));

// GET /api/children/positions?keys=MP-1,MP-2,... — positions sauvegardées
app.get('/api/children/positions', auth, aw(async (req, res) => {
  const keys = (req.query.keys || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!keys.length) return res.json({});
  const [rows] = await pool.query(
    'SELECT jira_id, offset_px, sprint_name FROM child_positions WHERE jira_id IN (?)',
    [keys]
  );
  const map = {};
  for (const r of rows) map[r.jira_id] = { offset_px: r.offset_px, sprint_name: r.sprint_name };
  res.json(map);
}));

// PUT /api/children/position — sauvegarder la position d'un enfant
app.put('/api/children/position', auth, adminOnly, aw(async (req, res) => {
  const { jira_id, offset_px, sprint_name } = req.body;
  if (!jira_id || offset_px == null) return res.status(400).json({ error: 'jira_id et offset_px requis' });
  await pool.query(
    `INSERT INTO child_positions (jira_id, offset_px, sprint_name) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE offset_px=VALUES(offset_px), sprint_name=VALUES(sprint_name)`,
    [jira_id, Math.round(offset_px), sprint_name || null]
  );
  res.json({ ok: true });
}));

// POST /api/jira/move-sprint — déplacer un ticket enfant dans un autre sprint Jira
app.post('/api/jira/move-sprint', auth, adminOnly, aw(async (req, res) => {
  const { jira_id, sprint_name } = req.body;
  if (!jira_id || !sprint_name) return res.status(400).json({ error: 'jira_id et sprint_name requis' });
  if (!process.env.JIRA_BASE_URL) return res.status(503).json({ error: 'Jira non configuré' });

  // Vérifier que le sprint cible n'est pas clôturé et récupérer son ID Jira + date de fin
  const [sprRows] = await pool.query('SELECT closed, jira_sprint_id, end_date FROM sprints WHERE name=? LIMIT 1', [sprint_name]);
  if (sprRows.length && sprRows[0].closed) {
    return res.status(400).json({ error: 'Sprint clôturé — déplacement interdit' });
  }

  // 1. Essai direct : ID Jira stocké en DB lors de la dernière synchro
  let jiraSprintId = sprRows[0]?.jira_sprint_id || null;

  // 2. Fallback : recherche via JQL (sprint non encore synchro ou ID absent)
  if (!jiraSprintId) {
    try {
      const jql = `sprint = "${sprint_name.replace(/"/g, '\\"')}" ORDER BY created ASC`;
      const search = await jiraRequest(
        `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=customfield_10020&maxResults=1`
      );
      const issue = (search.issues || [])[0];
      if (issue) {
        const sf = issue.fields?.customfield_10020;
        const spObj = Array.isArray(sf) ? (sf.find(s => s.name === sprint_name) || sf[0]) : sf;
        jiraSprintId = spObj?.id ?? null;
        // Mémoriser pour les prochains appels
        if (jiraSprintId && sprRows[0]) {
          await pool.query('UPDATE sprints SET jira_sprint_id=? WHERE name=?', [jiraSprintId, sprint_name]);
        }
      }
    } catch (e) {
      return res.json({ ok: false, jira: false, reason: `Recherche sprint Jira échouée : ${e.message}` });
    }
  }

  if (!jiraSprintId) {
    return res.json({ ok: false, jira: false, reason: `ID Jira introuvable pour le sprint "${sprint_name}" — rechargez le backlog pour synchroniser` });
  }

  // Formater la date de fin du sprint (DATE MySQL → YYYY-MM-DD)
  const sprintEndDate = sprRows[0]?.end_date
    ? new Date(sprRows[0].end_date).toISOString().slice(0, 10)
    : null;

  try {
    await jiraPost(`/rest/agile/1.0/sprint/${jiraSprintId}/issue`, { issues: [jira_id] });
  } catch (e) {
    return res.json({ ok: false, jira: false, reason: e.message });
  }

  // Mettre à jour la due date Jira avec la date de fin du sprint
  let dueDateWarning = null;
  if (sprintEndDate) {
    try {
      await jiraPost(`/rest/api/3/issue/${jira_id}`, { fields: { duedate: sprintEndDate } }, 'PUT');
    } catch (e) {
      dueDateWarning = `due date non mise à jour : ${e.message}`;
    }
  }

  res.json({ ok: true, jira: true, sprint_name, jira_sprint_id: jiraSprintId, due_date: sprintEndDate, warning: dueDateWarning || undefined });
}));

// ── Documentation API (Swagger UI) ──────────────────────

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'bobbee Capacity Planner — API publique',
    version: '1.0.0',
    description: 'API permettant de consulter les absences des membres d\'équipe.\n\nAucune authentification requise pour les endpoints `/api/public/*`.'
  },
  servers: [
    { url: 'https://bobbeecapacity.alwaysdata.net', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local' }
  ],

  tags: [
    { name: 'Absences', description: 'Congés et absences des membres' }
  ],
  paths: {
    '/bobbeCapacity/api/public/absences': {
      get: {
        tags: ['Absences'],
        summary: 'Liste des absences par membre',
        description: 'Retourne tous les membres avec leurs jours d\'absence. Filtrable par équipe et/ou plage de dates.',
        parameters: [
          {
            name: 'teamId',
            in: 'query',
            required: false,
            description: 'Identifiant de l\'équipe (retourne uniquement les membres de cette équipe)',
            schema: { type: 'integer', example: 1 }
          },
          {
            name: 'from',
            in: 'query',
            required: false,
            description: 'Date de début (incluse) au format YYYY-MM-DD',
            schema: { type: 'string', format: 'date', example: '2026-01-01' }
          },
          {
            name: 'to',
            in: 'query',
            required: false,
            description: 'Date de fin (incluse) au format YYYY-MM-DD',
            schema: { type: 'string', format: 'date', example: '2026-12-31' }
          }
        ],
        responses: {
          200: {
            description: 'Liste des membres avec leurs absences',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/MemberAbsences' }
                },
                example: [
                  {
                    id: 3,
                    firstName: 'Alice',
                    lastName: 'Martin',
                    absences: [
                      { date: '2026-05-02', type: 'full', reason: 'Congés annuels' },
                      { date: '2026-05-12', type: 'am',   reason: 'RDV médical' }
                    ]
                  },
                  {
                    id: 7,
                    firstName: 'Thomas',
                    lastName: 'Dupont',
                    absences: []
                  }
                ]
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      MemberAbsences: {
        type: 'object',
        properties: {
          id:        { type: 'integer', description: 'Identifiant du membre', example: 3 },
          firstName: { type: 'string',  description: 'Prénom',               example: 'Alice' },
          lastName:  { type: 'string',  description: 'Nom de famille',       example: 'Martin' },
          absences: {
            type: 'array',
            description: 'Liste des jours d\'absence (vide si aucune absence sur la période)',
            items: { $ref: '#/components/schemas/Absence' }
          }
        }
      },
      Absence: {
        type: 'object',
        properties: {
          date:   { type: 'string', format: 'date', description: 'Date de l\'absence (YYYY-MM-DD)', example: '2026-05-02' },
          type: {
            type: 'string',
            enum: ['full', 'am', 'pm'],
            description: '`full` = journée entière · `am` = matin seulement · `pm` = après-midi seulement',
            example: 'full'
          },
          reason: { type: 'string', description: 'Motif de l\'absence (peut être vide)', example: 'Congés annuels' }
        }
      }
    }
  }
};

app.get('/bobbeCapacity/api/docs/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});

app.get('/bobbeCapacity/api/docs', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>bobbee Capacity — API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { background: #110f1f; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .info .title { color: #7c3aed; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/bobbeCapacity/api/docs/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`);
});

// ── Fallback SPA (uniquement sous /bobbeeCapacity/) ─────
app.get('/', (req, res) => res.redirect('/bobbeeCapacity/'));
app.get(/^\/bobbeeCapacity(\/.*)?$/, (req, res) => res.sendFile(path.join(__dirname, 'www', 'bobbeeCapacity', 'index.html')));
app.use((req, res) => res.status(404).send('404 Not Found'));

// ── Migrations automatiques ─────────────────────────────
async function runMigrations() {
  const migrations = [
    // Colonnes DECIMAL pour les vélocités sprint (step 0.5)
    `ALTER TABLE sprints MODIFY COLUMN velocity_planned DECIMAL(6,1) NOT NULL DEFAULT 0`,
    `ALTER TABLE sprints MODIFY COLUMN velocity_current DECIMAL(6,1)`,
    `ALTER TABLE sprints MODIFY COLUMN velocity_actual  DECIMAL(6,1)`,
    // Vélocité individuelle par membre
    `ALTER TABLE team ADD COLUMN IF NOT EXISTS velocity INT NULL`,
    // Rôle super_admin
    `ALTER TABLE users MODIFY COLUMN role ENUM('super_admin','admin','consultant') NOT NULL DEFAULT 'consultant'`,
    // Table équipes
    `CREATE TABLE IF NOT EXISTS teams (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    // Appartenance membre ↔ équipe (many-to-many)
    `CREATE TABLE IF NOT EXISTS member_teams (member_id INT NOT NULL, team_id INT NOT NULL, PRIMARY KEY (member_id, team_id))`,
    // Visibilité utilisateur ↔ équipe
    `CREATE TABLE IF NOT EXISTS user_teams (user_id INT NOT NULL, team_id INT NOT NULL, PRIMARY KEY (user_id, team_id))`,
    // Sprint rattaché à une équipe
    `ALTER TABLE sprints ADD COLUMN IF NOT EXISTS team_id INT NULL`,
    `ALTER TABLE sprints ADD COLUMN IF NOT EXISTS convergence TINYINT(1) NOT NULL DEFAULT 1`,
    // Backlog RICE
    `CREATE TABLE IF NOT EXISTS backlog (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      team_id    INT NOT NULL,
      jira_id    VARCHAR(100) DEFAULT '',
      label      VARCHAR(500) NOT NULL DEFAULT '',
      sprint_id  INT NULL,
      reach      INT NOT NULL DEFAULT 0,
      impact     INT NOT NULL DEFAULT 0,
      confidence INT NOT NULL DEFAULT 0,
      effort     INT NOT NULL DEFAULT 0,
      position   INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Pays du collaborateur pour les jours fériés
    `ALTER TABLE team ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'FR'`,
    // Note WYSIWYG par ticket backlog
    `ALTER TABLE backlog ADD COLUMN IF NOT EXISTS note TEXT NULL`,
    // Historique d'appartenance équipe : remplacement de la PK composite par id autoincrement
    `ALTER TABLE member_teams ADD COLUMN id INT AUTO_INCREMENT FIRST, DROP PRIMARY KEY, ADD PRIMARY KEY (id), ADD INDEX idx_mt_member (member_id), ADD INDEX idx_mt_team (team_id)`,
    // Dates de début et fin d'affectation (NULL = pas de contrainte)
    `ALTER TABLE member_teams ADD COLUMN IF NOT EXISTS start_date DATE NULL`,
    `ALTER TABLE member_teams ADD COLUMN IF NOT EXISTS end_date DATE NULL`,
    // UID Jira de l'équipe (pour la correspondance Team[Team] dans le JQL)
    `ALTER TABLE teams ADD COLUMN IF NOT EXISTS jira_team_id VARCHAR(100) NULL`,
    // Source d'un ticket backlog : saisie manuelle ou importé depuis Jira
    `ALTER TABLE backlog ADD COLUMN IF NOT EXISTS source ENUM('manual','jira') NOT NULL DEFAULT 'manual'`,
    // Méthode de scoring par équipe : RICE ou RRICCE
    `ALTER TABLE teams ADD COLUMN IF NOT EXISTS scoring_method ENUM('rice','rricce') NOT NULL DEFAULT 'rice'`,
    // Validation effort par le dev / tech lead
    `ALTER TABLE backlog ADD COLUMN IF NOT EXISTS dev_validated TINYINT(1) NOT NULL DEFAULT 0`,
    // Critères RRICCE : Risque et Criticité
    `ALTER TABLE backlog ADD COLUMN IF NOT EXISTS risk        INT NOT NULL DEFAULT 0`,
    `ALTER TABLE backlog ADD COLUMN IF NOT EXISTS criticality INT NOT NULL DEFAULT 0`,
    // Noms d'objectifs Atlas (cache persistant + surcharges manuelles)
    `CREATE TABLE IF NOT EXISTS goal_names (
      ari  VARCHAR(500) NOT NULL PRIMARY KEY,
      name VARCHAR(500) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    // Tokens de réinitialisation de mot de passe
    `CREATE TABLE IF NOT EXISTS password_resets (
      user_id    INT NOT NULL PRIMARY KEY,
      token      VARCHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Données sprint par équipe (sprint partagé, vélocité/confiance/objectifs par équipe)
    `CREATE TABLE IF NOT EXISTS sprint_team_data (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      sprint_id        INT NOT NULL,
      team_id          INT NOT NULL,
      velocity_planned DECIMAL(6,1) NOT NULL DEFAULT 0,
      velocity_current DECIMAL(6,1) DEFAULT NULL,
      velocity_actual  DECIMAL(6,1) DEFAULT NULL,
      confidence       INT NOT NULL DEFAULT 0,
      objectives       TEXT NOT NULL DEFAULT '[]',
      UNIQUE KEY uq_sprint_team (sprint_id, team_id)
    )`,
    // ID Jira du sprint (pour l'API Agile move-sprint sans recherche JQL)
    `ALTER TABLE sprints ADD COLUMN IF NOT EXISTS jira_sprint_id INT NULL`,
    // Positions des tickets enfants sur le Gantt (offset en pixels depuis le début du sprint)
    `CREATE TABLE IF NOT EXISTS child_positions (
      jira_id     VARCHAR(100) NOT NULL PRIMARY KEY,
      offset_px   INT NOT NULL DEFAULT 0,
      sprint_name VARCHAR(255) NULL,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); }
    catch (e) { console.warn('Migration skipped:', e.message); }
  }
  console.log('Migrations OK');
}

// Migration des données sprint : transfert vers sprint_team_data + dédoublonnage par nom
async function migrateSprintData() {
  // 1. Copier les données existantes (sprints avec team_id) vers sprint_team_data
  await pool.query(`
    INSERT IGNORE INTO sprint_team_data
      (sprint_id, team_id, velocity_planned, velocity_current, velocity_actual, confidence, objectives)
    SELECT id, team_id,
      COALESCE(velocity_planned,0), velocity_current, velocity_actual,
      COALESCE(confidence,0), COALESCE(objectives,'[]')
    FROM sprints
    WHERE team_id IS NOT NULL
  `);

  // 2. Dédoublonner les sprints par nom (garder le plus ancien = id le plus bas)
  const [all] = await pool.query('SELECT id, name FROM sprints ORDER BY id ASC');
  const seen = {};
  for (const s of all) {
    if (!seen[s.name]) { seen[s.name] = s.id; continue; }
    const masterId = seen[s.name];
    const dupId    = s.id;

    // Récupérer les équipes déjà présentes sur le master
    const [masterTeams] = await pool.query(
      'SELECT team_id FROM sprint_team_data WHERE sprint_id=?', [masterId]
    );
    const masterTeamIds = masterTeams.map(r => r.team_id);

    // Déplacer les données du doublon dont l'équipe n'est pas encore sur le master
    if (masterTeamIds.length === 0) {
      await pool.query('UPDATE sprint_team_data SET sprint_id=? WHERE sprint_id=?', [masterId, dupId]);
    } else {
      await pool.query(
        `UPDATE sprint_team_data SET sprint_id=? WHERE sprint_id=? AND team_id NOT IN (${masterTeamIds.map(()=>'?').join(',')})`,
        [masterId, dupId, ...masterTeamIds]
      );
    }

    // Déplacer les références backlog
    await pool.query('UPDATE backlog SET sprint_id=? WHERE sprint_id=?', [masterId, dupId]);

    // Supprimer les données restantes du doublon puis le doublon lui-même
    await pool.query('DELETE FROM sprint_team_data WHERE sprint_id=?', [dupId]);
    await pool.query('DELETE FROM sprints WHERE id=?', [dupId]);
    console.log(`[SprintMigration] Doublon "${s.name}" (id=${dupId}) fusionné dans id=${masterId}`);
  }
  console.log('SprintMigration OK');
}

// ── Gestionnaire d'erreur global ────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erreur serveur' });
});

// ── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || process.env.ALWAYSDATA_HTTPD_PORT || 3000;
runMigrations()
  .then(() => migrateSprintData())
  .then(() => {
    app.listen(PORT, () => console.log(`bobbee backend running on :${PORT}`));
  });
