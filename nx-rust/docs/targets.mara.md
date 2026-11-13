# Targets

> **Status:** specified, not implemented yet. Target names, caching and outputs
> are decided. The exact commands and placement of `check`, `fmt`, `doc`,
> `bench` and `run` are proposals until [[DES-TARGET-COMMANDS]] is accepted.

The plugin infers targets from the shape of each crate. Nothing is declared per
crate.

| Target                     | Runs                                             | Exists on                         | Cached | Outputs                                                           |
| -------------------------- | ------------------------------------------------ | --------------------------------- | ------ | ----------------------------------------------------------------- |
| `build`                    | `cargo build`                                    | Every crate                       | Yes    | Final artifacts only: executables, `cdylib` and `staticlib` files |
| `check`                    | `cargo check`                                    | Every crate                       | Yes    | None; the result only                                             |
| `lint`                     | `cargo clippy`                                   | Every crate                       | Yes    | None; the result only                                             |
| `test`                     | `cargo test` or nextest                          | Every crate                       | Yes    | None; the result only                                             |
| `fmt-check`                | `cargo fmt --check`                              | Every crate                       | Yes    | None; the result only                                             |
| `fmt`                      | `cargo fmt`                                      | The workspace project             | No     | None                                                              |
| `doc`                      | `cargo doc`                                      | Every crate                       | Yes    | The doc output folder                                             |
| `bench`                    | `cargo bench`                                    | Crates with a bench target        | No     | None                                                              |
| `run`                      | `cargo run`                                      | Crates with a binary target       | No     | None                                                              |
| `napi-build`, `wasm-build` | See [napi and wasm artifacts](artifacts.mara.md) | Crates that produce that artifact | Yes    | The package files                                                 |
| Release publish            | `cargo publish`                                  | Crates without `publish = false`  | No     | None                                                              |

```sh
nx test api                     # one crate
nx run-many -t lint test        # every project, JS and Rust
nx affected -t lint test build  # only what the change affects
```

Names can be changed in the plugin options, and options of a target can be set
per crate or per workspace: see [Configuration](configuration.mara.md).

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
It stops there, because the crate's `build` depends on nothing.

## Options that cargo does not use

The `options` of a target default reach Rust targets too, and so do flags on
the command line, which Nx passes to every task of the targets it runs. A Rust
task runs as if an option it does not know were absent, such as Jest's
`passWithNoTests` or `--coverage`, and its output says so in one line per
option: which option, which task, and whether it came from a `targetDefaults`
key, from a `project.json` or `package.json`, or from the command line. Such an
option fails no task ([[REQ-UNKNOWN-OPTIONS]]).

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

Or add an empty entry keyed by the plugin's executor, the `executor` that
`nx show project <crate> --json` shows for the target. Nx prefers an entry
keyed by the executor to one keyed by the target name, so then no entry keyed
by a target name reaches the Rust targets.

A Rust option with a value of the wrong type, such as a number for `profile`,
is not ignored: Nx rejects it before the plugin sees it, and fails the Rust
tasks that run together with it with a message that does not name the option.

## Formatting

`nx format:check` and `nx format:write` are Nx's own commands, not targets.
They run prettier or oxfmt over files and never run rustfmt, so they leave Rust
sources alone ([[EVD-NX-FORMAT]]). Rust formatting is the `fmt-check` and `fmt`
targets, which keep Cargo's names so that they are not taken for that command:

```sh
nx format:check                            # JS, TS, Markdown, JSON
nx affected -t lint test build fmt-check   # plus rustfmt for the affected crates
```

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

No inferred target of a Rust crate depends on a target of another Rust crate. A change in a dependency reaches the dependent through cache inputs, not through task ordering. The plugin adds no task dependency to JS projects either. A `^build` that a JS target declares itself reaches the `build` of the crates its project depends on directly, as Nx defines `^build`, and goes no further.
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
:status: draft
:satisfies: NEED-UNIFORM-COMMANDS

A crate's `run` target can serve as a continuous Nx task that other targets depend on, and can restart when its sources change.

Open: whether this belongs in v1 at all. The design discussion of 12 November 2026 did not cover it.
:::

## Design

:::mara design DES-TARGETS
:mid: 01M78FHG7FMRNFBSN2G9VG7CX3
:title: Inferred targets
:status: accepted
:satisfies: REQ-INFERRED-TARGETS
:satisfies: REQ-TARGET-NAMES
:satisfies: REQ-NO-RUST-TASK-DEPS

| Default name               | Cargo's name  | Cached | Nx outputs                             |
| -------------------------- | ------------- | ------ | -------------------------------------- |
| `build`                    | `build`       | Yes    | Final artifacts only ([[DES-OUTPUTS]]) |
| `check`                    | `check`       | Yes    | None                                   |
| `lint`                     | `clippy`      | Yes    | None                                   |
| `test`                     | `test`        | Yes    | None                                   |
| `fmt-check`                | `fmt --check` | Yes    | None                                   |
| `fmt`                      | `fmt`         | No     | None                                   |
| `doc`                      | `doc`         | Yes    | The doc output folder                  |
| `bench`                    | `bench`       | No     | None                                   |
| `run`                      | `run`         | No     | None                                   |
| `napi-build`, `wasm-build` | none          | Yes    | [[DES-ARTIFACT-STEPS]]                 |
| Release publish            | `publish`     | No     | None                                   |

Only `clippy` is renamed, to `lint`: `lint`, `test` and `build` are the target names that Nx projects share. Formatting keeps Cargo's names, `fmt-check` and `fmt`, because Nx's `format` is a built-in command and not a target ([[ADR-NX-TARGET-NAMES]]). Every name can be changed through plugin options, the names of the artifact targets included. `bench` is not cached, because timings differ between runs.

Targets come from the `cargo metadata` report ([[DES-METADATA-REPORT]]): `run` exists when the crate has a binary target, `bench` when it has a bench target, an [[TERM-ARTIFACT-TARGET]] when the crate produces that artifact ([[DES-ARTIFACT-STEPS]]), and the release targets unless the manifest sets `publish = false`.

No inferred target has a `dependsOn` entry that names another Rust crate's target, and none uses `^build` ([[ADR-NO-RUST-BUILD-DEPS]]). Dependencies reach a target through `^` inputs ([[DES-INPUTS]]). The plugin adds no `dependsOn` entry to a JS project. A JS target's own `^build` reaches the `build` of the crates its project depends on directly, which is how Nx defines `^build`, and ends there.
:::

:::mara design DES-TARGET-COMMANDS
:mid: 01M78FHG7F9X4M34PB2MP9Y7S8
:title: Commands of the remaining targets
:status: draft
:satisfies: REQ-INFERRED-TARGETS

Proposed, to be confirmed:

| Target      | Command                                    | Notes                                                                                                      |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `check`     | `cargo check --all-targets -p <crate>`     | Open: whether Nx users expect the name `typecheck`.                                                        |
| `lint`      | `cargo clippy --all-targets -p <crate>`    | Open: whether warnings fail the task by default.                                                           |
| `fmt-check` | `cargo fmt --check -p <crate>`             | Inputs include the rustfmt configuration ([[DES-INPUTS]]).                                                 |
| `fmt`       | `cargo fmt --all` on the workspace project | Open: whether crates also get their own `fmt`.                                                             |
| `doc`       | `cargo doc --no-deps -p <crate>`           | Open: where the doc folder lives when several crates share one artifact directory.                         |
| `bench`     | `cargo bench -p <crate>`                   | Not cached, because timings differ between runs.                                                           |
| `run`       | `cargo run -p <crate>`                     | `nx run <project>` is Nx's own syntax, so the short form is `nx run <project>:run`. See [[REQ-RUN-WATCH]]. |

All of them start in the workspace root, and whether they pass `--locked` is the `locked` option ([[DES-INVOCATION]]).
:::

:::mara design DES-WORKSPACE-TARGETS
:mid: 01M78FHG7FDHZMAH480DED8M6W
:title: Targets of the workspace project
:status: draft
:satisfies: REQ-WORKSPACE-PROJECT

The [[TERM-WORKSPACE-PROJECT]] hosts `fmt`, `audit` (`cargo audit`), `deny` (`cargo deny check`), a lockfile update target and coverage collection ([[DES-BASELINE]]).

Open: the name of the workspace project and how it avoids colliding with a crate or a JS project at the same folder, which applies only where its folder is not already an Nx project, since otherwise the workspace project merges into that project and takes its name and its same-named targets ([[EVD-NX-PROJECT-MERGE]]); which of these targets exist when the tool they need is not installed; and their cache inputs, which include the whole `Cargo.lock` and the configuration file of the tool, such as `deny.toml`.
:::
