---
title: Hash the files that fileInputs declares
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-fy4t4k
  - nxr-xyq7c8
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:31Z
closed_at: 2026-11-13T19:57:35Z
---

Goal: the `fileInputs` key in `[package.metadata.nx]` and `[workspace.metadata.nx]` puts the declared files outside a crate into the cache keys of the crate and its dependents.

Implements `REQ-BUILD-SCRIPT-INPUTS` and `REQ-FILE-INPUTS-HASHABLE` through the "Declared files" row and paragraph of `DES-INPUTS` (`nx-rust/docs/caching.mara.md`), the `fileInputs` row of `DES-METADATA-TABLES` and the graph-time row for a bad pattern in `DES-DIAGNOSTICS`. Decision: `ADR-DECLARED-FILE-INPUTS`. Checked by the parts of `VER-CACHE-KEYS` that name declared files.

- [x] Turn the `fileInputs` of both tables, which nxr-xyq7c8 reads as `DES-PLUGIN-OPTIONS` gives them, into filesets as the "Declared files" row and paragraph of `DES-INPUTS` say
- [x] Put the filesets for `ProjectSettings.fileInputs` into `InputSettings.added.fileInputs` (`inputSettings` in `nx-rust/src/graph/projects.ts`, empty for now; `nx-rust/src/graph/inputs.ts`), which `namedInputs` adds to the crate's named input `default` after its path dependencies, so that its dependents hash them through `^default`
- [x] The graph-creation error of `REQ-FILE-INPUTS-HASHABLE`, worded as its row in `DES-DIAGNOSTICS`
- [x] A fixture crate that reads files outside its folder, as "How the plugin is tested" in `verification.mara.md` lists
- [x] The declared-file cases of `VER-CACHE-KEYS`: keys, affected selection and the ignored and linked files

Done when: the parts of `VER-CACHE-KEYS` that name declared files pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/src/graph/declared-files.ts` (new): `declaredFiles` resolves each `fileInputs` pattern of both tables against its manifest's folder, up to the first segment with a glob character, and resolves that fixed part to its real path, `..` and symbolic links included. Nx 24.0.6 fails the hash of any `includeIgnored` fileset with a `.` or `..` segment, keeps a stale hash for a link to a file, and matches changed files by their real paths. Each pattern becomes `{ fileset: "{workspaceRoot}/<real path><glob>", includeIgnored: true }`. Each of these is a problem worded as the `DES-DIAGNOSTICS` row: a `..` segment after a glob character, also in a brace alternative; a fixed part whose real path lies outside the repository, also through a link to a folder or a file (including one whose target does not exist yet); and one whose real path lies in the workspace's build or artifact directory. The message names the manifest and the pattern, and for outside the repository points to `runtimeInputs`.
- `nx-rust/src/graph/projects.ts`: `inferProjects` collects the problems of every project, each message once, and fails graph creation with all of them. `inputSettings` takes the filesets into `InputSettings.added.fileInputs`, which `namedInputs` already adds to `default` after the path dependencies. `inputs.ts` and `registration.ts` changed only in doc comments.
- Fixture `declared-files`: `api`'s build script reads `proto/greeting.proto`, which the workspace table declares, and its library includes `docs/banner.txt`, which its own table declares. `app` depends on `api`; `other` depends on neither. It is listed in `fixtureNames`, `fixtures.spec.ts`, `discovery.spec.ts`, `graph.spec.ts` and the test README.
- Tests: `cache-keys.spec.ts` has the matrix rows "keys with declared files" and "keys without declared files". The new `declared-files.spec.ts` covers the named inputs, resolution to real paths (`.`, `..`, an absolute path, a link to a file and one to a folder inside the repository, the repository root, a path below a file), `nx affected` after a commit and with `--files`, and the four ignored cases. A declared link to a file and a pattern through a link to a folder each change the keys of `check`, `lint`, `test`, `build` and `rust:doc` and select the tasks; each case is hashed twice in one workspace, with the link older than the moment within which Nx reads it again. The spec also covers the graph errors, among them a link into `target`. `init.spec.ts` has three rows for `VER-INIT`.
- Mara: `EVD-NX-24-FILE-INPUTS` has a bullet on paths in `includeIgnored` filesets. Nx rejects `.` and `..` segments; it hashes a file afresh through a link to a folder, also one outside the repository; `**` does not descend into a linked folder; a folder pattern covers its files; a link changed within about a second is read again. The `DES-INPUTS` "Declared files" paragraph states the rules above, together with the known limitation that a link reached only through a wildcard stays unresolved: `**` skips a linked folder, so the repository declares the linked folder or file itself. `DES-DIAGNOSTICS`, `VER-CACHE-KEYS` and `VER-INIT` name the `..` case; `VER-CACHE-KEYS` names the link cases. `REQ-BUILD-SCRIPT-INPUTS` and `VER-BUILD-INPUT-CHECK` say that a link named by a declaration counts as its target, so that they no longer contradict the rule. The status notes in `caching.mara.md` and `configuration.mara.md` no longer say that `fileInputs` has no effect, and the user guide bullet mentions links.
- The cases first filed as nxr-g9mgat were decided by the maintainer and done here: a declared link to a file or a fixed part through a link to a folder resolves to its real path, and `..` after a glob character fails graph creation. The remaining case, `**` over a linked folder, is a known limitation documented in `DES-INPUTS`, so nxr-g9mgat was deleted.

Checks run, last after the decided link and `..` rules: `pnpm nx run-many -t build lint`; `pnpm nx test nx-rust --maxWorkers=3`, in place of `run-many -t test` because the machine is short of memory: 26 suites, 769 tests passed; `pnpm nx format:check --all`; `pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 27 passed; `mara schema validate`; `mara project validate`: valid, evaluation complete, 0 errors, 0 warnings; `zban check`. CI on the pull request covers the remaining Done-when check.
