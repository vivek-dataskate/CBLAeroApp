#!/usr/bin/env bash
set -euo pipefail

BACKUP_REPO_NAME="vivek-dataskate/CBLAeroApp-artifacts"
BACKUP_DIR="/tmp/cblaero-artifacts-backup"
DATE=$(date '+%Y-%m-%d %H:%M')

# Use Codespace secret if available, otherwise fail gracefully
TOKEN="${ARTIFACTS_BACKUP_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "⚠️  ARTIFACTS_BACKUP_TOKEN not set — skipping backup"
  exit 0
fi

echo "▶ Backing up artifacts to ${BACKUP_REPO_NAME}..."
rm -rf "$BACKUP_DIR"
git clone "https://oauth2:${TOKEN}@github.com/${BACKUP_REPO_NAME}.git" "$BACKUP_DIR" --quiet

rsync -a --delete /workspaces/CBLAeroApp/_bmad-output/ "$BACKUP_DIR/_bmad-output/"
rsync -a /workspaces/CBLAeroApp/_bmad/project-context.md "$BACKUP_DIR/project-context.md" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/_bmad/bmm/config.yaml "$BACKUP_DIR/_bmad-config.yaml" 2>/dev/null || true

cd "$BACKUP_DIR"
git config user.email "vivek.yadlapalli@gmail.com"
git config user.name "Vivek"
git add -A

if git diff --cached --quiet; then
  echo "✅ No changes since last backup"
else
  git commit -m "backup: $DATE"
  git push "https://oauth2:${TOKEN}@github.com/${BACKUP_REPO_NAME}.git" main
  echo "✅ Pushed — $DATE"
fi
rm -rf "$BACKUP_DIR"
