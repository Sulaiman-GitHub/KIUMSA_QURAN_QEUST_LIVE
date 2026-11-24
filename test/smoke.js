'use strict';

/**
 * End-to-end smoke test: boots the server, signs in as host, joins 3 players, runs the whole
 * practice round and checks the important guarantees (no answer leaks, scoring, reconnect, auth).
 *   npm test
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');
const { SETS } = require('../questions');

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const PASSWORD = 'test-pass';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-'));

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const emitAck = (s, ev, data) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ack for ${ev}`)), 3000);
    const done = (v) => { clearTimeout(t); res(v); };
    if (data === undefined) s.emit(ev, done);
    else s.emit(ev, data, done);
  });
const connect = () =>
  new Promise((res) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.latest = null;
    s.on('state', (st) => (s.latest = st));
    s.on('me', (m) => (s.me = m));
    s.on('connect', () => res(s));
  });
const until = async (fn, label, ms = 4000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (fn()) return true;
    await wait(40);
  }
  console.log('  FAIL timed out waiting for: ' + label);
  failures++;
  return false;
};

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, ADMIN_PASSWORD: PASSWORD, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));

  try {
    console.log('Auth');
    const rogue = await connect();
    const bad = await emitAck(rogue, 'admin-login', { password: 'nope' });
    check(bad.ok === false, 'wrong password is rejected');
    rogue.emit('admin-start'); // must be ignored
    const admin = await connect();
    const good = await emitAck(admin, 'admin-login', { password: PASSWORD });
    check(good.ok && good.token, 'correct password signs in');
    await until(() => admin.latest, 'admin state');
    check(admin.latest.phase === 'lobby', 'starts in lobby');

    console.log('Joining');
    const a = await connect(), b = await connect(), c = await connect();
    const ja = await emitAck(a, 'join', { name: 'Aisha' });
    const jb = await emitAck(b, 'join', { name: 'Bilal' });
    const dup = await emitAck(c, 'join', { name: 'aisha' });
    check(ja.ok && jb.ok, 'two players join');
    check(dup.ok === false, 'duplicate name (case-insensitive) is refused');
    const jc = await emitAck(c, 'join', { name: 'Chidi' });
    check(jc.ok, 'third player joins');
    await until(() => admin.latest.counts.players === 3, '3 players visible to host');

    console.log('Practice round');
    admin.emit('admin-start');
    await until(() => a.latest && a.latest.phase === 'question', 'question 1 open');
    check(a.latest.question && a.latest.question.options.length === 4, 'players receive the question');
    check(!('correct' in a.latest.question) && !('explain' in a.latest.question), 'no correct answer inside the question sent to players');
    check(a.latest.reveal === null, 'reveal is null while question is open');

    const q0 = SETS.practice.questions[0];
    await emitAck(a, 'answer', { choice: q0.correct });
    await emitAck(b, 'answer', { choice: (q0.correct + 1) % 4 });
    const dupAns = await emitAck(a, 'answer', { choice: (q0.correct + 1) % 4 });
    check(dupAns.ok === false, 'second answer to same question is refused');
    await wait(500);
    check(admin.latest.leaderboard.every((r) => r.score === 0), 'scores are hidden while the question is open');

    await emitAck(c, 'answer', { choice: q0.correct });
    await until(() => a.latest.phase === 'reveal', 'auto reveal once everyone answered');
    check(a.latest.reveal.correct === q0.correct, 'reveal shows the correct answer');
    await until(() => a.me && a.me.score >= 80 && a.me.result, 'player score after reveal');
    check(a.me.score >= 80 && a.me.score <= 100, `correct answer scores 80-100 (got ${a.me.score})`);
    check(b.me.score === 0, 'wrong answer scores 0');
    await until(() => admin.latest.leaderboard[0] && admin.latest.leaderboard[0].score >= 80, 'leaderboard updates at reveal');

    console.log('Reconnect');
    const pid = ja.playerId;
    a.disconnect();
    await wait(300);
    const a2 = await connect();
    const re = await emitAck(a2, 'join', { playerId: pid });
    check(re.ok && re.name === 'Aisha', 'player reconnects with saved id');
    await until(() => a2.me && a2.me.score >= 80, 'score kept after reconnect');

    console.log('Pause');
    admin.emit('admin-next');
    await until(() => admin.latest.phase === 'question' && admin.latest.current === 2, 'question 2 open');
    admin.emit('admin-pause');
    await until(() => admin.latest.paused, 'paused');
    const r = await emitAck(b, 'answer', { choice: 0 });
    check(r.ok === false, 'answers are refused while paused');
    admin.emit('admin-resume');
    await until(() => !admin.latest.paused, 'resumed');

    console.log('Finish');
    const total = SETS.practice.questions.length;
    for (let i = 1; i < total; i++) {
      await until(() => admin.latest.phase === 'question' && admin.latest.current === i + 1, `question ${i + 1} open`);
      admin.emit('admin-next'); // host reveals
      await until(() => admin.latest.phase === 'reveal' && admin.latest.current === i + 1, `question ${i + 1} revealed`);
      admin.emit('admin-next');
    }
    await until(() => admin.latest.phase === 'finished', 'quiz finishes');
    const csv = await emitAck(admin, 'admin-export');
    check(csv.csv.split('\n').length === 4, 'CSV has a header + 3 players');
    check(csv.csv.startsWith('Rank,Name,Score'), 'CSV header looks right');

    admin.emit('admin-set-mode', 'competition');
    await until(() => admin.latest.mode === 'competition' && admin.latest.phase === 'lobby', 'switch to competition resets');
    check(admin.latest.leaderboard.every((r) => r.score === 0), 'scores reset when switching mode');
    check(admin.latest.counts.players === 3, 'players stay joined after the switch');

    [rogue, admin, a2, b, c].forEach((s) => s.disconnect());
  } catch (err) {
    console.error('Test crashed:', err);
    failures++;
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
  }
})();
