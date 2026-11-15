# Targets

> **Status:** the plugin infers the targets of this page apart from
> `napi-build` and `wasm-build`, which arrive with milestone 0.4, and the
> coverage baseline of milestone 0.3; a cargo-hakari hack crate still gets
> `nx-release-publish`, until its guard arrives with milestone 0.5. `test`
> runs `cargo test`; nextest arrives with milestone 0.3. `build` and `doc` run
> the executor `@convesoft/nx-rust:cargo-outputs`, the other cargo targets
> `@convesoft/nx-rust:cargo`. Each task still runs a cargo call of its own,
> until the strategies of milestone 0.2 let crates share one
> ([Batching and features](execution.mara.md)).

The plugin infers targets from the shape of each crate and of each Cargo
workspace. Nothing is declared per crate.

| Target                     | Runs                                                                 | Exists on                                                                     | Cached | Outputs                                                           |
| -------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `build`                    | `cargo build`                                                        | Every crate                                                                   | Yes    | Final artifacts only: executables, `cdylib` and `staticlib` files |
| `check`                    | `cargo check --all-targets`                                          | Every crate                                                                   | Yes    | None; the result only                                             |
| `lint`                     | `cargo clippy --all-targets`                                         | Every crate                                                                   | Yes    | None; the result only                                             |
| `test`                     | `cargo test` or nextest                                              | Every crate                                                                   | Yes    | None; the result only                                             |
| `fmt-check`                | `cargo fmt --check`                                                  | Every crate                                                                   | Yes    | None; the result only                                             |
| `fmt`                      | `cargo fmt`                                                          | Every crate                                                                   | No     | None                                                              |
| `bench`                    | `cargo bench`                                                        | Crates with a bench target                                                    | No     | None                                                              |
| `run`                      | `cargo run`                                                          | Crates with a binary target                                                   | No     | None                                                              |
| `napi-build`, `wasm-build` | See [napi and wasm artifacts](artifacts.mara.md)                     | Crates that produce that artifact                                             | Yes    | The package files                                                 |
| `nx-release-publish`       | `cargo publish`                                                      | Crates without `publish = false`, apart from a hack crate                     | No     | None                                                              |
| `doc`                      | `cargo doc --no-deps --workspace`                                    | The workspace project                                                         | Yes    | The workspace's whole doc folder                                  |
| `audit`                    | `cargo audit`                                                        | The workspace project                                                         | No     | None                                                              |
| `deny`                     | `cargo deny check`                                                   | The workspace project, where cargo-deny is set up                             | No     | None                                                              |
| `update`                   | `cargo update`                                                       | The workspace project                                                         | No     | None                                                              |
| `lockfile`                 | `cargo update --workspace`, then a digest per crate                  | The workspace project                                                         | No     | The digests, in `.nx/workspace-data`                              |
| `hakari-check`             | `cargo hakari generate --diff`, `cargo hakari manage-deps --dry-run` | The workspace project, where the workspace uses the `hakari` feature strategy | No     | None                                                              |

A crate's targets select it with `-p` and its package ID specification, which
cargo gives each task, and `fmt` and `fmt-check` with its package name. Every
command starts in the root folder of the crate's workspace
([Caching](caching.mara.md#where-cargo-runs)). With `--verbose`, each task
prints its exact command before it runs
([Seeing the command](caching.mara.md#seeing-the-command)).

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

`run` builds the binary as `cargo run` does and leaves it in the artifact
directory. With the options of `build`, it is the executable that `build`
writes. With other features or another profile, it replaces that executable
until the next `build`, run or restored from the cache, puts it back. `run` is
not cached and Nx does not order it after `build`, so do not run a crate's
`run` with other options in the same command as its `build` or `test`: the
`build` could store the executable of `run`, or the tests could run it.

## Tests that build a crate's binaries

For a crate with a binary and an integration test, `cargo test` builds the
binary again, with what the crate's dev-dependencies turn on and with
`[profile.test]`, and puts it where `cargo build` put its own, such as
`target/debug/api`. The tests run it from there as `CARGO_BIN_EXE_api`. So that
Nx never stores one of the two under the other's key, and the tests always run
their own, `test` waits for the crate's own `build` in such crates:

```sh
nx test api                   # runs or restores api:build, then runs api:test
nx run-many -t build test     # api:test starts once api:build has ended
```

- **Which crates.** Those with a binary and an integration test in `tests/` or
  under `[[test]]`, with or without `harness = false`, or a bench with
  `test = true`, whose tests `cargo test` runs. Examples, unit tests, doctests,
  a `[[test]]` with `test = false` and libraries do not count.
- **What it costs.** `nx test api` and `nx affected -t test` also run or restore
  `api:build`. With a warm build directory that is one quick task more; on a
  cold one, cargo also compiles what differs between the two executables,
  which plain `cargo build` would compile as well. A command that names both
  targets only orders them.
- **What is left on disk.** After a run of both, `target/debug/api` is the
  executable that `cargo test` built, as after plain
  `cargo build && cargo test`. The next `nx build api`, run or restored from
  the cache, puts the one of `build` back. The cache entries are right either
  way.
- **Your own `dependsOn`.** Keep the plugin's entries with `"..."` when you
  change the `dependsOn` of such a `test`, as in
  `"dependsOn": ["...", "^codegen"]`. Without them, a `test` task whose
  command also runs or restores the crate's `build` fails before cargo runs and
  says so; `nx test api` alone still runs. A dependency on a continuous task,
  such as a server the tests talk to, keeps the order only where that task, or
  a task it depends on, depends on `build` itself.
- **What it cannot order.** Two `nx` commands started at the same time in one
  checkout, `run` with other options than `build`, and two crates whose
  binaries have the same name can still write one file while the other's
  `build` ends.

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
  digest, so a dependency update reruns only the crates it reaches, where the
  workspace uses the `hakari` feature strategy; under `workspace-build` and
  `cargo` it reruns them all ([Caching](caching.mara.md#lockfile-changes)).
- **`hakari-check`**, where the workspace uses the `hakari` feature strategy,
  runs `cargo hakari generate --diff` and `cargo hakari manage-deps --dry-run`
  after `lockfile`. It is not cached, and the same crate tasks wait for it, so
  none of them runs while the hack crate is stale
  ([Batching and features](execution.mara.md#when-the-hack-crate-is-enough)).
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
Rust targets with that name too, unless an entry keyed by their executor comes
first, as the one that `nx add` adds does.

```json
{
  "targetDefaults": {
    "build": { "dependsOn": ["^build"] }
  }
}
```

Such an entry replaces the `dependsOn` of the Rust `build` targets, which
depend on their workspace's `lockfile` task, so it fails graph creation. With
`"..."`, as in `["...", "^build"]`, it keeps that dependency and adds `^build`,
and the plugin warns. Either way the message says how to narrow the entry: see
[Target defaults that reach Rust targets](#target-defaults-that-reach-rust-targets).

A JS project that consumes a Rust crate depends on the crate's artifact target:
see [napi and wasm artifacts](artifacts.mara.md). The plugin adds no `^build`
to JS projects, and it cannot take yours away. If a JS target declares `^build`
and its project depends on a crate, Nx also runs that crate's native `build`.
It stops there, because the crate's `build` depends only on the `lockfile`
task of its workspace and, with the `hakari` feature strategy, its
`hakari-check` task.

## Target defaults that reach Rust targets

A `targetDefaults` entry in `nx.json` keyed by a target's name, such as
`build`, `lint` or `test`, applies to the Rust targets of that name too, and
one keyed by an executor of the plugin to every target of that executor. Nx
lays the entry over what the plugin infers: its `dependsOn`, `inputs`,
`outputs` and `cache` replace the plugin's values, unless a list keeps them
with `"..."` ([[EVD-NX-TARGET-DEFAULTS]]).

An extra target that you define with a `targets` table in the Cargo metadata
([Configuration](configuration.mara.md#changing-an-inferred-target)) gets the
entry in the same way, over what the table sets. The plugin checks only the
targets that it infers, so such an entry may turn on caching for the extra
target or replace its inputs.

`build` and `doc` run `@convesoft/nx-rust:cargo-outputs` from milestone 0.2
on, so that Nx batches and stores them apart from the tasks that wait for them
([Batching and features](execution.mara.md#two-batches)); before, they ran
`@convesoft/nx-rust:cargo`. An entry keyed by `@convesoft/nx-rust:cargo` no
longer reaches them: where it is meant for them too, add the same entry keyed
by `@convesoft/nx-rust:cargo-outputs`. A repository that `nx add` set up before
has no entry keyed by `@convesoft/nx-rust:cargo-outputs`, so an entry keyed
`build` reaches the Rust `build` targets again, and the check below reports
what it changes; an entry such as `"build": { "dependsOn": ["^build"] }`
replaces their `dependsOn` and stops graph creation. Run
`nx g @convesoft/nx-rust:init`, which adds the missing entry and changes
nothing else, or add `"@convesoft/nx-rust:cargo-outputs": {}` yourself.

`nx add` adds `"@convesoft/nx-rust:cargo": {}`,
`"@convesoft/nx-rust:cargo-outputs": {}`, `"@convesoft/nx-rust:run": {}`,
`"@convesoft/nx-rust:lockfile": {}` and
`"@convesoft/nx-rust:release-publish": {}` where `targetDefaults` lacks them
([Setup](setup.mara.md#adding-the-plugin)). Nx chooses an entry keyed by a
target's executor before one keyed by its name or a glob, so with these entries
in place only an entry keyed by one of the five executors reaches Rust
targets. The plugin checks its targets when Nx creates
the project graph, and `nx add` checks them before it writes anything
([[DES-TARGET-DEFAULT-GUARD]]):

| What the entry does to a Rust target                                                                                                                     | Report  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Turns on caching that the plugin leaves off                                                                                                              | Error   |
| Replaces the `inputs` or `outputs` that the plugin declares                                                                                              | Error   |
| Replaces its `dependsOn`, which loses the dependency on `lockfile` or `hakari-check` or, on a `test` that waits for its crate's `build`, on that `build` | Error   |
| Adds a dependency on tasks of other projects, such as `^build`                                                                                           | Warning |

Caching counts only on a target that the plugin leaves uncached: `fmt`, `bench`,
`run`, `audit`, `deny` and `update`, and `build` and `doc` where
[Caching](caching.mara.md#what-is-stored) says they run uncached, such as
in a workspace whose artifact directory lies outside the repository, and a
target whose table in the Cargo metadata sets `cache = false`. Turning on
caching for a target that the plugin caches changes nothing and is not
reported. A `project.json` or `package.json` in a crate's folder that turns on
caching for an uncached target is not reported here either; its task fails
before cargo runs and says why the plugin leaves the target uncached.

An error stops every Nx command that needs the project graph until the entry is
narrowed: Nx would otherwise restore results that the task would not produce,
or `nx affected` would miss crates. A warning is printed, and the graph is
created ([Setup](setup.mara.md#error-messages-and-warnings) says where you see
it). Each task of a target that the entry changes prints the warning again at
its start, also when Nx restores the task from the cache, and adding or
removing the entry runs those tasks again. The message names the entry, the
targets, the projects and the fixes that fit:

```text
The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:
  - It replaces the inputs that nx-rust declares for "build", so that the cache key and nx affected miss files or settings that the task depends on. In api (rust/crates/api/Cargo.toml).
To narrow the entry (https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/targets.mara.md#target-defaults-that-reach-rust-targets), do one of these:
  - Give the entry a "filter" that leaves these projects out, ...
  - Add an empty entry keyed by the executor of these targets, "@convesoft/nx-rust:cargo-outputs": {}. ...
  - Keep what nx-rust declares by putting "..." into the entry's "inputs" list, as in ["...", <your entries>].
```

Where something else changes a Rust target as well, such as another plugin
listed in `nx.json`, nx-rust may not be able to tell which configuration made
the change. For caching turned on, or dependencies added, it then reports no
entry, but warns, naming the target and the fields that differ, and points to
`nx show target <project>:<target> --json`, whose `sourceMap` names the file
and entry behind each field. The tasks of that target print this warning at
their start too. For inputs, outputs or dependencies taken away, see
[Other plugins that reach Rust targets](#other-plugins-that-reach-rust-targets).

Neither the plugin nor `nx add` changes an entry that is there. Narrow it in one
of these ways:

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
  `"@convesoft/nx-rust:cargo": {}`, `"@convesoft/nx-rust:cargo-outputs": {}`
  for `build` and `doc`, `"@convesoft/nx-rust:run": {}` for `run`,
  `"@convesoft/nx-rust:lockfile": {}` for `lockfile` and
  `"@convesoft/nx-rust:release-publish": {}` for `nx-release-publish`, as
  `nx add` does where they are missing. Nx chooses an entry keyed by a
  target's executor before one keyed by its name, so no entry keyed by a target
  name reaches those targets.
- Where the entry is keyed by one of those executors, remove the field that the
  message names.
- Where the entry replaces a list, keep the plugin's values with `"..."`, as in
  `"inputs": ["...", "{workspaceRoot}/.tool-versions"]`.

## Other plugins that reach Rust targets

Nx merges the targets of the plugins listed after nx-rust in `nx.json` over the
Rust targets, and then the `project.json` and `package.json` in the crate's
folder. Another plugin may add to a Rust target, but it may not take away an
`inputs`, `outputs` or `dependsOn` entry that nx-rust declares, or narrow one:
a negated pattern such as `"!{projectRoot}/src/**/*"`, or a `default` or other
named input that it defines anew for the crate, takes files out of the key just
as well. Nx could then restore a result that the task would not give, so graph
creation fails, also where `targetDefaults` is empty, with a message that names
the target, what was lost or left out and the plugins listed after nx-rust.
Keep that plugin away from the crate with an `exclude` on its entry in
`nx.json`, or, where the plugin is yours, have it keep nx-rust's entries with
`"..."` and add no negated pattern or named input for the crate. If the change
is what you want, write it into the `project.json` in the crate's folder: nx-rust takes
that file, and a `package.json` there, as your own statement for the project.
A plugin that gives a target an executor or command of its own, as Nx's Jest
plugin gives `test`, replaces the whole target, which then no longer runs
cargo, and nx-rust leaves it alone. Caching that another plugin turns on makes
the target's tasks fail before cargo runs.

nx-rust reads these lists as Nx's JavaScript helpers expand them, which comes
close to, but is not exactly, how Nx plans a task's key. It can refuse a
negated pattern that leaves the key as it was, such as one under
`{workspaceRoot}`, which the fixes above get past, and it misses a few rare
forms of narrowing, such as a named input that another plugin defines anew
for a crate that a `^` input reads
([Risks](decisions.mara.md#risks)).

## Options that cargo does not use

The `options` of a target default reach Rust targets too, and so do flags on
the command line, which Nx passes to every task of the targets it runs. A Rust
task runs as if an option it does not know were absent, such as Jest's
`passWithNoTests` or `--coverage`, and its output says so in one line per option
([[REQ-UNKNOWN-OPTIONS]]):

```text
api:test: ignoring option `coverage`, passed on the command line. Remove it, or check its spelling.
api:test: ignoring option `passWithNoTests`, which the cargo executor does not know. It comes from the workspace's configuration: run `nx show target api:test --json` and look under `sourceMap` for the file and entry. If it is a `targetDefaults` entry in nx.json, add a `filter` to it or add an empty entry keyed by "@convesoft/nx-rust:cargo".
```

Such an option fails no task. The same goes for an option of the plugin that
the target does not take, such as `--targetTriple` on `test`, which runs on the
host triple only, or `--allTargets` on `build`, and for words after `--` on any
target but `run`, which Nx hands the task as positional arguments:

```text
api:test: ignoring option `targetTriple`, which this target does not take, passed on the command line. Remove it.
api:test: ignoring the positional arguments ["3000"] (option `_`), passed on the command line. Remove them.
```

A line says that an option was passed on the command line only where that is
certain: for a flag you typed, also after `--`, and on a dependency that a
`dependsOn` entry with `params: "forward"` reaches. Any other line names the
workspace's configuration, also for an option that a dependency gets through
`options: "forward"`. On `run`, the arguments after `--` go to the binary
instead: see [Running binaries](#running-binaries). There the line for an
option that `run` does not know, or for words typed without `--`, adds that you
can pass them to the binary after `--` or with `--args`. No other target passes
arguments on, and the plugin has no option for arguments of a test binary.

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
`nx show project <crate> --json` shows for it: `@convesoft/nx-rust:cargo`,
`@convesoft/nx-rust:cargo-outputs` for `build` and `doc`,
`@convesoft/nx-rust:run` for `run`, `@convesoft/nx-rust:lockfile` for
`lockfile`, or `@convesoft/nx-rust:release-publish` for `nx-release-publish`.
`nx add` adds all five where they are missing.
Nx prefers an entry keyed by the executor to one keyed by the target name, so
then no entry keyed by a target name reaches the targets of that executor.

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

No inferred target of a Rust crate depends on a target of another Rust crate, with two exceptions, both targets of the workspace project, which is the root crate's project where the root manifest is a package: every cached target of a crate other than `fmt-check` depends on the lockfile task of its workspace ([[DES-LOCKFILE-HASHING]]), and, in a workspace that uses the `hakari` feature strategy, on the workspace's drift check of the hack crate, which depends only on the lockfile task ([[DES-UNIFICATION]]). A change in a dependency reaches the dependent through cache inputs, not through task ordering. A dependency between two targets of the same crate is no dependency between crates, and so neither an exception nor what this requirement forbids: a crate's `test` depends on the crate's own `build` where `cargo test` replaces the executables of that `build` ([[DES-TARGETS]]). The plugin adds no task dependency to JS projects either. A `^build` that a JS target declares itself reaches the `build` of the crates its project depends on directly, as Nx defines `^build`, and goes no further.
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

| Default name               | Cargo's or the tool's name                                   | Exists on                                                                                    | Cached | Nx outputs                                     |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| `build`                    | `build`                                                      | Every crate                                                                                  | Yes    | Final artifacts only ([[DES-OUTPUTS]])         |
| `check`                    | `check`                                                      | Every crate                                                                                  | Yes    | None                                           |
| `lint`                     | `clippy`                                                     | Every crate                                                                                  | Yes    | None                                           |
| `test`                     | `test`                                                       | Every crate                                                                                  | Yes    | None                                           |
| `fmt-check`                | `fmt --check`                                                | Every crate                                                                                  | Yes    | None                                           |
| `fmt`                      | `fmt`                                                        | Every crate                                                                                  | No     | None                                           |
| `bench`                    | `bench`                                                      | Crates with a bench target                                                                   | No     | None                                           |
| `run`                      | `run`                                                        | Crates with a binary target                                                                  | No     | None                                           |
| `napi-build`, `wasm-build` | none                                                         | Crates that produce that artifact                                                            | Yes    | [[DES-ARTIFACT-STEPS]]                         |
| `nx-release-publish`       | `publish`                                                    | Crates without `publish = false`, other than the [[TERM-HACK-CRATE]]                         | No     | None                                           |
| `doc`                      | `doc`                                                        | The workspace project                                                                        | Yes    | The workspace's doc folder ([[DES-OUTPUTS]])   |
| `lockfile`                 | `update --workspace`                                         | The workspace project                                                                        | No     | The crates' digests ([[DES-LOCKFILE-HASHING]]) |
| `hakari-check`             | cargo-hakari's `generate --diff` and `manage-deps --dry-run` | The workspace project, where the workspace uses the `hakari` strategy of [[DES-UNIFICATION]] | No     | None                                           |
| `audit`                    | cargo-audit's `audit`                                        | The workspace project                                                                        | No     | None                                           |
| `deny`                     | cargo-deny's `check`                                         | The workspace project, where a cargo-deny configuration exists                               | No     | None                                           |
| `update`                   | `update`                                                     | The workspace project                                                                        | No     | None                                           |

Only `clippy` is renamed, to `lint`: `lint`, `test` and `build` are the target names that Nx projects share. Formatting keeps Cargo's names, `fmt-check` and `fmt`, because Nx's `format` is a built-in command and not a target, and the targets of the workspace project keep the names of Cargo and the tools ([[ADR-NX-TARGET-NAMES]]); the lockfile task is called `lockfile`, and the drift check of the hack crate `hakari-check`, after `fmt-check`, because it checks without changing anything. Every name can be changed through plugin options, the names of the artifact targets and of the workspace project's targets included, apart from `nx-release-publish`: Nx release runs the target only under that name ([[DES-RELEASE]]). `bench` is not cached, because timings differ between runs. The commands are [[DES-TARGET-COMMANDS]] and [[DES-WORKSPACE-TARGETS]].

Targets come from the `cargo metadata` report ([[DES-METADATA-REPORT]]): `run` exists when the crate has a binary target, `bench` when it has a bench target, an [[TERM-ARTIFACT-TARGET]] when the crate produces that artifact ([[DES-ARTIFACT-STEPS]]), and `nx-release-publish` unless the manifest sets `publish = false` or the crate is the hack crate of a cargo-hakari configuration ([[DES-RELEASE]]). The last six rows are targets of the [[TERM-WORKSPACE-PROJECT]]; `deny` exists only where a cargo-deny configuration file is in the workspace root, and `hakari-check` only where the workspace uses the `hakari` strategy, which its files decide ([[DES-UNIFICATION]]). Whether a tool is installed never decides whether a target exists.

**Executors.** Every inferred target runs the plugin's cargo executor, `@convesoft/nx-rust:cargo`, which has the batch implementation of [[DES-BATCH]], apart from `build` and `doc`, the targets whose files Nx stores ([[DES-OUTPUTS]]), which run `@convesoft/nx-rust:cargo-outputs`, the same executor with the same batch implementation under a name of its own, so that Nx batches and stores them apart from the tasks that wait for them ([[DES-BATCH]]); `run`, which runs `@convesoft/nx-rust:run`, and `lockfile` and `hakari-check`, which run `@convesoft/nx-rust:lockfile`, two executors without a batch implementation ([[DES-TARGET-COMMANDS]], [[DES-LOCKFILE-HASHING]], [[DES-UNIFICATION]]); and `nx-release-publish`, which runs `@convesoft/nx-rust:release-publish`, an executor with a batch implementation of its own ([[DES-RELEASE]]). The lockfile executor runs the command of the target's default name, so that the empty entry that `init` adds for it in `targetDefaults` covers `hakari-check` as well ([[DES-TARGET-DEFAULT-GUARD]]). Each target carries its default name from the table in its metadata, as `metadata.cargo.target`, so that the executor runs the same command whatever name `targetNames` gives the target. It also carries the `locked` option of the plugin entry that created its project, as `metadata.cargo.locked`, from which the executor decides locked mode ([[DES-INVOCATION]]). A target that names one of these executors but that the plugin did not infer has no such name, and its task fails before cargo runs ([[DES-DIAGNOSTICS]]).

No inferred target has a `dependsOn` entry that names another Rust crate's target, except that every cached crate target other than `fmt-check` depends on the lockfile task of its workspace and, under `hakari`, on its `hakari-check` ([[REQ-NO-RUST-TASK-DEPS]]), and none uses `^build` ([[ADR-NO-RUST-BUILD-DEPS]]). Within a crate, `test` depends on `build` where the rule below says so. Dependencies reach a target through `^` inputs ([[DES-INPUTS]]). The plugin adds no `dependsOn` entry to a JS project. A JS target's own `^build` reaches the `build` of the crates its project depends on directly, which is how Nx defines `^build`, and ends there.

**`test` after `build`.** Where `cargo test` replaces the executables that a crate's `build` declares ([[DES-OUTPUTS]]), the crate's `test` depends on the crate's own `build`, as `{ "target": <name> }` after its dependencies on tasks of the workspace project, under the names that `targetNames` gives the two, and whether or not either is cached ([[ADR-TEST-AFTER-BUILD]]). The rule reads the crate's `cargo metadata --no-deps` report: the crate has a target of kind `bin`, and a target of kind `test` or `bench` whose `test` flag is on, whatever the `required-features` of either. That is an integration test with or without a harness, or a bench that `cargo test` runs. An example, also one with `test = true`, unit tests, doctests, a `[[test]]` with `test = false` and a bench without `test` make cargo build no binary for the test run, and `cdylib` and `staticlib` files are never replaced. A binary or test whose required features are off makes cargo build none either, but whether they are on depends on the run, and a crate counted without need only orders two tasks; a `test` flag that the report lacks counts as on ([[EVD-CARGO-ARTIFACT-WRITERS]]). The target carries `metadata.cargo.waitsForBuild` for the executor. Nx gives the dependency the configuration of the command where `build` has it and the default configuration of `build` otherwise, so the `build` that `test` waits for is the one that the same command names. With `--exclude-task-dependencies` Nx keeps the edge where the command names both targets, and runs `test` alone where it names `test` alone. A cache hit of `test` still waits for `build` to run or be restored. The rule does not depend on the runner of `test`: nextest builds the test executables through cargo and runs them after cargo has exited, as `cargo test` does (reasoned, not tried). `bench` needs no such dependency: Nx starts a task with `parallelism: false` only when no other task runs, and none while it runs ([[DES-TARGET-COMMANDS]]). `run` has none either ([[DES-OUTPUTS]]).

**Guard.** Before cargo runs, the executor fails a `test` task that carries `waitsForBuild` where the task graph holds a task of the same project's `build`, by the name in its metadata, that Nx neither finishes before the `test` starts nor starts only after the `test` has finished, as where a `project.json`, a `package.json`, a target table or a `targetDefaults` entry replaces the `dependsOn` of `test` without `"..."`. Nx starts a task once its ordinary dependencies have completed, which is after their outputs are stored, and once its continuous dependencies have started, or reported ready where the edge waits for that, and it starts a continuous task only once that task's own ordinary dependencies have completed ([[EVD-CARGO-ARTIFACT-WRITERS]]). So the graph orders the two where a path of dependencies leads from one to the other, through ordinary and continuous dependencies alike, whose last edge, the one into the task that comes first, is an ordinary dependency: a `test` that depends on a continuous helper which depends on `build` passes. A path that reaches `build` only as a continuous dependency guarantees no more than that `build` has started, and does not count; Nx records every edge into a continuous task as such, so a `build` that is itself continuous never counts as finished. The message names both tasks, what could go wrong and the fix ([[DES-DIAGNOSTICS]]). A command whose graph holds no such `build`, such as `nx test <crate>` once the dependency is gone, has nothing to order and passes. A task invoked outside a task graph that holds it is not checked. [[DES-TARGET-DEFAULT-GUARD]] reports a `targetDefaults` entry that drops the dependency when the graph is created.
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

Each command starts in the root folder of the crate's workspace, names the crate, `<crate>` in the table, by its package ID specification and passes `--locked` as the `locked` option says ([[DES-INVOCATION]]), except `fmt` and `fmt-check`, which name it by its package name: `cargo fmt` resolves no dependencies, takes no specification and rejects the flag ([[EVD-CARGO-TARGET-COMMANDS]], [[EVD-CARGO-PACKAGE-SPECS]]). Batched tasks share cargo calls as [[DES-BATCH]] groups them; `cargo fmt` takes several `-p` as the cargo commands do.

**Flags as options.** A flag beyond the package selection comes from an option of the target, so that a command passes only what its options ask for ([[DES-INVOCATION]]). `--all-targets` on `check` and `lint` is such an option, on by default. A crate switches it off in the options of the target in its `[package.metadata.nx]` table ([[DES-METADATA-TABLES]]), for example when its benches need a nightly compiler, which stable rejects under `--all-targets`. Tasks whose options differ never share a cargo call ([[TERM-GROUP]]). The option is `allTargets` ([[DES-PLUGIN-OPTIONS]]). `--all-targets` is what rust-analyzer passes by default, so `check` compiles the units the editor compiles and the two reuse each other's work ([[EVD-CARGO-TARGET-COMMANDS]]).

**Warnings.** No target adds a flag that turns warnings into errors. A task fails on warnings where the repository says so through Cargo: lint levels in `[lints]` and `[workspace.lints]`, `build.warnings` in `.cargo/config.toml` or `CARGO_BUILD_WARNINGS`, which Cargo honours from 1.97 on, and `RUSTFLAGS`, all of which are cache inputs ([[DES-INPUTS]]). Passing `-D warnings` to clippy would differ from plain `cargo clippy` and check every selected member again whenever a developer alternates the two ([[EVD-CARGO-TARGET-COMMANDS]]).

**Formatting.** `fmt` exists on every crate and formats only the crates of its tasks. `cargo fmt --all` would also rewrite path dependencies outside the workspace, and plain `cargo fmt` in the workspace root would rewrite members that have no project ([[EVD-CARGO-TARGET-COMMANDS]], [[REQ-SKIP-CRATES]]). `cargo fmt -p` takes package names only, not package ID specifications, and matches them against the workspace's members alone, whose names are unique, so the name addresses the crate also where a dependency has the same name ([[EVD-CARGO-PACKAGE-SPECS]]).

**bench.** The target has `parallelism: false`, so that Nx starts no other task while benchmarks run. Nx never puts such a task into a batch, so each `bench` task is a cargo call of its own ([[EVD-NX-24-TARGETS]]). So `cargo bench`, which replaces the executables of a `build` in the release profile, never runs beside a `build`, and `bench` needs no dependency on it. Once tasks run in batches ([[DES-BATCH]]), a batch could start beside a running `bench` only after the readiness verdict of a continuous task, which an inferred target never waits for ([[EVD-CARGO-ARTIFACT-WRITERS]]).

**run.** One `run` target per crate. When the crate has several binaries, an option of the target, `bin`, passes `--bin`; it is set on the command line or in the crate's metadata ([[DES-PLUGIN-OPTIONS]]). Without it and without `default-run` in the manifest, cargo fails and lists the binaries. The `args` option, a string, gives the binary its arguments. It is split into words at blanks outside quotes. Single quotes, double quotes and backslashes quote and escape as in a POSIX shell, an empty pair of quotes is an empty word, and nothing is expanded or treated as an operator, so `|`, `;` and `>` are ordinary characters. An unterminated quote, or a backslash at the end, fails the task with a message that names the option. Arguments after `--` on the `nx` command line go to the binary too, after those of `args`, within two limits that come from Nx ([[EVD-NX-OPTION-VALIDATION]]). When the command has `--`, Nx drops the flags before it that Nx does not know itself, so `--bin` and `--args` cannot be combined with `--`. Nx also parses what follows `--` as options of the target and checks them against its schema before the executor runs, so an argument with the name of one of `run`'s options can be rejected. `--args` works in both cases. Nx also reads a value of `--args` that looks like a number as a number, so `--args=3000` and `--args="3000"` fail the schema. `--args=" 3000"`, with a blank, stays a string and gives the one word `3000`, and `-- 3000` passes `3000` as well. `run` uses an executor that has no batch implementation, because `cargo run` accepts one package only, while Nx hands every task of an executor with a batch implementation and `preferBatch` to one batch, also the tasks of `nx run-many -t run` ([[EVD-CARGO-TARGET-COMMANDS]], [[EVD-NX-24-TARGETS]]). `run` is not ordered after `build`: where its options differ from those of `build`, its executable replaces the one of `build` in the artifact directory ([[DES-OUTPUTS]], [[RISK-ARTIFACT-DIR-WRITERS]]). `run` is not a continuous task: a task that depends on it waits until the binary exits. A crate that serves something sets `continuous` and `readyWhen` on its `run` in its metadata ([[DES-METADATA-TABLES]]). `nx run <project>` is Nx's own syntax and needs a target, so the short form is `nx run <project>:run`.

The targets of the workspace project are [[DES-WORKSPACE-TARGETS]].
:::

:::mara design DES-WORKSPACE-TARGETS
:mid: 01M78FHG7FDHZMAH480DED8M6W
:title: Targets of the workspace project
:status: accepted
:satisfies: REQ-WORKSPACE-PROJECT

The [[TERM-WORKSPACE-PROJECT]] hosts the targets that concern a whole Cargo workspace. Each command starts in the workspace root ([[DES-INVOCATION]]).

| Target         | Command                                                                             | Exists                                                                         | Cached                       | Inputs                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc`          | `cargo doc --no-deps --workspace`                                                   | Always                                                                         | Yes, as [[DES-OUTPUTS]] says | Those of every cached target ([[DES-INPUTS]]), with the files of every member through the project's dependencies                                                                            |
| `audit`        | `cargo audit`                                                                       | Always                                                                         | No                           | `Cargo.lock`, the root `Cargo.toml` and `.cargo/audit.toml` of the workspace root                                                                                                           |
| `deny`         | `cargo deny check`                                                                  | Where `deny.toml`, `.deny.toml` or `.cargo/deny.toml` is in the workspace root | No                           | `Cargo.lock`, the root `Cargo.toml`, the cargo-deny configuration file and the manifest of every member                                                                                     |
| `update`       | `cargo update`                                                                      | Always                                                                         | No                           | `Cargo.lock` and the root `Cargo.toml`                                                                                                                                                      |
| `lockfile`     | `cargo update --workspace`, with `--locked` in locked mode, then a digest per crate | Always                                                                         | No                           | `Cargo.lock`, read also when git ignores it, the root `Cargo.toml`, the `Cargo.toml` of every member and of every path package in the repository, and the workspace files of [[DES-INPUTS]] |
| `hakari-check` | `cargo hakari generate --diff`, then `cargo hakari manage-deps --dry-run`           | Where the workspace uses the `hakari` strategy of [[DES-UNIFICATION]]          | No                           | Those of `lockfile`, and the configuration file of cargo-hakari                                                                                                                             |

The coverage baseline target of [[DES-BASELINE]] is on the same project, in a workspace with `affectedTests` only.

**doc.** The workspace is documented in one call and its documentation is one site. rustdoc writes a folder per documented crate and files that every run merges, such as the search index and the list of crates. The output is therefore the whole `doc` folder of the [[TERM-ARTIFACT-DIR]], and a cache hit restores what a run writes. Outputs per crate could not do that: Nx restores a folder output by replacing it, so overlapping folders would delete each other's pages, and a crate's own folder lacks the shared styles and search index ([[EVD-CARGO-TARGET-COMMANDS]], [[EVD-NX-24-TARGETS]]). `--no-deps` comes from an option of the target that is on by default, as the flags of [[DES-TARGET-COMMANDS]] do: `noDeps`, set like the other options of the workspace project's targets ([[DES-PLUGIN-OPTIONS]]).

**Existence.** Whether a tool is installed never decides whether a target exists. Every machine thus computes the same graph, and a missing tool cannot make `nx run-many -t audit` leave a workspace out without a word ([[ADR-CARGO-SOURCE-OF-TRUTH]], [[REQ-DIAGNOSTICS]]). A task whose tool is missing fails with the message of [[DES-DIAGNOSTICS]]. `deny` exists only where cargo-deny is configured, because without a configuration file cargo-deny falls back to defaults that reject every license ([[EVD-CARGO-AUDIT-DENY]]).

**lockfile.** The lockfile task is not cached and runs whenever a task that depends on it runs: every cached target of the workspace's crates other than `fmt-check`, and `doc` ([[DES-LOCKFILE-HASHING]]).

**hakari-check.** The drift check of the [[TERM-HACK-CRATE]] exists only on a workspace that uses the `hakari` strategy, because only there do the crates' keys rely on the hack crate. It is not cached, depends on the lockfile task, and runs whenever a task that depends on it runs: the same tasks as for the lockfile task. When it fails, none of them runs. [[DES-UNIFICATION]] ("Drift") says what it checks and why; its inputs, like the lockfile task's, only decide what `nx affected` selects.

**Caching.** `audit`, `deny` and `update` are not cached. cargo-audit and cargo-deny fetch the RustSec advisory database when they run, and no input covers it, so a cached pass could hide an advisory published since ([[EVD-CARGO-AUDIT-DENY]]). `update` exists to change `Cargo.lock`. Their inputs are declared all the same, so that `nx affected` selects them when a file they read changes. They and `lockfile` also have the plugin input of [[DES-INPUTS]], so that a change to the JS lockfile outside the plugin's package does not select them.

**Locked mode.** `update` never passes `--locked`, also with the `locked` option or `NX_RUST_LOCKED=true`: `cargo update --locked` fails whenever the lockfile would change ([[EVD-CARGO-TARGET-COMMANDS]]), and changing it is what the task is for ([[REQ-NO-MANIFEST-WRITES]]). `deny` passes `--locked` to cargo-deny in locked mode and then fails instead of updating `Cargo.lock`; without it, cargo-deny resolves the workspace as plain cargo would and may update the lockfile. cargo-audit only reads `Cargo.lock` and has no such flag ([[EVD-CARGO-AUDIT-DENY]]).
:::

:::mara design DES-TARGET-DEFAULT-GUARD
:mid: 01M7AT4GDP59EWQTMVSVR69G4M
:title: Report target defaults that change inferred targets
:status: accepted
:satisfies: REQ-TARGET-DEFAULT-GUARD

**Where.** `createDependencies` receives the projects after Nx has laid the `targetDefaults` of `nx.json` over the plugin's targets, while the plugin entry that created them still holds what it inferred ([[EVD-NX-TARGET-DEFAULTS]]). `createNodes` hands Nx a copy of its projects, so that this holds also where Nx loads the plugin into its own process, where it rewrites the project names in the lists it receives in place ([[EVD-NX-24-PLUGIN-NODES]]). For each inferred target the plugin compares the two. A target whose executor is no longer the inferred one was replaced by another file and is left alone. An extra target that a `targets.<name>` table of the Cargo metadata defines is not compared either ([[DES-METADATA-TABLES]]): the plugin infers nothing for it, so nothing of the plugin's can be lost, and Nx lays `targetDefaults` over the table as over any target that a plugin infers, so that what an entry does to it is the repository's own statement about that target, as the table is. The plugin tells its inferred targets by the `cargo` record in their metadata, which the executor reads as well ([[DES-OUTPUTS]], "Per project"). Before, such a target was compared with its table as if the plugin had inferred it: `"e2e": { "cache": true }` failed graph creation for a crate whose table defines `e2e` with an executor, so did an entry that replaced the table's `inputs` or `outputs`, and caching that another plugin turned on drew the warning of **Which layer**, which nothing backed, as the task does not run the plugin's executor. `init` runs the same check through the plugin's `createDependencies`, on `nx.json` with the empty entries keyed by the plugin's executors that it adds where they are missing ([[DES-GENERATORS]]). In a repository set up that way, Nx lays no entry keyed by a target's name or a glob over the plugin's targets, so the check reports entries keyed by the plugin's executors there; it stays the check for repositories that were set up by hand or lost those entries later, and its message names the same fix.

**What counts.** Each row compares the target as Nx merged it with the target as the plugin inferred it.

| The merged target                                                                                                                                                                                                        | Severity |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Has caching on where the plugin's `cache` is not `true`                                                                                                                                                                  | Error    |
| Lacks an `inputs` entry that the plugin declared                                                                                                                                                                         | Error    |
| Lacks an `outputs` entry that the plugin declared                                                                                                                                                                        | Error    |
| Lacks a `dependsOn` entry that the plugin declared, such as the one on the workspace's lockfile task ([[DES-LOCKFILE-HASHING]]) or the one of `test` on the crate's own `build` ([[DES-TARGETS]])                        | Error    |
| Has a `dependsOn` entry that the plugin did not declare and that Nx's task graph resolves to tasks of other projects: `^<target>`, `dependencies: true`, or `projects` or `<project>:<target>` that name another project | Warning  |

The differences are read from the targets that Nx merged, and from nothing else: a target that does not differ is not reported, whatever `targetDefaults` holds. A difference counts against an entry only where the plugin can tell that the entry made it (**Which layer**). The check runs whether `targetDefaults` holds entries or not; where it is empty, or no key of it can reach a target, by its executor, its name or a glob, no entry is blamed, and a difference is judged as **Other layers** says. The comparison is with what the plugin infers for the target at the time: where it declares no inputs, outputs or `dependsOn`, there is nothing to lose, and caching turned on counts only for a target that it leaves uncached in that project, by design, for a reason of [[DES-OUTPUTS]] such as an artifact directory outside the repository, or because a `targets.<name>` table of its Cargo metadata sets `cache = false`.

**Severity.** An entry that only adds dependencies costs time and leaves results correct ([[EVD-NXRUST-BUILD-DEPS]]), so it is a warning. The other rows let Nx restore a result that the task would not produce, or let `nx affected` miss a crate, so they are errors ([[GOAL-TRUSTED-CACHE]]). A `dependsOn` that loses the lockfile task drops the digests from its key ([[DES-LOCKFILE-HASHING]]), and one that loses the crate's `build` lets Nx run `test` beside it and store the executable of `cargo test` for `build` ([[DES-OUTPUTS]]).

**Which layer.** `createDependencies` receives no record of which layer set a value, so where a target differs, the plugin rebuilds it with Nx's own code. The layers are the plugin's projects as its `createNodes` returned them; the elements of `targetDefaults` that Nx's synthesis (`createTargetDefaultsResults` from `nx/src/devkit-internals`) lays over them, given what Nx's default plugins make of the `package.json` and `project.json` in the project's folder, the project's name and tags as Nx merged them, which are those that the synthesis reads, also where another plugin gave them, and the plugin that is the source of the target, which `filter.plugin` compares with; and those default-plugin results. That source is the plugin whose node first gave the target the executor that it has, because Nx keeps it when a later plugin gives the same executor, and graph creation cannot see which plugin that was. So the synthesis is run with the name under which Nx knows the plugin's entry as the source and, where `nx.json` lists a plugin other than this one, once more for each other plugin that an element's `filter.plugin` names and once for one that none names; an element that one of these runs lays over the target may apply to it, and one that none lays over it cannot. Each run gives a rebuild of its own. Each layer is merged with Nx's merge of project nodes, so `"..."` in lists and in objects, and the elements of an entry's list, behave as in Nx. Nx replaces each project reference in a target's `inputs` and `dependsOn` with the project that has that name when the plugin's projects are merged, and writes that project's final name in its place, so a `project.json` that renames a crate renames the references to it ([[EVD-NX-24-PLUGIN-NODES]]). The plugin gives the references that it declares the same names, in the inferred target and in its layer of the rebuild, where that is certain: a name that the plugin gave a project of its entry becomes the name under which the merged graph knows the project at that root. It renames only the forms that Nx renames: a `projects` string other than `*`, `self` and `dependencies` (`self` and `dependencies` in `inputs`), an element of a `projects` list that is no glob pattern, and a `<project>:<target>` string in `dependsOn` with exactly one colon that Nx can read no other way, because neither the string nor its first part is a target of the project itself and the string names no project. Every other name stays as written, so that a renaming that the plugin cannot prove stays a difference. Each of `cache`, `inputs`, `outputs` and `dependsOn` is then judged on its own, and a difference in one never decides another. Where a rebuild gives the field, and the project's name and tags, which filters read, as Nx merged them, a difference that the rebuild without the `targetDefaults` layer lacks is reported against the entry that this run of the synthesis laid over the target, with the severity below, and where the runs for several source plugins give the field, against the entry of each, since graph creation cannot tell which of them Nx made; a difference that the rebuild has without that layer was made by the folder's `project.json` or `package.json` and is not reported. The review of nxr-gyyhdj found that, with a plugin listed before this one that gave a crate's `check` its executor first, an entry keyed by the cargo executor and filtered to that plugin and an entry keyed `check` and filtered to the crate, which replaced the inputs in the same way, were reported as the entry keyed `check` alone, which the run with this plugin as the source lays over the target, while Nx, which tries the key of the target's executor first and falls through to that of its name only where no element of the first matches, had applied the entry keyed by the executor ([[EVD-NX-24-PLUGIN-NODES]]). Where none does, as when another plugin listed in `nx.json` contributes to the project or a reference was renamed in a way that the plugin cannot prove, an inferred `inputs`, `outputs` or `dependsOn` entry that the merged target lacks and that the rebuild without the `targetDefaults` layer keeps, and caching that is on where the plugin leaves the target uncached and the rebuild without that layer leaves it off, is still an error against each entry with an element that may apply to the target and would make it: one that sets that list without `"..."` in it, or `cache: true`, and not before an object-level `"..."`, where Nx keeps the value below. In the same way, a `dependsOn` entry that the merged target adds and the rebuild without the `targetDefaults` layer lacks is the warning against each entry with an element that may apply to the target and lists it, unless that list stands before an object-level `"..."` where the plugin declares a `dependsOn`, which Nx then keeps. Before, such an addition was never blamed on an entry where the rebuild did not give the field: with an entry that added `^check` to every crate's `check` and another plugin that only tagged one crate, that crate drew the warning that the plugin cannot tell which configuration changed the target instead of the entry's. The review of nxr-gyyhdj found that one field that the rebuild did not give had made the plugin leave the whole target with a warning: where a crate's declared `dependsOn` named a crate that a `project.json` renamed, an entry narrowed by a `filter` to that crate replaced its `inputs`, its `outputs` or, by `dependsOn: []`, its dependency on the lockfile task, and graph creation went on with a warning. The review of that change found two more ways through, both ending in a cache hit of a result that the task would not give: an entry filtered to a plugin listed before this one, which had given a crate's `check` its executor first, replaced the inputs, which the synthesis with this plugin as the source did not lay over the target; and an entry filtered to a tag that another plugin gave a crate turned on caching for a `check` that the crate's Cargo metadata set uncached, which drew only the warning, while the executor's check did not know that reason. A lost `inputs`, `outputs` or `dependsOn` entry that no entry is blamed for is judged as **Other layers** says. Caching that is on and a `dependsOn` entry that is added, where no entry is blamed for them and the folder's files do not explain them, the plugin does not attribute: it warns that it cannot tell which configuration changed the target, names the project, the target and those fields, and points to `nx show target <project>:<target> --json` and its `sourceMap`. For caching, that warning rests on the executor's check of a task's merged configuration, which fails a task that caches a target which the plugin leaves uncached in its project, for every reason that leaves it uncached, a target table's `cache = false` included ([[DES-OUTPUTS]]), whichever layer turned caching on. Nx's normalisation of `dependsOn` for the task graph decides which projects an added entry reaches. These parts of Nx are not public API. They are loaded only when a target differs, and where the installed Nx lacks one, graph creation fails with the error of [[DES-DIAGNOSTICS]].

**Other layers.** Besides `targetDefaults`, Nx merges over the plugin's targets the nodes of the plugins that `nx.json` lists after this one, and the `project.json` and `package.json` in the project's folder. A later node's target that names no executor, or the plugin's own, replaces each list of the plugin's that it sets without `"..."`, and the task still runs the plugin's executor; one that names another executor or a command replaces the whole target, which the check then leaves alone ([[EVD-NX-24-PLUGIN-NODES]], "Other layers"). So the plugin compares what each of the inferred target's `inputs`, `outputs` and `dependsOn` means in the merged target with what it means in the rebuilds of **Which layer** with the `targetDefaults` layer, one for each plugin that may be the source of the target, each made of the plugin's projects, those elements and the folder's own `project.json` and `package.json`. This comparison approximates what Nx hashes; it does not ask Nx's native hash planner, which plans each task's key from the unexpanded lists, and its reading can differ from that plan in both directions ([[RISK-GUARD-HASH-PLAN]]). For `inputs`, both lists are first expanded as the JS helpers of Nx's task hasher expand them ([[EVD-NX-24-PLUGIN-NODES]], "What a list means"): a name that the project's named inputs hold stands for their definition, recursively, where the project's own definition replaces that of `nx.json`, which replaces Nx's built-in `default`; for a target without `inputs`, the guard reads `default` of the project itself and of its dependencies, as those helpers do, although the native planner was seen to plan the project's files for such a target where `default` was defined anew; an object entry counts as the project's own named input only where it has no `dependencies` and no `projects`; and an entry for the dependencies or for other projects, such as `^default`, stays as it is written, without a comparison of what those projects define. A list counts as weakened where it lacks an entry that the rebuild's has, or holds a negated pattern, one that starts with `!`, that the rebuild's lacks: in those helpers, a negated pattern applies to all of a project's own inputs, so one added pattern, or one in a named input that a layer defines anew, can take files out of the key, and an output pattern with `!` takes files out of what a cache hit restores. The guard counts every such added pattern, also where the native plan stays the same, as for a pattern under `{workspaceRoot}` or one for the dependencies, which is then refused without need. Entries compare as JSON with sorted keys, so an entry whose `params`, `options`, `projects` or pattern changed counts as lacking the original. The guard does not report what it reads as widening only: an added input whose expansion, as it reads it, holds no negated pattern, such as a positive file set, a variable, a command, external dependencies, dependency outputs or an input of other projects; an added output without `!`; and an added dependency, which only adds tasks (the warning below). Its reading misses some forms that narrow the native plan: a self input written as `{ "input": <name>, "dependencies": false }`, whose definition it does not expand, and a named input that another layer defines anew for a project that a `^` input reads ([[RISK-GUARD-HASH-PLAN]]). Where one rebuild gives a list that the merged one does not weaken, nothing is reported for it. Otherwise, and where no entry of `targetDefaults` is blamed for that field (**Which layer**), the weakened list is an error, also where `targetDefaults` is empty or none of its keys reaches the target. Each field is judged on its own here as well. The rebuilds hold what the folder's files do, so a list that they weaken themselves is not reported: it is the project's own statement, as [[REQ-METADATA-OVERRIDES]] gives those files precedence, and so is a named input that `nx.json` defines, since both sides read it. A weakening that they do not explain comes from another plugin, in practice one listed after this one, since the plugin's lists and named inputs replace those of a plugin listed before it. The message names each project and target, and for each field up to three of its lost entries with the number of the others, the entries that leave files out, and each named input that another layer defines anew with what its definition loses, and the plugins that `nx.json` lists after this one, and gives the fixes: an `exclude` of the project's folder on that plugin's entry; `"..."` in the lists that the plugin gives the target, and no negated pattern or named input of its own for the project, where the plugin is the repository's own; the change written into the `project.json` in the project's folder, which the rebuilds then hold; and, where a lost entry names a project, the name of that project as the merged graph has it. It points to `nx show target <project>:<target> --json`, whose `sourceMap` names the plugin behind each field. The maintainer decided this on 15 November 2026, word for word "Error unless the crate's own files explain it (Recommended)". Not chosen were an error for a loss from any layer, which would take from `project.json` and `package.json` the precedence that [[REQ-METADATA-OVERRIDES]] promises; a warning with the executor failing the task before cargo runs, which needs the most machinery (the inferred lists in each target's metadata, a comparison in the executor and another channel through `createMetadata`) for a rare setup; and leaving such changes outside the guard, which allows a stale hit without any sign. Before, such a loss drew only the warning that the plugin cannot tell which configuration changed the target where a key of `targetDefaults` could reach it, and nothing otherwise: with a plugin listed after this one that gave a crate's `check` the inputs `["default"]`, `nx run api:check` was restored from the cache after a compile error in a crate that `api` depends on ([[EVD-NX-24-PLUGIN-NODES]]). The review of that rule found two ways in which a later plugin weakened the key while every entry stayed, both ending in such a cache hit in both plugin modes: `"inputs": ["...", "!{projectRoot}/src/**/*"]` on a crate's `check`, after which a compile error in the crate's own source was restored as a success, and a project-level `namedInputs` that defined `default` anew as `["{projectRoot}/Cargo.toml"]`. The control plane decided the same day that the maintainer's rule applies to what a list means, as above. A plugin that replaces a target with the plugin's executor under another name, such as `rust-alias:cargo` from a second installation of the package, and supplies a `cargo` record in its metadata itself circumvents the guard deliberately, which lies outside what it can tell from the plugin's own targets.

A project reference that the plugin cannot give the name that Nx gave it (**Which layer**) stays a difference, and a lost one counts as a loss: Nx writes the final name of a project that a later file renames, such as one that its `package.json` names `web` and its `project.json` renames `web-app`, into a crate's declared reference to `web`, while the rebuild, which reads only the crate's own folder, keeps `web`. Graph creation then fails although nothing is lost. The message's last fix resolves it: a reference to the project's final name, which Nx leaves as it is. Only a target table of the crate's Cargo metadata declares a reference to another plugin's project, so a repository without such a reference never meets the case, and a `project.json` or `package.json` in the crate's own folder never causes it, since the rebuild reads them.

Caching needs no rule of its own: the executor fails every cached task of a target that the plugin leaves uncached in its project, whichever layer turned caching on ([[DES-OUTPUTS]], "Per project"), so caching that another plugin turns on stores no result, and the warning of **Which layer** for `cache` rests on that check, which is the complete answer for caching. An added `dependsOn` entry that no element of `targetDefaults` lists keeps that warning as well, because an addition only queues tasks and leaves results correct ([[EVD-NXRUST-BUILD-DEPS]]), so nothing at run time needs to back it. An entry that another layer adds to `inputs` or `outputs` is not reported where the guard reads it as widening only, as above; a negated pattern, or a named input that holds one, counts as a weakening. Every other difference that drew the warning before, a lost `inputs`, `outputs` or `dependsOn` entry, is now either an error or a weakening that the folder's files explain.

**Message.** One paragraph per entry and severity names the key and its elements, says what the entry does to which targets of which projects, with their manifests, and lists the ways to narrow the entry that fit: a `filter` on `projects` or `executor`; an empty entry keyed by the targets' executor, which Nx chooses before an entry keyed by the target's name; removing the field from an entry keyed by the plugin's executor; and `"..."` in a list that replaces. Errors stop graph creation, and warnings are printed where [[DES-DIAGNOSTICS]] says. `createDependencies` hands each warning, with the targets it concerns, to `createMetadata`, which puts it into the metadata of those targets' projects for the executor, whose tasks of those targets print it at their start. So that a cache hit shows the current state, the digest of a project's warnings also covers the `dependsOn` entries that `targetDefaults` adds to the project's inferred targets as far as `createNodes` sees them: its own projects, Nx's synthesis of target defaults, run once for each plugin that may be the source of the targets as in **Which layer**, which `createNodes` cannot see either, and the `package.json` and `project.json` on disk in the projects' folders, leaving out entries whose form shows that they reach only the project's own tasks. Before, only the run with this plugin as the source counted, so that an entry from a file that `nx.json` extends, filtered to a plugin listed before this one that gave a crate's target its executor, changed no key, and a cache hit replayed the task's output without the warning. An entry whose `filter` selects projects by a tag, which another plugin may give, counts for every project with a target that its key can reach, since `createNodes` cannot decide it; filters by name, folder, plugin or executor keep their exact reading. That matters for entries from a file that `nx.json` extends: Nx hashes `nx.json` itself into every key, but not the file it extends ([[EVD-NX-24-WARNING-CHANNELS]]). Where only the list of projects that a warning names changes, a cache hit of another crate shows the earlier list until its key changes; an entry that counts without applying, or that adds only own tasks in a form that does not show it, causes one run without a warning; and a `dependsOn` that another plugin changes reaches no key ([[DES-DIAGNOSTICS]], "Warnings that `createDependencies` finds"). Graph creation never edits `targetDefaults`, and `init` only adds the empty entries that are missing.
:::
