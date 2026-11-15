---
title: Decide how publishing handles uncommitted changes on Cargo 1.91, which does not refuse them where the Cargo workspace lies in a subfolder of the repository
status: done
type: bug
priority: high
parent: nxr-6q2chq
related:
  - nxr-m8evx2
discovered_from: nxr-m8evx2
created_at: 2026-11-15T16:33:26Z
closed_at: 2026-11-15T17:08:01Z
---

`DES-RELEASE` ("Credentials and tree") relies on cargo refusing to publish uncommitted changes, because the executor never passes `--allow-dirty`. The tests of nxr-m8evx2 found that Cargo 1.91.0 does not refuse them where the Cargo workspace's root lies in a subfolder of the git repository, which is the usual layout of an Nx monorepo: `nx release publish` on Cargo 1.91 uploaded `pub-base` with an unstaged change to its `src/lib.rs`. The same `cargo package --no-verify` refused in a repository whose root is the workspace root, and Cargo 1.97.1, 1.98.1, 1.99.0 and 1.100.0 refused in both layouts; versions 1.92 to 1.96 were not tried (`EVD-CARGO-PUBLISH`, fourth session). The plugin supports Cargo 1.91 (`REQ-COMPATIBILITY`), so on it a user can publish code that is not committed.

The maintainer chooses, then `DES-RELEASE`, `VER-RELEASE` (group 7, "An uncommitted change fails the task …") and the test "fails a task over uncommitted changes" in `nx-rust/test/release-publish.spec.ts`, which asserts the upload on Cargo 1.91 for now, follow:

- The executor checks the tree itself before each call, for example `git status --porcelain` limited to the files that cargo would package for the crates of the call (`cargo package --list`), and fails those crates with the line about committing the new versions, on every Cargo version. A check of the plugin's own beside cargo's.
- Publishing requires a newer Cargo than the plugin's minimum: the executor fails on a Cargo older than the first version that refuses, to be found among 1.92 to 1.97.
- A known limit, documented in `release.mara.md`: on Cargo 1.91 commit before publishing, as `nx release` does by default.

- [x] Get the maintainer's choice and record it in `DES-RELEASE`
- [x] Implement it: a documented limit, with no check of the plugin's own; the test records what cargo does on Cargo 1.91 and the latest stable

## Summary of Changes

- The maintainer's decision of 15 November 2026, in his words: "Ok why git what if we don't have git document it as a limitation we have nothing to do with it". The plugin never passes `--allow-dirty` and does not check the working tree or call git for it; whether uncommitted changes are refused is cargo's own check on the Cargo in use.
- `DES-RELEASE` ("Credentials and tree") states the rule, the decision with its date, the options not chosen (a check of the plugin's own with git; a newer minimum Cargo for publishing) and the reason; the release guide says plainly what the runs showed (Cargo 1.91.0 does not refuse in a workspace below the repository root, 1.97.1 to 1.100.0 do, 1.92 to 1.96 not tried) and to commit before publishing; the new accepted risk `RISK-UNCOMMITTED-PUBLISH`, mitigated by `DES-RELEASE`, records that such an upload cannot be taken back. `EVD-CARGO-PUBLISH` stays as it was.
- `VER-RELEASE` group 7 and the test in `nx-rust/test/release-publish.spec.ts`, now named "leaves uncommitted changes to cargo's own check: …", describe and assert what cargo does on each version, refused on the latest stable and uploaded on 1.91.0, as cargo's behaviour that the plugin leaves alone.
- Checks: the test passed on Cargo 1.100.0 and 1.91.0; the final checks of the branch are listed in nxr-m8evx2, closed in the same change.
