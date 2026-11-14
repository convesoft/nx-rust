# Configuration

> **Status:** the plugin reads and checks every setting of this page, in the
> metadata tables and in the plugin options, and `NX_RUST_LOCKED`. Project
> names, `namePrefix`, tags, `implicitDependencies`, `targetNames`, `locked`,
> the `targets` tables, `envInputs`, `runtimeInputs` and `fileInputs` take
> effect. The others are read but have no effect yet: `testRunner`, apart
> from the nextest configuration as a cache input, and
> `affectedTests` until milestone 0.3, `featureUnification` until milestones
> 0.2 and 0.3, and `artifacts` until milestone 0.4. Until the plugin detects
> cargo-hakari configurations (nxr-k64tm5), the check of several entries
> treats an entry without `featureUnification` as agreeing with one that sets
> `hakari` or `workspace-build`.

Most repositories need no configuration. When a crate or workspace needs
something other than the default, you say so in the `Cargo.toml` that already
describes it. Repository-wide choices go into the plugin's entry in `nx.json`.

| Where                                                        | Scope                          | Typical use                                                            |
| ------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------- |
| `[package.metadata.nx]` in a crate's `Cargo.toml`            | One crate                      | Project name, tags, options of a target, extra targets, artifacts      |
| `[workspace.metadata.nx]` in the workspace root `Cargo.toml` | Every member of that workspace | Default tags, test runner, affected tests, a name prefix               |
| `[workspace.metadata.nx.project]` in the same file           | The workspace project          | Its name, tags and targets                                             |
| The plugin's entry in `nx.json`                              | The repository                 | Target names and locked mode in `options`, excluded paths in `exclude` |

A value for a crate wins over the workspace default, which wins over the
plugin options. Tags, `implicitDependencies`, `fileInputs`, `envInputs` and
`runtimeInputs` are the exceptions: they add up, so a crate has its workspace's
and its own. Which
setting goes where is listed under [All settings](#all-settings).

Nx applies some files after the plugin, and they win over all of these:
`targetDefaults` in `nx.json` first, then a `project.json` or `package.json`
in the project's folder. A target default that sets an option such as
`features` for `test` replaces the value a crate's `Cargo.toml` gives it,
unless the default is narrowed to other projects with a `filter`
([Targets](targets.mara.md#no-build-between-crates)).

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

### Changing an inferred target

A `targets` entry for an inferred target is laid over it the way Nx lays a
`project.json` over a plugin's target: what you set replaces the inferred
value, and options are merged one by one. A list such as `inputs` replaces the
inferred list unless it contains `"..."`, which keeps the inferred entries in
that place:

```toml
[package.metadata.nx.targets.test]
inputs = [
  "...", # keep the inferred inputs
  { env = "DATABASE_URL" }, # add a variable for this target
  "!{projectRoot}/docs/**", # and leave the docs folder out
]
```

Two things fail when the graph is created, with a message that names the
manifest: `inputs` without `"..."` on an inferred target, because the cache key
would lose the toolchain, the environment and the files of the crate's
dependencies; and a different `executor`, or a `command`, on an inferred
target. To run another command, define an extra target under a name of its
own, as `migrate` above.

Leaving files out, as `docs` above, is your statement that the target does not
read them. Nx then ignores changes to them, so if a macro such as
`include_str!`, a build script or a test still reads an excluded file, Nx
restores a result produced with the file's old content, a pass where plain
`cargo` would fail or the reverse. The check after a build catches this only
for an exclusion on `build`, and only for a read that Cargo records through an
include macro or a build script's `rerun-if-changed` in the crate's library or
binaries, by failing the task instead of caching it
([Caching](caching.mara.md#files-outside-the-crate)); an exclusion on `check`,
`lint`, `test` or an artifact target, and a file that a proc macro opens
itself, stay unprotected.

An input on one target stays with that target. If a build script reads the
variable, so that crates which depend on this one compile differently too, add
it with `envInputs` instead ([Caching](caching.mara.md#what-is-in-a-cache-key)).

`implicitDependencies` adds edges to projects that Cargo does not know about,
such as a JS project whose output a test reads. It only adds: an entry starting
with `!` is an error.

```toml
[package.metadata.nx]
implicitDependencies = ["web"]
```

## Per workspace

```toml
# rust/Cargo.toml
[workspace]
members = ["crates/*"]

[workspace.metadata.nx]
tags = ["lang:rust"]
namePrefix = "rust-" # members become "rust-api", "rust-core"
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
`[workspace.metadata.nx.targets]` is a default for the members only, and one
named like an inferred target applies only to the members that have it, such
as `bench` to the crates with benches. When the
root `Cargo.toml` also defines a crate, that crate is the workspace project and
is configured in its `[package.metadata.nx]` instead
([Workspaces](workspaces.mara.md#workspace-level-tasks)).

`namePrefix` is used as it is, so include the separator you want. A crate that
sets its own `name` gets exactly that name. The workspace project gets no
prefix where it is a project of its own, because the root `Cargo.toml` defines
no crate; where the root `Cargo.toml` defines a crate, that crate is named like
any member, prefix included
([Project names](workspaces.mara.md#project-names)).

A standalone crate is a workspace of one. It takes the workspace settings from
a `[workspace.metadata.nx]` table in its own `Cargo.toml`, beside
`[package.metadata.nx]`.

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

Two targets may not end up with one name: `{ "test": "build" }` fails graph
creation and names the project, both targets and the name. A key has to be the
default name of an inferred target, such as `bench`, also in a repository
without benches; `{ "clippy": "lint" }` fails graph creation and lists the names
that can be renamed. A `targets` table in `Cargo.toml` uses a target's name
after renaming.

The full list of targets is on the [Targets](targets.mara.md) page.

## Options of targets

The plugin's targets take these options, each the cargo flag of the same
meaning. Set them under `targets.<name>.options` in either table, or on the
command line:

| Option              | Cargo flag                                 | Targets                                                    | Default         |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------- | --------------- |
| `features`          | `--features`                               | `build`, `check`, `lint`, `test`, `bench`, `run` and `doc` | none            |
| `allFeatures`       | `--all-features`                           | the same                                                   | `false`         |
| `noDefaultFeatures` | `--no-default-features`                    | the same                                                   | `false`         |
| `profile`           | `--profile`; `--cargo-profile` for nextest | the same                                                   | Cargo's default |
| `targetTriple`      | `--target`                                 | the same, apart from `test`                                | Cargo's default |
| `allTargets`        | `--all-targets`                            | `check`, `lint`                                            | `true`          |
| `noDeps`            | `--no-deps`                                | `doc`, on the workspace project                            | `true`          |
| `bin`               | `--bin`                                    | `run`                                                      | Cargo's choice  |
| `args`              | the binary's arguments, after `--`         | `run`                                                      | none            |
| `affectedTests`     | none                                       | `test`                                                     | the workspace's |

```toml
# rust/crates/bench-heavy/Cargo.toml: benches that need nightly
[package.metadata.nx.targets.check.options]
allTargets = false

[package.metadata.nx.targets.lint.options]
allTargets = false
```

```sh
nx run api:run --bin=migrate        # one of several binaries
nx build api --profile=release
```

`profile` always names a Cargo profile. With `testRunner = "nextest"`, the
plugin passes it to nextest as `--cargo-profile`, because nextest's own
`--profile` selects a profile of `.config/nextest.toml`, and to the doctest step
as `--profile`.

`affectedTests = true` on a crate whose workspace does not use selection is an
error: in a `Cargo.toml` it stops graph creation, and as `--affectedTests=true`
on the command line it fails the task before cargo runs.

The triple is `targetTriple`, not `target`, because `nx run-many -t` and
`--target` already mean the Nx target. In v1 tests run on the host triple only.
`affectedTests` is described under [Testing](testing.mara.md#affected-tests).

## Excluding crates

To keep crates that are checked in from becoming projects, such as generated
ones, list their manifests under `exclude` on the plugin's entry. This is Nx's
own filter for plugin entries, so it sits beside `options`, not inside:

```json
{
  "plugins": [
    {
      "plugin": "@convesoft/nx-rust",
      "exclude": ["generated/**/*"]
    }
  ]
}
```

The crates that `cargo vendor` writes need no entry here: the plugin skips
them by itself ([Workspaces](workspaces.mara.md#how-workspaces-are-found)).

## All settings

| Setting                       | Plugin options | Workspace table | Crate's table | Described under                                                                                      |
| ----------------------------- | -------------- | --------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `targetNames`                 | yes            |                 |               | [Target names](#target-names)                                                                        |
| `locked`                      | yes            |                 |               | [Caching](caching.mara.md#where-cargo-runs)                                                          |
| `testRunner`, `affectedTests` | yes            | yes             |               | [Testing](testing.mara.md#options)                                                                   |
| `featureUnification`          | yes            | yes             |               | [Batching and features](execution.mara.md#feature-unification)                                       |
| `namePrefix`                  |                | yes             |               | [Per workspace](#per-workspace)                                                                      |
| `name`, `artifacts`           |                |                 | yes           | [Per crate](#per-crate), [napi and wasm artifacts](artifacts.mara.md#which-crates-get-these-targets) |
| `tags`, `targets`             |                | yes             | yes           | [Per crate](#per-crate)                                                                              |
| `implicitDependencies`        |                | yes             | yes           | [Changing an inferred target](#changing-an-inferred-target)                                          |
| `envInputs`, `runtimeInputs`  | yes            | yes             | yes           | [Caching](caching.mara.md#what-is-in-a-cache-key)                                                    |

The `project` table under `[workspace.metadata.nx]` takes `name`, `tags` and
`targets` for the workspace project. A key that this table does not list for a
place, in a `Cargo.toml` table or in the plugin options, fails graph creation
with a message that names the file and the key. That also catches a typo such
as `testrunner`, and a setting in the wrong table, such as `namePrefix` in a
crate's table.

If `nx.json` lists the plugin more than once, with `include` or `exclude`
patterns that split one workspace between entries, those entries have to agree
on `testRunner`, `affectedTests` and `featureUnification`, or the workspace's
`Cargo.toml` has to set them; otherwise graph creation fails and names the
entries.

Three environment variables change one run and are no settings:
`NX_RUST_TEST_MODE` chooses the test mode ([Testing](testing.mara.md)),
`NX_RUST_LOCKED` replaces `locked` ([Continuous integration](ci.mara.md)), and
`NX_RUST_ALLOW_UNSUPPORTED_NX` lets the plugin run on a newer Nx major than it
supports ([Setup](setup.mara.md)).

## Requirements

:::mara requirement REQ-METADATA-OVERRIDES
:mid: 01M78FHG7FJ4E8DDDAMXCG8AKF
:title: Override inferred configuration in Cargo manifests
:status: accepted
:satisfies: NEED-CONFIG-IN-CARGO

A crate's tags, Nx project name, options of inferred targets and additional targets can be set in `[package.metadata.nx]` of its manifest. Defaults for all members of a workspace can be set in `[workspace.metadata.nx]` of the workspace root manifest. When that manifest defines no crate, the name, tags, settings of inferred targets and additional targets of the workspace's own [[TERM-WORKSPACE-PROJECT]] can be set there as well, apart from the defaults for members. A value set for a crate takes precedence over the workspace default, except that a crate's tags, implicit dependencies and added cache inputs, `fileInputs`, `envInputs` and `runtimeInputs`, are added to those of its workspace. No file other than a Cargo manifest is needed to override what the plugin infers for a crate. Where a project's folder also is a JS project, its `package.json` and `project.json` take precedence over these settings, because Nx applies them after every plugin ([[EVD-NX-PROJECT-MERGE]]). The name Nx takes from them applies instead of the one set here ([[REQ-PROJECT-NAMES]]), and a script or target there with the name of one of the project's targets replaces that target, settings made here included, unless Nx merges the two. Tags from both are kept.
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

When a task of a target that runs one of the plugin's executors receives an option that its executor does not know, or one that its executor knows and the task's target does not take, from a `targetDefaults` entry in `nx.json`, a `project.json`, a `package.json` or the command line, the task runs as it would without that option, and the option fails no task. The task's own output carries one warning line per such option that names the option and the task and says that the option was passed on the command line, when that is certain, or else that it comes from the workspace's configuration, with the command that shows where. On a `run` task, the arguments after `--` on the command line go to its binary instead ([[DES-TARGET-COMMANDS]]).
:::

:::mara requirement REQ-UNKNOWN-METADATA-OPTIONS
:mid: 01M7A93PSWEY0RVZ0WCQM20EFG
:title: Reject target options in Cargo metadata that the executor does not know
:status: accepted
:satisfies: NEED-CLEAR-FAILURES

A key under `options` or under a configuration in `configurations` of a `targets.<name>` table in `[package.metadata.nx]`, `[workspace.metadata.nx]` or its `project` table, where the target runs one of the plugin's executors and that executor has no option of that name, fails graph creation with a message that names the manifest, the target, the configuration if any, and the key. So does, on an inferred target, a key that the executor has but the option reference does not give that target, with a message that says that the target does not take it, and `pluginVersion` on any such target, with a message that says that the plugin sets that option itself, because a value set by hand would replace the plugin's version in the cache key ([[GOAL-TRUSTED-CACHE]]).
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
| `featureUnification`          | workspace          | The feature-unification strategy of [[DES-UNIFICATION]].                                                                                                        |
| `namePrefix`                  | workspace          | Put in front of the package name of each member to give its project name ([[DES-PROJECT-GRAPH]]).                                                               |
| `artifacts`                   | package            | The kinds of artifact the crate produces, in place of the inference of [[DES-ARTIFACT-STEPS]].                                                                  |
| `implicitDependencies`        | package, workspace | Projects the crate depends on beyond its Cargo dependencies, as Nx's key of that name. Additions only; they add up.                                             |
| `envInputs`, `runtimeInputs`  | package, workspace | Environment variables and commands added to the crate's cache key ([[DES-INPUTS]]). They add up.                                                                |
| `fileInputs`                  | package, workspace | Glob patterns of files outside the crate that it reads, relative to the manifest's folder. They add up ([[REQ-BUILD-SCRIPT-INPUTS]]).                           |
| `project`                     | workspace          | The [[TERM-WORKSPACE-PROJECT]] itself: its own `name`, `tags` and `targets.<name>`, as in a package table. An error in a root manifest that defines a crate.    |

In the `project` table, `name` replaces the default name ([[DES-PROJECT-GRAPH]]), `tags` are added to the workspace's tags, and `targets.<name>` overrides a target of the workspace project or adds one. The workspace table's own `targets.<name>` do not reach the workspace project.

For a setting that both tables can hold, the crate's value wins over the workspace default; only tags, `implicitDependencies`, `fileInputs`, `envInputs` and `runtimeInputs` add up. Key names use the spelling of the matching Nx option, so one name works in `Cargo.toml`, in `nx.json` and on the command line. Where each setting can be set, the plugin options, the merge rules and the handling of unknown keys are in [[DES-PLUGIN-OPTIONS]].

The plugin puts these values on the project it returns. Where the project's folder also is a JS project, Nx applies `package.json` and `project.json` after them, with the effects [[REQ-METADATA-OVERRIDES]] states ([[EVD-NX-PROJECT-MERGE]]).
:::

:::mara design DES-PLUGIN-OPTIONS
:mid: 01M78FHG7F0KD92ZFBVS6GS65H
:title: Option reference
:status: accepted
:satisfies: REQ-TARGET-NAMES
:satisfies: REQ-METADATA-OVERRIDES

The settings of milestone 0.1, where each can be set, and its default. The plugin options are the `options` of the plugin's entry in `nx.json`, for the manifests that entry receives ([[DES-DISCOVERY]]); the workspace table is `[workspace.metadata.nx]` and the package table `[package.metadata.nx]` ([[DES-METADATA-TABLES]]). Later features add their rows when they are specified, among them the threshold and the switches of the coverage baseline ([[DES-BASELINE]]), the strict per-crate build check of the `hakari` strategy ([[DES-UNIFICATION]]), rules that widen the selection of tests for non-Rust files ([[DES-TEST-RUN]]) and the JS flavour of `wasm-build` ([[DES-WASM]]).

| Setting                | Plugin options | Workspace table | Package table | Default                                                                                    | Meaning                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | -------------- | --------------- | ------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targetNames`          | yes            | no              | no            | none: the names in [[DES-TARGETS]]                                                         | Map from the default name of an inferred target to the name to use, such as `{ "lint": "clippy" }`. Every inferred target can be renamed, the artifact targets and those of the workspace project included.                                                                                                               |
| `locked`               | yes            | no              | no            | `false`                                                                                    | Locked mode for the plugin's commands, as [[DES-INVOCATION]] defines it.                                                                                                                                                                                                                                                  |
| `testRunner`           | yes            | yes             | no            | `cargo`                                                                                    | `cargo` or `nextest` ([[DES-TEST-RUN]]).                                                                                                                                                                                                                                                                                  |
| `affectedTests`        | yes            | yes             | no            | `false`                                                                                    | The workspace uses selection of affected tests ([[DES-TEST-MODE]]). A crate opts out through the target option of the same name.                                                                                                                                                                                          |
| `featureUnification`   | yes            | yes             | no            | `hakari` where the workspace has a cargo-hakari configuration, `workspace-build` elsewhere | `hakari`, `cargo` or `workspace-build` ([[DES-UNIFICATION]]).                                                                                                                                                                                                                                                             |
| `namePrefix`           | no             | yes             | no            | none                                                                                       | Put in front of the package name of each member, as it is and without a separator, to give the project name. A crate that sets `name` gets no prefix, and neither does the workspace project of a root manifest without a `[package]` table. A root manifest's own crate is a member and gets it ([[DES-PROJECT-GRAPH]]). |
| `name`                 | no             | no              | yes           | the package name                                                                           | Nx project name, used as it is ([[DES-PROJECT-GRAPH]]).                                                                                                                                                                                                                                                                   |
| `artifacts`            | no             | no              | yes           | inferred                                                                                   | The kinds of artifact the crate produces, `napi` and `wasm`, in place of what the plugin infers. An empty list means none ([[DES-ARTIFACT-STEPS]]).                                                                                                                                                                       |
| `tags`                 | no             | yes             | yes           | none                                                                                       | Nx tags.                                                                                                                                                                                                                                                                                                                  |
| `targets.<name>`       | no             | yes             | yes           | none                                                                                       | A table shaped like an Nx target, merged as described below.                                                                                                                                                                                                                                                              |
| `implicitDependencies` | no             | yes             | yes           | none                                                                                       | Projects the crate depends on in addition to its Cargo dependencies.                                                                                                                                                                                                                                                      |
| `envInputs`            | yes            | yes             | yes           | none                                                                                       | Environment variables added to the cache key of the crate's cached targets ([[DES-INPUTS]]).                                                                                                                                                                                                                              |
| `runtimeInputs`        | yes            | yes             | yes           | none                                                                                       | Commands whose output is added to that cache key ([[DES-INPUTS]]).                                                                                                                                                                                                                                                        |
| `fileInputs`           | no             | yes             | yes           | none                                                                                       | Glob patterns of files outside the crate's folder that it reads, resolved against the folder of the manifest that holds them and added to its cache key ([[REQ-BUILD-SCRIPT-INPUTS]], [[DES-INPUTS]]).                                                                                                                    |

The workspace table also holds the `project` sub-table for the [[TERM-WORKSPACE-PROJECT]] ([[DES-METADATA-TABLES]]). `exclude`, beside `options` on the plugin's entry, is Nx's own filter for plugin entries, not an option of the plugin ([[DES-DISCOVERY]]). A standalone crate takes the workspace settings from a `[workspace.metadata.nx]` table in its own manifest, which Cargo reports for a workspace of one ([[EVD-CARGO-NX-TABLES]]).

Options of inferred targets are set under `targets.<name>.options`, in a configuration of the target, or on the command line. Each comes from a flag of the cargo command, so the command passes only what the options ask for ([[DES-INVOCATION]]). On a target that the table does not list for it, an option is left out of the command with a warning line ([[DES-UNKNOWN-OPTIONS]]):

| Option              | Flag                                                                                          | Targets                                                                                  | Default                                                  |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `features`          | `--features`                                                                                  | `build`, `check`, `lint`, `test`, `bench`, `run` and `doc`                               | none                                                     |
| `allFeatures`       | `--all-features`                                                                              | the same; the configuration for all features sets it ([[DES-FEATURE-SETS]])              | `false`                                                  |
| `noDefaultFeatures` | `--no-default-features`                                                                       | the same                                                                                 | `false`                                                  |
| `profile`           | `--profile`, or `--cargo-profile` for `cargo nextest run`                                     | the same                                                                                 | none: Cargo's default profile for the command            |
| `targetTriple`      | `--target`                                                                                    | the same, apart from `test`, which runs on the host triple only in v1 ([[ADR-V1-SCOPE]]) | none: the triple Cargo builds for without it             |
| `allTargets`        | `--all-targets`                                                                               | `check`, `lint` ([[DES-TARGET-COMMANDS]])                                                | `true`                                                   |
| `noDeps`            | `--no-deps`                                                                                   | `doc` of the workspace project ([[DES-WORKSPACE-TARGETS]])                               | `true`                                                   |
| `bin`               | `--bin`                                                                                       | `run` ([[DES-TARGET-COMMANDS]])                                                          | none: `default-run` or the only binary, as Cargo chooses |
| `args`              | the binary's arguments, after `--`: a string split into words as [[DES-TARGET-COMMANDS]] says | `run` ([[DES-TARGET-COMMANDS]])                                                          | none                                                     |
| `affectedTests`     | none                                                                                          | `test`                                                                                   | the workspace's `affectedTests`                          |
| `pluginVersion`     | none                                                                                          | every target the plugin infers, where Nx has no node for the plugin's package            | the plugin's version                                     |

`pluginVersion` is set by the plugin and not meant to be set by hand. It is the one target option that the plugin sets itself and that comes from no cargo flag: it carries the plugin's version into each task's key where Nx has no npm node for the plugin ([[DES-INPUTS]]), and each executor's schema declares it ([[DES-UNKNOWN-OPTIONS]]). A `targets.<name>` table in Cargo metadata that sets it fails graph creation, because a value set by hand would replace the plugin's version in the key ([[REQ-UNKNOWN-METADATA-OPTIONS]], [[GOAL-TRUSTED-CACHE]]).

A `pluginVersion` that the plugin did not set is an error wherever it comes from, never a warning and never ignored ([[GOAL-TRUSTED-CACHE]]). Nx lays `targetDefaults`, `project.json` and `package.json` over the plugin's targets (**Precedence**), and a value that covers every target of a task's project and of the projects whose configuration its key holds, as an entry keyed by the plugin's executors does, keeps the key when the plugin's version changes ([[EVD-NX-24-PLUGIN-VERSION]]). So graph creation fails, once Nx has merged these files, where an inferred target that still runs the plugin's executor has among its options a `pluginVersion` other than the one the plugin gave it, also where the plugin gave none because Nx has a node for its package, or has one in any of its configurations. The message lists the targets by project under the place the value comes from: the `project.json` or `package.json` in the project's folder, or the `targetDefaults` entry and element, as the layers that [[DES-TARGET-DEFAULT-GUARD]] rebuilds with Nx's own code show it (**Which layer**). Where those layers do not show the value, as when another plugin sets it, the message gives for each target the `nx show target` command whose `sourceMap` names the file. A value equal to the plugin's own cannot be told from it and fails once the plugin's version changes. Given for one run only, on the command line or by a task that forwards its options, the value reaches no configuration that graph creation sees. Nx then hashes it beside the target's own, so it takes the place of nothing, but the plugin did not set it either: the executor fails the task before cargo runs where the run's `pluginVersion` differs from the target's. Words after `--` that `run` passes to its binary are no option and fail nothing ([[DES-UNKNOWN-OPTIONS]]).

`profile` names a Cargo profile. With the nextest runner, `test` passes it to `cargo nextest run` as `--cargo-profile`, because nextest takes `--profile` for a profile of its own configuration, and to the doctest step, `cargo test --doc`, as `--profile` ([[DES-TEST-RUN]], [[EVD-NEXTEST-CARGO-FLAGS]]). nextest takes the other flags of the table as cargo does.

`affectedTests = false` as an option of `test` makes the task run the full suite in a workspace that uses selection. It is how a crate opts out of selection, `[package.metadata.nx.targets.test.options] affectedTests = false`, and what `--affectedTests=false` passes for one run ([[DES-TEST-RUN]]). In a workspace without the `affectedTests` setting, the option set to `true` in stored configuration, which is the plugin options, the workspace and package tables, or a target configuration that Nx holds in the graph, fails graph creation. Given as `--affectedTests=true` on the command line, which graph creation never sees, it makes the executor fail the task with the same message before it runs cargo; Nx hands such an override to the executor, also in a batch ([[EVD-NX-24-OPTION-SEMANTICS]]). The triple option is not called `target`, because `nx run`, `nx run-many` and `nx affected` take `--target` and `-t` themselves, so an option of that name could not be given on the command line. `--verbose` is Nx's own flag and no option of the plugin's targets; Nx adds `verbose: true` to the options of a single task only where the executor's schema declares `verbose` or sets `additionalProperties: true` ([[EVD-NX-24-OPTION-SEMANTICS]]).

Three environment variables act on a run and are no options: `NX_RUST_TEST_MODE` ([[DES-TEST-MODE]]), `NX_RUST_LOCKED`, which replaces `locked` for one run ([[DES-INVOCATION]]), and `NX_RUST_ALLOW_UNSUPPORTED_NX` ([[DES-DIAGNOSTICS]]).

**Precedence.** A setting takes its default, then the value in the plugin options, then the one in the workspace table, then the one in the package table, each replacing the one before. `tags`, `implicitDependencies`, `fileInputs`, `envInputs` and `runtimeInputs` add up instead: a crate has the values of every level, and no level removes what another set. This order is the plugin's own, applied to the projects it returns. Nx then applies `targetDefaults` from `nx.json`, and after them the `project.json` and `package.json` in the project's folder, so a value that either sets for a target, an option such as `features` included, replaces the one that the plugin gave it ([[EVD-NX-TARGET-DEFAULTS]], [[EVD-NX-PROJECT-MERGE]]).

**Target names.** When `targetNames` gives two inferred targets of one project the same name, graph creation fails with an error that names the project, the two inferred targets and the resulting name, and says to change `targetNames`. Neither target replaces the other, because [[DES-TARGETS]] gives the project both. A key of `targetNames` has to be the default name of an inferred target that this version of the plugin knows, whether or not a project of the repository has that target; any other key fails graph creation, as an unknown key does (**Unknown keys**), with a message that names the key and lists the names that can be renamed. A `targetNames` that is no object, or a value in it that is no non-empty string, fails graph creation with a message that names the key. Later milestones add the names of the targets they add. The rule for a `targets.<name>` table in Cargo metadata stands: under the name of an inferred target, which is its name after `targetNames`, it overrides that target, and under any other name it defines an extra target ([[DES-METADATA-TABLES]]).

**Several entries.** `testRunner`, `affectedTests` and `featureUnification` are settings of a whole workspace. When entries of the plugin that receive manifests of one workspace give different values for one of them, an entry without the option counting as giving its default, and the workspace table does not set it, graph creation fails with a message that names the workspace, the setting and the entries by their place in the `plugins` of `nx.json`. An entry learns of the others from the `plugins` of `nx.json` in the context Nx passes to its `createNodes`, which holds every entry, also under plugin isolation. It takes the manifests that another entry receives by applying that entry's `include` and `exclude` to the `Cargo.toml` files of Nx's workspace context, as Nx does, with Nx's own `findMatchingConfigFiles` and `globWithWorkspaceContext` ([[EVD-NX-24-ENTRY-CONTEXT]]).

**Targets.** A `targets.<name>` table is merged over the target the plugin infers under that name by Nx's own rule for laying one configuration of a target over another, in the order of precedence; the plugin calls Nx's `mergeTargetConfigurations` for it ([[EVD-NX-24-OPTION-SEMANTICS]]). A field the table sets replaces the inferred one, `options` and `configurations` are merged key by key, and a list replaces the inferred list unless it contains `"..."`, which stands for the inferred entries at that place. For a name under which the plugin infers no target, the table defines an extra target. A table in the workspace table under the name, after `targetNames`, of a target that the plugin infers applies only to the members that have that target and creates nothing on the others; under any other name it defines an extra target on every member. A field that an Nx target has, such as `options`, `outputs` or `continuous`, has to have the type that Nx's project schema gives it; another type fails graph creation with a message that names the manifest, the target and the field. Two more cases fail graph creation with a message that names the manifest, the target and the field: `inputs` without `"..."` on an inferred target, because it would drop inferred inputs such as the toolchain, the environment and the dependencies' files from the key; and a different `executor`, or a `command`, on an inferred target, which Nx would treat as another target and use in place of the inferred one; the inferred executor repeated is accepted. Another command runs as an extra target under another name. A negated pattern beside `"..."`, such as `"!{projectRoot}/docs/**"`, takes files out of the inferred inputs. This is allowed, as the repository's statement that the target does not read those files: a change to such a file changes no key, so where a macro, build script or test still reads it, Nx restores a result produced with the file's old content ([[EVD-NX-24-OPTION-SEMANTICS]]).

**Implicit dependencies.** Each entry of `implicitDependencies` adds an edge from the crate to the project it names, which may be a project of another plugin. The key only adds, so an entry starting with `!` fails graph creation, whatever it names.

**Added inputs.** `envInputs` and `runtimeInputs` of all three levels, and `fileInputs` of the two tables, go into the crate's own named input, which its dependents hash through `^` inputs ([[DES-INPUTS]]). A variable or command added for one crate therefore also reaches the keys of the crates that depend on it, in other workspaces too. The plugin options hold no `fileInputs`, because a pattern is resolved against the folder of the manifest that holds it ([[REQ-BUILD-SCRIPT-INPUTS]]). The names pair with Nx's input kinds `env` and `runtime`: a plain `env` would read as the option of `nx:run-commands` that sets variables for a command, and an extra target with a `command` is such a target ([[EVD-NX-24-OPTION-SEMANTICS]]).

**Unknown keys.** A key at the top level of a package table, of a workspace table or of its `project` sub-table, or in the plugin options, that this reference does not give for that place fails graph creation with a message that names the file, the manifest or `nx.json`, and the key. A setting given only for another place counts as unknown there, such as `namePrefix` in a package table. So do the other keys of an Nx project configuration, such as `root`, `sourceRoot`, `projectType`, `namedInputs` and `metadata`, and `release` until the release flow is specified ([[DES-RELEASE]]). A key under a target's `options` or one of its configurations that the target's executor does not know fails graph creation as well ([[REQ-UNKNOWN-METADATA-OPTIONS]]).
:::

:::mara design DES-UNKNOWN-OPTIONS
:mid: 01M7A93PSWW34M2MF0BAD1S6PJ
:title: Options the executor does not know
:status: accepted
:satisfies: REQ-UNKNOWN-OPTIONS
:satisfies: REQ-UNKNOWN-METADATA-OPTIONS

The schema of each of the plugin's executors declares each target option with its type and leaves `additionalProperties` unset, so that Nx passes any other option on to the executor. Because no schema declares `verbose` or sets `additionalProperties: true`, Nx's own `--verbose` adds no option to a task and draws no line ([[EVD-NX-24-OPTION-SEMANTICS]]). Nx checks options against the schema before the batch implementation runs, and with `additionalProperties: false` one unknown option fails every task that Nx hands to the batch implementation, in every group, with a message that names neither the option nor a task ([[EVD-NX-OPTION-VALIDATION]], [[ADR-UNKNOWN-OPTIONS]]).

When a task starts, the executor compares the keys of the task's options with the options its schema declares. It leaves every other key out of the cargo command, so that such a key splits no group ([[TERM-GROUP]]), and writes one warning line per such key at the top of the task's own output. A key that the schema declares but that the option reference of [[DES-PLUGIN-OPTIONS]] does not give the task's target, such as `targetTriple` on `test` or `allTargets` on `build`, is treated the same way, because one schema serves every target of the cargo executor; its line says that the target does not take the option. The batch implementation and the implementation for a single task, which Nx uses with `--batch=false` and which is the only one that the executor of `run` has, both do this.

**Source.** Nx assembles a task's options from the plugin's target, `targetDefaults`, `package.json`, `project.json`, configurations, options forwarded from other tasks and the command line, and records which source gave a value only in its own source map ([[EVD-NX-OPTION-VALIDATION]]). The executor therefore does not work out the file or the `targetDefaults` entry, and the line takes one of two forms:

- When the option is among the command's own flags, as the next paragraph defines, the line says so and what to do, for example ``api:test: ignoring option `coverage`, passed on the command line. Remove it, or check its spelling.`` For an option that the target does not take, the line says to remove it, and for positional words, to remove them. On `run`, whose binary takes the arguments after `--` and the value of `args`, the line for an unknown option or for positional words also says to pass them to the binary after `--` or with `--args`. No other target passes arguments on: `test` has no option for arguments of the test binary, so its line for positional words only says to remove them.
- In every other case, the line says that the option comes from the workspace's configuration and names the command that shows Nx's own record, with the two fixes for a `targetDefaults` entry, for example ``api:test: ignoring option `passWithNoTests`, which the cargo executor does not know. It comes from the workspace's configuration: run `nx show target api:test --json` and look under `sourceMap` for the file and entry. If it is a `targetDefaults` entry in nx.json, add a `filter` to it or add an empty entry keyed by "@convesoft/nx-rust:cargo".`` The empty entry is keyed by the target's executor, which Nx then chooses for that executor's targets instead of entries keyed by a target name ([[EVD-NX-TARGET-DEFAULTS]]).

**Command line.** An option counts as passed on the command line only when three conditions hold. First, the task that the executor's context gives for the task holds the option among its overrides, under its name and with the value that this invocation received. Second, that task's own `__overrides_unparsed__` lists the option as `--<name>`, `--<name>=<value>`, `--no-<name>` or, for a one-letter name, `-<name>`. A word after a second `--` does not count: Nx keeps it as positional data under `_`, and the option keeps its configured value. Third, the same flag is among the arguments of the `nx` command, which the plugin's `preTasksExecution` hook records. Nx fills `__overrides_unparsed__` with the command's arguments for a task that the command started and for a dependency reached with `params: "forward"`. It leaves the list empty for every other dependency, also one that gets the dependent's options through `options: "forward"`. In every other case, also when the task, the list or the record is missing, the line has the second form. Positional words, which Nx hands a task as the option `_`, count as passed on the command line under the same three conditions, with the words in place of a flag: the overrides hold the same words, the task's own list parsed as Nx parses it gives them, and each word of that list that can be positional is among the recorded arguments.

**Started in code.** Devkit's `runExecutor` lets another executor start the target with options of its own while passing its own context on. The conditions above are then evaluated as they stand, against the task that the caller's task graph holds for the target, if it holds one, and with the options that Nx merged for the invocation. The form of the line, and what `run` forwards, can therefore differ from what the user typed on the command line. The plugin promises no particular result for such an invocation, only that an option its executor does not know is still ignored with a line, and that no task fails because of it ([[EVD-NX-OPTION-VALIDATION]]).

**Record.** The hook receives the command's arguments, `--` included, and records them on every command in an environment variable. Nx carries an assignment to `process.env` in that hook to the `nx` process, whose tasks inherit it, with the daemon and without. The record is in no task's cache key and is the same for every task of a command, so it splits no group. A dependency or continuous task inherits it as well, which is why both uses here also require the task's own `__overrides_unparsed__`. A record longer than 64 KiB is left empty and counts as missing, because Linux starts no process with an environment variable longer than 128 KiB, so a longer one would fail every task of the command.

**run.** The value of the `args` option and the arguments after `--` on the command line go to the binary ([[DES-TARGET-COMMANDS]]). The executor takes none of the arguments after `--` as an option and writes no line for them. Nx hands a task the arguments after `--` as options, in the same form as flags given without `--`, and when the command has `--` it hands over only those ([[EVD-NX-OPTION-VALIDATION]]). The executor therefore passes arguments after `--` to the binary only when three conditions hold. The record has `--`. The task's own `__overrides_unparsed__` equals the arguments after it. The invocation's options hold every option that Nx parsed from those arguments and that is not one of `run`'s own, with the same value. That holds for a task that the command started and for a dependency reached with `params: "forward"`. A dependency or continuous task reached with `params: "ignore"` has an empty list, so its binary gets none of them. For a target started in code, see **Started in code**. When the record is missing, the executor treats the command as having no `--`. Any other unknown option of a `run` task gets a line, as on every other target.

**Cache.** `run` is not cached. For other targets, a cache hit replays the output stored with the result, its lines included. The ignored option stays in the task's cache key: Nx hashes the `options` and `configurations` of every target of the project, and `nx.json`, into each task of the project, and the command line into each task of a run. A run that ignores the option therefore does the same work under its own key.

Known limitation: Nx checks the types of the declared options in the same place. A target default or `project.json` that gives a declared option a value of the wrong type, such as `profile: 1`, fails every task that Nx hands to the batch implementation with it, in every group, with Nx's own message, an unhandled `SchemaError` that names no option. With `--batch=false`, and on `run`, only the tasks that receive the value fail, each with Nx's message `Property '<option>' does not match the schema`. The types stay in the schema, because Nx converts values from the command line by them.

Options in the plugin's own tables are checked when the graph is created. While reading `[package.metadata.nx]`, `[workspace.metadata.nx]` and its `project` table ([[DES-METADATA-TABLES]]), the plugin compares the keys under `options` and under each configuration of each `targets.<name>` table whose target runs one of its executors with the options that executor declares. An unknown key stops graph creation with a message that names the manifest, the target, the configuration if any, and the key, as [[REQ-DIAGNOSTICS]] prescribes for problems found at that point. On an inferred target, so does a key that the executor declares but the option reference of [[DES-PLUGIN-OPTIONS]] does not give that target, such as `targetTriple` on `test`, with a message that says that the target does not take it.
:::
