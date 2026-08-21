#!/bin/sh
set -eu

PROJECT_DIR="${PROJECT_DIR:-/volume1/docker/RevoFlip}"
COMPOSE_PROJECT="revo-flip"
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
compose() { docker compose -p "$COMPOSE_PROJECT" "$@"; }
log "=== Revo Flip update/repair check (project=$COMPOSE_PROJECT) ==="

API_URL="https://api.github.com/repos/$OWNER/$REPO/commits/$BRANCH"
NEW="$(curl -fsSL "$API_URL" | sed -n 's/^[[:space:]]*"sha": "\([0-9a-f]*\)".*/\1/p' | head -n 1)"
[ -n "$NEW" ] || { log "ERROR: cannot read latest GitHub commit"; exit 1; }
OLD="$(cat "$VERSION_FILE" 2>/dev/null || true)"
RUNTIME="$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/version 2>/dev/null || true)"
ACTUAL="$(printf '%s' "$RUNTIME" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
log "Installed=${OLD:-none} Latest=$NEW Runtime=${ACTUAL:-missing}"

# Also repair a container that is running outside the Compose project.
APP_PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' revo-flip-app 2>/dev/null || true)"
if [ "$OLD" = "$NEW" ] && [ "$ACTUAL" = "$NEW" ] && [ "$APP_PROJECT" = "$COMPOSE_PROJECT" ]; then
  log "Already up to date, runtime verified, and container belongs to project $COMPOSE_PROJECT"
  exit 0
fi

log "Runtime/source/project mismatch detected. Performing forced repair."

log "[1/8] Downloading exact commit $NEW"
curl -fsSL "https://codeload.github.com/$OWNER/$REPO/tar.gz/$NEW" -o "$ARCHIVE"
mkdir -p "$WORK_DIR/source"
tar -xzf "$ARCHIVE" -C "$WORK_DIR/source" --strip-components=1
[ -f "$WORK_DIR/source/server.js" ] || { log "ERROR: downloaded source invalid"; exit 1; }
grep -q "/api/version" "$WORK_DIR/source/server.js" || { log "ERROR: downloaded source lacks /api/version"; exit 1; }

log "[2/8] Validating compose configuration for project $COMPOSE_PROJECT"
if ! compose config >> "$LOG_FILE" 2>&1; then
  log "ERROR: docker compose config failed"
  exit 1
fi

log "[3/8] Backing up current source"
BACKUP="$BACKUP_DIR/source-$STAMP.tar.gz"
tar --exclude='./storage' --exclude='./postgres' --exclude='./backups' --exclude='./.env' --exclude='./.revo-flip-version' --exclude='./revo-flip-update.log' -czf "$BACKUP" -C "$PROJECT_DIR" .

log "[4/8] Replacing application source"
[ -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env" "$WORK_DIR/env.keep"
[ -f "$PROJECT_DIR/docker-compose.yml" ] && cp "$PROJECT_DIR/docker-compose.yml" "$WORK_DIR/compose.keep"
for f in "$WORK_DIR/source"/* "$WORK_DIR/source"/.[!.]*; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  case "$name" in .git|storage|postgres|backups|.env|.revo-flip-version|revo-flip-update.log) continue ;; esac
  rm -rf "$PROJECT_DIR/$name"
  cp -R "$f" "$PROJECT_DIR/$name"
done
[ -f "$WORK_DIR/env.keep" ] && cp "$WORK_DIR/env.keep" "$PROJECT_DIR/.env"
[ -f "$WORK_DIR/compose.keep" ] && cp "$WORK_DIR/compose.keep" "$PROJECT_DIR/docker-compose.yml"
printf '%s\n' "$NEW" > "$VERSION_FILE"

grep -q "/api/version" "$PROJECT_DIR/server.js" || { log "ERROR: staged server.js lacks /api/version"; exit 1; }
log "Staged source verified"

log "[5/8] Removing any old app container and Compose app service"
# Remove a legacy standalone container with the same fixed name if present.
docker rm -f revo-flip-app >> "$LOG_FILE" 2>&1 || true
compose rm -sf app >> "$LOG_FILE" 2>&1 || true

log "[6/8] Building app with no cache under project $COMPOSE_PROJECT"
if ! compose build --no-cache --pull app >> "$LOG_FILE" 2>&1; then
  log "ERROR: docker build failed"
  exit 1
fi

log "[7/8] Starting freshly built app inside project $COMPOSE_PROJECT"
if ! compose up -d --no-deps --force-recreate app >> "$LOG_FILE" 2>&1; then
  log "ERROR: docker compose up failed"
  exit 1
fi

CID="$(compose ps -q app)"
[ -n "$CID" ] || { log "ERROR: app container not found after start"; exit 1; }
RUN_PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$CID" 2>/dev/null || true)"
[ "$RUN_PROJECT" = "$COMPOSE_PROJECT" ] || { log "ERROR: app started outside expected project: ${RUN_PROJECT:-missing}"; exit 1; }
if ! docker exec "$CID" sh -c 'grep -q "/api/version" /app/server.js'; then
  log "ERROR: running container does not contain new server.js"
  exit 1
fi
IMAGE_VERSION="$(docker exec "$CID" sh -c 'cat /app/.revo-flip-version 2>/dev/null || true')"
log "Container=$CID Project=$RUN_PROJECT ImageVersion=${IMAGE_VERSION:-missing}"

log "[8/8] Verifying HTTP runtime"
i=0
ACTUAL=""
while [ "$i" -lt 30 ]; do
  RUNTIME="$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/version 2>/dev/null || true)"
  ACTUAL="$(printf '%s' "$RUNTIME" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  [ "$ACTUAL" = "$NEW" ] && break
  i=$((i + 1))
  sleep 2
done

if [ "$ACTUAL" != "$NEW" ]; then
  log "ERROR: HTTP runtime mismatch expected=$NEW actual=${ACTUAL:-missing}"
  exit 1
fi
log "SUCCESS: exact version and project verified: $ACTUAL / $RUN_PROJECT"
log "Backup: $BACKUP"
