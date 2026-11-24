'use strict';

/* Player page. The server decides everything; this only shows it. */
(() => {
  const { $, $$, h, makeTimer } = QQ;
  const socket = io({ transports: ['websocket', 'polling'] });

  let state = null;
  let me = null;
  let joined = false;
  let history = {}; // question number -> what this player saw (for the end-of-quiz review)
  let historyMode = null;

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const screens = ['lobby', 'quiz', 'results'];
  const show = (name) => screens.forEach((s) => $('#' + s).classList.toggle('active', s === name));
  const options = $$('#options .option');

  // ------------------------------------------------------------ connection
  socket.on('connect', () => {
    $('#conn').classList.add('hidden');
    if (store.get('qq_pid') && store.get('qq_name')) attemptJoin(store.get('qq_name'), true);
  });
  socket.on('disconnect', () => $('#conn').classList.remove('hidden'));
  socket.on('connect_error', () => $('#conn').classList.remove('hidden'));
  // Before joining, the server only sends a small public summary (mode, number of questions, time).
  function applyInfo(i) {
    $('#tagline').textContent = i.isPractice
      ? 'Practice Round | ' + i.total + ' Questions | Scores do not count'
      : 'Competition | ' + i.total + ' Questions × ' + Math.round(i.limitMs / 1000) + ' Seconds Each';
    $('#infoCount').textContent = i.total + ' Questions';
    $('#infoSecs').textContent = Math.round(i.limitMs / 1000) + ' seconds';
    $('#participantCount').textContent = i.players;
  }
  socket.on('info', (i) => { if (!state) applyInfo(i); });
  socket.on('state', (s) => { state = s; render(); });
  socket.on('me', (m) => { me = m; render(); });
  socket.on('removed', () => {
    store.del('qq_pid');
    joined = false;
    me = null;
    $('#joinError').textContent = 'You were removed from the quiz. You can join again.';
    resetJoinForm();
    render();
  });

  // ------------------------------------------------------------------ join
  function resetJoinForm() {
    $('#username').disabled = false;
    $('#joinBtn').disabled = false;
    $('#joinBtn').textContent = 'Join Quiz';
  }

  function attemptJoin(name, silent) {
    if (!silent) {
      $('#joinBtn').disabled = true;
      $('#joinBtn').textContent = 'Joining...';
      $('#joinError').textContent = '';
    }
    socket.emit('join', { name, playerId: store.get('qq_pid') }, (res) => {
      if (res && res.ok) {
        store.set('qq_pid', res.playerId);
        store.set('qq_name', res.name);
        joined = true;
        $('#waitName').textContent = res.name;
      } else {
        if (silent) store.del('qq_pid');
        joined = false;
        $('#joinError').textContent = (res && res.error) || 'Could not join. Please try again.';
        resetJoinForm();
      }
      render();
    });
  }

  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#username').value.trim();
    if (name.length < 2) {
      $('#joinError').textContent = 'Please enter a name with at least 2 characters.';
      return;
    }
    store.del('qq_pid'); // typing a name = a fresh player
    attemptJoin(name, false);
  });
  if (store.get('qq_name')) $('#username').value = store.get('qq_name');

  // ---------------------------------------------------------------- answer
  options.forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (!state || state.phase !== 'question' || state.paused) return;
      if (me && me.choice !== null && me.choice !== undefined) return;
      if (me) me.choice = i; // lock immediately
      renderQuestion();
      socket.emit('answer', { choice: i }, (res) => {
        if (res && !res.ok && me) { me.choice = null; renderQuestion(); } // e.g. time was just up
      });
    })
  );

  // ----------------------------------------------------------------- timer
  const timer = makeTimer((left) => {
    const t = $('#timer');
    if (!state || state.phase !== 'question') { t.textContent = '--'; t.classList.remove('warning'); return; }
    const secs = Math.ceil(left / 1000);
    t.textContent = secs;
    t.classList.toggle('warning', secs <= 5);
  });

  // ---------------------------------------------------------------- render
  const hasChoice = () => me && me.choice !== null && me.choice !== undefined;

  function renderLeaderboard() {
    const list = $('#leaderboardList');
    list.replaceChildren();
    state.leaderboard.forEach((r) => {
      list.appendChild(
        h('div', 'leaderboard-item' + (me && r.name === me.name ? ' you' : ''), null, [
          h('span', 'leaderboard-rank', r.rank),
          h('span', 'leaderboard-name', r.name),
          h('span', 'leaderboard-score', r.score),
          h('span', 'leaderboard-correct', r.correct + '/' + state.total),
        ])
      );
    });
  }

  function renderPerformance() {
    const done = state.phase === 'reveal' ? state.current : Math.max(0, state.current - 1);
    const correct = me ? me.correct : 0;
    const incorrect = Math.max(0, done - correct);
    $('#correctCount').textContent = correct;
    $('#incorrectCount').textContent = incorrect;
    $('#accuracy').textContent = (done > 0 ? Math.round((correct / done) * 100) : 0) + '%';
    $('#currentScore').textContent = me ? me.score : 0;
  }

  function fillQuestion() {
    const q = state.question;
    $('#currentQ').textContent = state.current;
    $('#totalQ').textContent = state.total;
    $('#questionText').textContent = q.text;
    options.forEach((b, i) => { b.textContent = q.options[i]; });
  }

  function renderQuestion() {
    if (!state || !state.question) return;
    fillQuestion();
    const locked = hasChoice();
    options.forEach((b, i) => {
      b.disabled = locked || state.paused;
      b.className = 'option' + (locked && me.choice === i ? ' selected' : '');
    });
    $('#status').textContent = locked ? 'Answer locked in. Waiting for the result...' : state.isPractice ? 'Practice round: scores do not count.' : '';
    $('#feedback').classList.add('hidden');
    $('#explain').classList.add('hidden');
    timer.set(state.remainingMs, state.limitMs, state.paused);
  }

  function renderReveal() {
    fillQuestion();
    const r = state.reveal;
    const res = me && me.result;
    options.forEach((b, i) => {
      b.disabled = true;
      let cls = 'option';
      if (i === r.correct) cls += ' correct';
      else if (me && me.choice === i) cls += ' incorrect';
      else cls += ' dim';
      b.className = cls;
    });
    $('#status').textContent = '';
    const fb = $('#feedback');
    fb.classList.remove('hidden', 'good', 'bad', 'none');
    if (res && res.isCorrect) { fb.classList.add('good'); fb.textContent = 'Correct! +' + res.points + ' points'; }
    else if (res && res.missed) { fb.classList.add('none'); fb.textContent = "Time's up - no answer"; }
    else { fb.classList.add('bad'); fb.textContent = 'Incorrect'; }
    const ex = $('#explain');
    ex.classList.toggle('hidden', !r.explain);
    ex.textContent = r.explain || '';

    history[state.current] = {
      n: state.current,
      text: state.question.text,
      options: state.question.options,
      correct: r.correct,
      choice: me && hasChoice() ? me.choice : null,
    };
  }

  function renderResults() {
    $('#resultsTitle').textContent = state.isPractice ? '🎉 Practice Complete!' : '🎉 Quiz Finished! Final Results';
    $('#myResult').textContent = me ? 'You finished ' + ordinal(me.rank) + ' of ' + me.of + ' with ' + me.score + ' points.' : '';

    const board = $('#finalLeaderboard');
    board.replaceChildren();
    state.leaderboard.forEach((r) => {
      const acc = Math.round((r.correct / state.total) * 100);
      board.appendChild(
        h('div', 'leaderboard-item' + (me && r.name === me.name ? ' you' : ''), null, [
          h('span', 'leaderboard-rank', r.rank),
          h('span', 'leaderboard-name', r.name),
          h('span', 'leaderboard-score', r.score),
          h('span', 'leaderboard-correct', r.correct + '/' + state.total),
          h('span', 'leaderboard-correct', acc + '%'),
        ])
      );
    });

    const review = $('#questionsReview');
    review.replaceChildren();
    Object.values(history).sort((a, b) => a.n - b.n).forEach((q) => {
      const ok = q.choice === q.correct;
      review.appendChild(
        h('div', 'review-item', null, [
          h('div', 'review-question', q.n + '. ' + q.text),
          h('div', 'review-answer ' + (ok ? 'correct' : 'incorrect'), null, [
            h('div', null, null, [
              h('strong', null, 'Your answer: '),
              document.createTextNode(q.choice === null ? 'Not answered' : q.options[q.choice]),
              document.createElement('br'),
              h('strong', null, 'Correct answer: '),
              document.createTextNode(q.options[q.correct]),
            ]),
            h('span', 'answer-status ' + (ok ? 'correct' : 'incorrect'), ok ? '✓ Correct' : '✗ Incorrect'),
          ]),
        ])
      );
    });
  }

  function ordinal(n) { return QQ.ordinal(n); }

  function render() {
    if (!state) return;
    if (historyMode !== state.mode || state.phase === 'lobby') { history = {}; historyMode = state.mode; }

    $('#tagline').textContent = state.isPractice
      ? 'Practice Round | ' + state.total + ' Questions | Scores do not count'
      : 'Competition | ' + state.total + ' Questions × ' + Math.round(state.limitMs / 1000) + ' Seconds Each';
    $('#infoCount').textContent = state.total + ' Questions';
    $('#infoSecs').textContent = Math.round(state.limitMs / 1000) + ' seconds';
    $('#participantCount').textContent = state.counts.players;
    $('#pausedOverlay').classList.toggle('hidden', !(joined && state.paused && state.phase === 'question'));

    if (!joined || state.phase === 'lobby') {
      show('lobby');
      $('#joinBox').classList.toggle('hidden', joined);
      $('#waitBox').classList.toggle('hidden', !joined);
      $('#waitMsg').textContent = state.isPractice
        ? 'Practice round: no pressure, scores do not count. Waiting for the host to start.'
        : 'Please wait while the host starts the quiz. Questions will appear here when it begins.';
      $('#waitInfo').textContent = '⏱️ Get ready: ' + state.total + ' questions × ' + Math.round(state.limitMs / 1000) + ' seconds';
      return;
    }

    if (state.phase === 'finished') {
      show('results');
      renderResults();
      return;
    }

    show('quiz');
    renderLeaderboard();
    renderPerformance();
    if (state.phase === 'question') renderQuestion();
    else renderReveal();
  }

  // ---------------------------------------------------------------- share
  $('#shareBtn').addEventListener('click', () => {
    if (!me) return;
    const text = 'I scored ' + me.score + ' points and ranked ' + ordinal(me.rank) + ' in the QuranQuest Live Quiz! Correct answers: ' + me.correct + '/' + (state ? state.total : '');
    if (navigator.share) {
      navigator.share({ title: 'My QuranQuest Results', text, url: location.href }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => alert('Results copied to clipboard!'));
    }
  });
})();
