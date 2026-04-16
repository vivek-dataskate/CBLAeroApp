# /push — Full Git Push Workflow

When the user runs `/push` or says "push" in the context of committing code, execute the following git workflow by running the project's push script.

## What it does

1. Stage all changes (`git add -A`)
2. Commit with an auto-generated or user-supplied message
3. Pull latest `master` with rebase
4. Merge current feature branch into `master` (no fast-forward)
5. Push `master` to remote
6. Delete the feature branch locally and remotely

## Execution

Run this command in the project root:

```bash
bash scripts/git-push-all.sh "$COMMIT_MESSAGE"
```

If the user provided a commit message after `/push`, pass it as the argument. Otherwise omit it and the script will auto-generate one from the changed files.

## Examples

- `/push` → auto-generates commit message
- `/push feat: add scheduler control plane` → uses that message

## Notes

- Safe to run on `master` directly — skips merge/delete steps and just commits + pulls + pushes
- Script is at `scripts/git-push-all.sh`
- Always confirm with user before running if there are merge conflicts
