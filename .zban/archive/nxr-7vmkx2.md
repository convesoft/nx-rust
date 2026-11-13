---
title: Warn about Cargo directories inside the repository that Nx does not ignore
status: done
type: feature
parent: nxr-w9qa5f
discovered_from: nxr-eg9s2w
created_at: 2026-11-13T14:23:27Z
closed_at: 2026-11-13T18:15:18Z
---

Goal: graph creation warns when a workspace's build or artifact directory lies inside the repository and Nx does not ignore it, as the row of `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) says. Checked by the last paragraph of `VER-SETUP`.

Context: no issue owned this row. nxr-q6cxt3 implements the errors of `DES-DIAGNOSTICS`, and nxr-fy4t4k the warning for a path dependency that Nx cannot see. `init` (nxr-eg9s2w) runs the plugin's `createNodes` through Nx's project-configuration step (`nx-rust/src/generators/init/graph-check.ts`), so a warning that `createNodes` prints reaches `init`'s output without further code. `init`'s report already names each workspace whose build directory lies inside the repository, together with the suggested `build.build-dir` setting. This warning is about what Nx hashes, which is a different matter.

- [x] The warning when the graph is created, naming the directory and advising `.gitignore`; none when only `.nxignore` excludes the directory, or when it lies under a folder that Nx always ignores (`EVD-NX-24-SETUP`)
- [x] A test that `init` prints it
- [x] The warning again from the executor at the start of a task of the workspace concerned ("Warnings where they are seen" in `DES-DIAGNOSTICS`), once the executor of nxr-kmdpgj exists

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- Graph creation warns once per Cargo build or artifact directory that lies inside the repository and that Nx's own ignore checker (`createGitIgnoreChecker` from `nx/src/devkit-internals`, read through the new `nxIgnoreRules` in `nx-internals.ts`) does not leave out. The warning names the directory, its role and the workspaces, and gives the line for the root `.gitignore`. Nothing is printed where the installed Nx lacks that part (`unignoredDirectoryWarnings` in `discovery.ts`).
- Each workspace keeps its warnings (`CargoWorkspace.warnings`), each of its projects records them under `metadata.cargo.warnings`, and the executor prints them at the start of every task (`projectWarnings` in `task.ts`). The shape is the one that nxr-fy4t4k's pull request #33 uses.
- `DES-DIAGNOSTICS` describes the `cargo.warnings` record and how the check reads Nx's rules. The setup page's status note lists the warnings that are implemented.
- Tests: `nx-rust/test/cargo-directories.spec.ts` (10 cases: the warning with `NX_DAEMON=false`; separate and shared directories; none with `.nxignore` alone, with a nested `.gitignore`, or under `node_modules` or `.nx/cache`; the metadata of the projects concerned; the repeat at task start with the daemon off and on), one `init` case in `init.spec.ts`, and one end-to-end case with the daemon on.
- Checks run: `pnpm nx run-many -t build lint test` (613 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (21 passed), `mara schema validate` and `mara project validate` (valid, evaluation complete, no errors or warnings), and `zban check`.
- Found: Nx's file walker also honours `.git/info/exclude` and the global git excludes file, which the checker does not read, so the warning still appears where only those cover the directory. Filed as nxr-6cz4s7, which holds the question for the maintainer.
