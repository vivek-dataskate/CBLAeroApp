---
name: git-push-pr
description: "Automated Git-to-PR workflow. Use when: user says 'push', wants to submit changes for review, or requests 'create PR and merge'. Handles: branch creation, staging, committing, pushing, PR creation, and optional merge."
argument-hint: "Optionally specify PR title, description, whether to auto-merge, or draft status"
---

# Automated Git Push → PR → Merge Workflow

Complete end-to-end Git workflow: create feature branch, commit changes, push, open PR, and optionally merge to master.

## When to Use

- User says `push` (shorthand for full workflow)
- User wants to `open a PR` with automatic setup
- User requests `commit and create PR`
- User wants to `submit for review`
- User needs `merge to master` after PR approval

## Procedure

### 1. Check Working Tree State

Run git status to determine what needs to be committed:

```bash
git status --porcelain
```

- **Uncommitted changes**: Show user what changed, ask confirmation to proceed
- **No changes**: Inform user there's nothing to push
- **Mixed staged/unstaged**: Offer to stage all changes

### 2. Create Feature Branch

If on `master` or `main`, create a feature branch using the pattern:
```
feature/story-<story-number>-<brief-description>
```

For example:
```bash
git checkout -b feature/story-2-7-global-scheduler
```

**Edge case**: If already on a feature branch, use that branch.

### 3. Stage and Commit Changes

Stage all modified files:
```bash
git add -A
```

Commit with a conventional commit message:
```bash
git commit -m "feat: [description from recent changes]"
```

Or if user provided a message, use that. Follow conventional commits:
- `feat:` for features
- `fix:` for bug fixes
- `chore:` for maintenance
- `docs:` for documentation
- `test:` for tests

### 4. Push to Remote

Push the feature branch to origin:
```bash
git push --set-upstream origin <branch-name>
```

Handle case where remote doesn't exist yet.

### 5. Create Pull Request

Use the `create_pull_request` skill to open a PR:

- **Head branch**: The feature branch you just created
- **Base branch**: `master` (or `main` if that's the default)
- **Title**: Derive from commit message or ask user
- **Body**: Include:
  - Summary of changes
  - Story reference (e.g., "Implements story 2-7")
  - Files changed (optional)
  - Testing notes (optional)
- **Draft**: Ask user, default to `false` for immediate review

### 6. Optional: Auto-Merge

If user requested merge or PR is auto-mergeable:

```bash
gh pr merge <pr-number> --merge
```

Or ask user:
- `--merge`: Create a merge commit
- `--squash`: Squash commits before merging
- `--rebase`: Rebase and fast-forward

Then return to master:
```bash
git checkout master
git pull origin master
```

## Implementation Steps

When user says "push":

1. ✅ Check git status
2. ✅ Create feature branch (if not already on one)
3. ✅ Add and commit all changes
4. ✅ Push branch to remote
5. ✅ Call `create_pull_request` tool
6. ⚠️ Ask: "Merge now?" (then call `gh pr merge` if yes)
7. ✅ Report PR number and URL

## Example Dialogue

**User**: `push`

**Agent**:
```
📋 Found 7 modified files and 2 new files:
  - src/modules/ingestion/scheduler.ts
  - src/modules/__tests__/ingestion-scheduler.test.ts
  - [5 more files]

🔀 Creating branch: feature/story-2-7-global-scheduler
📝 Committing: "feat: implement global scheduler control plane (story 2-7)"
🚀 Pushing to origin...
📌 PR Title: Implement global scheduler control plane (story 2-7)

Ready to create PR? (y/n)
```

After confirmation:
```
✅ PR #42 created: https://github.com/vivek-dataskate/CBLAeroApp/pull/42

Merge now? Options:
  [m] --merge (default merge commit)
  [s] --squash (squash commits)
  [r] --rebase (rebase and fast-forward)
  [n] skip merge
```

## Best Practices

- **Always confirm** before creating PR or merging
- **Auto-derive commit message** from changed files or ask user
- **Use conventional commits** for consistency with project
- **Default draft: false** but allow user override for work-in-progress
- **Show diff summary** before committing
- **Handle conflicts gracefully** if merge base has drifted

## Error Handling

| Scenario | Action |
|----------|--------|
| No changes staged | Show status, ask if user wants to proceed with empty PR |
| Merge conflict on push | Ask user to resolve before proceeding |
| PR creation fails | Show error, suggest debugging |
| Push to remote fails | Check network, credentials, branch permissions |

## Tools Used

- `run_in_terminal`: Git commands (add, commit, push, checkout)
- `github-pull-request_create_pull_request`: Create PR
- `send_to_terminal` (optional): For interactive merge confirmation
