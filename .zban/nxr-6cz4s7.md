---
title: Decide whether .git/info/exclude and the global git excludes file silence the Cargo directory warning
status: todo
type: task
parent: nxr-w9qa5f
related:
  - nxr-7vmkx2
discovered_from: nxr-7vmkx2
created_at: 2026-11-13T18:04:14Z
---

Goal: settle what the warning for a Cargo directory that Nx does not ignore (row of `DES-DIAGNOSTICS` in `nx-rust/docs/setup.mara.md`, paragraph "Directories that Nx does not ignore") does when only `.git/info/exclude` or the user's global git excludes file covers the directory, and record what Nx does in `EVD-NX-24-SETUP`.

Context: `EVD-NX-24-SETUP` ("Ignored paths") and `DES-DIAGNOSTICS` say that Nx leaves out only what `.gitignore` and `.nxignore` exclude and its fixed folders. While implementing nxr-7vmkx2 on 13 November 2026, a scratch git repository with Nx 24.0.6 showed more: `globWithWorkspaceContext(root, ["**/target/**"])` (from `nx/src/utils/workspace-context`, `NX_DAEMON=false`) left out a `target` folder that only `.git/info/exclude` named, and one that only `$XDG_CONFIG_HOME/git/ignore` named; after `.git` was removed, both folders were listed again. Nx's own `createGitIgnoreChecker` (`nx/src/devkit-internals`, "what the native walker ignores") reads neither file, and nxr-7vmkx2's warning uses it, so it warns in both cases: the files in the repository do not leave the directory out, so other clones and CI hash it, while Nx on this machine does not.

- [ ] Rerun the observation and add it to `EVD-NX-24-SETUP`
- [ ] Ask the maintainer whether the warning should stay (it names a gap that other clones have) or go quiet (Nx on this machine does not read the directory), and update `DES-DIAGNOSTICS` and `VER-SETUP` with the answer
- [ ] Change the check and its tests if the answer is to go quiet
