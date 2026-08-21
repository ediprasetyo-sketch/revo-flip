#!/bin/sh
set -eu

# Revo Flip NAS updater
# Designed for Synology Task Scheduler / SSH. Requires curl, tar and docker.

PROJECT_DIR="${PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"
OWNER="ediprasetyo-sketch"
REPO="revo-flip"
BRANCH="${BRANCH:-main}"
BACKUP_DIR="$PROJECT_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d /tmp/revo-flip-update.XXXXXX)"
ARCHIVE="$WORK_DIR/source.tar.gz"
KEEP="storage postgres backups .env docker-compose.local.yml"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"
mkdir -p "$BACKUP_DIR"

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required."
  exit 1
fi

API_URL="https://api.github.com/repos/$OWNER/$REPO/commits/$BRANCH"
NEW="$(curl -fsSL "$API_URL" | sed -n 's/^[[:space:]]*"sha": "\([0-9a-f]*\)".*/\1/p' | head -n 1)"
[ -n "$NEW" ] || { echo "ERROR: cannot read latest GitHub version"; exit 1; }
OLD="$(cat "$PROJECT_DIR/.revo-flip-version" 2>/dev/null || true)"

if [ "$OLD" = "$NEW" ]; then
  echo "Already up to date: $NEW"
  exit 0
fi

echo "[1/5] Downloading latest source..."
curl -fsSL "https://codeload.github.com/$OWNER/$REPO/tar.gz/refs/heads/$BRANCH" -o "$ARCHIVE"
mkdir -p "$WORK_DIR/source"
tar -xzf "$ARCHIVE" -C "$WORK_DIR/source" --strip-components=1

echo "[2/5] Backing up current source..."
BACKUP="$BACKUP_DIR/source-$STAMP.tar.gz"
tar --exclude='./storage' --exclude='./postgres' --exclude='./backups' --exclude='./.env' -czf "$BACKUP" -C "$PROJECT_DIR" .

# Preserve the NAS-specific compose file and data folders.
[ -f "$PROJECT_DIR/docker-compose.yml" ] && cp "$PROJECT_DIR/docker-compose.yml" "$PROJECT_DIR/docker-compose.local.yml"

echo "[3/5] Updating application files..."
for item in "$WORK_DIR/source"/.[!.]* "$WORK_DIR/source"/*; do
  [ -e "$item" ] || continue
  name="$(basename "$item")"
  case " $KEEP " in *" $name "*) continue ;; esac
  rm -rf "$PROJECT_DIR/$name"
  cp -R "$item" "$PROJECT_DIR/$name"
done

# Restore the working NAS compose configuration after source refresh.
[ -f "$PROJECT_DIR/docker-compose.local.yml" ] && mv "$PROJECT_DIR/docker-compose.local.yml" "$PROJECT_DIR/docker-compose.yml"
printf '%s' "$NEW" > "$PROJECT_DIR/.revo-flip-version"

echo "[4/5] Rebuilding Revo Flip app..."
docker compose build app

echo "[5/5] Restarting application..."
docker compose up -d --no-deps app

echo "Update complete. Version: $NEW"
echo "Backup: $BACKUP"
