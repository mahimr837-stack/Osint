#!/usr/bin/env bash
set -euo pipefail

BRANCH="${SYNC_BRANCH:-main}"
MSG="${1:-sync: update $(date -u '+%Y-%m-%d %H:%M:%S UTC')}"

git add -A

if ! git diff --cached --quiet; then
  git commit -m "$MSG"
else
  echo "No local changes to commit."
fi

echo "Pulling latest changes from origin/$BRANCH..."
git pull --rebase origin "$BRANCH"

echo "Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

echo "Sync complete."
