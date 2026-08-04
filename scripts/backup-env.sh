#!/usr/bin/env bash
# Backs up .env.local before any operation that might overwrite it (e.g.
# `vercel env pull`), never printing its contents. Created after a real
# incident: `vercel integration add stripe`'s automatic env pull replaced
# .env.local with only the variables registered on the Vercel project,
# silently dropping locally-set variables (the Supabase credentials) that
# had never been registered there. See docs/DEPLOYMENT_GUIDE.md's
# "Environment Recovery" section.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SOURCE=".env.local"
BACKUP_DIR=".env-backups"

if [ ! -f "$SOURCE" ]; then
  echo "No $SOURCE found — nothing to back up."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEST="$BACKUP_DIR/.env.local.$TIMESTAMP"

if [ -e "$DEST" ]; then
  echo "WARNING: $DEST already exists (same-second backup) — not overwriting. Re-run in a moment."
  exit 1
fi

cp "$SOURCE" "$DEST"
echo "Backed up $SOURCE -> $DEST"
