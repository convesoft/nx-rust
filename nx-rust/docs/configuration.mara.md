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
plugin options. Tags and `fileInputs` are the exceptions: a crate has its
workspace's and its own.

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
fileInputs = ["../../../proto/**/*.proto"] # files outside the crate that it reads

[package.metadata.nx.targets.test.options]
features = ["integration"] # option of the inferred "test" target

[package.metadata.nx.targets.migrate]
command = "cargo run -p api --bin migrate" # an extra target
```

`fileInputs` patterns are relative to the `Cargo.toml` that holds them;
[Caching](caching.mara.md#files-outside-the-crate) says when you need them.

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

A crate's tags, Nx project name, options of inferred targets and additional targets can be set in `[package.metadata.nx]` of its manifest. Defaults for all members of a workspace can be set in `[workspace.metadata.nx]` of the workspace root manifest. When that manifest defines no crate, the name, tags, settings of inferred targets and additional targets of the workspace's own [[TERM-WORKSPACE-PROJECT]] can be set there as well, apart from the defaults for members. A value set for a crate takes precedence over the workspace default, except that a crate's tags are added to its workspace's tags. No file other than a Cargo manifest is needed to override what the plugin infers for a crate.
:::

:::mara requirement REQ-TARGET-NAMES
:mid: 01M78FHG7FP3Z0DWAES110WHYT
:title: Use Nx target names by default and allow renaming
:status: accepted
:satisfies: NEED-UNIFORM-COMMANDS

Inferred targets have, by default, the names that Nx projects conventionally use for the same job, so that `lint`, `test` and `build` cover Rust crates and JS projects alike. The name of every inferred target can be changed through the plugin's options.
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
| `fileInputs`                  | package, workspace | Glob patterns of files outside the crate that it reads, relative to the manifest's folder. They add up ([[REQ-BUILD-SCRIPT-INPUTS]]).                           |
| `project`                     | workspace          | The [[TERM-WORKSPACE-PROJECT]] itself: its own `name`, `tags` and `targets.<name>`, as in a package table. An error in a root manifest that defines a crate.    |

In the `project` table, `name` replaces the default name ([[DES-PROJECT-GRAPH]]), `tags` are added to the workspace's tags, and `targets.<name>` overrides a target of the workspace project or adds one. The workspace table's own `targets.<name>` do not reach the workspace project.

For a setting that both tables can hold, the crate's value wins over the workspace default; only tags and `fileInputs` add up. Key names use the spelling of the matching Nx option, so one name works in `Cargo.toml`, in `nx.json` and on the command line. The remaining keys, the merge rules and the handling of unknown keys are in [[DES-PLUGIN-OPTIONS]].
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
