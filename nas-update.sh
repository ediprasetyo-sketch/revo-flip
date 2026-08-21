#!/bin/sh
set -eu

# Revo Flip NAS updater
# Run from the project directory, for example: /volume1/docker/RevoFlip

PROJECT_DIR="${PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"
REPO="${REPO:-https://github.com/ediprasetyo-sketch/revo-flip.git}"
BRANCH="${BRANCH:-main}"
BACKUP_DIR="$PROJECT_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d /tmp/revo-flip-update.XXXXXX)"
KEEP="storage postgres backups .env docker-compose.local.yml"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"
mkdir -p "$BACKUP_DIR"

echo "[1/5] Checking latest source..."
git clone --depth 1 --branch "$BRANCH" "$REPO" "$WORK_DIR/source"

if [ -f "$PROJECT_DIR/.revo-flip-version" ]; then
  OLD="$(cat "$PROJECT_DIR/.revo-flip-version" 2>/dev/null || true)"
else
  OLD=""
fi
NEW="$(git -C "$WORK_DIR/source" rev-parse HEAD)"

if [ "$OLD" = "$NEW" ]; then
  echo "Already up to date: $NEW"
  exit 0
fi

echo "[2/5] Backing up current source..."
BACKUP="$BACKUP_DIR/source-$STAMP.tar.gz"
tar --exclude='./storage' --exclude='./postgres' --exclude='./backups' --exclude='./.env' -czf "$BACKUP" -C "$PROJECT_DIR" .

# Preserve the NAS-specific compose file and data folders.
if [ -f "$PROJECT_DIR/docker-compose.yml" ]; then
  cp "$PROJECT_DIR/docker-compose.yml" "$PROJECT_DIR/docker-compose.local.yml"
fi

echo "[3/5] Updating application files..."
for item in "$WORK_DIR/source"/.[!.]* "$WORK_DIR/source"/*; do
  [ -e "$item" ] || continue
  name="$(basename "$item")"
  case " $KEEP " in
    *" $name "*) continue ;;
  esac
  rm -rf "$PROJECT_DIR/$name"
  cp -R "$item" "$PROJECT_DIR/$name"
done

# Restore the working NAS compose configuration after source refresh.
if [ -f "$PROJECT_DIR/docker-compose.local.yml" ]; then
  mv "$PROJECT_DIR/docker-compose.local.yml" "$PROJECT_DIR/docker-compose.yml"
fi

printf '%s' "$NEW" > "$PROJECT_DIR/.revo-flip-version"

echo "[4/5] Rebuilding Revo Flip app..."
docker compose build app

echo "[5/5] Restarting application..."
docker compose up -d --no-deps app

echo "Update complete. Version: $NEW"
echo "Backup: $BACKUP"
