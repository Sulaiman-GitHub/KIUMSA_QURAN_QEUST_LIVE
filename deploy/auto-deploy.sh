#!/usr/bin/env bash
# Auto-deploy: runs every minute on the Azure VM (via systemd timer).
# Pulls the latest commit of the GitHub repo and, if it changed, validates it,
# copies it to /opt/quranquest, installs deps if needed and restarts the service.
# A deploy is postponed while a question is live so a running round is never cut off.
set -euo pipefail

REPO="https://github.com/Sulaiman-GitHub/KIUMSA_QURAN_QEUST_LIVE.git"
BRANCH="main"
SRC="/var/lib/quranquest-deploy/src"
STATE="/var/lib/quranquest-deploy/deployed-commit"
APP="/opt/quranquest"
SERVICE="quranquest"
PORT="$(grep -E '^PORT=' /etc/quranquest.env | cut -d= -f2 || true)"; PORT="${PORT:-3000}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

exec 9>/run/quranquest-deploy.lock
flock -n 9 || exit 0
mkdir -p "$(dirname "$SRC")"

[ -d "$SRC/.git" ] || git clone -q --depth 1 -b "$BRANCH" "$REPO" "$SRC"
cd "$SRC"
git fetch -q --depth 1 origin "$BRANCH"
NEW="$(git rev-parse FETCH_HEAD)"
OLD="$(cat "$STATE" 2>/dev/null || true)"
[ "$NEW" = "$OLD" ] && exit 0

PHASE="$(curl -s -m 5 "http://localhost:$PORT/health" | sed -n 's/.*"phase":"\([a-z]*\)".*/\1/p' || true)"
if [ "$PHASE" = "question" ] || [ "$PHASE" = "reveal" ]; then
  log "New commit ${NEW:0:7} waiting - a round is live (phase=$PHASE); will retry."
  exit 0
fi

log "Deploying ${NEW:0:7} (was ${OLD:0:7})"
git reset -q --hard FETCH_HEAD

# Refuse to deploy a broken question bank / server file.
timeout 30 node -e "require('./questions.js')" || { log "questions.js failed validation - NOT deploying"; echo "$NEW" > "$STATE.failed"; exit 1; }
node --check server.js || { log "server.js syntax error - NOT deploying"; exit 1; }

DEPS_CHANGED=0
cmp -s package-lock.json "$APP/package-lock.json" || DEPS_CHANGED=1

rsync -a --chown=quizapp:quizapp server.js questions.js package.json package-lock.json "$APP/"
rsync -a --delete --chown=quizapp:quizapp public/ "$APP/public/"

if [ "$DEPS_CHANGED" = 1 ]; then
  log "Dependencies changed - running npm ci"
  (cd "$APP" && runuser -u quizapp -- npm ci --omit=dev --no-audit --no-fund)
fi

systemctl restart "$SERVICE"
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  curl -sf -m 3 "http://localhost:$PORT/health" >/dev/null && { echo "$NEW" > "$STATE"; log "Deployed ${NEW:0:7} OK"; exit 0; }
done
log "Service did not come back healthy after deploy of ${NEW:0:7}!"
exit 1
