---
title: Use Nx Release changelog formatting for GitHub Releases in release.yml
status: done
type: task
parent: nxr-nm0jd6
created_at: 2026-11-22T00:52:58Z
closed_at: 2026-11-22T00:55:35Z
---

Goal: replace `gh release create --generate-notes` in `.github/workflows/release.yml` with `nx release changelog` so GitHub Releases use Nx's Conventional Commits formatting (`### 🚀 Features`, `### 🩹 Fixes`, `### ❤️ Thank You`, etc., matching `araketski/pi-packages`) while keeping tag-only releases without version-bump commits on `main`. Also refresh the existing `v1.0.0-rc.1` GitHub Release notes to match.

- [x] Configure `release` (`projects`, `conventionalCommits`, `releaseTag`, `changelog.workspaceChangelog`, `changelog.git`) in `nx.json`
- [x] Update `.github/workflows/release.yml` to preview (`--dry-run`) and create the GitHub Release + tag via `pnpm nx release changelog`
- [x] Verify with `pnpm nx release changelog --dry-run`, `pnpm nx format:check --all`, `zban check`, and CI on the PR
- [x] Refresh the existing `v1.0.0-rc.1` GitHub Release body using Nx Release's formatted changelog

Done when: all checks pass, the PR is ready/merged, and `v1.0.0-rc.1`'s GitHub Release notes use Nx Release formatting.

## Summary of Changes

- `nx.json`: configured `release` (`projects: ["@convesoft/nx-rust"]`, `conventionalCommits.useCommitScope: false`, `releaseTag.pattern: "v{version}"`, `changelog.automaticFromRef: true`, `changelog.workspaceChangelog: { createRelease: "github", file: false }`, `changelog.projectChangelogs: false`, `changelog.git: { commit: false, tag: true, push: true }`).
- `.github/workflows/release.yml`: replaced `gh release create --generate-notes` with `pnpm nx release changelog "$VERSION" --git-push-args="refs/tags/v$VERSION"` (plus a `--dry-run` preview step when `dry_run: true`) so tags push cleanly without touching protected `main` and GitHub Releases use Nx's Conventional Commits formatting.
- Refreshed the existing `v1.0.0-rc.1` GitHub Release body with Nx Release's formatted changelog (`### 🚀 Features`, `### 🩹 Fixes`, `### 🔥 Performance`, `### ❤️ Thank You`).
- Checks run: `pnpm nx release changelog 1.0.0-rc.2 --git-push-args="refs/tags/v1.0.0-rc.2" --dry-run --verbose`, `pnpm nx format:check --all`, `zban check`, and CI on the pull request.
