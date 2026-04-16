#!/usr/bin/env bash
# git-push-all.sh
# Usage: ./scripts/git-push-all.sh ["commit message"]
# When called with no message, auto-generates one from staged file list.
# Full workflow: create feature branch → commit → push → open PR → merge → delete branch.

set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✅ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $*${NC}"; }
die()   { echo -e "${RED}❌ $*${NC}"; exit 1; }

# ── config ────────────────────────────────────────────────────────────────
BASE_BRANCH="master"
REMOTE="origin"
COMMIT_MSG="${1:-}"

# ── guards ────────────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || die "git not found"
command -v gh  >/dev/null 2>&1 || die "gh CLI not found — install from https://cli.github.com"
cd "$(git rev-parse --show-toplevel)"

CURRENT=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT" == "HEAD" ]] && die "Detached HEAD — check out a branch first"

# ── 1. Stage all changes ──────────────────────────────────────────────────
info "Staging all changes..."
git add -A

if git diff --cached --quiet; then
  warn "Nothing to commit — working tree clean."
  exit 0
fi

# Auto-generate message if not provided
if [[ -z "$COMMIT_MSG" ]]; then
  CHANGED_FILES=$(git diff --cached --name-only | head -5 | tr '\n' ' ')
  FILE_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
  DATE=$(date '+%Y-%m-%d')
  COMMIT_MSG="chore: update ${FILE_COUNT} file(s) — ${CHANGED_FILES}[${DATE}]"
fi

# ── 2. Create feature branch if on base branch ───────────────────────────
if [[ "$CURRENT" == "$BASE_BRANCH" ]]; then
  # Generate branch name from commit message: lowercase, replace non-alphanum with dashes
  SLUG=$(echo "$COMMIT_MSG" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//' | cut -c1-50)
  BRANCH="auto/${SLUG}"
  info "Creating feature branch: ${BRANCH}"
  git checkout -b "$BRANCH"
  CURRENT="$BRANCH"
else
  info "On feature branch: ${CURRENT}"
fi

info "Branch: ${CURRENT}  →  target: ${BASE_BRANCH}"

# ── 3. Commit ─────────────────────────────────────────────────────────────
info "Committing: \"${COMMIT_MSG}\""
git commit -m "$COMMIT_MSG"
ok "Committed"

# ── 4. Push feature branch ───────────────────────────────────────────────
info "Pushing ${CURRENT} to ${REMOTE}..."
git push -u "$REMOTE" "$CURRENT"
ok "Pushed ${CURRENT}"

# ── 5. Create PR via gh CLI ──────────────────────────────────────────────
info "Creating pull request..."
PR_URL=$(gh pr create \
  --base "$BASE_BRANCH" \
  --head "$CURRENT" \
  --title "$COMMIT_MSG" \
  --body "$(cat <<'PREOF'
Automated PR created via `scripts/git-push-all.sh`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PREOF
)" 2>&1)
ok "PR created: ${PR_URL}"

# ── 6. Merge PR via gh CLI ───────────────────────────────────────────────
info "Merging PR..."
gh pr merge "$CURRENT" --merge --delete-branch
ok "PR merged and remote branch deleted"

# ── 7. Switch back to base branch and clean up ───────────────────────────
info "Switching to ${BASE_BRANCH} and pulling..."
git checkout "$BASE_BRANCH"
git pull "$REMOTE" "$BASE_BRANCH"
ok "Pulled latest ${BASE_BRANCH}"

# Prune stale remote tracking refs
git fetch --prune

# Delete local feature branch if it still exists
if git rev-parse --verify "$CURRENT" >/dev/null 2>&1; then
  info "Deleting local branch ${CURRENT}..."
  git branch -d "$CURRENT"
  ok "Local branch deleted"
fi

echo ""
ok "Done. PR merged into ${BASE_BRANCH} and ${CURRENT} cleaned up."
echo -e "${CYAN}   PR: ${PR_URL}${NC}"
