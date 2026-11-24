# QuranQuest Live

Real-time Quran quiz for live events. One host runs the quiz from a dashboard that is projected for the room; everyone else answers on their phone.

## How it works

| Who | Opens | Sees |
|---|---|---|
| **Host** | `/admin` (password) | The projected screen: question, countdown, answer results, live leaderboard, podium. Controls at the bottom. |
| **Players** | `/` | Only their name entry and four answer buttons, their own result and rank. |

**Two modes** (host switches between them in the lobby):

- **Practice**: 20 training questions. Scores do not count, and an explanation is shown after each answer.
- **Competition**: 50 questions, 15 s each (configurable).

**Round flow:** question (timer) -> reveal (correct answer + how everyone answered) -> next. The host presses *Next* or turns on *Auto-advance*. The question closes early once everyone has answered.

**Scoring:** 80 points for a correct answer + up to 20 speed bonus. Ties are broken by correct answers, then total time.

### Host controls

`Start` / `Reveal answer` / `Next question`, `Pause` / `Resume`, `Auto-advance`, `Lock joining`, `Export CSV`, `Reset round`, remove a player. Keys: **N** next, **P** pause, **F** presentation mode (hides controls, fullscreen), **Esc** exit.

### Built for event day

- The server decides everything. Correct answers are never sent to phones before the reveal, and scores stay hidden on the projector while a question is open.
- Phones that sleep or refresh **reconnect with their score intact**.
- The session is **saved to disk** (`DATA_DIR`). If the server restarts, scores come back and the running question resumes *paused* so the host decides when to continue.
- Host password required; brute-force lockout; names are never injected as HTML; strict security headers; no external CDNs or fonts (works on a weak venue network).

## Run locally

```bash
npm install
ADMIN_PASSWORD=choose-a-password npm start      # Windows PowerShell: $env:ADMIN_PASSWORD="choose-a-password"; npm start
```

- Players: http://localhost:3000
- Host: http://localhost:3000/admin
- Tests: `npm test` (boots a server, plays a full practice round with 3 simulated players)

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | random (printed at boot) | **Set this.** Host login. |
| `PORT` | 3000 | Provided by most hosts automatically. |
| `DATA_DIR` | `./data` | Where the session snapshot is saved. Must survive restarts. |
| `PRACTICE_SECONDS` / `COMPETITION_SECONDS` | 15 / 15 | Time per question. |
| `PRACTICE_REVEAL_SECONDS` / `COMPETITION_REVEAL_SECONDS` | 6 / 4 | How long the answer stays on screen before the next question (Auto-advance on). |
| `MAX_PLAYERS` | 500 | Safety cap. |

## Editing questions

All questions live in `questions.js`. The server refuses to start if a question is malformed. **Have a knowledgeable teacher review every question and answer before the event.**

## Hosting

The game state lives in one Node process, so run **exactly one instance** (do not scale horizontally).

- **Always-on** matters most. Free tiers that sleep when idle (e.g. Render free) can take ~1 minute to wake and may restart mid-event.
- Use a paid always-on instance, or a small VPS (1 vCPU / 1 GB RAM is plenty for hundreds of players).
- On a VPS: `pm2 start server.js --name quiz` behind **Caddy** or nginx for HTTPS (WebSocket upgrade enabled), with `ADMIN_PASSWORD` and `DATA_DIR` set.
- Use HTTPS (phones and some networks block or interfere with plain ws://).

## Event-day checklist

1. Deploy at least a day early; open `/health` to confirm it is up.
2. Run a full rehearsal with real phones on the **venue's** Wi-Fi (or a hotspot) in the same room.
3. Have a backup: a phone hotspot ready, and a second person who knows the host password.
4. Run **Practice** first with everyone, then *Switch to Competition*, wait for everyone to join, press **Lock joining**, then Start.
5. Use **Presentation mode** on the projected laptop; keep the laptop plugged in and disable sleep.
6. After the quiz, **Export CSV** straight away (results are also in `DATA_DIR/state.json`).
