# Targets

> **Status:** specified, not implemented yet. Target names, commands, caching
> and outputs are decided. The options that switch a target's flags have no
> names yet; they are chosen in the option reference
> ([Configuration](configuration.mara.md)).

The plugin infers targets from the shape of each crate and of each Cargo
workspace. Nothing is declared per crate.

| Target                     | Runs                                             | Exists on                                         | Cached | Outputs                                                           |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `build`                    | `cargo build`                                    | Every crate                                       | Yes    | Final artifacts only: executables, `cdylib` and `staticlib` files |
| `check`                    | `cargo check --all-targets`                      | Every crate                                       | Yes    | None; the result only                                             |
| `lint`                     | `cargo clippy --all-targets`                     | Every crate                                       | Yes    | None; the result only                                             |
| `test`                     | `cargo test` or nextest                          | Every crate                                       | Yes    | None; the result only                                             |
| `fmt-check`                | `cargo fmt --check`                              | Every crate                                       | Yes    | None; the result only                                             |
| `fmt`                      | `cargo fmt`                                      | Every crate                                       | No     | None                                                              |
| `bench`                    | `cargo bench`                                    | Crates with a bench target                        | No     | None                                                              |
| `run`                      | `cargo run`                                      | Crates with a binary target                       | No     | None                                                              |
| `napi-build`, `wasm-build` | See [napi and wasm artifacts](artifacts.mara.md) | Crates that produce that artifact                 | Yes    | The package files                                                 |
| Release publish            | `cargo publish`                                  | Crates without `publish = false`                  | No     | None                                                              |
| `doc`                      | `cargo doc --no-deps --workspace`                | The workspace project                             | Yes    | The workspace's whole doc folder                                  |
| `audit`                    | `cargo audit`                                    | The workspace project                             | No     | None                                                              |
| `deny`                     | `cargo deny check`                               | The workspace project, where cargo-deny is set up | No     | None                                                              |
| `update`                   | `cargo update`                                   | The workspace project                             | No     | None                                                              |
| `lockfile`                 | Writes a digest of `Cargo.lock` per crate        | The workspace project                             | Yes    | The digests, in `.nx/workspace-data`                              |

A crate's targets select it with `-p` and its real package name. Every command
starts in the root folder of the crate's workspace
([Caching](caching.mara.md#where-cargo-runs)).

```sh
nx test api                     # one crate
nx run-many -t lint test        # every project, JS and Rust
nx affected -t lint test build  # only what the change affects
nx run api:run -- --port 3000   # run a binary with arguments
```

Names can be changed in the plugin options, and options of a target can be set
per crate or per workspace: see [Configuration](configuration.mara.md).

## Checking all targets

`check` and `lint` cover the tests, benches and examples of a crate too, because
they pass `--all-targets`. rust-analyzer checks the same way by default, so the
editor and Nx compile the same things and reuse each other's work
([[EVD-CARGO-TARGET-COMMANDS]]).

The flag comes from an option of the target that is on by default. A crate whose
benches need a nightly compiler, which stable rejects under `--all-targets`, can
switch it off in its `[package.metadata.nx.targets.check.options]` and
`[package.metadata.nx.targets.lint.options]`. The option's name is not settled
yet.

## Warnings

No target adds a flag that turns warnings into errors: `lint` fails where
`cargo clippy` fails. To fail on warnings, say so where Cargo reads it:

- lint levels in `[lints]` or `[workspace.lints]` of your manifests,
- `build.warnings = "deny"` in `.cargo/config.toml`, or
  `CARGO_BUILD_WARNINGS=deny` for one run, such as in CI,
- `RUSTFLAGS="-D warnings"`, which also rebuilds every dependency.

```toml
# rust/.cargo/config.toml
[build]
warnings = "deny"
```

All of these are part of the cache key, so a result that passed with warnings
allowed is never reused where they are denied. Cargo honours `build.warnings`
from 1.97 on; older versions ignore it without a word
([[EVD-CARGO-TARGET-COMMANDS]]).

## Running binaries

`nx run api` is Nx's own syntax and needs a target, so `run` is started as
`nx run api:run`. Arguments after `--` go to the binary.

A crate with several binaries needs to say which one `run` starts: set
`default-run` in its `[package]` table, or pass the binary through an option of
the `run` target, on the command line or in the crate's metadata. Without
either, cargo stops and lists the binaries. The option's name is not settled
yet.

`run` is not a continuous task: a target that depends on it waits until the
binary exits, which is what a code generator or a migration needs. A crate that
serves something, such as an API that end-to-end tests talk to, makes its `run`
continuous and tells Nx when it is ready:

```toml
# rust/crates/api/Cargo.toml
[package.metadata.nx.targets.run]
continuous = true
readyWhen = { port = 3000 }
```

A target that depends on it with `"waitFor": "ready"` then starts once the port
answers. Restarting the binary when its sources change is not part of v1
([[REQ-RUN-WATCH]]).

`nx run-many -t run` starts each binary in its own cargo call: `run` tasks are
never batched.

## Workspace-level targets

Each Cargo workspace has one project for the tasks that concern the whole
workspace ([Workspaces](workspaces.mara.md#workspace-level-tasks)). It carries
these targets:

- **`doc`** documents every member into the `doc` folder of the workspace's
  artifact directory, as one site with one search index. A cache hit restores
  the whole folder. If two workspaces share one artifact directory, for example
  through a `target-dir` set above both, `doc` runs uncached and the plugin says
  so: restoring one workspace's folder would delete the other's pages.
- **`audit`** runs `cargo audit` against the workspace's `Cargo.lock`, with the
  settings in `.cargo/audit.toml` of the workspace root.
- **`deny`** runs `cargo deny check`. It exists only where `deny.toml`,
  `.deny.toml` or `.cargo/deny.toml` is in the workspace root, because without
  a configuration cargo-deny rejects every license.
- **`update`** runs `cargo update` and writes `Cargo.lock`. It never passes
  `--locked`, also with the `locked` option or `NX_RUST_LOCKED=true`, because
  changing the lockfile is its purpose.
- **`lockfile`** reads `Cargo.lock` and writes one digest per crate of the
  packages the crate reaches. Every cached task of a crate waits for it and
  reads the crate's digest, so a dependency update reruns only the crates it
  reaches ([Caching](caching.mara.md#lockfile-changes)). It runs no cargo.
- The coverage baseline, in a workspace with `affectedTests`
  ([Continuous integration](ci.mara.md#the-coverage-baseline)).

```sh
nx run-many -t audit deny   # every workspace
```

`audit`, `deny` and `update` are not cached. cargo-audit and cargo-deny fetch
the RustSec advisory database each time, so the same `Cargo.lock` can fail
tomorrow that passes today ([[EVD-CARGO-AUDIT-DENY]]). `nx affected` still
selects them when `Cargo.lock`, the root `Cargo.toml` or the tool's
configuration changes, and `deny` also when a member's manifest does.

The targets exist whether or not cargo-audit and cargo-deny are installed, so
every machine sees the same projects and targets. A task whose tool is missing
fails and says how to get it ([Setup](setup.mara.md)).

## No `^build` between crates

In JS projects a `build` target often depends on `^build`, the builds of its
dependencies. Rust targets do not: Cargo builds a crate's dependencies itself,
and `^` inputs make a change in a dependency invalidate the dependent's cache.

Adding `^build` between crates only queues extra cargo processes behind the
build lock. In one repository that inherited `^build` onto its Rust crates, a
52-second test run took 40 minutes ([[EVD-NXRUST-BUILD-DEPS]]).

Check your `nx.json`: a target default keyed by a bare target name applies to
Rust targets with that name too.

```json
{
  "targetDefaults": {
    "build": { "dependsOn": ["^build"] }
  }
}
```

Nx 24 can narrow such a default to the projects or the plugin it is meant for,
with a `filter` on the entry. [[RISK-TARGET-DEFAULTS]] describes the problem and
[[REQ-TARGET-DEFAULT-GUARD]] the planned check.

A JS project that consumes a Rust crate depends on the crate's artifact target:
see [napi and wasm artifacts](artifacts.mara.md). The plugin adds no `^build`
to JS projects, and it cannot take yours away. If a JS target declares `^build`
and its project depends on a crate, Nx also runs that crate's native `build`.
It stops there, because the crate's `build` depends only on the `lockfile`
task of its workspace.

## Formatting

`nx format:check` and `nx format:write` are Nx's own commands, not targets.
They run prettier or oxfmt over files and never run rustfmt, so they leave Rust
sources alone ([[EVD-NX-FORMAT]]). Rust formatting is the `fmt-check` and `fmt`
targets, which keep Cargo's names so that they are not taken for that command:

```sh
nx format:check                            # JS, TS, Markdown, JSON
nx affected -t lint test build fmt-check   # plus rustfmt for the affected crates
nx affected -t fmt                         # rustfmt rewrites the affected crates
```

Both targets exist on every crate and touch only the crates they run for. A
path dependency outside the workspace, or a member that Nx leaves out such as an
excluded vendored crate, is never reformatted. `cargo fmt --all` would reformat
the former ([[EVD-CARGO-TARGET-COMMANDS]]). Neither target passes `--locked`,
not even in locked mode: `cargo fmt` reads no lockfile and rejects the flag.

If your workspace formatter is oxfmt, `nx format:write` also formats
`Cargo.toml` files, because oxfmt formats TOML.

## Requirements

:::mara requirement REQ-INFERRED-TARGETS
:mid: 01M78FHG7FQ71E32Q38CHFFHB0
:title: Infer targets from the shape of the crate
:status: accepted
:satisfies: NEED-ZERO-CONFIG

Each crate's Nx targets are derived from Cargo's description of the crate, without per-crate declarations. The kinds of Cargo targets a crate has decide whether it gets `run`, `bench` and the targets for other target triples. A crate with `publish = false` gets no release targets.
:::

:::mara requirement REQ-NO-RUST-TASK-DEPS
:mid: 01M78FHG7FGDP772BSP1FSAYKN
:title: Declare no task dependencies between Rust crates
:status: accepted
:satisfies: NEED-EFFICIENT-BUILDS

No inferred target of a Rust crate depends on a target of another Rust crate, with one exception: every cached target of a crate depends on the lockfile task of its workspace ([[DES-LOCKFILE-HASHING]]), which is a target of the root crate's project where the root manifest is a package. A change in a dependency reaches the dependent through cache inputs, not through task ordering. The plugin adds no task dependency to JS projects either. A `^build` that a JS target declares itself reaches the `build` of the crates its project depends on directly, as Nx defines `^build`, and goes no further.
:::

:::mara requirement REQ-TARGET-DEFAULT-GUARD
:mid: 01M78FHG7FV5M1E44R30RRAB5P
:title: Report target defaults that change Rust targets
:status: draft
:satisfies: NEED-CLEAR-FAILURES
:satisfies: NEED-CORRECT-CACHE
:mitigates: RISK-TARGET-DEFAULTS

When a `targetDefaults` entry in `nx.json` adds a dependency on other crates' targets to an inferred Rust target, or replaces the inputs the plugin inferred for it, the plugin reports the entry and the affected target and says how to narrow the entry.

Open: how Nx 24 merges target defaults with inferred targets, and whether the report is a warning or an error.
:::

:::mara requirement REQ-RUN-WATCH
:mid: 01M78FHG7FQ0KY79YN7KV80X58
:title: Run binaries as continuous tasks
:status: retired
:satisfies: NEED-UNIFORM-COMMANDS

A crate's `run` target can serve as a continuous Nx task that other targets depend on, and can restart when its sources change.

Retired on 13 November 2026: not part of v1. `run` is not continuous by default, because a continuous task that exits while a dependent runs fails the Nx command, and many binaries are one-shot tools that other targets wait for ([[EVD-NX-24-TARGETS]]). A crate that serves something makes its `run` continuous, with a `readyWhen` check, in `[package.metadata.nx.targets.run]`, which [[DES-METADATA-TABLES]] already allows. Restarting on change would need a file watcher in the executor or a tool the user installs; `nx watch` waits for its command to exit and cannot restart one that keeps running.
:::

## Design

:::mara design DES-TARGETS
:mid: 01M78FHG7FMRNFBSN2G9VG7CX3
:title: Inferred targets
:status: accepted
:satisfies: REQ-INFERRED-TARGETS
:satisfies: REQ-TARGET-NAMES
:satisfies: REQ-NO-RUST-TASK-DEPS

| Default name               | Cargo's or the tool's name | Exists on                                                      | Cached | Nx outputs                                     |
| -------------------------- | -------------------------- | -------------------------------------------------------------- | ------ | ---------------------------------------------- |
| `build`                    | `build`                    | Every crate                                                    | Yes    | Final artifacts only ([[DES-OUTPUTS]])         |
| `check`                    | `check`                    | Every crate                                                    | Yes    | None                                           |
| `lint`                     | `clippy`                   | Every crate                                                    | Yes    | None                                           |
| `test`                     | `test`                     | Every crate                                                    | Yes    | None                                           |
| `fmt-check`                | `fmt --check`              | Every crate                                                    | Yes    | None                                           |
| `fmt`                      | `fmt`                      | Every crate                                                    | No     | None                                           |
| `bench`                    | `bench`                    | Crates with a bench target                                     | No     | None                                           |
| `run`                      | `run`                      | Crates with a binary target                                    | No     | None                                           |
| `napi-build`, `wasm-build` | none                       | Crates that produce that artifact                              | Yes    | [[DES-ARTIFACT-STEPS]]                         |
| Release publish            | `publish`                  | Crates without `publish = false`                               | No     | None                                           |
| `doc`                      | `doc`                      | The workspace project                                          | Yes    | The workspace's doc folder ([[DES-OUTPUTS]])   |
| `lockfile`                 | none                       | The workspace project                                          | Yes    | The crates' digests ([[DES-LOCKFILE-HASHING]]) |
| `audit`                    | cargo-audit's `audit`      | The workspace project                                          | No     | None                                           |
| `deny`                     | cargo-deny's `check`       | The workspace project, where a cargo-deny configuration exists | No     | None                                           |
| `update`                   | `update`                   | The workspace project                                          | No     | None                                           |

Only `clippy` is renamed, to `lint`: `lint`, `test` and `build` are the target names that Nx projects share. Formatting keeps Cargo's names, `fmt-check` and `fmt`, because Nx's `format` is a built-in command and not a target, and the targets of the workspace project keep the names of Cargo and the tools ([[ADR-NX-TARGET-NAMES]]); the lockfile task, which runs neither, is called `lockfile`. Every name can be changed through plugin options, the names of the artifact targets and of the workspace project's targets included. `bench` is not cached, because timings differ between runs. The commands are [[DES-TARGET-COMMANDS]] and [[DES-WORKSPACE-TARGETS]].

Targets come from the `cargo metadata` report ([[DES-METADATA-REPORT]]): `run` exists when the crate has a binary target, `bench` when it has a bench target, an [[TERM-ARTIFACT-TARGET]] when the crate produces that artifact ([[DES-ARTIFACT-STEPS]]), and the release targets unless the manifest sets `publish = false`. The last five rows are targets of the [[TERM-WORKSPACE-PROJECT]]; `deny` exists only where a cargo-deny configuration file is in the workspace root. Whether a tool is installed never decides whether a target exists.

No inferred target has a `dependsOn` entry that names another Rust crate's target, except that every cached crate target depends on the lockfile task of its workspace ([[REQ-NO-RUST-TASK-DEPS]]), and none uses `^build` ([[ADR-NO-RUST-BUILD-DEPS]]). Dependencies reach a target through `^` inputs ([[DES-INPUTS]]). The plugin adds no `dependsOn` entry to a JS project. A JS target's own `^build` reaches the `build` of the crates its project depends on directly, which is how Nx defines `^build`, and ends there.
:::

:::mara design DES-TARGET-COMMANDS
:mid: 01M78FHG7F9X4M34PB2MP9Y7S8
:title: Commands of the remaining per-crate targets
:status: accepted
:satisfies: REQ-INFERRED-TARGETS
:satisfies: REQ-CARGO-UNCHANGED

| Target      | Command                                 | Cached | Batched                       |
| ----------- | --------------------------------------- | ------ | ----------------------------- |
| `check`     | `cargo check --all-targets -p <crate>`  | Yes    | Yes                           |
| `lint`      | `cargo clippy --all-targets -p <crate>` | Yes    | Yes                           |
| `fmt-check` | `cargo fmt --check -p <crate>`          | Yes    | Yes                           |
| `fmt`       | `cargo fmt -p <crate>`                  | No     | Yes                           |
| `bench`     | `cargo bench -p <crate>`                | No     | No: `parallelism` is `false`  |
| `run`       | `cargo run -p <crate>`                  | No     | No: an executor without batch |

Each command starts in the root folder of the crate's workspace, names the crate by its real package name and passes `--locked` as the `locked` option says ([[DES-INVOCATION]]), except `fmt` and `fmt-check`: `cargo fmt` resolves no dependencies and rejects the flag ([[EVD-CARGO-TARGET-COMMANDS]]). Batched tasks share cargo calls as [[DES-BATCH]] groups them; `cargo fmt` takes several `-p` as the cargo commands do.

**Flags as options.** A flag beyond the package selection comes from an option of the target, so that a command passes only what its options ask for ([[DES-INVOCATION]]). `--all-targets` on `check` and `lint` is such an option, on by default. A crate switches it off in the options of the target in its `[package.metadata.nx]` table ([[DES-METADATA-TABLES]]), for example when its benches need a nightly compiler, which stable rejects under `--all-targets`. Tasks whose options differ never share a cargo call ([[TERM-GROUP]]). The name of the option belongs to the option reference ([[DES-PLUGIN-OPTIONS]]). `--all-targets` is what rust-analyzer passes by default, so `check` compiles the units the editor compiles and the two reuse each other's work ([[EVD-CARGO-TARGET-COMMANDS]]).

**Warnings.** No target adds a flag that turns warnings into errors. A task fails on warnings where the repository says so through Cargo: lint levels in `[lints]` and `[workspace.lints]`, `build.warnings` in `.cargo/config.toml` or `CARGO_BUILD_WARNINGS`, which Cargo honours from 1.97 on, and `RUSTFLAGS`, all of which are cache inputs ([[DES-INPUTS]]). Passing `-D warnings` to clippy would differ from plain `cargo clippy` and check every selected member again whenever a developer alternates the two ([[EVD-CARGO-TARGET-COMMANDS]]).

**Formatting.** `fmt` exists on every crate and formats only the crates of its tasks. `cargo fmt --all` would also rewrite path dependencies outside the workspace, and plain `cargo fmt` in the workspace root would rewrite members that have no project ([[EVD-CARGO-TARGET-COMMANDS]], [[REQ-SKIP-CRATES]]). `cargo fmt -p` takes package names only, not package ID specs; names are unique within a workspace, so the name addresses the crate.

**bench.** The target has `parallelism: false`, so that Nx starts no other task while benchmarks run. Nx never puts such a task into a batch, so each `bench` task is a cargo call of its own ([[EVD-NX-24-TARGETS]]).

**run.** One `run` target per crate. When the crate has several binaries, an option of the target passes `--bin`; it is set on the command line or in the crate's metadata, and its name belongs to the option reference ([[DES-PLUGIN-OPTIONS]]). Without it and without `default-run` in the manifest, cargo fails and lists the binaries. Arguments after `--` on the `nx` command line go to the binary. `run` uses an executor that has no batch implementation, because `cargo run` accepts one package only, while Nx hands every task of an executor with a batch implementation and `preferBatch` to one batch, also the tasks of `nx run-many -t run` ([[EVD-CARGO-TARGET-COMMANDS]], [[EVD-NX-24-TARGETS]]). `run` is not a continuous task: a task that depends on it waits until the binary exits. A crate that serves something sets `continuous` and `readyWhen` on its `run` in its metadata ([[DES-METADATA-TABLES]]). `nx run <project>` is Nx's own syntax and needs a target, so the short form is `nx run <project>:run`.

The targets of the workspace project are [[DES-WORKSPACE-TARGETS]].
:::

:::mara design DES-WORKSPACE-TARGETS
:mid: 01M78FHG7FDHZMAH480DED8M6W
:title: Targets of the workspace project
:status: accepted
:satisfies: REQ-WORKSPACE-PROJECT

The [[TERM-WORKSPACE-PROJECT]] hosts the targets that concern a whole Cargo workspace. Each command starts in the workspace root ([[DES-INVOCATION]]); the lockfile task runs none.

| Target     | Command                                                           | Exists                                                                         | Cached                                | Inputs                                                                                                           |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `doc`      | `cargo doc --no-deps --workspace`                                 | Always                                                                         | Yes, as [[DES-OUTPUTS]] says          | Those of every cached target ([[DES-INPUTS]]), with the files of every member through the project's dependencies |
| `audit`    | `cargo audit`                                                     | Always                                                                         | No                                    | `Cargo.lock`, the root `Cargo.toml` and `.cargo/audit.toml` of the workspace root                                |
| `deny`     | `cargo deny check`                                                | Where `deny.toml`, `.deny.toml` or `.cargo/deny.toml` is in the workspace root | No                                    | `Cargo.lock`, the root `Cargo.toml`, the cargo-deny configuration file and the manifest of every member          |
| `update`   | `cargo update`                                                    | Always                                                                         | No                                    | `Cargo.lock` and the root `Cargo.toml`                                                                           |
| `lockfile` | None: the plugin reads `Cargo.lock` and writes a digest per crate | Always                                                                         | Yes, as [[DES-LOCKFILE-HASHING]] says | The whole `Cargo.lock`, read also when git ignores it                                                            |

The coverage baseline target of [[DES-BASELINE]] is on the same project, in a workspace with `affectedTests` only.

**doc.** The workspace is documented in one call and its documentation is one site. rustdoc writes a folder per documented crate and files that every run merges, such as the search index and the list of crates. The output is therefore the whole `doc` folder of the [[TERM-ARTIFACT-DIR]], and a cache hit restores what a run writes. Outputs per crate could not do that: Nx restores a folder output by replacing it, so overlapping folders would delete each other's pages, and a crate's own folder lacks the shared styles and search index ([[EVD-CARGO-TARGET-COMMANDS]], [[EVD-NX-24-TARGETS]]). `--no-deps` comes from an option of the target that is on by default, as the flags of [[DES-TARGET-COMMANDS]] do; where it is set and its name belong to the option reference ([[DES-PLUGIN-OPTIONS]]).

**Existence.** Whether a tool is installed never decides whether a target exists. Every machine thus computes the same graph, and a missing tool cannot make `nx run-many -t audit` leave a workspace out without a word ([[ADR-CARGO-SOURCE-OF-TRUTH]], [[REQ-DIAGNOSTICS]]). A task whose tool is missing fails with the message of [[DES-DIAGNOSTICS]]. `deny` exists only where cargo-deny is configured, because without a configuration file cargo-deny falls back to defaults that reject every license ([[EVD-CARGO-AUDIT-DENY]]).

**lockfile.** Besides `doc`, the lockfile task is the only cached target of the workspace project, and every cached target of the workspace's crates depends on it ([[DES-LOCKFILE-HASHING]]).

**Caching.** `audit`, `deny` and `update` are not cached. cargo-audit and cargo-deny fetch the RustSec advisory database when they run, and no input covers it, so a cached pass could hide an advisory published since ([[EVD-CARGO-AUDIT-DENY]]). `update` exists to change `Cargo.lock`. Their inputs are declared all the same, so that `nx affected` selects them when a file they read changes.

**Locked mode.** `update` never passes `--locked`, also with the `locked` option or `NX_RUST_LOCKED=true`: `cargo update --locked` fails whenever the lockfile would change ([[EVD-CARGO-TARGET-COMMANDS]]), and changing it is what the task is for ([[REQ-NO-MANIFEST-WRITES]]). `deny` passes `--locked` to cargo-deny in locked mode and then fails instead of updating `Cargo.lock`; without it, cargo-deny resolves the workspace as plain cargo would and may update the lockfile. cargo-audit only reads `Cargo.lock` and has no such flag ([[EVD-CARGO-AUDIT-DENY]]).
:::
