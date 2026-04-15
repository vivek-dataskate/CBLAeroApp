#!/usr/bin/env bash
set -euo pipefail

source /workspaces/CBLAeroApp/.backup-env 2>/dev/null || true

BACKUP_REPO_NAME="vivek-dataskate/CBLAeroApp-artifacts"
BACKUP_DIR="/tmp/cblaero-artifacts-backup"
DATE=$(date '+%Y-%m-%d %H:%M')
source /workspaces/CBLAeroApp/.backup-env 2>/dev/null || true
TOKEN="${ARTIFACTS_BACKUP_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "⚠️  ARTIFACTS_BACKUP_TOKEN not set — skipping backup"
  exit 0
fi

echo "▶ Backing up artifacts..."
rm -rf "$BACKUP_DIR"
git clone "https://oauth2:${TOKEN}@github.com/${BACKUP_REPO_NAME}.git" "$BACKUP_DIR" --quiet

# Main artifacts output
rsync -a --delete /workspaces/CBLAeroApp/_bmad-output/ "$BACKUP_DIR/_bmad-output/"

# BMAD configurations
rsync -a /workspaces/CBLAeroApp/_bmad/project-context.md "$BACKUP_DIR/project-context.md" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/_bmad/bmm/config.yaml "$BACKUP_DIR/_bmad-config.yaml" 2>/dev/null || true

# Custom skills and instructions (from .gitignore exceptions)
rsync -a /workspaces/CBLAeroApp/.github/skills/git-push-pr/ "$BACKUP_DIR/.github-skills-git-push-pr/" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/.github/instructions/ "$BACKUP_DIR/.github-instructions/" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/.vscode/mcp.json "$BACKUP_DIR/.vscode-mcp.json" 2>/dev/null || true

# Project status and workspace notes
rsync -a /workspaces/CBLAeroApp/PROJECT_STATUS.md "$BACKUP_DIR/PROJECT_STATUS.md" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/tech-spec-wip.md "$BACKUP_DIR/tech-spec-wip.md" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/deferred-work.md "$BACKUP_DIR/deferred-work.md" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/review-prompt-*.md "$BACKUP_DIR/" 2>/dev/null || true

# BMAD framework artifacts (excluded from git)
rsync -a /workspaces/CBLAeroApp/_bmad/ "$BACKUP_DIR/_bmad/" --exclude="node_modules" 2>/dev/null || true
rsync -a /workspaces/CBLAeroApp/_bmad-core/ "$BACKUP_DIR/_bmad-core/" --exclude="node_modules" 2>/dev/null || true

# Generated documentation (excluded from git)
rsync -a /workspaces/CBLAeroApp/docs/ "$BACKUP_DIR/docs/" 2>/dev/null || true

# Package lock file (excluded from git)
rsync -a /workspaces/CBLAeroApp/package-lock.json "$BACKUP_DIR/package-lock.json" 2>/dev/null || true

# Backup environment (excluded from git)
rsync -a /workspaces/CBLAeroApp/.backup-env "$BACKUP_DIR/.backup-env" 2>/dev/null || true

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
