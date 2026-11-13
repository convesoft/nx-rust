# Targets

> **Status:** the plugin infers the targets of this page, apart from the
> artifact and release targets and `lockfile`, `targetNames` renames them, and
> they run the commands below, each task with a cargo call of its own until
> the batching of milestone 0.2. The `lockfile` target and the crate targets'
> dependency on it are not implemented yet and arrive with nxr-xq9ava; until
> then `targetNames` rejects the key `lockfile`. Without cargo-audit or
> cargo-deny, `audit` and `deny` fail with cargo's own message for an unknown
> command. None of the targets is cached until its inputs are declared
> (nxr-fy4t4k). A `targetDefaults` entry in `nx.json` that turns caching on
> for one of them fails graph creation
> ([Target defaults that reach Rust targets](#target-defaults-that-reach-rust-targets)),
> and a task whose configuration caches it anyway, such as through a
> `project.json`, fails before cargo runs and says where the setting comes
> from: Nx's default inputs miss `Cargo.lock`, the toolchain and the
> environment, so it would restore results that no longer hold. The warnings
> of that section are printed when the graph is created and by `nx add`, not
> yet in the output of a task (nxr-rxzgbq).

The plugin infers targets from the shape of each crate and of each Cargo
workspace. Nothing is declared per crate.

| Target                     | Runs                                                | Exists on                                         | Cached | Outputs                                                           |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `build`                    | `cargo build`                                       | Every crate                                       | Yes    | Final artifacts only: executables, `cdylib` and `staticlib` files |
| `check`                    | `cargo check --all-targets`                         | Every crate                                       | Yes    | None; the result only                                             |
| `lint`                     | `cargo clippy --all-targets`                        | Every crate                                       | Yes    | None; the result only                                             |
| `test`                     | `cargo test` or nextest                             | Every crate                                       | Yes    | None; the result only                                             |
| `fmt-check`                | `cargo fmt --check`                                 | Every crate                                       | Yes    | None; the result only                                             |
| `fmt`                      | `cargo fmt`                                         | Every crate                                       | No     | None                                                              |
| `bench`                    | `cargo bench`                                       | Crates with a bench target                        | No     | None                                                              |
| `run`                      | `cargo run`                                         | Crates with a binary target                       | No     | None                                                              |
| `napi-build`, `wasm-build` | See [napi and wasm artifacts](artifacts.mara.md)    | Crates that produce that artifact                 | Yes    | The package files                                                 |
| Release publish            | `cargo publish`                                     | Crates without `publish = false`                  | No     | None                                                              |
| `doc`                      | `cargo doc --no-deps --workspace`                   | The workspace project                             | Yes    | The workspace's whole doc folder                                  |
| `audit`                    | `cargo audit`                                       | The workspace project                             | No     | None                                                              |
| `deny`                     | `cargo deny check`                                  | The workspace project, where cargo-deny is set up | No     | None                                                              |
| `update`                   | `cargo update`                                      | The workspace project                             | No     | None                                                              |
| `lockfile`                 | `cargo update --workspace`, then a digest per crate | The workspace project                             | No     | The digests, in `.nx/workspace-data`                              |

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
`[package.metadata.nx.targets.lint.options]` with `allTargets = false`.

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
`nx run api:run`. Arguments after `--` go to the binary, and so does the value
of the `args` option:

```sh
nx run api:run -- --port 3000
nx run api:run --bin server --args="--port 3000"
```

Use `--args` when you also pass a flag to Nx or to `run`, such as `--bin`: when
the command has `--`, Nx drops the flags before it that it does not know.
Use it also when an argument has the name of one of `run`'s options, such as
`--profile`, which Nx would otherwise check as that option and can reject.
Write `--args` with `=`, and give it once. Quotes inside its value group words
as in a shell, and nothing in it is expanded. A value that is only a number
needs a blank, as in `--args=" 3000"`, or goes after `--`, because Nx would
otherwise read it as a number and reject it.

A crate with several binaries needs to say which one `run` starts: set
`default-run` in its `[package]` table, or pass the binary through the `bin`
option of the `run` target, on the command line as in `nx run api:run
--bin=migrate` or in the crate's metadata. Without either, cargo stops and
lists the binaries.

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
  so: restoring one workspace's folder would delete the other's pages. It
  passes `--no-deps`; with `noDeps = false` in
  `[workspace.metadata.nx.project.targets.doc.options]` it documents the
  dependencies too.
- **`audit`** runs `cargo audit` against the workspace's `Cargo.lock`, with the
  settings in `.cargo/audit.toml` of the workspace root.
- **`deny`** runs `cargo deny check`. It exists only where `deny.toml`,
  `.deny.toml` or `.cargo/deny.toml` is in the workspace root, because without
  a configuration cargo-deny rejects every license.
- **`update`** runs `cargo update` and writes `Cargo.lock`. It never passes
  `--locked`, also with the `locked` option or `NX_RUST_LOCKED=true`, because
  changing the lockfile is its purpose.
- **`lockfile`** runs `cargo update --workspace`, which brings `Cargo.lock` up
  to date as your next `cargo build` would, and writes one digest per crate of
  the packages the crate reaches. It is not cached and runs in every run. Every
  cached task of a crate except `fmt-check` waits for it and reads the crate's
  digest, so a dependency update reruns only the crates it reaches
  ([Caching](caching.mara.md#lockfile-changes)).
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

The plugin warns about such an entry and says how to narrow it: see
[Target defaults that reach Rust targets](#target-defaults-that-reach-rust-targets).

A JS project that consumes a Rust crate depends on the crate's artifact target:
see [napi and wasm artifacts](artifacts.mara.md). The plugin adds no `^build`
to JS projects, and it cannot take yours away. If a JS target declares `^build`
and its project depends on a crate, Nx also runs that crate's native `build`.
It stops there, because the crate's `build` depends only on the `lockfile`
task of its workspace.

## Target defaults that reach Rust targets

A `targetDefaults` entry in `nx.json` keyed by a target's name, such as
`build`, `lint` or `test`, applies to the Rust targets of that name too, and
one keyed by `@convesoft/nx-rust:cargo` to every target of that executor. Nx
lays the entry over what the plugin infers: its `dependsOn`, `inputs`,
`outputs` and `cache` replace the plugin's values, unless a list keeps them
with `"..."` ([[EVD-NX-TARGET-DEFAULTS]]). The plugin checks its targets when Nx
creates the project graph, and `nx add` checks them before it registers the
plugin ([[DES-TARGET-DEFAULT-GUARD]]):

| What the entry does to a Rust target                               | Report  |
| ------------------------------------------------------------------ | ------- |
| Turns on caching that the plugin leaves off                        | Error   |
| Replaces the `inputs` or `outputs` that the plugin declares        | Error   |
| Replaces its `dependsOn`, which loses the dependency on `lockfile` | Error   |
| Adds a dependency on tasks of other projects, such as `^build`     | Warning |

An error stops every Nx command that needs the project graph until the entry is
narrowed: Nx would otherwise restore results that the task would not produce,
or `nx affected` would miss crates. A warning is printed, and the graph is
created ([Setup](setup.mara.md#error-messages-and-warnings) says where you see
it). The message names the entry, the targets, the projects and the fixes that
fit:

```text
The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:
  - It turns on caching for "build", which nx-rust leaves uncached: Nx could restore a result where running the task would give another one. In api (rust/crates/api/Cargo.toml).
To narrow the entry (https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/targets.mara.md#target-defaults-that-reach-rust-targets), do one of these:
  - Give the entry a "filter" that leaves these projects out, ...
  - Add an empty entry keyed by the executor of these targets, "@convesoft/nx-rust:cargo": {}. ...
```

Neither the plugin nor `nx add` edits the entry. Narrow it in one of these
ways:

- Give it a `filter`, which needs the entry written as a list. This one assumes
  that your crates carry the tag `lang:rust`, for example through
  `[workspace.metadata.nx]`. A filter on `executor`, naming the executor of
  your JS targets, works as well.

  ```json
  {
    "targetDefaults": {
      "build": [
        {
          "filter": { "projects": ["!tag:lang:rust"] },
          "dependsOn": ["^build"],
          "cache": true
        }
      ]
    }
  }
  ```

- Add an empty entry keyed by the executor of the Rust targets,
  `"@convesoft/nx-rust:cargo": {}`, and `"@convesoft/nx-rust:run": {}` for
  `run`. Nx chooses an entry keyed by a target's executor before one keyed by
  its name, so no entry keyed by a target name reaches those targets.
- Where the entry replaces a list, keep the plugin's values with `"..."`, as in
  `"inputs": ["...", "{workspaceRoot}/.tool-versions"]`.

## Options that cargo does not use

The `options` of a target default reach Rust targets too, and so do flags on
the command line, which Nx passes to every task of the targets it runs. A Rust
task runs as if an option it does not know were absent, such as Jest's
`passWithNoTests` or `--coverage`, and its output says so in one line per option
([[REQ-UNKNOWN-OPTIONS]]):

```text
api:test: ignoring option `coverage`, passed on the command line.
api:test: ignoring option `passWithNoTests`, which the cargo executor does not know. It comes from the workspace's configuration: run `nx show target api:test --json` and look under `sourceMap` for the file and entry. If it is a `targetDefaults` entry in nx.json, add a `filter` to it or add an empty entry keyed by "@convesoft/nx-rust:cargo".
```

Such an option fails no task. The same goes for an option of the plugin that
the target does not take, such as `--targetTriple` on `test`, which runs on the
host triple only, or `--allTargets` on `build`, and for words after `--` on any
target but `run`, which Nx hands the task as positional arguments:

```text
api:test: ignoring option `targetTriple`, which this target does not take, passed on the command line.
api:test: ignoring the positional arguments ["3000"] (option `_`), passed on the command line.
```

A line says that an option was passed on the command line only where that is
certain: for a flag you typed, also after `--`, and on a dependency that a
`dependsOn` entry with `params: "forward"` reaches. Any other line names the
workspace's configuration, also for an option that a dependency gets through
`options: "forward"`. On `run`, the arguments after `--` go to the binary
instead: see [Running binaries](#running-binaries).

To keep a target default away from Rust targets, and so silence the warning,
narrow the entry with a `filter`. This one assumes that your crates carry the
tag `lang:rust`, for example through `[workspace.metadata.nx]`:

```json
{
  "targetDefaults": {
    "test": [
      {
        "filter": { "projects": ["!tag:lang:rust"] },
        "options": { "passWithNoTests": true }
      }
    ]
  }
}
```

Or add an empty entry keyed by the target's executor, the `executor` that
`nx show project <crate> --json` shows for it: `@convesoft/nx-rust:cargo`, or
`@convesoft/nx-rust:run` for `run`. Nx prefers an entry keyed by the executor
to one keyed by the target name, so then no entry keyed by a target name
reaches the targets of that executor.

A Rust option with a value of the wrong type, such as a number for `profile`,
is not ignored: Nx rejects it before the plugin sees it. Rust tasks normally run
in a batch, and then every task of that batch fails, with a message that does
not name the option. A single task, such as `run` or any task with
`--batch=false`, fails alone, and Nx's message names the option.

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

No inferred target of a Rust crate depends on a target of another Rust crate, with one exception: every cached target of a crate other than `fmt-check` depends on the lockfile task of its workspace ([[DES-LOCKFILE-HASHING]]), which is a target of the root crate's project where the root manifest is a package. A change in a dependency reaches the dependent through cache inputs, not through task ordering. The plugin adds no task dependency to JS projects either. A `^build` that a JS target declares itself reaches the `build` of the crates its project depends on directly, as Nx defines `^build`, and goes no further.
:::

:::mara requirement REQ-TARGET-DEFAULT-GUARD
:mid: 01M78FHG7FV5M1E44R30RRAB5P
:title: Report target defaults that change Rust targets
:status: accepted
:satisfies: NEED-CLEAR-FAILURES
:satisfies: NEED-CORRECT-CACHE
:mitigates: RISK-TARGET-DEFAULTS

When a `targetDefaults` entry in `nx.json` adds a dependency on other crates' targets to an inferred Rust target, replaces the inputs or outputs the plugin inferred for it, or turns on caching that the plugin left off, the plugin reports the entry and the affected target and says how to narrow the entry. A list that keeps the inferred values with `"..."` does not count as replacing them.
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
| `lockfile`                 | `update --workspace`       | The workspace project                                          | No     | The crates' digests ([[DES-LOCKFILE-HASHING]]) |
| `audit`                    | cargo-audit's `audit`      | The workspace project                                          | No     | None                                           |
| `deny`                     | cargo-deny's `check`       | The workspace project, where a cargo-deny configuration exists | No     | None                                           |
| `update`                   | `update`                   | The workspace project                                          | No     | None                                           |

Only `clippy` is renamed, to `lint`: `lint`, `test` and `build` are the target names that Nx projects share. Formatting keeps Cargo's names, `fmt-check` and `fmt`, because Nx's `format` is a built-in command and not a target, and the targets of the workspace project keep the names of Cargo and the tools ([[ADR-NX-TARGET-NAMES]]); the lockfile task is called `lockfile`. Every name can be changed through plugin options, the names of the artifact targets and of the workspace project's targets included. `bench` is not cached, because timings differ between runs. The commands are [[DES-TARGET-COMMANDS]] and [[DES-WORKSPACE-TARGETS]].

Targets come from the `cargo metadata` report ([[DES-METADATA-REPORT]]): `run` exists when the crate has a binary target, `bench` when it has a bench target, an [[TERM-ARTIFACT-TARGET]] when the crate produces that artifact ([[DES-ARTIFACT-STEPS]]), and the release targets unless the manifest sets `publish = false`. The last five rows are targets of the [[TERM-WORKSPACE-PROJECT]]; `deny` exists only where a cargo-deny configuration file is in the workspace root. Whether a tool is installed never decides whether a target exists.

**Executors.** Every inferred target runs the plugin's cargo executor, `@convesoft/nx-rust:cargo`, which has the batch implementation of [[DES-BATCH]], apart from `run`, which runs `@convesoft/nx-rust:run`, an executor without one ([[DES-TARGET-COMMANDS]]). Each target carries its default name from the table in its metadata, as `metadata.cargo.target`, so that the executor runs the same command whatever name `targetNames` gives the target. It also carries the `locked` option of the plugin entry that created its project, as `metadata.cargo.locked`, from which the executor decides locked mode ([[DES-INVOCATION]]). A target that names one of these executors but that the plugin did not infer has no such name, and its task fails before cargo runs ([[DES-DIAGNOSTICS]]).

No inferred target has a `dependsOn` entry that names another Rust crate's target, except that every cached crate target other than `fmt-check` depends on the lockfile task of its workspace ([[REQ-NO-RUST-TASK-DEPS]]), and none uses `^build` ([[ADR-NO-RUST-BUILD-DEPS]]). Dependencies reach a target through `^` inputs ([[DES-INPUTS]]). The plugin adds no `dependsOn` entry to a JS project. A JS target's own `^build` reaches the `build` of the crates its project depends on directly, which is how Nx defines `^build`, and ends there.
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

**Flags as options.** A flag beyond the package selection comes from an option of the target, so that a command passes only what its options ask for ([[DES-INVOCATION]]). `--all-targets` on `check` and `lint` is such an option, on by default. A crate switches it off in the options of the target in its `[package.metadata.nx]` table ([[DES-METADATA-TABLES]]), for example when its benches need a nightly compiler, which stable rejects under `--all-targets`. Tasks whose options differ never share a cargo call ([[TERM-GROUP]]). The option is `allTargets` ([[DES-PLUGIN-OPTIONS]]). `--all-targets` is what rust-analyzer passes by default, so `check` compiles the units the editor compiles and the two reuse each other's work ([[EVD-CARGO-TARGET-COMMANDS]]).

**Warnings.** No target adds a flag that turns warnings into errors. A task fails on warnings where the repository says so through Cargo: lint levels in `[lints]` and `[workspace.lints]`, `build.warnings` in `.cargo/config.toml` or `CARGO_BUILD_WARNINGS`, which Cargo honours from 1.97 on, and `RUSTFLAGS`, all of which are cache inputs ([[DES-INPUTS]]). Passing `-D warnings` to clippy would differ from plain `cargo clippy` and check every selected member again whenever a developer alternates the two ([[EVD-CARGO-TARGET-COMMANDS]]).

**Formatting.** `fmt` exists on every crate and formats only the crates of its tasks. `cargo fmt --all` would also rewrite path dependencies outside the workspace, and plain `cargo fmt` in the workspace root would rewrite members that have no project ([[EVD-CARGO-TARGET-COMMANDS]], [[REQ-SKIP-CRATES]]). `cargo fmt -p` takes package names only, not package ID specs; names are unique within a workspace, so the name addresses the crate.

**bench.** The target has `parallelism: false`, so that Nx starts no other task while benchmarks run. Nx never puts such a task into a batch, so each `bench` task is a cargo call of its own ([[EVD-NX-24-TARGETS]]).

**run.** One `run` target per crate. When the crate has several binaries, an option of the target, `bin`, passes `--bin`; it is set on the command line or in the crate's metadata ([[DES-PLUGIN-OPTIONS]]). Without it and without `default-run` in the manifest, cargo fails and lists the binaries. The `args` option, a string, gives the binary its arguments. It is split into words at blanks outside quotes. Single quotes, double quotes and backslashes quote and escape as in a POSIX shell, an empty pair of quotes is an empty word, and nothing is expanded or treated as an operator, so `|`, `;` and `>` are ordinary characters. An unterminated quote, or a backslash at the end, fails the task with a message that names the option. Arguments after `--` on the `nx` command line go to the binary too, after those of `args`, within two limits that come from Nx ([[EVD-NX-OPTION-VALIDATION]]). When the command has `--`, Nx drops the flags before it that Nx does not know itself, so `--bin` and `--args` cannot be combined with `--`. Nx also parses what follows `--` as options of the target and checks them against its schema before the executor runs, so an argument with the name of one of `run`'s options can be rejected. `--args` works in both cases. Nx also reads a value of `--args` that looks like a number as a number, so `--args=3000` and `--args="3000"` fail the schema. `--args=" 3000"`, with a blank, stays a string and gives the one word `3000`, and `-- 3000` passes `3000` as well. `run` uses an executor that has no batch implementation, because `cargo run` accepts one package only, while Nx hands every task of an executor with a batch implementation and `preferBatch` to one batch, also the tasks of `nx run-many -t run` ([[EVD-CARGO-TARGET-COMMANDS]], [[EVD-NX-24-TARGETS]]). `run` is not a continuous task: a task that depends on it waits until the binary exits. A crate that serves something sets `continuous` and `readyWhen` on its `run` in its metadata ([[DES-METADATA-TABLES]]). `nx run <project>` is Nx's own syntax and needs a target, so the short form is `nx run <project>:run`.

The targets of the workspace project are [[DES-WORKSPACE-TARGETS]].
:::

:::mara design DES-WORKSPACE-TARGETS
:mid: 01M78FHG7FDHZMAH480DED8M6W
:title: Targets of the workspace project
:status: accepted
:satisfies: REQ-WORKSPACE-PROJECT

The [[TERM-WORKSPACE-PROJECT]] hosts the targets that concern a whole Cargo workspace. Each command starts in the workspace root ([[DES-INVOCATION]]).

| Target     | Command                                                                             | Exists                                                                         | Cached                       | Inputs                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc`      | `cargo doc --no-deps --workspace`                                                   | Always                                                                         | Yes, as [[DES-OUTPUTS]] says | Those of every cached target ([[DES-INPUTS]]), with the files of every member through the project's dependencies                                                                            |
| `audit`    | `cargo audit`                                                                       | Always                                                                         | No                           | `Cargo.lock`, the root `Cargo.toml` and `.cargo/audit.toml` of the workspace root                                                                                                           |
| `deny`     | `cargo deny check`                                                                  | Where `deny.toml`, `.deny.toml` or `.cargo/deny.toml` is in the workspace root | No                           | `Cargo.lock`, the root `Cargo.toml`, the cargo-deny configuration file and the manifest of every member                                                                                     |
| `update`   | `cargo update`                                                                      | Always                                                                         | No                           | `Cargo.lock` and the root `Cargo.toml`                                                                                                                                                      |
| `lockfile` | `cargo update --workspace`, with `--locked` in locked mode, then a digest per crate | Always                                                                         | No                           | `Cargo.lock`, read also when git ignores it, the root `Cargo.toml`, the `Cargo.toml` of every member and of every path package in the repository, and the workspace files of [[DES-INPUTS]] |

The coverage baseline target of [[DES-BASELINE]] is on the same project, in a workspace with `affectedTests` only.

**doc.** The workspace is documented in one call and its documentation is one site. rustdoc writes a folder per documented crate and files that every run merges, such as the search index and the list of crates. The output is therefore the whole `doc` folder of the [[TERM-ARTIFACT-DIR]], and a cache hit restores what a run writes. Outputs per crate could not do that: Nx restores a folder output by replacing it, so overlapping folders would delete each other's pages, and a crate's own folder lacks the shared styles and search index ([[EVD-CARGO-TARGET-COMMANDS]], [[EVD-NX-24-TARGETS]]). `--no-deps` comes from an option of the target that is on by default, as the flags of [[DES-TARGET-COMMANDS]] do: `noDeps`, set like the other options of the workspace project's targets ([[DES-PLUGIN-OPTIONS]]).

**Existence.** Whether a tool is installed never decides whether a target exists. Every machine thus computes the same graph, and a missing tool cannot make `nx run-many -t audit` leave a workspace out without a word ([[ADR-CARGO-SOURCE-OF-TRUTH]], [[REQ-DIAGNOSTICS]]). A task whose tool is missing fails with the message of [[DES-DIAGNOSTICS]]. `deny` exists only where cargo-deny is configured, because without a configuration file cargo-deny falls back to defaults that reject every license ([[EVD-CARGO-AUDIT-DENY]]).

**lockfile.** The lockfile task is not cached and runs whenever a task that depends on it runs: every cached target of the workspace's crates other than `fmt-check`, and `doc` ([[DES-LOCKFILE-HASHING]]).

**Caching.** `audit`, `deny` and `update` are not cached. cargo-audit and cargo-deny fetch the RustSec advisory database when they run, and no input covers it, so a cached pass could hide an advisory published since ([[EVD-CARGO-AUDIT-DENY]]). `update` exists to change `Cargo.lock`. Their inputs are declared all the same, so that `nx affected` selects them when a file they read changes.

**Locked mode.** `update` never passes `--locked`, also with the `locked` option or `NX_RUST_LOCKED=true`: `cargo update --locked` fails whenever the lockfile would change ([[EVD-CARGO-TARGET-COMMANDS]]), and changing it is what the task is for ([[REQ-NO-MANIFEST-WRITES]]). `deny` passes `--locked` to cargo-deny in locked mode and then fails instead of updating `Cargo.lock`; without it, cargo-deny resolves the workspace as plain cargo would and may update the lockfile. cargo-audit only reads `Cargo.lock` and has no such flag ([[EVD-CARGO-AUDIT-DENY]]).
:::

:::mara design DES-TARGET-DEFAULT-GUARD
:mid: 01M7AT4GDP59EWQTMVSVR69G4M
:title: Report target defaults that change inferred targets
:status: accepted
:satisfies: REQ-TARGET-DEFAULT-GUARD

**Where.** `createDependencies` receives the projects after Nx has laid the `targetDefaults` of `nx.json` over the plugin's targets, while the plugin entry that created them still holds what it inferred ([[EVD-NX-TARGET-DEFAULTS]]). For each inferred target the plugin compares the two. A target whose executor is no longer the inferred one was replaced by another file and is left alone. `init` runs the same check through the plugin's `createDependencies` ([[DES-GENERATORS]]).

**What counts.** Each row compares the target as Nx merged it with the target as the plugin inferred it.

| The merged target                                                                                                                                                                                                        | Severity |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Has caching on where the plugin's `cache` is not `true`                                                                                                                                                                  | Error    |
| Lacks an `inputs` entry that the plugin declared                                                                                                                                                                         | Error    |
| Lacks an `outputs` entry that the plugin declared                                                                                                                                                                        | Error    |
| Lacks a `dependsOn` entry that the plugin declared, such as the one on the workspace's lockfile task ([[DES-LOCKFILE-HASHING]])                                                                                          | Error    |
| Has a `dependsOn` entry that the plugin did not declare and that Nx's task graph resolves to tasks of other projects: `^<target>`, `dependencies: true`, or `projects` or `<project>:<target>` that name another project | Warning  |

A row counts only where the elements of `targetDefaults` that Nx laid over the target set that field, and the `project.json` or `package.json` in the project's folder does not: `cache: true` for the first row, a list without `"..."` for a missing entry, and the added entry itself for the last row. A list with `"..."` keeps what lies below it in its place. In an element, that is what the plugin inferred, so such an element replaces nothing. In the folder's file, it is what the elements gave, so the change stays theirs. A field that the folder's file sets without `"..."` is that file's, and a change it makes is not reported. The comparison is with what the plugin infers for the target at the time: where it declares no inputs, outputs or `dependsOn`, there is nothing to lose, and while it leaves every target uncached, an entry that sets `cache: true` on any of them is an error.

**Severity.** An entry that only adds dependencies costs time and leaves results correct ([[EVD-NXRUST-BUILD-DEPS]]), so it is a warning. The other rows let Nx restore a result that the task would not produce, or let `nx affected` miss a crate, so they are errors ([[GOAL-TRUSTED-CACHE]]). A `dependsOn` that loses the lockfile task drops the crate's digest from its key ([[DES-LOCKFILE-HASHING]]).

**Which layer.** `createDependencies` receives no record of which layer set a value, so where a target differs from what the plugin inferred, the plugin establishes it with Nx's own code. Nx's default plugins for `package.json` and `project.json`, run on those of the two files in the project's folder that Nx sees, give what the folder declares. Nx's synthesis of target defaults, `createTargetDefaultsResults` from `nx/src/devkit-internals`, given the plugin's projects as its `createNodes` returned them, those declarations and the name under which Nx knows the plugin's entry, gives the elements of `targetDefaults` that Nx laid over the target, with their key and positions. The order of keys and every `filter` therefore work as in Nx ([[EVD-NX-TARGET-DEFAULTS]]), also a `filter.plugin` that stops matching when the folder's file declares the target's executor. Nx's normalisation of `dependsOn` for the task graph decides which projects an added entry reaches. Other plugins listed in `nx.json` are not taken as a layer. These parts of Nx are not public API. They are loaded only when a target differs, and where the installed Nx lacks one, graph creation fails with the error of [[DES-DIAGNOSTICS]].

**Message.** One paragraph per entry and severity names the key and its elements, says what the entry does to which targets of which projects, with their manifests, and lists the ways to narrow the entry that fit: a `filter` on `projects` or `executor`; an empty entry keyed by the targets' executor, which Nx chooses before an entry keyed by the target's name; removing the field from an entry keyed by the plugin's executor; and `"..."` in a list that replaces. Errors stop graph creation, and warnings are printed where [[DES-DIAGNOSTICS]] says. The plugin never edits `targetDefaults`.
:::
