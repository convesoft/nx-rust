---
title: Check compatibility and report missing tools
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
  - nxr-1bv0wm
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T15:28:47Z
---

Goal: unsupported versions, missing tools and contradictory options produce messages that say what is wrong and what to do.

Implements `REQ-COMPATIBILITY` and `REQ-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`). Checked by `VER-SETUP`.

- [x] Version checks for Nx and Cargo with the found and required versions in the message
- [x] The peer dependency range of the package names the supported Nx majors, `^24` at first
- [x] Graph-time errors for the problems the design lists: the versions of Nx and Cargo here; a missing cargo, a failing `cargo metadata` and the name collision existed already; a missing pinned toolchain fails through `RUSTUP_AUTO_INSTALL=0` (nxr-66wa7d), and the rows for options and settings belong to the issues of those features (nxr-xyq7c8, nxr-t1ht7j, nxr-d371vy, nxr-95kg91, nxr-tabkjx)
- [x] Nothing is installed by the plugin
- [x] `init` stops for each of these errors too, and for an unsupported Nx also in a repository without a `Cargo.toml`, with the tests that the third paragraph of `VER-SETUP` lists, the name collision of nxr-1bv0wm included. `init` runs the plugin's `createNodes` through Nx (`nx-rust/src/generators/init/graph-check.ts`), so a check made there reaches it; a check made when the plugin loads has to reach it as well
- [x] `init`'s check also covers what graph creation checks in `createDependencies`, which it does not run yet: since nxr-1bv0wm, the collision between two projects of the plugin that hold one name once Nx has merged the projects of all plugins and entries (`DES-PROJECT-GRAPH`, `REQ-PROJECT-NAMES`, the collision row of `DES-DIAGNOSTICS`)
- [x] Name the supported Nx majors in `init`'s error for Nx internals it cannot use (`UnsupportedNxError` in `nx-rust/src/generators/init/graph-check.ts`) from the peer dependency range, instead of its constant
- [x] Take the tools, how to get them and whether they are installed for the task-time errors from the table that `init` reports (`nx-rust/src/tools/optional-tools.ts`)

Task-time errors for a missing tool need the executor, which does not exist yet (nxr-kmdpgj). The check they call, `requireTool`, is built and tested here; calling it from the executors, with the task-time tests of `VER-SETUP`, moved to nxr-zqvnrh.

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/src/compatibility/nx-version.ts`: the supported Nx majors come from the new peer dependency range `nx: ^24` in `nx-rust/package.json`; the installed Nx is the `nx/package.json` that resolves from the repository root, as Nx finds it. An older major is an error, a newer one too unless `NX_RUST_ALLOW_UNSUPPORTED_NX` is `true`, which makes it a warning; the messages name the version found and the supported majors. The plugin checks when Nx loads it for an entry (in the `createNodes` getter of `index.ts`) and again in each graph computation (`Registration.discover`), where it prints the warning once per computation.
- `nx-rust/src/compatibility/cargo-version.ts`: a `cargo metadata` report without `build_directory` fails graph creation with the version that one more `cargo --version` names; a supported Cargo costs no extra call. Hooked into `requestMetadata` and the failure messages of `discovery.ts`.
- `init` (`graph-check.ts`): checks the Nx version first, runs the plugin's entries together with the other plugins of `nx.json` and Nx's default plugins, so that the projects merge as in graph creation, then runs the entries' `createDependencies` on the merged projects and the repository's files, which reports the name collision with graph creation's message. `UnsupportedNxError` names the majors from the peer range.
- `nx-rust/src/tools/optional-tools.ts`: `requireTool` and `MissingToolError` for the task-time check, with the message shared with `init`'s report (`missingToolMessage`).
- Harness: `fakeNxPackage` and `FixtureWorkspace.useNx` (a hard-linked copy of Nx that reports another version), `daemonLog`, `NX_RUST_TEST_CARGO_VERSION` in the cargo wrapper, `ToolFolders`. New `test/compatibility.spec.ts` and `test/missing-tools.spec.ts`; new `init` cases; end-to-end checks of the installed peer range and of the installed plugin with a newer Nx, with and without the variable.
- Mara: new `EVD-NX-24-VERSION-CHECK`; the "Nx version" paragraph of `DES-DIAGNOSTICS` says that the plugin compares again on each graph creation and cites it; status note of the setup page and the testing section of the verification page updated.

Checks run: `pnpm nx run-many -t build lint test` (4 tasks succeeded; uncached `test`: 10 suites, 230 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` (13 passed), `mara schema validate` and `mara project validate` (valid, evaluation complete, no errors or warnings), `mara related REQ-COMPATIBILITY` and `DES-DIAGNOSTICS` (the implementing declarations are linked), `zban check`.

Rejected approaches: a check only when the module loads, because a daemon that runs the plugin in its own process keeps it loaded when `NX_RUST_ALLOW_UNSUPPORTED_NX` changes (`EVD-NX-24-VERSION-CHECK`); a throw at the top of `index.ts`, because `init` imports that module and would fail to load without its own message; loading the plugin lazily in `init`, because Nx unregisters its TypeScript transpiler once a generator module has loaded; a fake Nx whose `package.json` alone differs from the running Nx, because Nx then turns its daemon off.

Follow-ups: nxr-zqvnrh (task-time errors for missing tools and the warning at task start, blocked by nxr-kmdpgj), nxr-t9xv44 (end-to-end suite on Cargo 1.91 and the latest stable).
