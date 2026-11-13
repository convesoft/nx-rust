# Setup and compatibility

> **Status:** specified, not implemented yet. The package is not published to
> npm yet. The generator options shown here are proposals until
> [[DES-GENERATORS]] is accepted.

## What you need

|       | Supported       |
| ----- | --------------- |
| Nx    | 24              |
| Cargo | 1.91 and later  |
| Host  | Linux and macOS |

Windows hosts are not supported in v1. With an older Nx or Cargo the plugin
stops with an error that names the version it found and the one it needs. A
later Nx major is added once the plugin's end-to-end tests pass on it.

macOS is supported, but for the moment the plugin's own CI runs on Linux only,
so macOS is not tested automatically yet ([[ADR-CI-LINUX-ONLY]]). Please report
anything that behaves differently there.

The plugin installs nothing. These tools are yours to install, and only when
you use the feature that needs them:

| Tool                                                                | Needed for                                |
| ------------------------------------------------------------------- | ----------------------------------------- |
| A Rust toolchain: `cargo` and `rustc` on `PATH`, with rustup or not | Everything                                |
| [cargo-nextest](https://nexte.st)                                   | `testRunner = "nextest"`                  |
| [cargo-affected](https://github.com/max-sixty/cargo-affected)       | `affectedTests = true`                    |
| [cargo-hakari](https://docs.rs/cargo-hakari)                        | The `hakari` feature-unification strategy |
| [cargo-audit](https://crates.io/crates/cargo-audit)                 | The `audit` target                        |
| [cargo-deny](https://crates.io/crates/cargo-deny)                   | The `deny` target                         |
| The `wasm-bindgen` CLI and the wasm target                          | `wasm-build`                              |
| The napi CLI                                                        | `napi-build`                              |

When one is missing, the task or the graph fails with a message that says which
tool, which feature asked for it, and how to get it.

Every machine that runs `nx` in the repository needs cargo, also one that only
works on JS projects: Nx asks Cargo for the crates whenever it builds the
project graph. Without cargo the graph fails with a message that says so. The
plugin does not leave the Rust projects out instead, because that machine would
then compute other cache keys than everyone else.

## Adding the plugin

```sh
nx add @convesoft/nx-rust
```

This registers the plugin in `nx.json` and reports anything missing from the
table above that your repository needs. It writes nothing into your crates.
Afterwards:

```sh
nx show projects          # your crates are listed
nx graph                  # with their dependencies
nx run-many -t lint test  # Rust and JS together
```

To add the plugin by hand, put it into `nx.json`:

```json
{
  "plugins": ["@convesoft/nx-rust"]
}
```

## Creating crates

```sh
nx g @convesoft/nx-rust:library core --directory rust/crates/core
nx g @convesoft/nx-rust:binary cli --directory rust/crates/cli
```

Both are thin wrappers over `cargo new` that also add the crate to the
workspace's members. A crate you create with plain `cargo new` works just as
well: the plugin finds it on the next run.

Migrating from `@monodon/rust` is not part of v1.

## Requirements

:::mara requirement REQ-COMPATIBILITY
:mid: 01M78FHG7FES2FR7DNAAPSDVWE
:title: Support Nx 24, Cargo 1.91+, Linux and macOS
:status: accepted
:satisfies: NEED-EASY-SETUP

The plugin works with Nx 24 and with Cargo 1.91 and later, on Linux and macOS hosts. A later Nx major is supported from the release whose end-to-end suite has passed on it, and the package's peer dependency range names exactly the supported majors. With an older Nx or Cargo the plugin stops with an error that names the version found and the version required, instead of continuing with reduced behaviour.
:::

:::mara requirement REQ-INIT
:mid: 01M78FHG7FCBH4HM2R3S09S9KV
:title: Set up the plugin with nx add
:status: accepted
:satisfies: NEED-EASY-SETUP

`nx add @convesoft/nx-rust` registers the plugin in `nx.json` and reports the tools that the repository's configuration needs and that are missing. It writes nothing into crates.
:::

:::mara requirement REQ-CRATE-GENERATORS
:mid: 01M78FHG7F7C38X583EWPV1J5J
:title: Generate library and binary crates
:status: accepted
:satisfies: NEED-EASY-SETUP

A `library` generator and a `binary` generator each create a crate with `cargo new` and add it to the members of the Cargo workspace it is created in. The result is the same as running `cargo new` and editing the workspace manifest by hand.
:::

:::mara requirement REQ-DIAGNOSTICS
:mid: 01M78FHG7FGW9BB3M4MCE52PEG
:title: Say what is missing and how to fix it
:status: accepted
:satisfies: NEED-CLEAR-FAILURES

When a required toolchain or tool is missing, a version is unsupported, or options contradict each other, the plugin fails with a message that names what is wrong, the crate, workspace or option concerned, and what the user can do. It does this at the earliest point where the problem can be known, and it never installs anything itself. A problem found while the graph is created stops graph creation: the plugin does not leave a workspace or a crate out of the graph to get past it.
:::

:::mara requirement REQ-NO-MANIFEST-WRITES
:mid: 01M78FHG7F8PRTX5Q1T77QNQ1K
:title: Write Cargo files only when asked to
:status: accepted
:satisfies: NEED-CARGO-UNCHANGED

The plugin does not write `Cargo.toml`, `Cargo.lock` or `.cargo/config.toml`. The exceptions are generators, release, and tasks that the user runs in order to change those files, such as a lockfile update. Cargo's own update of `Cargo.lock` during a command the plugin runs, which the same plain cargo command would make as well, is not a write of the plugin; with the `locked` option the plugin's commands cannot make it.
:::

## Design

:::mara design DES-GENERATORS
:mid: 01M78FHG7FWY1P7FPVC6ZYA9ND
:title: Generators
:status: draft
:satisfies: REQ-INIT
:satisfies: REQ-CRATE-GENERATORS

- `init`, run by `nx add`: adds the plugin entry to `nx.json` and runs the checks of [[DES-DIAGNOSTICS]] against the repository. Open: whether it offers to write the `build.build-dir` setting described in [[DES-BUILD-DIRS]], and whether it warns about target defaults ([[REQ-TARGET-DEFAULT-GUARD]]).
- `library` and `binary`: run `cargo new --lib` or `cargo new --bin` in the requested directory and add the path to `[workspace] members` of the enclosing workspace when it is not already matched by a glob. Open: options for edition and name, and what happens outside any workspace.

A generator that migrates a repository from `@monodon/rust` is not part of v1 ([[ADR-SETUP-GENERATORS]]).
:::

:::mara design DES-DIAGNOSTICS
:mid: 01M78FHG7F2T375STHFWNZZZYG
:title: Diagnostics
:status: draft
:satisfies: REQ-DIAGNOSTICS
:satisfies: REQ-COMPATIBILITY

Proposed checks and the point where each runs:

| Problem                                                                             | Detected                             |
| ----------------------------------------------------------------------------------- | ------------------------------------ |
| Unsupported Nx version                                                              | When the plugin loads                |
| `cargo` not found, or `cargo metadata` fails for a manifest ([[DES-DISCOVERY]])     | When the graph is created            |
| Unsupported Cargo version, or no toolchain, for a workspace                         | When the graph is created            |
| Two projects with one name ([[REQ-PROJECT-NAMES]])                                  | When the graph is created            |
| `affectedTests` without the nextest runner ([[REQ-AFFECTED-TESTS]])                 | When the graph is created            |
| An unknown key in a metadata table ([[DES-PLUGIN-OPTIONS]])                         | When the graph is created            |
| A path dependency without a project whose files Nx cannot see ([[DES-INPUTS]])      | When the graph is created; a warning |
| An artifact directory outside the repository ([[DES-OUTPUTS]])                      | When the graph is created; a warning |
| nextest, cargo-affected, cargo-hakari, `wasm-bindgen` or the napi CLI missing       | When a task that needs it starts     |
| cargo-affected missing in a workspace with `affectedTests`, in a run in mode `full` | When a `test` task starts; a warning |
| A value of `NX_RUST_TEST_MODE` other than `affected` and `full` ([[DES-TEST-MODE]]) | When a `test` task starts            |
| `wasm-bindgen` CLI and crate versions differ ([[DES-WASM]])                         | When the task starts                 |

A problem found when the graph is created stops graph creation for the whole repository, unless the table calls it a warning ([[REQ-DIAGNOSTICS]]).

Open: a stable set of error codes, and whether the plugin stops or only warns on an Nx major newer than the ones it supports.
:::

## Scenario

:::mara scenario SCN-ADOPT
:mid: 01M78FHG7FBRMYNWBR4T2Z3PHJ
:title: A team adds the plugin to an existing mixed repository
:status: accepted

A team has an Nx monorepo with JS apps and a Cargo workspace under `rust/` that Nx does not know about; CI runs the Rust checks through a separate script. A developer runs `nx add @convesoft/nx-rust`. The plugin is registered in `nx.json`, and the command reports that nextest is not installed, which the workspace's settings do not need. No file under `rust/` changes. `nx show projects` now lists every crate, and `nx graph` shows the edges between crates. The team replaces the script with the `nx affected -t lint test build` step that CI already runs for JS. Developers who work only on Rust keep using `cargo` and rust-analyzer as before, and their builds and the Nx builds reuse each other's compiled dependencies.
:::
