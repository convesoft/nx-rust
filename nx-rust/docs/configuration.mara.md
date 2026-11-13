# Configuration

> **Status:** specified, not implemented yet. The tables named `nx` and the
> target names are decided. The other option names on this page are proposals
> until [[DES-PLUGIN-OPTIONS]] is accepted.

Most repositories need no configuration. When a crate or workspace needs
something other than the default, you say so in the `Cargo.toml` that already
describes it. Repository-wide choices go into the plugin's entry in `nx.json`.

| Where                                                        | Scope                          | Typical use                                            |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------ |
| `[package.metadata.nx]` in a crate's `Cargo.toml`            | One crate                      | Project name, tags, options of a target, extra targets |
| `[workspace.metadata.nx]` in the workspace root `Cargo.toml` | Every member of that workspace | Default tags, test runner, affected tests              |
| `[workspace.metadata.nx.project]` in the same file           | The workspace project          | Its name, tags and targets                             |
| The plugin's entry in `nx.json`                              | The repository                 | Target names in `options`, excluded paths in `exclude` |

A value for a crate wins over the workspace default, which wins over the
plugin options. Tags are the exception: a crate has its workspace's tags and
its own.

## Per crate

The table has the shape of the `nx` property that Nx reads from a
`package.json`:

```toml
# rust/crates/api/Cargo.toml
[package]
name = "api"

[package.metadata.nx]
name = "backend-api" # Nx project name; Cargo still sees "api"
tags = ["scope:backend"]

[package.metadata.nx.targets.test.options]
features = ["integration"] # option of the inferred "test" target

[package.metadata.nx.targets.migrate]
command = "cargo run -p api --bin migrate" # an extra target
```

In a crate folder that also is a JS project, Nx applies its `package.json`
and `project.json` after this table. Where Nx takes the project's name from
them, `name` has no effect
([Project names](workspaces.mara.md#project-names)). A script or target there
with the name of one of the crate's targets replaces that target, together with
the settings this table gives it, unless Nx merges the two
([napi and wasm artifacts](artifacts.mara.md#things-to-know)).

The keys under `options`, and under each of the target's `configurations`,
have to be options of the target. A key that the plugin does not know, such as
a misspelt `feature`, makes graph creation fail with an error that names the
manifest, the target and the key. The same holds for the workspace table and
its `project` table. Options that reach a Rust target from `nx.json`, a
`project.json` or `package.json`, or the command line are ignored with a
warning instead: see [Targets](targets.mara.md#options-that-cargo-does-not-use).

## Per workspace

```toml
# rust/Cargo.toml
[workspace]
members = ["crates/*"]

[workspace.metadata.nx]
tags = ["lang:rust"]
testRunner = "nextest"
affectedTests = true

[workspace.metadata.nx.project]
name = "rust-tools" # the workspace project, "rust" by default
tags = ["scope:tooling"]
```

The `project` table configures the workspace project itself, the project for
workspace-level tasks, with the `name`, `tags` and `targets` keys of a crate's
table. The other keys of `[workspace.metadata.nx]` apply to the members. The
workspace project has the workspace's tags and its own, but a target set under
`[workspace.metadata.nx.targets]` is a default for the members only. When the
root `Cargo.toml` also defines a crate, that crate is the workspace project and
is configured in its `[package.metadata.nx]` instead
([Workspaces](workspaces.mara.md#workspace-level-tasks)).

## Target names

Inferred targets use the names Nx projects conventionally use, so the commands
a mixed repository already runs also cover Rust:

```sh
nx affected -t lint test build
```

`lint` runs clippy. Formatting is the one exception: `nx format` is a built-in
Nx command that cannot run rustfmt, so the Rust targets are `fmt-check` and
`fmt` ([Targets](targets.mara.md#formatting)). If you prefer Cargo's names
elsewhere too, rename targets in the plugin options:

```json
{
  "plugins": [
    {
      "plugin": "@convesoft/nx-rust",
      "options": {
        "targetNames": { "lint": "clippy" }
      }
    }
  ]
}
```

The full list of targets is on the [Targets](targets.mara.md) page.

## Excluding crates

To keep crates that are checked in from becoming projects, such as vendored
ones, list their manifests under `exclude` on the plugin's entry. This is Nx's
own filter for plugin entries, so it sits beside `options`, not inside:

```json
{
  "plugins": [
    {
      "plugin": "@convesoft/nx-rust",
      "exclude": ["vendor/**/*"]
    }
  ]
}
```

## Requirements

:::mara requirement REQ-METADATA-OVERRIDES
:mid: 01M78FHG7FJ4E8DDDAMXCG8AKF
:title: Override inferred configuration in Cargo manifests
:status: accepted
:satisfies: NEED-CONFIG-IN-CARGO

A crate's tags, Nx project name, options of inferred targets and additional targets can be set in `[package.metadata.nx]` of its manifest. Defaults for all members of a workspace can be set in `[workspace.metadata.nx]` of the workspace root manifest. When that manifest defines no crate, the name, tags, settings of inferred targets and additional targets of the workspace's own [[TERM-WORKSPACE-PROJECT]] can be set there as well, apart from the defaults for members. A value set for a crate takes precedence over the workspace default, except that a crate's tags are added to its workspace's tags. No file other than a Cargo manifest is needed to override what the plugin infers for a crate. Where a project's folder also is a JS project, its `package.json` and `project.json` take precedence over these settings, because Nx applies them after every plugin ([[EVD-NX-PROJECT-MERGE]]). The name Nx takes from them applies instead of the one set here ([[REQ-PROJECT-NAMES]]), and a script or target there with the name of one of the project's targets replaces that target, settings made here included, unless Nx merges the two. Tags from both are kept.
:::

:::mara requirement REQ-TARGET-NAMES
:mid: 01M78FHG7FP3Z0DWAES110WHYT
:title: Use Nx target names by default and allow renaming
:status: accepted
:satisfies: NEED-UNIFORM-COMMANDS

Inferred targets have, by default, the names that Nx projects conventionally use for the same job, so that `lint`, `test` and `build` cover Rust crates and JS projects alike. The name of every inferred target can be changed through the plugin's options.
:::

:::mara requirement REQ-UNKNOWN-OPTIONS
:mid: 01M7A93PSWRTX4KDZVJ0ACW62Y
:title: Run with a warning when a task gets an option the executor does not know
:status: accepted
:satisfies: NEED-CLEAR-FAILURES
:mitigates: RISK-TARGET-DEFAULTS

When a task of a target that runs one of the plugin's executors receives an option that its executor does not know, from a `targetDefaults` entry in `nx.json`, a `project.json`, a `package.json` or the command line, the task runs as it would without that option, and the option fails no task. The task's own output carries one warning line per such option that names the option and the task and says that the option was passed on the command line, when that is certain, or else that it comes from the workspace's configuration, with the command that shows where. On a `run` task, the arguments after `--` on the command line go to its binary instead ([[DES-TARGET-COMMANDS]]).
:::

:::mara requirement REQ-UNKNOWN-METADATA-OPTIONS
:mid: 01M7A93PSWEY0RVZ0WCQM20EFG
:title: Reject target options in Cargo metadata that the executor does not know
:status: accepted
:satisfies: NEED-CLEAR-FAILURES

A key under `options` or under a configuration in `configurations` of a `targets.<name>` table in `[package.metadata.nx]`, `[workspace.metadata.nx]` or its `project` table, where the target runs one of the plugin's executors and that executor has no option of that name, fails graph creation with a message that names the manifest, the target, the configuration if any, and the key.
:::

## Design

:::mara design DES-METADATA-TABLES
:mid: 01M78FHG7FX2K81MEQEY7YQHTN
:title: The nx metadata tables
:status: accepted
:satisfies: REQ-METADATA-OVERRIDES

Overrides are read from the `metadata` values in the `cargo metadata` report ([[DES-METADATA-REPORT]]): `[package.metadata.nx]` for a crate and `[workspace.metadata.nx]` for a workspace ([[ADR-METADATA-KEY]]).

| Key                           | Table              | Meaning                                                                                                                                                         |
| ----------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                        | package            | Nx project name. The Cargo package name is unchanged.                                                                                                           |
| `tags`                        | package, workspace | Nx tags. A crate has its workspace's tags and its own.                                                                                                          |
| `targets.<name>`              | package, workspace | A table shaped like an Nx target. For an inferred target it overrides that target's settings, such as `options`. For any other name it defines an extra target. |
| `testRunner`, `affectedTests` | workspace          | The test settings in [[DES-TEST-RUN]].                                                                                                                          |
| `project`                     | workspace          | The [[TERM-WORKSPACE-PROJECT]] itself: its own `name`, `tags` and `targets.<name>`, as in a package table. An error in a root manifest that defines a crate.    |

In the `project` table, `name` replaces the default name ([[DES-PROJECT-GRAPH]]), `tags` are added to the workspace's tags, and `targets.<name>` overrides a target of the workspace project or adds one. The workspace table's own `targets.<name>` do not reach the workspace project.

For a setting that both tables can hold, the crate's value wins over the workspace default; only tags add up. Key names use the spelling of the matching Nx option, so one name works in `Cargo.toml`, in `nx.json` and on the command line. The remaining keys, the merge rules and the handling of unknown keys are in [[DES-PLUGIN-OPTIONS]].

The plugin puts these values on the project it returns. Where the project's folder also is a JS project, Nx applies `package.json` and `project.json` after them, with the effects [[REQ-METADATA-OVERRIDES]] states ([[EVD-NX-PROJECT-MERGE]]).
:::

:::mara design DES-PLUGIN-OPTIONS
:mid: 01M78FHG7F0KD92ZFBVS6GS65H
:title: Option reference
:status: draft
:satisfies: REQ-TARGET-NAMES
:satisfies: REQ-METADATA-OVERRIDES

Proposed names, to be confirmed as each feature is specified.

| Option               | Where                                                                        | Default              | Meaning                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `targetNames`        | plugin options                                                               | See [[DES-TARGETS]]  | Map from default target name to the name to use, for example `{ "lint": "clippy" }`. Every inferred target can be renamed, `napi-build` and `wasm-build` included. |
| `exclude`            | plugin entry in `nx.json`, beside `options`                                  | none                 | Nx's own filter for plugin entries, no option of the plugin: glob patterns of manifests that Nx does not hand to it ([[DES-DISCOVERY]]).                           |
| `namePrefix`         | workspace table                                                              | none                 | Prefix for the project names of all members of the workspace ([[REQ-PROJECT-NAMES]]).                                                                              |
| `featureUnification` | plugin options, workspace table                                              | chosen automatically | `hakari`, `cargo` or `workspace-build` ([[DES-UNIFICATION]]).                                                                                                      |
| `testRunner`         | plugin options, workspace table                                              | `cargo`              | `cargo` or `nextest` ([[DES-TEST-RUN]]).                                                                                                                           |
| `affectedTests`      | plugin options, workspace table; `false` in a package table opts a crate out | `false`              | The workspace uses selection of affected tests. Which mode a run is in is chosen per run, not here ([[DES-TEST-MODE]]).                                            |
| `artifacts`          | package table                                                                | inferred             | The kinds of artifact the crate produces, `napi` and `wasm`, in place of what the plugin infers. An empty list means none ([[DES-ARTIFACT-STEPS]]).                |
| `env`                | plugin options, workspace table                                              | none                 | Additional environment variables for the cache key ([[DES-INPUTS]]).                                                                                               |
| `runtimeInputs`      | plugin options, workspace table                                              | none                 | Additional commands whose output joins the cache key ([[DES-INPUTS]]).                                                                                             |
| `locked`             | plugin options                                                               | `false`              | Pass `--locked` to every cargo command of a task ([[DES-INVOCATION]]).                                                                                             |

Two environment variables act on one run and are no options: `NX_RUST_TEST_MODE` ([[DES-TEST-MODE]]) and `NX_RUST_LOCKED`, which replaces `locked` ([[DES-INVOCATION]]).

Precedence is defaults, then plugin options, then the workspace table, then the package table. Tags do not follow it: a crate's tags are added to its workspace's tags ([[DES-METADATA-TABLES]]). A `targets.<name>` table merges over the inferred target key by key, with `options` merged per option. An unknown key in either table is an error that names the manifest and the key.

Open: the final names, and which options a single crate may set.
:::

:::mara design DES-UNKNOWN-OPTIONS
:mid: 01M7A93PSWW34M2MF0BAD1S6PJ
:title: Options the executor does not know
:status: accepted
:satisfies: REQ-UNKNOWN-OPTIONS
:satisfies: REQ-UNKNOWN-METADATA-OPTIONS

The schema of each of the plugin's executors declares each target option with its type and leaves `additionalProperties` unset, so that Nx passes any other option on to the executor. Nx checks options against the schema before the batch implementation runs, and with `additionalProperties: false` one unknown option fails every task that Nx hands to the batch implementation, in every group, with a message that names neither the option nor a task ([[EVD-NX-OPTION-VALIDATION]], [[ADR-UNKNOWN-OPTIONS]]).

When a task starts, the executor compares the keys of the task's options with the options its schema declares. It leaves every other key out of the cargo command, so that such a key splits no group ([[TERM-GROUP]]), and writes one warning line per such key at the top of the task's own output. The batch implementation and the implementation for a single task, which Nx uses with `--batch=false` and which is the only one that the executor of `run` has, both do this.

**Source.** Nx assembles a task's options from the plugin's target, `targetDefaults`, `package.json`, `project.json`, configurations, options forwarded from other tasks and the command line, and records which source gave a value only in its own source map ([[EVD-NX-OPTION-VALIDATION]]). The executor therefore does not work out the file or the `targetDefaults` entry, and the line takes one of two forms:

- When the option is among the command's own flags, as the next paragraph defines, the line says so, for example ``api:test: ignoring option `coverage`, passed on the command line.``
- In every other case, the line says that the option comes from the workspace's configuration and names the command that shows Nx's own record, with the two fixes for a `targetDefaults` entry, for example ``api:test: ignoring option `passWithNoTests`, which the cargo executor does not know. It comes from the workspace's configuration: run `nx show target api:test --json` and look under `sourceMap` for the file and entry. If it is a `targetDefaults` entry in nx.json, add a `filter` to it or add an empty entry keyed by the plugin's executor.`` The empty entry is keyed by the target's executor, which Nx then chooses for that executor's targets instead of entries keyed by a target name ([[EVD-NX-TARGET-DEFAULTS]]).

**Command line.** An option counts as passed on the command line only when three conditions hold. First, the task that the executor's context gives for the task holds the option among its overrides, under its name and with the value that this invocation received. Second, that task's own `__overrides_unparsed__` lists the option as `--<name>`, `--<name>=<value>`, `--no-<name>` or, for a one-letter name, `-<name>`. A word after a second `--` does not count: Nx keeps it as positional data under `_`, and the option keeps its configured value. Third, the same flag is among the arguments of the `nx` command, which the plugin's `preTasksExecution` hook records. Nx fills `__overrides_unparsed__` with the command's arguments for a task that the command started and for a dependency reached with `params: "forward"`. It leaves the list empty for every other dependency, also one that gets the dependent's options through `options: "forward"`. In every other case, also when the task, the list or the record is missing, the line has the second form.

**Started in code.** Devkit's `runExecutor` lets another executor start the target with options of its own while passing its own context on, so the plugin's executor finds the caller's graph task, not one of its own ([[EVD-NX-OPTION-VALIDATION]]). The first condition gives such an invocation the second form when the value it received differs from the graph task's. When the caller passes the value that the command gave, the executor cannot tell the invocation from the scheduled one, and the line takes the first form.

**Record.** The hook receives the command's arguments, `--` included, and records them on every command in an environment variable. Nx carries an assignment to `process.env` in that hook to the `nx` process, whose tasks inherit it, with the daemon and without. The record is in no task's cache key and is the same for every task of a command, so it splits no group. A dependency or continuous task inherits it as well, which is why both uses here also require the task's own `__overrides_unparsed__`.

**run.** The value of the `args` option and the arguments after `--` on the command line go to the binary ([[DES-TARGET-COMMANDS]]). The executor takes none of the arguments after `--` as an option and writes no line for them. Nx hands a task the arguments after `--` as options, in the same form as flags given without `--`, and when the command has `--` it hands over only those ([[EVD-NX-OPTION-VALIDATION]]). The executor therefore passes arguments after `--` to the binary only when three conditions hold. The record has `--`. The task's own `__overrides_unparsed__` equals the arguments after it. The invocation's options hold every option that Nx parsed from those arguments and that is not one of `run`'s own, with the same value. That holds for a task that the command started and for a dependency reached with `params: "forward"`. A dependency or continuous task reached with `params: "ignore"` has an empty list, so its binary gets none of them. An invocation started in code with the caller's context gets them as well when the arguments after `--` name only `run`'s own options, or when the caller passes the same values, because the executor cannot tell such an invocation from the scheduled one. When the record is missing, the executor treats the command as having no `--`. Any other unknown option of a `run` task gets a line, as on every other target.

**Cache.** `run` is not cached. For other targets, a cache hit replays the output stored with the result, its lines included. The ignored option stays in the task's cache key: Nx hashes the `options` and `configurations` of every target of the project, and `nx.json`, into each task of the project, and the command line into each task of a run. A run that ignores the option therefore does the same work under its own key.

Known limitation: Nx checks the types of the declared options in the same place. A target default or `project.json` that gives a declared option a value of the wrong type, such as `profile: 1`, fails every task that Nx hands to the batch implementation with it, in every group, with Nx's own message, an unhandled `SchemaError` that names no option. With `--batch=false`, and on `run`, only the tasks that receive the value fail, each with Nx's message `Property '<option>' does not match the schema`. The types stay in the schema, because Nx converts values from the command line by them.

Options in the plugin's own tables are checked when the graph is created. While reading `[package.metadata.nx]`, `[workspace.metadata.nx]` and its `project` table ([[DES-METADATA-TABLES]]), the plugin compares the keys under `options` and under each configuration of each `targets.<name>` table whose target runs one of its executors with the options that executor declares. An unknown key stops graph creation with a message that names the manifest, the target, the configuration if any, and the key, as [[REQ-DIAGNOSTICS]] prescribes for problems found at that point.
:::
