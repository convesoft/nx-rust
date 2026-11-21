# napi and wasm artifacts

> **Status:** `napi-build` and `wasm-build` work.

A Rust crate can be built into something a JS project consumes: a Node addon
through [napi-rs](https://napi.rs), or a wasm package through `wasm-bindgen`.
v1 supports both: Node addons for the host platform, and wasm for the browser.
Node addons need napi-rs 3: `napi-derive` 3, and `@napi-rs/cli` 3.4.0 or later
installed in the workspace. napi-rs 2 addons are not supported.

| Target       | Produces                                                    | Flags                                     |
| ------------ | ----------------------------------------------------------- | ----------------------------------------- |
| `build`      | Native binaries and libraries                               | Profile, feature set, platform triple     |
| `napi-build` | The Node addon: a `.node` file plus JS and type definitions | Platform triple                           |
| `wasm-build` | The wasm package: `.wasm` plus JS glue                      | wasm target: `web`, `bundler` or `nodejs` |

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
- **Scripts after `napi-build`.** The files that `napi-build` writes are left
  out of the inputs of nx-rust's targets, but not out of those of the
  targets that Nx makes from the package's own scripts. After `napi-build`
  wrote new files, the package's `build` and `test` scripts therefore run
  again instead of being restored. To avoid that, give those targets
  `inputs` of your own that leave out the addon's file, `index.js` and
  `index.d.ts`.

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
definitions `index.d.ts`. `wasm-build` writes what
`wasm-bindgen --target <wasm target> --out-dir pkg` writes for the `.wasm` file
that cargo built, such as `image_codec.js`, `image_codec.d.ts` and
`image_codec_bg.wasm`.

## Things to know

- **Tool versions matter.** The `wasm-bindgen` CLI must match the version of
  the `wasm-bindgen` crate in your lockfile; `wasm-build` checks
  `wasm-bindgen --version` before cargo runs and says which version to
  install with `cargo install --locked wasm-bindgen-cli --version <version>`.
  Tool versions are part of the cache key.
- **wasm needs its target and the CLI.** `wasm-build` compiles for
  `wasm32-unknown-unknown`, so the toolchain of the Cargo workspace needs
  that target (`rustup target add wasm32-unknown-unknown`), and the
  `wasm-bindgen` CLI has to be on `PATH`. The plugin installs neither; a task
  without them fails with a message that says what to install.
- **The wasm package goes to `pkg`.** `wasm-build` writes the `.wasm` file,
  its JS glue and type definitions into the folder `pkg` of the crate's folder,
  as wasm-pack does, and empties that folder first, so keep nothing else
  there. It compiles the crate's library alone, so a binary of the crate,
  such as a command-line tool in `src/main.rs`, is not built for wasm. Point the `main` or `exports` of the crate's `package.json` at it,
  such as `pkg/image_codec.js`.
- **The wasm target is an option.** `wasmTarget`, the `--target` of
  `wasm-bindgen`, is `bundler` by default, the
  CLI's own default, for bundlers such as webpack; set `web` for a browser
  without a bundler, or `nodejs`, for example
  `nx wasm-build image-codec --wasmTarget=web` or in the options of the
  crate's target table. `wasm-build` takes `features`, `allFeatures`,
  `noDefaultFeatures` and `profile` as `build` does, and no `targetTriple`.
- **`@napi-rs/cli` comes from your packages.** `napi-build` uses the
  `@napi-rs/cli` that Node finds from the crate's folder, so list it in the
  `devDependencies` of the crate's `package.json` or of the repository's.
  The plugin installs nothing, and a missing or older CLI fails the task with
  a message that says what to install.
- **The crate's folder needs a `package.json`.** Its `napi` settings, such as
  `binaryName`, `dtsHeader` and `constEnum`, apply as for
  `napi build --platform`. The files get the names that command gives them;
  its flags for other names, other folders or ES modules, and a separate napi
  configuration file, have no counterpart.
- **napi options.** `napi-build` takes `features`, `allFeatures`,
  `noDefaultFeatures` and `profile`, and the configuration `all-features`, as
  `build` does, for example `"profile": "release"` in the options of the
  crate's `project.json` target. It has no `targetTriple`: it builds for the
  host only, and fails where Cargo's configuration or `CARGO_BUILD_TARGET`
  picks another triple.
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
- **Generated files in the source tree**, the addon, `index.js` and
  `index.d.ts` of `napi-build` and the `pkg` folder of `wasm-build`, are
  outputs of those targets and are left out of the inputs of nx-rust's
  targets and of the crates and JS projects that depend on the crate through
  `^default`; scripts of the crate's own `package.json` still read them (see
  above).

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

| Target       | Produces                                                    | Flags                                    |
| ------------ | ----------------------------------------------------------- | ---------------------------------------- |
| `build`      | Native binaries and libraries                               | Profile, feature set, platform triple    |
| `napi-build` | The Node addon: a `.node` file plus JS and type definitions | Platform triple                          |
| `wasm-build` | The wasm package: `.wasm` plus JS glue                      | wasm target (`web`, `bundler`, `nodejs`) |

A different kind of artifact gets its own target name; a different flavour of the same artifact is a flag ([[ADR-ARTIFACT-TARGET-NAMES]]).

A crate produces an artifact when its library target has the crate type `cdylib` and the crate depends directly, through a normal dependency, on `napi` for a Node addon or on `wasm-bindgen` for a wasm package. A dependency declared for one platform only counts too. Both facts come from the `cargo metadata` report ([[DES-METADATA-REPORT]]), so the usual crate needs no configuration. An `artifacts` list in `[package.metadata.nx]` replaces the inference: it names the kinds the crate produces, and an empty list means none.

Each artifact target is built in two steps:

1. A plain cargo compile inside the batch ([[DES-BATCH]]). A non-host triple is its own group and builds only the selected crates ([[DES-FEATURE-SETS]]).
2. A post-processing task that Nx caches, with outputs outside Cargo's directories.

JS consumers depend on the artifact target, not on `^build`, and hash its outputs ([[DES-MIXED-PROJECTS]]). Generated type definitions and JS glue are declared as outputs and left out of the crate's named input `default`, which the plugin's targets of the crate and every dependent's `^default` read; the targets that Nx or other plugins give the crate's folder keep their own inputs ([[DES-NAPI]], [[DES-WASM]]). The target triple is in the key, as the host triple of the toolchain input for `napi-build` and as a constant of `wasm-build`, whose target Nx hashes; the versions of the post-processing tools are runtime inputs.
:::

:::mara design DES-WASM
:mid: 01M78FHG7FEJ8068G4VR6C06QJ
:title: wasm-build
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS

`wasm-build` compiles the crate with `cargo build` for the wasm triple, `wasm32-unknown-unknown`, and then runs the `wasm-bindgen` CLI on the result, in the two steps of [[DES-ARTIFACT-STEPS]]. The plugin does not use wasm-pack ([[ADR-NO-WASM-PACK]]). v1 targets the browser and runs no wasm tests ([[ADR-V1-SCOPE]]).

**Target.** `wasm-build` runs `@convesoft/nx-rust:cargo-outputs`, the executor of the targets whose files Nx stores ([[DES-BATCH]], "Two batch executors"). It takes `features`, `allFeatures`, `noDefaultFeatures` and `profile` and has the configuration `all-features`, as `build` does, and takes no `targetTriple`: it always builds for the wasm triple ([[DES-PLUGIN-OPTIONS]]). The wasm target is its option `wasmTarget`, one of `bundler`, `web` and `nodejs`, which it passes to the CLI as `--target`; the inferred target sets `bundler`, the CLI's own default. Its output is the folder `pkg` in the crate's folder, outside Cargo's directories, as wasm-pack names it ([[DES-OUTPUTS]]), which is left out of the crate's named input `default`, so that writing it changes the key of no target of the plugin, neither `wasm-build`'s own nor any other target of the crate, and no dependent's key that reads the crate through `^default`. The worker of nxr-0ap8n4 chose on 16 November 2026, and the maintainer confirmed on 20 November 2026, the feature and profile options, as `napi-build` has them ([[DES-NAPI]]), because a package that a web app ships is usually built with `--release`; the default `bundler` of the wasm target; and the folder `pkg`, which the plugin owns and empties on each run. To undo one, change `inferTargets` and `optionTargets` and the constants of `nx-rust/src/graph/wasm.ts`, and this paragraph. The maintainer named the option `wasmTarget` on 20 November 2026, after `wasm-bindgen --target` as `targetTriple` is named after `cargo --target`.

**Compile.** The compile step is a group of its own kind in the batch ([[DES-BATCH]]), a plain `cargo build` with `--lib`, `--target wasm32-unknown-unknown`, the feature and profile flags of the task and `--locked` in locked mode. `--lib` builds the library targets alone, in every strategy and for a group of one crate as for a shared `-p` command: the package is the crate's library, and a binary of the crate that is built for the wasm triple writes `<name>.wasm` too, over the library's where it has the library's name, so that the CLI would read the binary ([[EVD-WASM-POSTPROCESS]]). The worker of nxr-0ap8n4 added it on 16 November 2026, after the review of 02ed6a2 found that a crate with a wasm library and a `src/main.rs` failed in the CLI; to undo it, drop `--lib` from the command of `nx-rust/src/executors/command.ts`, which brings that failure back. Because of it, the reading of cargo's messages expects the library's unit alone, and the build input check names no record of a binary. Its command always passes `--keep-going` and `--message-format=json`, also for a group of one crate, since `wasm-build` has no plain cargo command that a user would compare it with, and cargo's JSON messages report the `.wasm` file that the post-processing reads. The wasm triple is a triple other than the host's, so the compile selects crates and resolves features as a `build` group for such a triple does under the workspace's strategy ([[DES-UNIFICATION]], [[DES-FEATURE-SETS]]), so that its result rests only on what its key holds and not on which other tasks share the command ([[ADR-WORKSPACE-FEATURES]]):

- **`workspace-build`**: one crate per command, with `-p`, because the whole workspace may not build for the triple ([[DES-BATCH]], "Groups of one crate"). The command resolves features for the crate and what it depends on, which the key of `workspace-build` covers with every member's manifest and digest, a superset.
- **`hakari`**: `-p` for each crate of the group where the `platforms` that graph creation recorded list both the host and `wasm32-unknown-unknown`, since the hack crate unifies the third-party features on each listed platform; otherwise, and for feature flags, one crate per command ([[DES-UNIFICATION]], "Triples that `platforms` does not list"). The target depends on `hakari-check` as every cached crate target does, and its key follows the `hakari` rule.
- **`cargo`**: `-p` for each crate with `--config 'resolver.feature-unification="workspace"'` and `-Zfeature-unification`, which resolve features for the whole workspace on the triple, and a group of one crate for `--features`; on a stable cargo the task fails with cargo's error, as every compiling target does under `cargo`.

The compile builds in a stage of its own, whatever it selects, and moves nothing into the artifact directory: the CLI reads the `.wasm` file from the stage, and the checks after cargo read the crate's records there, so that it writes no file that a `build` stores ([[DES-BATCH]], "Staged builds"). After the compile, each task whose crate passed runs the checks that follow cargo for `build`: the lockfile post-check and the check of [[DES-BUILD-INPUT-CHECK]] on the crate's records for the wasm triple, where the record of a `cdylib` is `<name>.d` beside `<name>.wasm` ([[EVD-WASM-POSTPROCESS]]). Unlike the compile of `napi-build`, it sets no variable of its own.

**Post-processing.** After the compile, for each task whose crate passed, the plugin removes the `pkg` folder of an earlier run and runs the CLI with `--target <wasmTarget> --out-dir <crate folder>/pkg` on the `.wasm` file among the files of the `compiler-artifact` message that cargo printed for the crate's `cdylib` in this compile, which cargo prints also for a fresh unit; where cargo reports no such file for the crate, or more than one, the task fails and says so. The plugin derives no file's place from the layout of Cargo's folders. The CLI runs in the workspace root, with the environment that cargo had. A task fails where the CLI fails, and where it ends without error but wrote no `<name>_bg.wasm`, and then leaves no `pkg` folder. The CLI writes `<name>.js`, `<name>.d.ts`, `<name>_bg.wasm` and `<name>_bg.wasm.d.ts`, with `<name>_bg.js` for `bundler`, and `snippets` and a `package.json` where the crate's code imports JS modules or npm packages ([[EVD-WASM-POSTPROCESS]]).

**What the step needs.** A task fails before cargo runs, with a message that names the tool or the crate and says what the user can do ([[DES-DIAGNOSTICS]]), where the crate's library shares its file name with another crate's (**Library names** of [[DES-NAPI]]), where `wasmTarget` is none of the three wasm targets, where the toolchain that the workspace root selects has no standard library for the wasm triple, where the CLI is not on the task's `PATH` in the workspace root, and where the CLI that `wasm-bindgen --version` names differs from the version of the `wasm-bindgen` crate that the crate's entry in `Cargo.lock` reaches, or where that entry reaches none or several. The lockfile task has brought `Cargo.lock` up to date before the task starts ([[DES-LOCKFILE-HASHING]]). The plugin installs nothing ([[ADR-V1-SCOPE]]).

**Key.** The cache key holds `build`'s inputs ([[DES-INPUTS]]), the options, `wasmTarget` among them, and the target, whose triple is a constant; the CLI's version, through a `runtime` input that prints what `wasm-bindgen --version` writes in the workspace root, as the task finds the CLI, or a random value where that fails; and the variables that the CLI reads, `WASM_BINDGEN_ANYREF`, `WASM_BINDGEN_EXTERNREF` and `WASM_BINDGEN_MULTI_VALUE`, each with its value and with whether it is set. The CLI turns each on by its presence, an empty value included, while Nx 24 hashes an unset and an empty `env` input alike ([[EVD-WASM-POSTPROCESS]]), so the values are `env` inputs and the same `runtime` input prints, after the version, one line per variable that says whether it is set; the CLI gets the task's environment unchanged. Nx runs that command with the task's environment, its dotenv files included, which is the environment the batch gives the CLI ([[DES-BATCH]], [[EVD-NX-24-INPUT-SEMANTICS]]); an Nx 24 target has no `env` of its own that the two could see differently. The control plane decided this on 16 November 2026 after the review of 02ed6a2 found that a package of an unset `WASM_BINDGEN_MULTI_VALUE` was restored for an empty one; there is no safe undo. The CLI reads no configuration file. It reads the `package.json` of a crate whose code imports a local JS module, which is a crate file of a project or a file of a crate behind it, and nothing else besides the `.wasm` file ([[EVD-WASM-POSTPROCESS]]).
:::

:::mara design DES-NAPI
:mid: 01M78FHG7FRRT8J6Z5NYMT12A3
:title: napi-build
:status: accepted
:satisfies: REQ-ARTIFACT-TARGETS

`napi-build` compiles the crate with `cargo build` for the host triple and then post-processes the library into the `.node` file with its JS and type definitions, in the two steps of [[DES-ARTIFACT-STEPS]]. `napi build` cannot do the second step alone: it always runs cargo itself, for the one package and with `--target`, and would compile the crate's whole dependency tree a second time into the triple's folder, with the features of that package alone ([[EVD-NAPI-POSTPROCESS]]). The plugin therefore does not run `napi build`.

**Target.** `napi-build` runs `@convesoft/nx-rust:cargo-outputs`, the executor of the targets whose files Nx stores ([[DES-BATCH]], "Two batch executors"). It takes `features`, `allFeatures`, `noDefaultFeatures` and `profile` and has the configuration `all-features`, as `build` does, and takes no `targetTriple`, since v1 builds Node addons for the host only ([[DES-PLUGIN-OPTIONS]], [[ADR-V1-SCOPE]]). The worker of nxr-tv3r95 gave it these options on 16 November 2026, and the maintainer confirmed them on 20 November 2026, because an addon that a JS package ships is usually built with `--release`; without them it would only build the dev profile. Its outputs are the addon's file, `index.js` and `index.d.ts` in the crate's folder ([[DES-OUTPUTS]]). Graph creation names the addon's file from the `binaryName` of the crate's `package.json` as `readNapiConfig` reads it, else `index`, and from the host triple that `rustc -vV` names in the workspace root, in the form of `parseTriple` of `@napi-rs/cli` 3, such as `addon.linux-x64-gnu.node`; where rustc names no host triple, the target runs uncached. Its inputs are those of `build` with the version of the CLI, `npm_new_version` and the `dtsHeaderFile` of the crate's napi settings ([[DES-INPUTS]]).

**Compile.** The compile step is a group of its own kind in the batch ([[DES-BATCH]]), which selects crates and resolves features as `build` does under the workspace's strategy ([[DES-UNIFICATION]]), without `--target` on the host: under `workspace-build` the whole workspace, and a task whose own options give it a feature set as a group of one crate. Its command always passes `--keep-going` and `--message-format=json`, also for a group of one crate, since `napi-build` has no plain cargo command that a user would compare it with, and cargo's JSON messages report the library that the post-processing copies. Its command builds in a stage and moves nothing into the artifact directory, so it writes no file that a batch stores (**Compile** below; [[DES-BATCH]], "Staged builds"). While `napi-derive` 3 expands a crate's `#[napi]` items, it writes the crate's type information into a file named after the package in the folder that `NAPI_TYPE_DEF_TMP_FOLDER` names. It writes nothing while that variable is unset or the folder is missing, and only when the crate is actually compiled: it never removes the file of a crate that is fresh or that no longer has any `#[napi]` item ([[EVD-NAPI-POSTPROCESS]]). The compile therefore starts from nothing each time:

- **An empty folder.** Before each compile, the plugin creates the folder empty, in Cargo's build directory, at a path of the group's configuration: everything the tasks of a group share ([[TERM-GROUP]]), and for a group of one crate that crate. The path is `nx-rust/napi/<hash>/types` in the build directory, with a hash of the workspace root and the compile's command, which holds the selection, the feature and profile flags and `--locked`. Nothing from an earlier run is kept, and no two configurations share a folder. The path stays the same from run to run, because cargo rebuilds every crate whose build script calls `napi_build::setup()` when it changes, also crates that this compile does not need.
- **Every napi crate forced.** The closure is the group's addon crates and every crate that they depend on through normal dependencies. The plugin asks `cargo tree -e normal` for it once per group, with the compile's selection, feature flags and `--locked`, which resolves features as the compile does, for the host. For each crate of the closure that depends on `napi-derive`, whether or not it has a task in the group, the command sets `NAPI_FORCE_BUILD_` with the package name in capitals and `-` replaced by `_` to a value of this compile's own. `napi_build::setup()` makes cargo rebuild the crate when that variable changes, so every such crate is compiled and writes its file.
- **Every file written.** After cargo, each crate that the command forced must have a file in the folder. Where one has none, every `napi-build` task whose addon is that crate or depends on it fails, with a message that names the crate and the two causes: its build script does not run `napi_build::setup()`, which alone lets the variable force it, or it no longer has any `#[napi]` item and should drop its dependency on `napi-derive` ([[DES-DIAGNOSTICS]]). Forcing cannot reach a crate whose build script does not call `setup()`: cargo keeps it fresh, and only a change to its own files compiles it again.

After the compile, each task whose crate passed runs the checks that follow cargo for `build`: the lockfile post-check and the check of [[DES-BUILD-INPUT-CHECK]] on the crate's records.

**Strategies.** The compile selects crates and resolves features as a `build` group does under the workspace's strategy ([[DES-UNIFICATION]]), so that its result rests only on what its key holds and not on which other tasks share the command ([[ADR-WORKSPACE-FEATURES]]); `cargo tree` gets the same selection and flags, so that the closure is what the command builds:

- **`workspace-build`**: `--workspace` on the host, so every crate compiles with the features of the whole workspace, as the key's digests of every member promise; a task whose own options give it a feature set runs alone with `-p`.
- **`hakari`**: `-p` for each crate of the group, and a group of one crate for feature flags and for a host or triple that `platforms` does not list. The hack crate gives every crate the same features whatever the selection. The target depends on `hakari-check` as every cached crate target does, and its key follows the `hakari` rule: the crate's own digest, the hack crate's manifest and cargo-hakari's configuration. The hack crate never counts among the crates that write type information: it can depend on `napi-derive` only to unify its features, and has no `#[napi]` item and no build script that calls `napi_build::setup()`.
- **`cargo`**: `-p` for each crate with `--config 'resolver.feature-unification="workspace"'` and `-Zfeature-unification`, which `cargo tree` gets as well, and a group of one crate for `--features`; on a stable cargo the task fails with cargo's error, as every compiling target does under `cargo`.

The compile builds in a stage of its own, whatever it selects, and moves nothing into the artifact directory: the post-processing reads the library from the stage, and the checks after cargo read the crate's records there ([[DES-BATCH]], "Staged builds"). It therefore writes no file that a `build` stores, and a `build` and a `napi-build` of one crate can share a batch ([[DES-BATCH]], "Files that a batch stores").

Only this step sets these variables. `build`, `test`, `check` and `lint` run without them, as plain cargo does. Every crate that the step forces, and every crate that depends on one of them, is therefore compiled again on each `napi-build` compile and on the next command without the variables, such as plain `cargo build`, `nx build` or rust-analyzer's check. The plugin accepts this in the shared build directory ([[ADR-NAPI-SHARED-BUILD-DIR]]). Two `nx` commands that run the compile of one group configuration at the same time empty the same folder, and one of them can then miss files or read the other's.

**Library names.** The `.node` file is a copy of the library that cargo reports for the crate's `cdylib`. Where two crates give their libraries one file name, as [[DES-OUTPUTS]] compares them ("Files of one name"), cargo builds one file for both, and the copy would give both addons one crate's functions. `build` of such crates runs uncached with a warning; a `napi-build` of such a crate fails when the task starts, before cargo runs, with a message that names both crates and says to give them different `[lib] name`s ([[DES-DIAGNOSTICS]]).

**Post-processing.** After the compile, for each task, the plugin removes the addon's file, `index.js` and `index.d.ts` of an earlier run, so that none is left where the CLI writes none, as `index.js` of an addon without exports. It copies the library that cargo reports for the crate's `cdylib` in this compile, the file with the extension of a dynamic library among the files of the crate's `compiler-artifact` message, which cargo prints also for a fresh unit, to `<binaryName>.<platform>-<arch>-<abi>.node` in the crate's folder; where cargo reports no such file for the crate, or more than one, the task fails and says so. The plugin derives no file's place from the layout of Cargo's folders: cargo writes the library into the folder of a triple where `CARGO_BUILD_TARGET`, `build.target` or `--target` selects one, also the host's, and the type folders lie in the build directory that cargo reports, which no triple changes. The review of a86d172 found that an earlier version, which copied `lib<name>.so` from the profile's folder of the artifact directory, stored the older library of a plain build under the new key where `CARGO_BUILD_TARGET` or `build.target` named the host, and failed without one; the control plane decided on 16 November 2026 to copy the reported file in every case. It then writes `index.d.ts` and `index.js` there with `generateTypeDef` and `writeJsBinding`, which the workspace's installed `@napi-rs/cli` exports, and with the crate's `napi` settings, which `readNapiConfig` reads from the crate's `package.json`. The defaults are those of `napi build --platform`, whose post-processing in 3.10.12 the plugin follows: the header, `constEnum` and `runtimeStringEnum` of the settings; the binding-target declaration where the addon has exports or the settings list a WASI target; the WASI flavours of the settings' targets for the loader, the threaded one first; the version of `npm_new_version` in the task's environment, else that of the `package.json`; and `index.d.ts` only where the crate's dependency on `napi-derive` keeps its default features or turns on `type-def`. `generateTypeDef` reads every file in the folder it is given, so the plugin gives it a folder of the task's own, `nx-rust/napi/<hash>/tasks/<crate>` beside the type folder. That folder holds only the files of the crate and of the napi crates in its own closure, whose `#[napi]` items become part of the addon. With that folder, both files were byte-identical to those of `napi build --platform` ([[EVD-NAPI-POSTPROCESS]]), and are in the plugin's tests. These three files are the target's outputs ([[DES-ARTIFACT-STEPS]]). They are left out of the crate's named input `default`, so that writing them changes the key of no target of the plugin, neither `napi-build`'s own nor any other target of the crate, and no dependent's key that reads the crate through `^default`. The targets that Nx makes from the scripts of the crate's `package.json` keep inputs of their own, which held all three files with Nx 24.0.6 also where `nx.json` defines `default` as usual, as the review of a86d172 found with Nx's graph and hasher: after `napi-build` wrote new files, the scripts `build` and `test` run again. That runs more and never less than their keys promise, and the plugin changes no target of a JS project ([[ADR-NO-RUST-BUILD-DEPS]]); the guide tells users how to leave the files out of those targets' inputs. What `napi build` takes as flags, other file names and folders, ES modules and a separate configuration file, and the WASI loader files that it writes again beside earlier ones, have no counterpart.

**What the step needs.** `napi-build` supports crates built with `napi-derive` 3 and post-processed with `@napi-rs/cli` 3, from 3.4.0, the first release that exports all three functions ([[ADR-NAPI-RS-3]]). The CLI is the package that Node resolves from the crate's folder, through the `node_modules` folders from there up, as a package manager installs it for the crate's own `package.json` or for the repository. A task fails before cargo runs, with a message that names the tool or the crate and the version ([[DES-DIAGNOSTICS]]), where Node resolves no `@napi-rs/cli` there, as for any missing tool, or one of another major or older than 3.4.0, where the crate's folder has no `package.json`, where `rustc -vV` names no host triple or Cargo's configuration or `CARGO_BUILD_TARGET` picks another triple in the workspace root, and where the installed CLI names the addon's file otherwise than the outputs of a cached task. A crate of its closure that depends on `napi-derive` of another major fails the task after `cargo tree` and before the compile.

The cache key holds the version of the `@napi-rs/cli` that Node resolves from the crate's folder and the host triple, through the toolchain input's `rustc -Vv` ([[DES-INPUTS]]). Of what `readNapiConfig` returns and `generateTypeDef` and `writeJsBinding` read, every setting comes from the crate's `package.json`, a crate file, apart from the file that `dtsHeaderFile` names, which `generateTypeDef` reads from the crate's folder. Graph creation reads that path from the `package.json` and puts the file into the target's inputs as a fileset that also covers an ignored file. A cached task fails before cargo where the file lies outside the repository, where Nx cannot hash it, and where the `package.json` now names another file than the graph's inputs, as after a change that the Nx daemon has not seen. The review of a86d172 found that a header outside the crate's folder reached no key, so that Nx restored `index.d.ts` with the old header; the control plane decided on 16 November 2026 that what the plugin cannot cover must fail. A separate napi configuration file, which `napi build` reads only with `--config-path`, is never read. v1 builds for the host triple only: cross-compiling takes one target per command and zig or cargo-xwin, and is normally a CI matrix.

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
