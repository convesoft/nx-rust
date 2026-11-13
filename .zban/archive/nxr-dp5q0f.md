---
title: Specify generators and diagnostics
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T10:14:53Z
---

Goal: turn the draft items `DES-GENERATORS` and `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) into accepted knowledge.

- [x] Answer the open questions in the two items with the user: whether `init` offers to write the build directory setting and warns about target defaults; generator options and behaviour outside a workspace; error codes; what the plugin does on an Nx major newer than the supported ones
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [x] Add or extend the verification that the Mara policies then require
- [x] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The maintainer answered the open questions on 13 November 2026. `DES-GENERATORS` and `DES-DIAGNOSTICS` are rewritten and accepted.

- `init` runs the graph-time checks first and stops before it writes `nx.json` when graph creation would fail. It then registers the plugin and reports: graph-time warnings, missing tools the configuration needs (warnings), absent tools nothing needs (one line), and workspaces whose build directory is inside the repository (with the snippet). It never writes `build.build-dir` and edits `nx.json` only for its entry. In a repository without a `Cargo.toml` it registers and says how to create a crate. In v1 it takes no options of its own. A repeated run leaves an existing entry, options included, exactly as it is, and still checks and reports. A missing cargo-audit goes on the informational line, because no setting asks for `audit`. cargo-deny counts as needed only where a workspace root holds a cargo-deny configuration file. It says nothing about target defaults; nxr-d3087e adds that report once `REQ-TARGET-DEFAULT-GUARD` is accepted.
- `library` and `binary` take `directory` (first positional), `name` and `edition`. They run `cargo new --vcs none` in place from the generator's callback, print only the command under `--dry-run`, say when the crate is standalone, and fail when the enclosing workspace's `exclude` matches the folder.
- The diagnostics table has a severity column and new rows: a newer Nx major, a pinned toolchain that is not installed (consistent with the answer recorded under nxr-1ydrfd), and a build or artifact directory that Nx does not ignore. cargo-audit and cargo-deny are added to the missing-tool row. The unknown-key row is left to nxr-9f4w3f. Graph-time warnings are repeated from the executor and from `init`.
- No error codes in v1: `ADR-NO-ERROR-CODES` gives the rationale and notes that codes may be introduced later and what they would be for. It presents one possible scheme, not a commitment.
- `REQ-COMPATIBILITY` and `REQ-DIAGNOSTICS` each gained one sentence for `NX_RUST_ALLOW_UNSUPPORTED_NX=true`.
- New accepted evidence: `EVD-CARGO-NEW`, `EVD-CARGO-DIRECTORIES`, `EVD-NX-24-SETUP`. `VER-SETUP` is extended, and the guidance in `setup.mara.md` follows the items, with a new section on error messages and warnings.
- The review of pull request #9 led to these corrections. The guidance now says that Nx installs the package before `init` runs and keeps it when `init` stops. A failing plugin stops the commands that require the project graph, not every command. `VER-SETUP` checks the repeated run, cargo-audit and cargo-deny, and that `init` leaves `nx.json` unchanged when `cargo metadata` fails, when Cargo is older than 1.91 and for an unsupported Nx major. The warning about Cargo's directories depends on whether Nx ignores them: `VER-SETUP` adds a negative case for `.nxignore`. `EVD-NX-24-SETUP` records only that no numbered codes were found, plus the reproduced `nx add`, `--skipProjectGraph` and `.nxignore` behaviour. `EVD-CARGO-DIRECTORIES` and `DES-DIAGNOSTICS` rest on Cargo's source: a stable Cargo reports `build_directory` from 1.91 on. The question of whether cargo-audit counts as needed was answered before it reached main, so it was not filed as an issue.
- In `DES-BUILD-DIRS`, "The build directory sits outside the repository. CI caches it; Nx does not." now reads "The recommended build directory sits outside the repository. CI caches it; Nx never does, wherever it lies." The maintainer agreed to that wording on 2026-11-13. Nothing else in that item changed.
- The second review of pull request #9 led to two more `VER-SETUP` fixes. The warning about Cargo's directories now applies when Nx does not ignore them by any of its rules, with negative cases for `.nxignore` alone and for a folder Nx always ignores (reproduced with `crate/.nx/cache/target` and `crate/node_modules/target`, now recorded in `EVD-NX-24-SETUP`). `init` must leave `nx.json` unchanged for each error that `DES-DIAGNOSTICS` reports when the plugin loads or the graph is created, which now includes a pinned toolchain that is not installed (with no toolchain installed afterwards) and `affectedTests` without nextest. `VER-SETUP` was also read again in full against both designs. It now checks the peer dependency range, the content of the override warning, `init` under the override, every row of `init`'s table of tools, that `init` and the generators declare no options beyond the agreed ones, `directory` resolved from a subfolder, a `members` list created where there was none, a generator run into an existing folder, the toolchain row at key computation, tasks getting no `RUSTUP_AUTO_INSTALL` from the plugin, and the three places every graph-time warning appears.
- After the merge of #6, the collision row of `DES-DIAGNOSTICS` agrees with `REQ-PROJECT-NAMES` and `DES-PROJECT-GRAPH`: two crates with one project name are the plugin's error, and a collision with another plugin's project fails with Nx's own error.

Checks run, again after the second review's fixes and the merge of `origin/main` at 4cc6615: `pnpm nx format:write`; `mara schema validate` and `mara project validate` (all 8 pages): `valid: true` with complete evaluation, no diagnostics, no failed policy check; `zban check`: no problems; `pnpm nx run-many -t build lint test`: 4 tasks succeeded; `pnpm nx format:check --all`: passed.
