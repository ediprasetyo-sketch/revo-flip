#!/bin/sh
set -eu

PROJECT_DIR="${PROJECT_DIR:-/volume1/docker/RevoFlip}"
OWNER="ediprasetyo-sketch"
REPO="revo-flip"
BRANCH="${BRANCH:-main}"
BACKUP_DIR="$PROJECT_DIR/backups"
VERSION_FILE="$PROJECT_DIR/.revo-flip-version"
LOG_FILE="$PROJECT_DIR/revo-flip-update.log"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d /tmp/revo-flip-update.XXXXXX)"
ARCHIVE="$WORK_DIR/source.tar.gz"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

[ -d "$PROJECT_DIR" ] || { echo "ERROR: project directory not found: $PROJECT_DIR"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required"; exit 1; }

mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"
log "=== Revo Flip update check ==="

API_URL="https://api.github.com/repos/$OWNER/$REPO/commits/$BRANCH"
NEW="$(curl -fsSL "$API_URL" | sed -n 's/^[[:space:]]*"sha": "\([0-9a-f]*\)".*/\1/p' | head -n 1)"
[ -n "$NEW" ] || { log "ERROR: cannot read latest GitHub commit"; exit 1; }
OLD="$(cat "$VERSION_FILE" 2>/dev/null || true)"
log "Installed=${OLD:-none} Latest=$NEW"

if [ "$OLD" = "$NEW" ]; then
  log "Already up to date"
  exit 0
fi

log "[1/6] Downloading source for exact commit $NEW"
curl -fsSL "https://codeload.github.com/$OWNER/$REPO/tar.gz/$NEW" -o "$ARCHIVE"
mkdir -p "$WORK_DIR/source"
tar -xzf "$ARCHIVE" -C "$WORK_DIR/source" --strip-components=1
[ -f "$WORK_DIR/source/server.js" ] || { log "ERROR: downloaded source invalid"; exit 1; }

log "[2/6] Backing up current application source"
BACKUP="$BACKUP_DIR/source-$STAMP.tar.gz"
tar --exclude='./storage' --exclude='./postgres' --exclude='./backups' --exclude='./.env' --exclude='./.revo-flip-version' -czf "$BACKUP" -C "$PROJECT_DIR" .

log "[3/6] Replacing application files"
[ -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env" "$WORK_DIR/env.keep"
[ -f "$PROJECT_DIR/docker-compose.yml" ] && cp "$PROJECT_DIR/docker-compose.yml" "$WORK_DIR/compose.keep"
rm -rf "$PROJECT_DIR/public" "$PROJECT_DIR/src" "$PROJECT_DIR/db"
for f in "$WORK_DIR/source"/* "$WORK_DIR/source"/.[!.]*; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  case "$name" in .git|storage|postgres|backups|.env|.revo-flip-version) continue ;; esac
  rm -rf "$PROJECT_DIR/$name"
  cp -R "$f" "$PROJECT_DIR/$name"
done
[ -f "$WORK_DIR/env.keep" ] && cp "$WORK_DIR/env.keep" "$PROJECT_DIR/.env"
[ -f "$WORK_DIR/compose.keep" ] && cp "$WORK_DIR/compose.keep" "$PROJECT_DIR/docker-compose.yml"
printf '%s\n' "$NEW" > "$VERSION_FILE"

log "[4/6] Verifying staged source"
grep -q "/api/version" "$PROJECT_DIR/server.js" || { log "ERROR: version endpoint missing; rollback required"; exit 1; }
grep -q "no-store" "$PROJECT_DIR/server.js" || { log "ERROR: cache policy missing; rollback required"; exit 1; }

log "[5/6] Building app without cache"
docker compose build --no-cache app

log "[6/6] Recreating app and verifying runtime version"
docker compose up -d --no-deps --force-recreate app
EXPECTED="$NEW"
ACTUAL=""
i=0
while [ "$i" -lt 30 ]; do
  ACTUAL="$(curl -fsS http://127.0.0.1:3000/api/version 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
  [ "$ACTUAL" = "$EXPECTED" ] && break
  i=$((i + 1))
  sleep 2
done

if [ "$ACTUAL" != "$EXPECTED" ]; then
  log "ERROR: runtime version mismatch expected=$EXPECTED actual=${ACTUAL:-none}"
  exit 1
fi
log "SUCCESS: runtime version verified: $ACTUAL"
log "Backup: $BACKUP"
