---
title: Decide whether .git/info/exclude and the global git excludes file silence the Cargo directory warning
status: done
type: task
parent: nxr-w9qa5f
related:
  - nxr-7vmkx2
discovered_from: nxr-7vmkx2
created_at: 2026-11-13T18:04:14Z
closed_at: 2026-11-14T07:46:33Z
---

Goal: settle what the warning for a Cargo directory that Nx does not ignore (row of `DES-DIAGNOSTICS` in `nx-rust/docs/setup.mara.md`, paragraph "Directories that Nx does not ignore") does when only `.git/info/exclude` or the user's global git excludes file covers the directory, and record what Nx does in `EVD-NX-24-SETUP`.

Context: `EVD-NX-24-SETUP` ("Ignored paths") and `DES-DIAGNOSTICS` say that Nx leaves out only what `.gitignore` and `.nxignore` exclude and its fixed folders. While implementing nxr-7vmkx2 on 13 November 2026, a scratch git repository with Nx 24.0.6 showed more: `globWithWorkspaceContext(root, ["**/target/**"])` (from `nx/src/utils/workspace-context`, `NX_DAEMON=false`) left out a `target` folder that only `.git/info/exclude` named, and one that only `$XDG_CONFIG_HOME/git/ignore` named; after `.git` was removed, both folders were listed again. Nx's own `createGitIgnoreChecker` (`nx/src/devkit-internals`, "what the native walker ignores") reads neither file, and nxr-7vmkx2's warning uses it, so it warns in both cases: the files in the repository do not leave the directory out, so other clones and CI hash it, while Nx on this machine does not.

- [x] Rerun the observation and add it to `EVD-NX-24-SETUP`
- [x] Ask the maintainer whether the warning should stay (it names a gap that other clones have) or go quiet (Nx on this machine does not read the directory), and update `DES-DIAGNOSTICS` and `VER-SETUP` with the answer
- [x] Change the check and its tests if the answer is to go quiet

## Summary of Changes

Decision (the control plane's, told to the maintainer on 13 November 2026, who did not object): the warning stays when only `.git/info/exclude` or the user's global git excludes file covers the directory. Neither file is part of the repository, so other clones and CI do not leave the directory out, and the warning names a gap that the repository has. The check and its message are unchanged, so the third task item needed no work.

- Observation rerun on 14 November 2026 with Nx 24.0.6, git 2.56.0 and a private git configuration, and added to `EVD-NX-24-SETUP`. Nx left out a folder that only `.git/info/exclude` named and one that only `$XDG_CONFIG_HOME/git/ignore` named, while `createGitIgnoreChecker` left out neither. Unlike what this issue's context says, the global excludes file still kept its folder out after `.git` was removed, and also in a repository that never had one. Nx follows a `core.excludesFile` set in `$XDG_CONFIG_HOME/git/config` in place of the default file.
- `DES-DIAGNOSTICS` ("Directories that Nx does not ignore"), the user guide on `nx-rust/docs/setup.mara.md` and `VER-SETUP` state the rule.
- `nx-rust/test/cargo-directories.spec.ts`: three cases in a git repository with a home folder of the test's own: no excludes file, only `.git/info/exclude`, only the global excludes file. Each draws the warning once. A `project.json` in the directory shows that Nx reads the directory only in the first case.

Checks run: `pnpm nx run-many -t build lint test` (31 suites, 941 tests passed); the changed spec files again with `CI=true GITHUB_ACTIONS=true` and without the agent variables (350 tests passed); `pnpm nx format:check --all`; `mara schema validate`, `mara project validate` and `zban check`. I also confirmed that the new test fails when the expectation of one case is flipped.
