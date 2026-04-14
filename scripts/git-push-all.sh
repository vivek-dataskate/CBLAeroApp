#!/usr/bin/env bash
# git-push-all.sh
# Usage: ./scripts/git-push-all.sh ["commit message"]
# When called with no message, auto-generates one from staged file list.
# Full workflow: stage → commit → pull master → merge → push → delete branch.

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
cd "$(git rev-parse --show-toplevel)"

CURRENT=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT" == "HEAD" ]] && die "Detached HEAD — check out a branch first"

info "Branch: ${CURRENT}  →  target: ${BASE_BRANCH}"

# ── 1. Stage all changes ──────────────────────────────────────────────────
info "Staging all changes..."
git add -A

if git diff --cached --quiet; then
  warn "Nothing to commit — working tree clean."
  SKIP_COMMIT=true
else
  SKIP_COMMIT=false

  # Auto-generate message if not provided
  if [[ -z "$COMMIT_MSG" ]]; then
    CHANGED_FILES=$(git diff --cached --name-only | head -5 | tr '\n' ' ')
    FILE_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
    DATE=$(date '+%Y-%m-%d')
    COMMIT_MSG="chore: update ${FILE_COUNT} file(s) — ${CHANGED_FILES}[${DATE}]"
  fi

  info "Committing: \"${COMMIT_MSG}\""
  git commit -m "$COMMIT_MSG"
  ok "Committed"
fi

# ── 2. On master? push directly ───────────────────────────────────────────
if [[ "$CURRENT" == "$BASE_BRANCH" ]]; then
  info "Already on ${BASE_BRANCH}, pulling and pushing..."
  git pull --rebase "$REMOTE" "$BASE_BRANCH"
  git push "$REMOTE" "$BASE_BRANCH"
  ok "Pushed ${BASE_BRANCH}"
  exit 0
fi

# ── 3. Feature branch: push branch, pull master, merge, push, clean up ───
info "Pushing feature branch to remote..."
git push "$REMOTE" "$CURRENT"
ok "Pushed ${CURRENT} to ${REMOTE}"

info "Checking out ${BASE_BRANCH}..."
git checkout "$BASE_BRANCH"

info "Pulling latest ${BASE_BRANCH}..."
git pull --rebase "$REMOTE" "$BASE_BRANCH"
ok "Pulled ${BASE_BRANCH}"

info "Merging ${CURRENT} → ${BASE_BRANCH} (no fast-forward)..."
git merge --no-ff "$CURRENT" -m "Merge branch '${CURRENT}' into ${BASE_BRANCH}"
ok "Merged"

info "Pushing ${BASE_BRANCH}..."
git push "$REMOTE" "$BASE_BRANCH"
ok "Pushed ${BASE_BRANCH}"

# ── 4. Delete branch locally + remote ─────────────────────────────────────
info "Deleting local branch ${CURRENT}..."
git branch -d "$CURRENT"
ok "Local branch deleted"

info "Deleting remote branch ${CURRENT}..."
git push "$REMOTE" --delete "$CURRENT" 2>/dev/null && ok "Remote branch deleted" \
  || warn "Remote branch already deleted or not found — skipping"

echo ""
ok "Done. All changes merged into ${BASE_BRANCH} and ${CURRENT} cleaned up."
