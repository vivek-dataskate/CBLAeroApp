---
name: "Automated Git PR Workflow"
description: "Intercept 'push' commands to run full Git workflow: branch → commit → push → PR → optional merge. Use when user says push, commit and create PR, or submit for review."
---

# CBLAeroApp Git → PR Workflow

## Quick Commands

| Command | Action |
|---------|--------|
| `push` | Full workflow: branch → commit → push → create PR |
| `push --squash` | Same, but squash commits before merge |
| `push --auto-merge` | Create PR and auto-merge immediately |
| `push --draft` | Create as draft PR (not ready for review) |

## How It Works

When you say **"push"** or any variant, I will automatically:

1. ✅ Check what files have changed
2. ✅ Create a feature branch (`feature/story-X-description`)
3. ✅ Stage and commit all changes (with conventional commit message)
4. ✅ Push to remote
5. ✅ Open a GitHub PR for review
6. ✅ Ask if you want to merge now

You get a full code review workflow without typing all the Git commands!

## Examples

```
YOU: push
ME: [checks changes] → [creates branch] → [commits] → [creates PR #42]
    Ready to merge? (y/n)

YOU: Yes
ME: ✅ Merged! Branch deleted. Back to master.
```

## Notes

- **After each major feature**: Just say `push` to submit for review
- **Default behavior**: PR created in regular (non-draft) mode, ready for review
- **Merge is optional**: I'll ask before merging, never auto-merge without confirmation
- **Feature branch naming**: Automatically derives from commit message and story numbers
