'use strict';

/**
 * QuranQuest Live - server
 *
 * The server is the single source of truth. Browsers only render what they are told:
 *   - correct answers are NOT sent until the host reveals them
 *   - scores are computed server-side, from server timestamps
 *   - state is snapshotted to disk so a restart does not lose the event
 *
 * Roles: host (/admin, password protected) and players (/).
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { SETS } = require('./questions');

// ---------------------------------------------------------------- config ----
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 500;
// How long the answer stays up before auto-advancing: set per mode in questions.js (revealSeconds).
const BASE_POINTS = 80;
const SPEED_BONUS = 20;

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(5).toString('hex');
  console.warn('\n[!] ADMIN_PASSWORD is not set. Using a temporary one for this run:');
  console.warn(`    ${ADMIN_PASSWORD}\n    Set ADMIN_PASSWORD in your hosting environment variables.\n`);
}

// ------------------------------------------------------------------ http ----
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'"
  );
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '5m' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptimeSeconds: Math.round(process.uptime()),
    phase: game.phase,
    mode: game.mode,
    players: players.size,
    connected: [...players.values()].filter((p) => p.connected).length,
    time: new Date().toISOString(),
  });
});

// ----------------------------------------------------------------- state ----
const game = {
  mode: 'practice',
  phase: 'lobby', // lobby | question | reveal | finished
  qIndex: -1,
  paused: false,
  elapsedBefore: 0, // ms already spent on the current question (before the running segment)
  segmentStart: 0,
  autoAdvance: false,
  joinsLocked: false,
};

/** @type {Map<string, any>} */
const players = new Map();
const socketToPlayer = new Map();
const adminTokens = new Set();
const loginFailures = new Map();

let questionTimer = null;
let autoTimer = null;
let broadcastTimer = null;
let saveTimer = null;

const currentSet = () => SETS[game.mode];
const currentQuestion = () => currentSet().questions[game.qIndex];
const inRound = () => game.phase === 'question' || game.phase === 'reveal';
const elapsed = () =>
  game.elapsedBefore + (game.phase === 'question' && !game.paused ? Date.now() - game.segmentStart : 0);
const remaining = () => currentSet().timeLimit * 1000 - elapsed();
const revealMs = () => currentSet().revealSeconds * 1000;

function newPlayer(id, name) {
  return { id, name, score: 0, correct: 0, totalMs: 0, answers: [], connected: false, socketId: null };
}

/**
 * Scores as the audience should see them. While a question is open, points for that
 * question are held back so the projector can't leak who answered correctly.
 */
function stats(p) {
  let { score, correct, totalMs } = p;
  if (game.phase === 'question') {
    const a = p.answers[game.qIndex];
    if (a) {
      score -= a.points;
      if (a.correct) correct -= 1;
      totalMs -= a.ms;
    }
  }
  return { score, correct, totalMs };
}

function ranked() {
  return [...players.values()]
    .map((p) => ({ p, ...stats(p) }))
    .sort(
      (a, b) =>
        b.score - a.score || b.correct - a.correct || a.totalMs - b.totalMs || a.p.name.localeCompare(b.p.name)
    )
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

function buildReveal(q, list) {
  const distribution = [0, 0, 0, 0];
  let answered = 0;
  for (const p of list) {
    const a = p.answers[game.qIndex];
    if (a) {
      distribution[a.choice]++;
      answered++;
    }
  }
  return {
    correct: q.correct,
    explain: q.explain || null,
    distribution,
    answered,
    correctCount: distribution[q.correct],
    total: list.length,
  };
}

function buildState(rows) {
  const set = currentSet();
  const list = [...players.values()];
  const round = inRound();
  const q = round ? currentQuestion() : null;
  return {
    phase: game.phase,
    mode: game.mode,
    modeLabel: set.label,
    isPractice: game.mode === 'practice',
    total: set.questions.length,
    current: game.qIndex + 1,
    paused: game.paused,
    limitMs: set.timeLimit * 1000,
    remainingMs: game.phase === 'question' ? Math.max(0, remaining()) : 0,
    settings: { autoAdvance: game.autoAdvance, joinsLocked: game.joinsLocked },
    counts: {
      players: list.length,
      connected: list.filter((p) => p.connected).length,
      answered: round ? list.filter((p) => p.answers[game.qIndex]).length : 0,
    },
    question: q ? { text: q.text, options: q.options, category: q.category } : null,
    reveal: game.phase === 'reveal' ? buildReveal(q, list) : null,
    names: game.phase === 'lobby' ? rows.slice(0, 80).map((r) => r.p.name) : undefined,
    leaderboard: rows.slice(0, 30).map((r) => ({
      rank: r.rank,
      name: r.p.name,
      score: r.score,
      correct: r.correct,
    })),
  };
}

function meFor(p, row, count) {
  const a = inRound() ? p.answers[game.qIndex] : null;
  let result = null;
  if (game.phase === 'reveal') {
    result = a ? { isCorrect: a.correct, points: a.points } : { isCorrect: false, points: 0, missed: true };
  }
  return {
    id: p.id,
    name: p.name,
    score: row.score,
    correct: row.correct,
    rank: row.rank,
    of: count,
    choice: a ? a.choice : null,
    result,
  };
}

function adminExtras(rows) {
  const round = inRound();
  return {
    players: rows.map((r) => ({
      id: r.p.id,
      name: r.p.name,
      rank: r.rank,
      score: r.score,
      correct: r.correct,
      connected: r.p.connected,
      answered: round ? !!r.p.answers[game.qIndex] : false,
    })),
  };
}

/** Tiny public summary shown on the join screen before someone has joined. */
function publicInfo() {
  const set = currentSet();
  return {
    modeLabel: set.label,
    isPractice: game.mode === 'practice',
    total: set.questions.length,
    limitMs: set.timeLimit * 1000,
    players: players.size,
  };
}

function broadcastNow() {
  clearTimeout(broadcastTimer);
  broadcastTimer = null;
  const rows = ranked();
  const state = buildState(rows);
  io.emit('info', publicInfo());
  io.to('players').emit('state', state);
  io.to('admins').emit('state', { ...state, admin: adminExtras(rows) });
  for (const row of rows) {
    if (row.p.socketId) io.to(row.p.socketId).emit('me', meFor(row.p, row, rows.length));
  }
}

/** Coalesce bursts (e.g. 100 answers arriving together) into one broadcast. */
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(broadcastNow, 250);
}

function sendStateTo(socket) {
  const rows = ranked();
  const state = buildState(rows);
  if (socket.data.isAdmin) {
    socket.emit('state', { ...state, admin: adminExtras(rows) });
  } else {
    socket.emit('state', state);
    const row = rows.find((r) => r.p.id === socketToPlayer.get(socket.id));
    if (row) socket.emit('me', meFor(row.p, row, rows.length));
  }
}

// ------------------------------------------------------------ game flow ----
function clearTimers() {
  clearTimeout(questionTimer);
  clearTimeout(autoTimer);
  questionTimer = autoTimer = null;
}

function startQuestion(index) {
  clearTimers();
  game.qIndex = index;
  game.phase = 'question';
  game.paused = false;
  game.elapsedBefore = 0;
  game.segmentStart = Date.now();
  questionTimer = setTimeout(endQuestion, currentSet().timeLimit * 1000);
  broadcastNow();
  save();
}

function endQuestion() {
  if (game.phase !== 'question') return;
  clearTimers();
  game.elapsedBefore = elapsed();
  game.phase = 'reveal';
  game.paused = false;
  if (game.autoAdvance) autoTimer = setTimeout(advance, revealMs());
  broadcastNow();
  save();
}

function advance() {
  if (game.phase === 'question') return endQuestion();
  if (game.phase !== 'reveal') return;
  clearTimers();
  if (game.qIndex + 1 < currentSet().questions.length) {
    startQuestion(game.qIndex + 1);
  } else {
    game.phase = 'finished';
    broadcastNow();
    save();
  }
}

function pauseQuestion() {
  if (game.phase !== 'question' || game.paused) return;
  clearTimeout(questionTimer);
  game.elapsedBefore = elapsed();
  game.paused = true;
  broadcastNow();
  save();
}

function resumeQuestion() {
  if (game.phase !== 'question' || !game.paused) return;
  game.paused = false;
  game.segmentStart = Date.now();
  questionTimer = setTimeout(endQuestion, Math.max(0, remaining()));
  broadcastNow();
  save();
}

function resetGame(mode) {
  clearTimers();
  if (mode && SETS[mode]) game.mode = mode;
  game.phase = 'lobby';
  game.qIndex = -1;
  game.paused = false;
  game.elapsedBefore = 0;
  for (const p of players.values()) {
    p.score = 0;
    p.correct = 0;
    p.totalMs = 0;
    p.answers = [];
  }
  broadcastNow();
  save();
}

function allAnswered() {
  if (game.phase !== 'question' || game.paused) return false;
  const online = [...players.values()].filter((p) => p.connected);
  return online.length > 0 && online.every((p) => p.answers[game.qIndex]);
}

// ----------------------------------------------------------- persistence ----
function snapshot() {
  return {
    savedAt: Date.now(),
    mode: game.mode,
    phase: game.phase,
    qIndex: game.qIndex,
    elapsed: game.phase === 'question' ? elapsed() : game.elapsedBefore,
    autoAdvance: game.autoAdvance,
    joinsLocked: game.joinsLocked,
    players: [...players.values()].map(({ id, name, score, correct, totalMs, answers }) => ({
      id, name, score, correct, totalMs, answers,
    })),
  };
}

function writeSnapshot() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot()));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('Could not save state:', err.message);
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSnapshot, 500);
}

function load() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!SETS[s.mode]) return;
    game.mode = s.mode;
    game.phase = ['lobby', 'question', 'reveal', 'finished'].includes(s.phase) ? s.phase : 'lobby';
    game.qIndex = Number.isInteger(s.qIndex) ? s.qIndex : -1;
    game.elapsedBefore = Number(s.elapsed) || 0;
    game.autoAdvance = !!s.autoAdvance;
    game.joinsLocked = !!s.joinsLocked;
    // A question that was running comes back paused: the host decides when to continue.
    game.paused = game.phase === 'question';
    for (const sp of s.players || []) {
      const p = newPlayer(sp.id, sp.name);
      Object.assign(p, { score: sp.score, correct: sp.correct, totalMs: sp.totalMs, answers: sp.answers || [] });
      players.set(p.id, p);
    }
    console.log(`Restored previous session: ${players.size} players, phase "${game.phase}".`);
  } catch (err) {
    console.error('Could not restore state (starting fresh):', err.message);
  }
}

// -------------------------------------------------------------- helpers ----
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

function clientIp(socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : socket.handshake.address) || 'unknown';
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv() {
  const set = currentSet();
  const letters = ['A', 'B', 'C', 'D'];
  const head = ['Rank', 'Name', 'Score', 'Correct', 'Total time (s)'];
  set.questions.forEach((_, i) => head.push(`Q${i + 1}`));
  const lines = [head.map(csvCell).join(',')];
  for (const r of ranked()) {
    const row = [r.rank, r.p.name, r.score, r.correct, (r.totalMs / 1000).toFixed(1)];
    set.questions.forEach((q, i) => {
      const a = r.p.answers[i];
      row.push(a ? `${letters[a.choice]}${a.correct ? ' (correct)' : ''}` : '-');
    });
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n');
}

// --------------------------------------------------------------- sockets ----
io.on('connection', (socket) => {
  const adminOnly = (fn) => (...args) => {
    if (socket.data.isAdmin) fn(...args);
  };
  const reply = (ack, payload) => typeof ack === 'function' && ack(payload);
  socket.emit('info', publicInfo());

  // ---- players ----
  socket.on('join', (data, ack) => {
    data = data || {};
    const existing = typeof data.playerId === 'string' ? players.get(data.playerId) : null;

    if (existing) {
      // Reconnect (phone slept, page refreshed, server restarted): keep score.
      if (existing.socketId && existing.socketId !== socket.id) socketToPlayer.delete(existing.socketId);
      existing.socketId = socket.id;
      existing.connected = true;
      socketToPlayer.set(socket.id, existing.id);
      socket.join('players');
      reply(ack, { ok: true, playerId: existing.id, name: existing.name });
      sendStateTo(socket);
      return scheduleBroadcast();
    }

    const name = cleanName(data.name);
    if (name.length < 2) return reply(ack, { ok: false, error: 'Please enter a name with at least 2 characters.' });
    if (game.joinsLocked) return reply(ack, { ok: false, error: 'Registration is closed. Ask the host.' });
    if (players.size >= MAX_PLAYERS) return reply(ack, { ok: false, error: 'The quiz is full.' });
    const lower = name.toLowerCase();
    if ([...players.values()].some((p) => p.name.toLowerCase() === lower)) {
      return reply(ack, { ok: false, error: `The name "${name}" is already taken. Please choose another.` });
    }

    const p = newPlayer(crypto.randomUUID(), name);
    p.connected = true;
    p.socketId = socket.id;
    players.set(p.id, p);
    socketToPlayer.set(socket.id, p.id);
    socket.join('players');
    reply(ack, { ok: true, playerId: p.id, name: p.name });
    sendStateTo(socket);
    broadcastNow();
    save();
  });

  socket.on('answer', (data, ack) => {
    const p = players.get(socketToPlayer.get(socket.id));
    if (!p) return reply(ack, { ok: false });
    if (game.phase !== 'question' || game.paused) return reply(ack, { ok: false, error: 'Question closed' });
    const choice = data && data.choice;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return reply(ack, { ok: false });
    if (p.answers[game.qIndex]) return reply(ack, { ok: false, error: 'Already answered' });

    const q = currentQuestion();
    const limitMs = currentSet().timeLimit * 1000;
    const ms = Math.min(Math.max(elapsed(), 0), limitMs);
    const isCorrect = choice === q.correct;
    const points = isCorrect ? BASE_POINTS + Math.max(0, Math.round(SPEED_BONUS * (1 - ms / limitMs))) : 0;

    p.answers[game.qIndex] = { choice, ms, points, correct: isCorrect };
    p.score += points;
    if (isCorrect) p.correct += 1;
    p.totalMs += ms;

    reply(ack, { ok: true });
    if (allAnswered()) setTimeout(endQuestion, 600);
    scheduleBroadcast();
    save();
  });

  socket.on('disconnect', () => {
    const p = players.get(socketToPlayer.get(socket.id));
    socketToPlayer.delete(socket.id);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.socketId = null;
      if (allAnswered()) setTimeout(endQuestion, 600);
      scheduleBroadcast();
    }
  });

  // ---- host ----
  socket.on('admin-login', (data, ack) => {
    data = data || {};
    const ip = clientIp(socket);
    const fail = loginFailures.get(ip) || { count: 0, until: 0 };
    if (fail.until > Date.now()) return reply(ack, { ok: false, error: 'Too many attempts. Wait a minute.' });

    let token = typeof data.token === 'string' && adminTokens.has(data.token) ? data.token : null;
    if (!token) {
      if (typeof data.password !== 'string' || !safeEqual(data.password, ADMIN_PASSWORD)) {
        fail.count += 1;
        if (fail.count >= 5) {
          fail.count = 0;
          fail.until = Date.now() + 60000;
        }
        loginFailures.set(ip, fail);
        return reply(ack, { ok: false, error: 'Wrong password.' });
      }
      token = crypto.randomBytes(24).toString('hex');
      adminTokens.add(token);
    }
    loginFailures.delete(ip);
    socket.data.isAdmin = true;
    socket.join('admins');
    reply(ack, { ok: true, token });
    sendStateTo(socket);
  });

  socket.on('admin-set-mode', adminOnly((mode) => {
    if (SETS[mode] && (game.phase === 'lobby' || game.phase === 'finished')) resetGame(mode);
  }));

  socket.on('admin-start', adminOnly(() => {
    if (game.phase === 'lobby' && players.size > 0) startQuestion(0);
  }));

  socket.on('admin-next', adminOnly(() => advance()));
  socket.on('admin-pause', adminOnly(() => pauseQuestion()));
  socket.on('admin-resume', adminOnly(() => resumeQuestion()));
  socket.on('admin-reset', adminOnly(() => resetGame()));

  socket.on('admin-settings', adminOnly((s) => {
    if (!s) return;
    if (typeof s.autoAdvance === 'boolean') {
      game.autoAdvance = s.autoAdvance;
      if (!s.autoAdvance) clearTimeout(autoTimer);
      else if (game.phase === 'reveal' && !autoTimer) autoTimer = setTimeout(advance, revealMs());
    }
    if (typeof s.joinsLocked === 'boolean') game.joinsLocked = s.joinsLocked;
    broadcastNow();
    save();
  }));

  socket.on('admin-kick', adminOnly((id) => {
    const p = players.get(id);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('removed');
    players.delete(id);
    broadcastNow();
    save();
  }));

  socket.on('admin-clear-players', adminOnly(() => {
    io.to('players').emit('removed');
    players.clear();
    socketToPlayer.clear();
    resetGame();
  }));

  socket.on('admin-export', adminOnly((ack) => reply(ack, { csv: buildCsv(), mode: game.mode })));
});

// ------------------------------------------------------------- lifecycle ----
load();
if (game.phase === 'reveal' && game.autoAdvance) autoTimer = setTimeout(advance, revealMs());

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QuranQuest Live listening on port ${PORT}`);
  console.log(`  practice: ${SETS.practice.questions.length} questions @ ${SETS.practice.timeLimit}s`);
  console.log(`  competition: ${SETS.competition.questions.length} questions @ ${SETS.competition.timeLimit}s`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

function shutdown() {
  writeSnapshot();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Keep the process alive through a stray bug; the state is on disk anyway.
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
