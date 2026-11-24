'use strict';

/* Host dashboard: same screens as the players, plus a control panel. This is the page you project. */
(() => {
  const { $, $$, h, makeTimer } = QQ;
  const socket = io({ transports: ['websocket', 'polling'] });

  let state = null;
  let authed = false;

  const session = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  // ------------------------------------------------------------------ auth
  function showDash(on) {
    $('#login').classList.toggle('active', !on);
    $('#dash').classList.toggle('hidden', !on);
  }

  function login(payload) {
    socket.emit('admin-login', payload, (res) => {
      if (res && res.ok) {
        authed = true;
        session.set('qq_admin', res.token);
        $('#loginError').textContent = '';
        showDash(true);
      } else {
        authed = false;
        session.del('qq_admin');
        showDash(false);
        $('#loginError').textContent = (res && res.error) || 'Could not sign in.';
      }
    });
  }

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    login({ password: $('#password').value });
    $('#password').value = '';
  });
  socket.on('connect', () => {
    const token = session.get('qq_admin');
    if (token) login({ token });
  });
  $('#logoutBtn').addEventListener('click', () => { session.del('qq_admin'); location.reload(); });

  socket.on('state', (s) => { if (authed) { state = s; render(); } });

  // ----------------------------------------------------------------- timer
  const timer = makeTimer((left) => {
    const t = $('#timer');
    if (!state || state.phase !== 'question') { t.textContent = '--'; t.classList.remove('warning'); return; }
    const secs = Math.ceil(left / 1000);
    t.textContent = secs;
    t.classList.toggle('warning', secs <= 5);
  });

  // ---------------------------------------------------------------- render
  const screens = ['lobby', 'quiz', 'results'];
  const show = (name) => screens.forEach((s) => $('#' + s).classList.toggle('active', s === name));

  function leaderboardRows(box, withAccuracy) {
    box.replaceChildren();
    if (!state.leaderboard.length) { box.appendChild(h('div', 'leaderboard-item', 'No players yet')); return; }
    state.leaderboard.forEach((r) => {
      const cells = [
        h('span', 'leaderboard-rank', r.rank),
        h('span', 'leaderboard-name', r.name),
        h('span', 'leaderboard-score', r.score),
        h('span', 'leaderboard-correct', r.correct + '/' + state.total),
      ];
      if (withAccuracy) cells.push(h('span', 'leaderboard-correct', Math.round((r.correct / state.total) * 100) + '%'));
      box.appendChild(h('div', 'leaderboard-item', null, cells));
    });
  }

  function render() {
    $('#tagline').textContent =
      (state.isPractice ? 'Practice Round' : 'Competition') + ' | ' + state.total + ' Questions × ' + Math.round(state.limitMs / 1000) + ' Seconds';
    renderPanel();
    renderPlayers();

    if (state.phase === 'lobby') {
      show('lobby');
      $('#joinUrl').textContent = location.host;
      $('#participantCount').textContent = state.counts.players;
      const chips = $('#chips');
      chips.replaceChildren();
      state.admin.players.slice(-60).forEach((p) => chips.appendChild(h('span', 'chip' + (p.connected ? '' : ' off'), p.name)));
      return;
    }

    if (state.phase === 'finished') {
      show('results');
      $('#resultsTitle').textContent = state.isPractice ? '🎉 Practice Complete!' : '🎉 Quiz Finished! Final Results';
      leaderboardRows($('#finalLeaderboard'), true);
      return;
    }

    show('quiz');
    const revealing = state.phase === 'reveal';
    const r = state.reveal;
    $('#pausedBanner').classList.toggle('hidden', !state.paused);
    $('#currentQ').textContent = state.current;
    $('#totalQ').textContent = state.total;
    $('#questionText').textContent = state.question.text;
    $('#answered').textContent = state.counts.answered;
    $('#playerTotal').textContent = state.counts.players;

    $$('#quiz .option').forEach((el, i) => {
      el.querySelector('.opt-text').textContent = state.question.options[i];
      let cls = 'option static';
      let count = '';
      if (revealing) {
        cls += i === r.correct ? ' correct' : ' dim';
        const pct = r.answered ? Math.round((r.distribution[i] / r.answered) * 100) : 0;
        count = r.distribution[i] + ' answered (' + pct + '%)';
      }
      el.className = cls;
      el.querySelector('.opt-count').textContent = count;
    });

    const info = $('#revealInfo');
    info.classList.toggle('hidden', !revealing);
    if (revealing) info.textContent = r.correctCount + ' of ' + r.answered + ' who answered got it right' + (r.total - r.answered > 0 ? ' · ' + (r.total - r.answered) + ' did not answer' : '');
    const ex = $('#explain');
    ex.classList.toggle('hidden', !(revealing && r.explain));
    ex.textContent = revealing && r.explain ? r.explain : '';

    $('#statAnswered').textContent = revealing ? r.answered : state.counts.answered;
    $('#statCorrect').textContent = revealing ? r.correctCount : '-';
    $('#statOnline').textContent = state.counts.connected;

    leaderboardRows($('#leaderboardList'), false);
    timer.set(state.remainingMs, state.limitMs, state.paused || revealing);
  }

  // -------------------------------------------------------------- controls
  function primaryLabel() {
    switch (state.phase) {
      case 'lobby': return 'Start ' + (state.isPractice ? 'Practice' : 'Competition');
      case 'question': return 'Reveal Answer';
      case 'reveal': return state.current >= state.total ? 'Show Final Results' : 'Next Question';
      default: return 'New Round';
    }
  }

  function renderPanel() {
    $$('#modeSeg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === state.mode);
      b.disabled = !(state.phase === 'lobby' || state.phase === 'finished');
    });
    const primary = $('#primaryBtn');
    primary.textContent = primaryLabel();
    primary.disabled = state.phase === 'lobby' && state.counts.players === 0;
    const pause = $('#pauseBtn');
    pause.classList.toggle('hidden', state.phase !== 'question');
    pause.textContent = state.paused ? 'Resume' : 'Pause';
    $('#autoChk').checked = state.settings.autoAdvance;
    $('#lockChk').checked = state.settings.joinsLocked;
  }

  function renderPlayers() {
    const list = state.admin ? state.admin.players : [];
    $('#pCount').textContent = list.length;
    const details = $('#plist').closest('details');
    if (!details.open) return;
    const box = $('#plist');
    box.replaceChildren();
    list.forEach((p) => {
      const kick = h('button', null, 'Remove');
      kick.type = 'button';
      kick.addEventListener('click', () => {
        if (confirm('Remove "' + p.name + '" from the quiz?')) socket.emit('admin-kick', p.id);
      });
      box.appendChild(h('div', 'prow', null, [h('span', null, (p.connected ? '🟢 ' : '⚪ ') + p.name + (p.answered ? ' ✓' : '')), kick]));
    });
  }

  function doPrimary() {
    if (!state) return;
    if (state.phase === 'lobby') {
      if (state.counts.players === 0) return;
      if (!state.isPractice && !confirm('Start the COMPETITION for ' + state.counts.players + ' players?')) return;
      socket.emit('admin-start');
    } else if (state.phase === 'finished') {
      socket.emit('admin-reset');
    } else {
      socket.emit('admin-next');
    }
  }
  function doPause() {
    if (state && state.phase === 'question') socket.emit(state.paused ? 'admin-resume' : 'admin-pause');
  }

  $('#primaryBtn').addEventListener('click', doPrimary);
  $('#pauseBtn').addEventListener('click', doPause);
  $$('#modeSeg button').forEach((b) =>
    b.addEventListener('click', () => {
      if (state && b.dataset.mode !== state.mode && confirm('Switch mode? Everyone stays joined but scores reset to zero.')) {
        socket.emit('admin-set-mode', b.dataset.mode);
      }
    })
  );
  $('#autoChk').addEventListener('change', (e) => socket.emit('admin-settings', { autoAdvance: e.target.checked }));
  $('#lockChk').addEventListener('change', (e) => socket.emit('admin-settings', { joinsLocked: e.target.checked }));
  $('#resetBtn').addEventListener('click', () => {
    if (confirm('Reset? Scores go back to zero and everyone returns to the lobby.')) socket.emit('admin-reset');
  });
  $('#clearBtn').addEventListener('click', () => {
    if (confirm('Remove ALL players? They will have to join again.')) socket.emit('admin-clear-players');
  });
  $('#plist').closest('details').addEventListener('toggle', () => state && renderPlayers());
  $('#exportBtn').addEventListener('click', () => {
    socket.emit('admin-export', (res) => {
      if (!res || !res.csv) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + res.csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'quranquest-' + res.mode + '-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  });

  // Big screen mode: larger text, controls hidden (for the projector)
  function bigScreen(force) {
    const on = typeof force === 'boolean' ? force : !document.body.classList.contains('present');
    document.body.classList.toggle('present', on);
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  $('#bigBtn').addEventListener('click', () => bigScreen());

  document.addEventListener('keydown', (e) => {
    if (!authed || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'n' || k === 'arrowright') doPrimary();
    else if (k === 'p') doPause();
    else if (k === 'f') bigScreen();
    else if (k === 'escape') bigScreen(false);
  });
})();
