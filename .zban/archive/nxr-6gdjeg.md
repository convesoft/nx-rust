---
title: Enforce the merge rules on GitHub
status: done
type: task
priority: high
tags:
  - infra
created_at: 2026-11-13T07:55:22Z
closed_at: 2026-11-13T07:55:44Z
---

`AGENTS.md` says that pull requests are squash-merged and only once CI is green, but nothing on GitHub enforced it: `main` was unprotected, merge commits and rebase merges were allowed, and a squash took the list of commit messages as its message. With several agents working in parallel the rules have to hold without anyone watching. Asked for by the user on 2026-11-13.

- [x] Repository settings: squash merges only; the squash message defaults to the pull request's title and description; merged branches are deleted
- [x] Branch protection on `main`: a pull request is required, with no approving review; the checks `Build, lint, test and format` and `End-to-end tests` are required; force pushes and deletion are off; the rules bind administrators too, because the agents work with the maintainer's account
- [x] `AGENTS.md` says what GitHub enforces, and the workflow says that its job names are required checks

Done when: the GitHub API reports these settings, and a pull request shows that `main` takes this change only through a squash merge with both checks green.

## Summary of Changes

- Repository settings, changed through the GitHub API: `allow_merge_commit` and `allow_rebase_merge` are off, `allow_squash_merge` is on, the squash title is `PR_TITLE` and the squash message `PR_BODY`, and `delete_branch_on_merge` is on.
- Branch protection on `main`: a pull request is required with 0 approving reviews; the required checks are `Build, lint, test and format` and `End-to-end tests`, both from GitHub Actions; `enforce_admins` is on; force pushes and deletion are off. A branch does not have to be up to date with `main` before it is merged (`strict` is off).
- `enforce_admins` is on because every agent works with the maintainer's account, which administers the repository: without it the rules would bind nobody. The cost is that the maintainer cannot push to `main` directly either. It is one switch in the branch protection settings.
- `AGENTS.md` (Commits) says what GitHub enforces. A comment in `.github/workflows/ci.yml` says that the job names are required checks.

Checks run: both groups of settings read back from the GitHub API with the values above; `pnpm nx format:check --all`; actionlint with shellcheck on the workflow; `zban check`. No knowledge and no code changed. CI on this issue's pull request covers the check that is left: that `main` takes the change through a squash merge with both checks green.
