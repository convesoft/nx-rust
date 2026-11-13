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

- `nx-rust/src/graph/declared-files.ts` (new): `declaredFiles` resolves each `fileInputs` pattern of both tables against its manifest's folder, up to the first segment with a glob character. Nx 24.0.6 fails the hash of any `includeIgnored` fileset with a `.` or `..` segment, so those segments are resolved there. Each pattern becomes `{ fileset: "{workspaceRoot}/<path>", includeIgnored: true }`. A pattern whose fixed part resolves outside the repository, also through a symbolic link to a folder or a file (including one whose target does not exist yet), or into the workspace's build or artifact directory, is a problem worded as the `DES-DIAGNOSTICS` row. The message names the manifest and the pattern, and for outside the repository points to `runtimeInputs`.
- `nx-rust/src/graph/projects.ts`: `inferProjects` collects the problems of every project, each message once, and fails graph creation with all of them. `inputSettings` takes the filesets into `InputSettings.added.fileInputs`, which `namedInputs` already adds to `default` after the path dependencies. `inputs.ts` and `registration.ts` changed only in doc comments.
- Fixture `declared-files`: `api`'s build script reads `proto/greeting.proto`, which the workspace table declares, and its library includes `docs/banner.txt`, which its own table declares. `app` depends on `api`; `other` depends on neither. It is listed in `fixtureNames`, `fixtures.spec.ts`, `discovery.spec.ts`, `graph.spec.ts` and the test README.
- Tests: `cache-keys.spec.ts` has the matrix rows "keys with declared files" and "keys without declared files". The new `declared-files.spec.ts` covers the named inputs, resolution (`.`, `..`, an absolute path, a link inside the repository, the repository root, a path below a file), `nx affected` after a commit and with `--files`, the four ignored cases and the declared link, each hashed twice in one workspace, and the graph errors. `init.spec.ts` has two rows for `VER-INIT`.
- Mara: `EVD-NX-24-FILE-INPUTS` has a bullet on paths in `includeIgnored` filesets. Nx rejects `.` and `..` segments; it hashes a file afresh through a link to a folder, also one outside the repository; `**` does not descend into a linked folder; a folder pattern covers its files; a link changed within about a second is read again. The `DES-INPUTS` "Declared files" paragraph says "also through a symbolic link" and gives the corrected reason. `VER-CACHE-KEYS` names the link cases of the error. The status notes in `caching.mara.md` and `configuration.mara.md` no longer say that `fileInputs` has no effect, and the user guide bullet mentions links.
- Follow-up: nxr-g9mgat (draft) holds four cases for a decision: a declared link to a file (stale key by design), a pattern through a folder link inside the repository (keys change, `nx affected` misses it), `**` over a linked folder (silently skipped) and `..` after a glob character (Nx's own hash error).

Checks run: `pnpm nx run-many -t build lint`; `pnpm nx test nx-rust --maxWorkers=6`, in place of `run-many -t test` because the machine is short of memory: 26 suites, 766 tests passed; `pnpm nx format:check --all`; `pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 27 passed; `mara schema validate`; `mara project validate`: valid, evaluation complete, 0 errors, 0 warnings; `zban check`. CI on the pull request covers the remaining Done-when check.
