# napi and wasm artifacts

> **Status:** specified, not implemented yet. Planned for milestone 0.4.

A Rust crate can be built into something a JS project consumes: a Node addon
through [napi-rs](https://napi.rs), or a wasm package through `wasm-bindgen`.
v1 supports both: Node addons for the host platform, and wasm for the browser.
Node addons need napi-rs 3: `napi-derive` 3, and `@napi-rs/cli` 3.4.0 or later
installed in the workspace. napi-rs 2 addons are not supported.

| Target       | Produces                                                    | Flags                                                   |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| `build`      | Native binaries and libraries                               | Profile, feature set, platform triple                   |
| `napi-build` | The Node addon: a `.node` file plus JS and type definitions | Platform triple                                         |
| `wasm-build` | The wasm package: `.wasm` plus JS glue                      | wasm-bindgen's JS flavour: `web`, `bundler` or `nodejs` |

```sh
nx wasm-build image-codec
nx build web          # builds image-codec's wasm package first, if needed
```

## Which crates get these targets

The plugin reads it from the manifest. A library with
`crate-type = ["cdylib"]` gets `napi-build` when the crate depends directly on
`napi`, and `wasm-build` when it depends directly on `wasm-bindgen`. If the
rule guesses wrong for a crate, name the artifacts yourself in its own
`Cargo.toml` ([Configuration](configuration.mara.md#all-settings)):

```toml
[package.metadata.nx]
artifacts = ["wasm"] # or [] for none
```

## Depending on an artifact from JS

A JS project depends on the artifact target of the crate, not on `^build`, and
hashes the files it gets from it:

```json
{
  "name": "web",
  "targets": {
    "build": {
      "dependsOn": [{ "projects": ["image-codec"], "target": "wasm-build" }],
      "inputs": ["default", "^default", { "dependentTasksOutputFiles": "**/*" }]
    }
  }
}
```

The dependency builds the artifact first. The input puts the artifact's files
into `web`'s cache key. Without it, the key holds the crate's source files and
those of the crates it depends on, but not what only the artifact's own key
holds: `Cargo.lock`, the toolchain, `RUSTFLAGS` and the tool versions. A change
there would build a new artifact and still restore `web`'s old build.

Nx also needs to know that `web` uses the crate, so that `nx affected` reaches
`web` when the crate changes. It knows when `web` depends on the crate's
package (next section). A crate without a `package.json` goes into `web`'s
`implicitDependencies` instead.

If the JS target also declares `^build`, Nx runs the crate's `build` as well:
the native cargo build, or whatever replaced it (next section). The plugin
cannot prevent that ([Targets](targets.mara.md#no-build-between-crates)).

## A crate that is also a JS package

A napi or wasm crate usually has a `package.json` beside its `Cargo.toml`,
listed in the package manager's workspaces, so that JS packages can depend on
it by name. Nx then merges what nx-rust and its own JS support say about the
folder into one project:

- **Name.** The project takes the name of the folder's `project.json`, if that
  sets one, and otherwise of its `package.json` (`nx.name`, else `name`); the
  crate's own name and a `name` in `[package.metadata.nx]` do not apply
  ([Project names](workspaces.mara.md#project-names)).
- **Targets.** The project has nx-rust's targets and those of the JS files. A
  script in the `package.json`, or a `project.json` target, with the name of
  an nx-rust target replaces it, so the `build` and `test` scripts of the
  napi-rs template replace cargo's `build` and `test`. A `project.json` target
  without an executor of its own, for example one that sets only `inputs`,
  changes the nx-rust target instead. nx-rust reports none of this, because
  these files are yours.
- **Other plugins.** Of two plugins that give the folder a target of one
  name, the one listed later in `nx.json` wins, and `nx add` appends. A JS
  plugin added after nx-rust can therefore take a crate's `build`, `test` or
  `lint`: move nx-rust after it, or `exclude` the crate folders on its entry.
- **Consumers.** A JS package that depends on the crate's package, as with
  `"workspace:*"`, gets an edge to it in the project graph, so `nx affected`
  reaches it when the crate, or a crate the crate depends on, changes.
- **`^build`.** A consumer's `^build` runs the project's `build` as Nx merged
  it. Where that is a script or a TypeScript build that itself depends on
  `^build`, Nx also runs the native `build` of the crates behind it.

To keep cargo's targets in such a folder, list only the scripts you want as
targets in `nx.includedScripts`:

```json
{
  "name": "@acme/native",
  "scripts": { "build": "napi build --platform", "artifacts": "napi artifacts" },
  "nx": { "includedScripts": ["artifacts"] }
}
```

The same holds for a Cargo workspace whose folder already is an Nx project,
such as a repository root with a `project.json` or an `nx` key in its
`package.json`. If a script or target there is called `lockfile`, it replaces
the task whose digests the crates' cache keys read, and the crates' cached
tasks fail without storing anything. Rename one of them, for example nx-rust's
through `targetNames`:

```json
{ "plugin": "@convesoft/nx-rust", "options": { "targetNames": { "lockfile": "cargo-lockfile" } } }
```

## Why separate target names

The rule: a different **kind** of artifact gets its own target name; a
different **flavour** of the same artifact is a flag.

- Nx's `dependsOn` names a target and cannot pin a configuration of it. A JS
  app can depend on `wasm-build`; it could not depend on "`build`, but the wasm
  configuration".
- `nx run-many -t build -c wasm` would run the default native build on every
  crate that has no wasm configuration.
- One configuration applies per invocation, so native plus wasm would take two
  commands.
- A named target exists only on crates that produce that artifact.

## How an artifact is built

Each artifact is built in two steps:

1. A plain cargo compile, which takes part in batching like any other build.
   A non-host triple such as `wasm32-unknown-unknown` is a group of its own and
   builds only the selected crates.
2. A post-processing step that Nx caches, with outputs outside Cargo's
   directories: the `wasm-bindgen` CLI for wasm, and for Node addons the
   functions that `@napi-rs/cli` exports for this.

The plugin calls `cargo build` and the `wasm-bindgen` CLI directly. It does not
use wasm-pack, whose home organisation was sunset in 2025. Nor does it run
`napi build`, which always runs cargo itself and would compile the crate's
dependencies a second time. `napi-build` writes the files that
`napi build --platform` writes, into the crate's folder: the addon, such as
`my-addon.linux-x64-gnu.node` on Linux x86-64, its loader `index.js` and its type
definitions `index.d.ts`.

## Things to know

- **Tool versions matter.** The `wasm-bindgen` CLI must match the version of
  the `wasm-bindgen` crate in your lockfile. Tool versions are part of the
  cache key.
- **Every napi crate needs `napi_build::setup()`.** The addon crate and every
  crate it depends on that uses `napi-derive` need a build script that calls
  `napi_build::setup()`, as the napi-rs templates have it, and at least one
  `#[napi]` item. Otherwise `napi-build` cannot be sure the type definitions
  are current, and fails and names the crate.
- **`napi-build` and plain cargo rebuild the napi crates for each other.**
  After `nx napi-build`, the next plain `cargo build`, `nx build` or
  rust-analyzer check compiles the napi crates, and every crate that depends
  on them, again, and the next `napi-build` does the same after them. The rest
  of the workspace is reused. Addon crates are usually leaves, so this is
  usually a few crates.
- **Two addons need different library names.** If two crates have the same
  `[lib] name`, cargo builds one file for both, and `napi-build` fails for
  both until you rename one.
- **Artifacts are platform-specific.** The target triple is part of the key, so
  a `.node` file built on Linux is never restored on macOS.
- **Generated files in the source tree** such as type definitions and JS glue
  are outputs of the target and are left out of its inputs.

Not in v1: cross-compiling Node addons to other platforms, wasm tests, and
publishing the resulting packages to npm.

## Requirements

:::mara requirement REQ-ARTIFACT-TARGETS
:mid: 01M78FHG7FP44K4K3TDR87ZFQS
:title: Build Node addons and wasm packages as named targets
:status: accepted
:satisfies: NEED-JS-BRIDGE

A crate that produces a Node addon has a `napi-build` target that builds the addon for the host triple, with its JS and type definitions. A crate that produces a wasm package has a `wasm-build` target that builds the package for the browser, with its JS glue. Each target exists only on crates that produce that artifact, and a JS project can depend on it by name. Which crates produce an artifact is inferred from their manifests, and a crate can state it explicitly instead.
:::

:::mara requirement REQ-ARTIFACT-CACHE
:mid: 01M78FHG7FWCZAQ21ZSKRABR4B
:title: Cache artifacts on everything that shapes them
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of an [[TERM-ARTIFACT-TARGET]] includes the target triple and the versions of the tools that post-process the build. Files that the target generates inside the source tree are outputs of the target and are not among its inputs. An artifact built for one platform is never restored on another.
:::

:::mara requirement REQ-MIXED-PROJECTS
:mid: 01M78FHG7FJ88KAM4MK9SZ4FZH
:title: Describe a folder with Cargo.toml and package.json as one project
:status: accepted
:satisfies: NEED-JS-BRIDGE
:mitigates: RISK-MIXED-PROJECT-MERGE

A crate whose folder also is a JS project, through a `package.json` that Nx reads or a `project.json`, is one Nx project. Its name is the one Nx takes from those files ([[REQ-PROJECT-NAMES]]). It has the targets that the plugin infers for the crate, under their usual names, together with those of the folder's files and of other plugins, as Nx merges them: a script or target of one of the plugin's names in the folder's files, or in a plugin listed after this one in `nx.json`, replaces the plugin's target or merges into it, and the plugin neither renames its target nor reports this ([[ADR-MIXED-PROJECT-TARGETS]]). A JS project that depends on the crate's package has a dependency on the project in the graph, so that a change to the crate, or to a crate it depends on, reaches the JS project through `nx affected` and its `^` inputs. The plugin adds no task dependency to the JS project and removes none, so its `^build` runs the `build` of the merged project, whichever layer gave it. The same holds for a [[TERM-WORKSPACE-PROJECT]] whose folder already is an Nx project.
:::

## Design

:::mara design DES-ARTIFACT-STEPS
:mid: 01M78FHG7F47NNMQ07P6DKD6KB
:title: Two steps per artifact
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS
:satisfies: REQ-ARTIFACT-CACHE

| Target       | Produces                                                    | Flags                                                  |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------ |
| `build`      | Native binaries and libraries                               | Profile, feature set, platform triple                  |
| `napi-build` | The Node addon: a `.node` file plus JS and type definitions | Platform triple                                        |
| `wasm-build` | The wasm package: `.wasm` plus JS glue                      | wasm-bindgen's JS flavour (`web`, `bundler`, `nodejs`) |

A different kind of artifact gets its own target name; a different flavour of the same artifact is a flag ([[ADR-ARTIFACT-TARGET-NAMES]]).

A crate produces an artifact when its library target has the crate type `cdylib` and the crate depends directly, through a normal dependency, on `napi` for a Node addon or on `wasm-bindgen` for a wasm package. A dependency declared for one platform only counts too. Both facts come from the `cargo metadata` report ([[DES-METADATA-REPORT]]), so the usual crate needs no configuration. An `artifacts` list in `[package.metadata.nx]` replaces the inference: it names the kinds the crate produces, and an empty list means none.

Each artifact target is built in two steps:

1. A plain cargo compile inside the batch ([[DES-BATCH]]). A non-host triple is its own group and builds only the selected crates ([[DES-FEATURE-SETS]]).
2. A post-processing task that Nx caches, with outputs outside Cargo's directories.

JS consumers depend on the artifact target, not on `^build`, and hash its outputs ([[DES-MIXED-PROJECTS]]). Generated type definitions and JS glue are declared as outputs and excluded from inputs. The target triple is a target option and therefore in the key; the versions of the post-processing tools are runtime inputs.
:::

:::mara design DES-WASM
:mid: 01M78FHG7FEJ8068G4VR6C06QJ
:title: wasm-build
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS

`wasm-build` compiles the crate with `cargo build` for the wasm triple and then runs the `wasm-bindgen` CLI on the result. The JS flavour (`web`, `bundler` or `nodejs`) is a flag of the target. The CLI must match the version of the `wasm-bindgen` crate in the lockfile; a mismatch is reported before the step runs ([[REQ-DIAGNOSTICS]]). The plugin does not use wasm-pack ([[ADR-NO-WASM-PACK]]). v1 targets the browser and runs no wasm tests.
:::

:::mara design DES-NAPI
:mid: 01M78FHG7FRRT8J6Z5NYMT12A3
:title: napi-build
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS

`napi-build` compiles the crate with `cargo build` for the host triple and then post-processes the library into the `.node` file with its JS and type definitions, in the two steps of [[DES-ARTIFACT-STEPS]]. `napi build` cannot do the second step alone: it always runs cargo itself, for the one package and with `--target`, and would compile the crate's whole dependency tree a second time into the triple's folder, with the features of that package alone ([[EVD-NAPI-POSTPROCESS]]). The plugin therefore does not run `napi build`.

**Compile.** The compile step is a group of its own kind in the batch ([[DES-BATCH]]), which selects crates and resolves features as `build` does under the workspace's strategy ([[DES-UNIFICATION]]), without `--target` on the host. While `napi-derive` 3 expands a crate's `#[napi]` items, it writes the crate's type information into a file named after the package in the folder that `NAPI_TYPE_DEF_TMP_FOLDER` names. It writes nothing while that variable is unset or the folder is missing, and only when the crate is actually compiled: it never removes the file of a crate that is fresh or that no longer has any `#[napi]` item ([[EVD-NAPI-POSTPROCESS]]). The compile therefore starts from nothing each time:

- **An empty folder.** Before each compile, the plugin creates the folder empty, in Cargo's build directory, at a path of the group's configuration: everything the tasks of a group share ([[TERM-GROUP]]), and for a group of one crate that crate. Nothing from an earlier run is kept, and no two configurations share a folder. The path stays the same from run to run, because cargo rebuilds every crate whose build script calls `napi_build::setup()` when it changes, also crates that this compile does not need.
- **Every napi crate forced.** The closure is the group's addon crates and every crate that they depend on through normal dependencies. For each crate of the closure that depends on `napi-derive`, whether or not it has a task in the group, the command sets `NAPI_FORCE_BUILD_` with the package name in capitals and `-` replaced by `_` to a value of this compile's own. `napi_build::setup()` makes cargo rebuild the crate when that variable changes, so every such crate is compiled and writes its file.
- **Every file written.** After cargo, each crate that the command forced must have a file in the folder. Where one has none, every `napi-build` task whose addon is that crate or depends on it fails, with a message that names the crate and the two causes: its build script does not run `napi_build::setup()`, which alone lets the variable force it, or it no longer has any `#[napi]` item and should drop its dependency on `napi-derive` ([[DES-DIAGNOSTICS]]). Forcing cannot reach a crate whose build script does not call `setup()`: cargo keeps it fresh, and only a change to its own files compiles it again.

Only this step sets these variables. `build`, `test`, `check` and `lint` run without them, as plain cargo does. Every crate that the step forces, and every crate that depends on one of them, is therefore compiled again on each `napi-build` compile and on the next command without the variables, such as plain `cargo build`, `nx build` or rust-analyzer's check. The plugin accepts this in the shared build directory ([[ADR-NAPI-SHARED-BUILD-DIR]]). Two `nx` commands that run the compile of one group configuration at the same time empty the same folder, and one of them can then miss files or read the other's.

**Library names.** The `.node` file is a copy of the library that cargo reports for the crate. Where two crates give their libraries one file name, as [[DES-OUTPUTS]] compares them ("Files of one name"), cargo builds one file for both, and the copy would give both addons one crate's functions. `build` of such crates runs uncached with a warning; a `napi-build` of such a crate fails when the task starts, before cargo runs, with a message that names both crates and says to give them different `[lib] name`s ([[DES-DIAGNOSTICS]]).

**Post-processing.** After the compile, for each task, the plugin copies the library that cargo reported for the crate to `<binaryName>.<platform>-<arch>-<abi>.node` in the crate's folder. It then writes `index.d.ts` and `index.js` there with `generateTypeDef` and `writeJsBinding`, which the workspace's installed `@napi-rs/cli` exports, and with the crate's `napi` settings, which `readNapiConfig` reads. The defaults are those of `napi build --platform`. `generateTypeDef` reads every file in the folder it is given, so the plugin gives it a folder of the task's own. That folder holds only the files of the crate and of the napi crates in its own closure, whose `#[napi]` items become part of the addon. With that folder, both files were byte-identical to those of `napi build --platform` ([[EVD-NAPI-POSTPROCESS]]). These three files are the target's outputs, excluded from its inputs ([[DES-ARTIFACT-STEPS]]).

**What the step needs.** `napi-build` supports crates built with `napi-derive` 3 and post-processed with `@napi-rs/cli` 3, from 3.4.0, the first release that exports all three functions ([[ADR-NAPI-RS-3]]). A task fails before cargo runs, with a message that names the tool or the crate and the version ([[DES-DIAGNOSTICS]]), where the workspace has no `@napi-rs/cli` installed, as for any missing tool, or has another major of it or a release older than 3.4.0, and where a crate of its closure depends on `napi-derive` of another major.

The versions of `@napi-rs/cli` and of any cross toolchain are part of the cache key. v1 builds for the host triple only: cross-compiling takes one target per command and zig or cargo-xwin, and is normally a CI matrix.

Whether napi crates need a special feature to link under `cargo test` is not confirmed ([[RISK-NAPI-TOOLING]]).
:::

:::mara design DES-MIXED-PROJECTS
:mid: 01M7J4NJ5WGAAQEBVGQCFFCQ02
:title: One project from two descriptions
:status: accepted
:satisfies: REQ-MIXED-PROJECTS

**Name.** Nx merges every project returned for one root into one, in this order: the plugins in the order of `nx.json`, target defaults, then its own `package.json` and `project.json` plugins, which no position in `nx.json` follows ([[EVD-NX-PROJECT-MERGE]]). The project is therefore named by the folder's `project.json`, where it sets a name, and otherwise by the `package.json` (`nx.name`, else `name`), and the plugin names the ends of its edges by the project at the crate's root ([[DES-PROJECT-GRAPH]]). Nx reads a crate's `package.json` only where the package manager's workspaces list it or a `project.json` sits beside it; otherwise the folder is the crate's project alone.

**Targets.** The plugin infers a mixed crate's targets as any crate's ([[DES-TARGETS]]) and does nothing about the folder's other layers ([[ADR-MIXED-PROJECT-TARGETS]]). Nx merges a later target of the same name into the plugin's where at most one of the two names an executor, or both name the same one; its lists then replace the plugin's unless they hold `"..."`. A target with another executor or a command, such as a `package.json` script, which runs `nx:run-script`, replaces the plugin's whole ([[EVD-NX-24-PLUGIN-NODES]], "Other layers"). A script keeps the plugin's `cargo` record in its metadata beside its own ([[EVD-NX-MIXED-CONSUMER]]), which no executor of the script reads, and the guard leaves every target alone that no longer runs the plugin's executor ([[DES-TARGET-DEFAULT-GUARD]], "Where"). A merged target that still runs it is compared as that item says, and what the folder's own `project.json` and `package.json` do to it counts as the project's own statement ("Other layers"). Of two plugins, the one listed later wins a target; `init` appends nx-rust to the plugins of `nx.json`, and `nx add` appends a plugin added later. `nx.includedScripts` in the `package.json` limits which scripts become targets.

**Consumers.** The plugin adds no edge to or from a JS project. Nx's own analysis of a JS project's `package.json` turns a dependency on the crate's package, such as `workspace:*`, into a static edge to the merged project ([[EVD-NX-MIXED-CONSUMER]]). A crate without a `package.json` that Nx reads has no package name, and a JS project reaches it through its own `implicitDependencies`. Through that edge and the plugin's edges between crates, `nx affected` selects the JS project when the crate or a crate behind it changes, and the JS project's `^default` reads each such crate's named input `default`, its folder and its workspace's root manifest ([[DES-INPUTS]]). It does not read what only the crates' own keys hold, the lockfile digests, the toolchain, the variables and the tool versions. A JS target that consumes an artifact therefore depends on the [[TERM-ARTIFACT-TARGET]] and hashes its outputs through a `dependentTasksOutputFiles` input, which the user writes, since the plugin writes nothing into JS projects ([[ADR-NO-RUST-BUILD-DEPS]]).

**`^build`.** A JS target's `^build` runs the `build` of the merged project. Where that is the plugin's, it is the crate's native build, which depends only on its workspace's lockfile task and, under `hakari`, the drift check ([[REQ-NO-RUST-TASK-DEPS]]). Where a script, a `project.json` target or a later plugin replaced it, it runs that target with that target's own `dependsOn`. A script has none of its own, a TypeScript build of `@nx/js/typescript` has `^build`, and a `targetDefaults` entry keyed `build` gives one to a script, while the entries keyed by the plugin's executors that `init` writes keep it from the crates' own `build`. Such a `^build` runs the native `build` of the crates that the mixed project depends on directly, which stop at their lockfile task ([[EVD-NX-MIXED-CONSUMER]], [[ADR-NO-RUST-BUILD-DEPS]]).

**Workspace project.** A workspace project whose folder already is an Nx project merges in the same way ([[EVD-NX-PROJECT-MERGE]]). A script or target named like the lockfile task replaces it; the crates' cached tasks still depend on the target of that name and then fail without storing a result ([[DES-LOCKFILE-HASHING]], "Merged project").
:::

## Scenario

:::mara scenario SCN-MIXED-CHANGE
:mid: 01M78FHG7FZW8RSXABKCH37WF5
:title: A Rust change reaches the JS app that consumes it
:status: accepted

A repository has a web app `web` and a crate `image-codec` that is built into a wasm package; `web`'s build depends on `image-codec:wasm-build`. A developer changes a source file of `core`, a crate that `image-codec` depends on, and opens a pull request. CI runs `nx affected -t lint test build`. Nx runs `lint` and `test` for `core` and `image-codec`, runs `wasm-build` for `image-codec` because `web`'s build needs it, and builds and tests `web`. Unrelated crates and JS projects are restored from the cache or not selected at all. The Rust tasks of one workspace run with one cargo command per step of each group, not one per crate. No command in the pipeline is specific to Rust.
:::
