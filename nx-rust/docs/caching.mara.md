# Caching

> **Status:** specified, not implemented yet.

Nx caches the **result** of a Rust task and, for a few targets, its **final
artifacts**. It never stores or restores Cargo's intermediate files: Cargo owns
its build directory, and Cargo's own incremental build does the rest.

The rule behind every choice on this page is cache correctness over cache
ambition. Running more than a cache key promises is fine. Running less is not.

## What is in a cache key

| Input                 | Details                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crate files           | Every file in the crate's folder, except the files a `napi-build` or `wasm-build` target generates there                                                                                              |
| Workspace files       | The root `Cargo.toml`, and every `rust-toolchain.toml` and `.cargo/config.toml` between the crate and the repository root                                                                             |
| Dependency sources    | The same files of every crate this one depends on, including dev- and build-dependencies. A path dependency that is not an Nx project counts with its whole folder.                                   |
| External dependencies | The locked versions of the external crates this crate uses. Until per-crate hashing is specified, the whole `Cargo.lock`.                                                                             |
| Tool configuration    | `clippy.toml` for `lint`, `rustfmt.toml` for `fmt-check`, and `.config/nextest.toml` for tests that nextest runs                                                                                      |
| Environment           | A fixed list of variables that change Rust builds, such as `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUSTC_WRAPPER`, `CARGO_BUILD_TARGET`, `CC` and `CFLAGS`. [[DES-INPUTS]] has the full list. You can add more. |
| Toolchain             | The output of `rustc -Vv`, run in the root folder of the crate's workspace                                                                                                                            |
| Options               | Features, profile and target triple                                                                                                                                                                   |

Never all environment variables: a key that changes with every shell is no
cache at all.

The whole crate folder is an input, so a README, a template or a migration
that a macro or build script reads is covered, at the price that a change to
any file in the crate runs its tasks again.

If a build script or test reads something outside this list, add it: an
environment variable, or a command whose output should be part of the key.
Typical cases are a system library version or a code generator.

```toml
# rust/Cargo.toml
[workspace.metadata.nx]
env = ["PROTOC", "DATABASE_URL"]
runtimeInputs = ["protoc --version"]
```

Files **outside** the crate that a build script names with
`cargo::rerun-if-changed`, or that a macro such as `include_str!` pulls in, are
not picked up automatically yet ([[REQ-BUILD-SCRIPT-INPUTS]]).

## Where cargo runs

The plugin starts every cargo command in the root folder of the crate's
workspace. rustup and Cargo choose `rust-toolchain.toml` and
`.cargo/config.toml` by the folder a command starts in, so the files that count
are those at the workspace root and above it.

- A toolchain or configuration file **inside a member crate** applies only to a
  `cargo` you start in that crate's folder. It does not apply to Nx runs,
  although a change to it still changes the cache key.
- The toolchain in the key is whatever `rustc -Vv` reports in the workspace
  root. `RUSTUP_TOOLCHAIN`, `rustup override` and a toolchain installed without
  rustup are all respected.
- Cargo may create or update `Cargo.lock` during a task, as it does for plain
  `cargo`. With the `locked` option, or `NX_RUST_LOCKED=true` for one run,
  every cargo command of a task passes `--locked` and fails instead. Three
  targets never pass it: `update`, which exists to change the lockfile, and
  `fmt` and `fmt-check`, because `cargo fmt` reads no lockfile and rejects the
  flag. Building the project graph never touches `Cargo.lock`.

## What is stored

| Target                                                            | Cached | Stored                                                            |
| ----------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `check`, `lint`, `fmt-check`, `test`                              | Yes    | Nothing but the result and the terminal output                    |
| `build`                                                           | Yes    | Final artifacts only: executables, `cdylib` and `staticlib` files |
| `doc`, on the workspace project                                   | Yes    | The workspace's whole doc folder                                  |
| `fmt`, `bench`, `run`, `audit`, `deny`, `update`, release publish | No     | Nothing                                                           |

A cache hit on `test` means "these tests passed for exactly these inputs", and
nothing is copied. A cache hit on `build` restores the binary. It does not
restore `rlib` files or anything else Cargo would need to continue compiling;
the next real compile uses whatever is in the build directory.

Nx can store only files inside the repository. If Cargo's artifact directory
lies outside it, for example through `CARGO_TARGET_DIR`, `build` and `doc` run
uncached, and the plugin says so. `doc` also runs uncached, with the same
notice, when two workspaces share one artifact directory: restoring one
workspace's doc folder would delete the other's pages.

## Cargo's two directories

Since Cargo 1.91, intermediate files and final artifacts can live in separate
directories:

```toml
# .cargo/config.toml
[build]
build-dir = "{cargo-cache-home}/build/{workspace-path-hash}" # intermediate files
target-dir = "target" # final artifacts
```

- Nx outputs point only into the **artifact directory**.
- The **build directory** should sit outside the repository. Nx never caches
  it; in CI, cache it with your CI system's cache
  ([Continuous integration](ci.mara.md)).
- The layout of the build directory is Cargo's business and has changed between
  Cargo versions, so the plugin never names a path inside it.
- Splitting the directories does not remove lock contention: there is still one
  lock per build directory. Batching deals with that
  ([Batching and features](execution.mara.md)).

These settings live in `.cargo/config.toml`, so plain `cargo` and rust-analyzer
use the same directories as the plugin, and a build through one is reused by
the other.

## Sharing the cache between machines

The toolchain input includes the host triple, and the target triple is an
option, so a result from Linux is never restored on macOS. Two machines with
the same triple can still differ in system libraries or linkers. If your crates
link against system libraries and you share the cache between unlike machines,
add an input that tells them apart ([[RISK-HOST-ENVIRONMENT]]).

## Requirements

:::mara requirement REQ-INPUT-FILES
:mid: 01M78FHG7F5EMJYNVQRAZX9C63
:title: Hash every file that can change a crate's result
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of a crate's cached target covers every file in the crate's folder, the workspace files that apply to it, every `rust-toolchain.toml` and `.cargo/config.toml` at any level between the crate and the repository root, the configuration files of the tool the target runs, and the same files of every crate it depends on through normal, build or dev-dependencies. A path dependency that has no Nx project contributes its whole folder to the key of every crate that depends on it. Inputs name real paths per project, because a repository can hold several lockfiles and toolchain files.
:::

:::mara requirement REQ-ENV-ALLOWLIST
:mid: 01M78FHG7FB30V9FZNFF0TFHC1
:title: Hash a fixed, extendable list of environment variables
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of a cached target includes the values of a fixed list of environment variables that are known to change Rust builds. A repository can add variables and commands whose output joins the key. The plugin never hashes the whole environment.
:::

:::mara requirement REQ-TOOLCHAIN-KEY
:mid: 01M78FHG7FRC3KSSDACETE745J
:title: Key each task on the toolchain its crate uses
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of a cached target includes the identity of the Rust toolchain that the plugin's cargo commands use for that crate, which is the one that applies in the root folder of its workspace. Two crates that use different toolchains never share a toolchain identity in their keys, and a toolchain update changes the keys of exactly the crates that use it.
:::

:::mara requirement REQ-CACHE-OUTPUTS
:mid: 01M78FHG7FR6HKPFNAN6P607RX
:title: Cache results and final artifacts only
:status: accepted
:satisfies: NEED-CORRECT-CACHE
:satisfies: NEED-CARGO-UNCHANGED

The Nx cache holds task results and final artifacts. It never stores a file from Cargo's build directory, and restoring from the cache never writes into that directory.
:::

:::mara requirement REQ-CARGO-UNCHANGED
:mid: 01M78FHG7F5VCD6HDS9R6HDS3Z
:title: Leave plain cargo behaviour unchanged
:status: accepted
:satisfies: NEED-CARGO-UNCHANGED

A cargo command that the plugin runs uses the same build directory, the same artifact directory and the same default flags as the equivalent plain `cargo` command in that workspace, so that builds through Nx and builds through plain cargo or rust-analyzer reuse each other's work. The plugin generates no files inside crates.
:::

:::mara requirement REQ-BUILD-SCRIPT-INPUTS
:mid: 01M78FHG7FC47G6VCHVQBY6JT2
:title: Hash files outside the crate that build scripts and macros read
:status: draft
:satisfies: NEED-CORRECT-CACHE
:mitigates: RISK-UNDECLARED-INPUTS

Files outside a crate's folder that its build script declares with `cargo::rerun-if-changed`, or that its source code includes with macros such as `include_str!`, are part of the cache key of the crate that reads them. Files inside the crate's folder are inputs already ([[REQ-INPUT-FILES]]).

Open: how the plugin learns these paths without running the build, and what it does on the first run. The design discussion of 12 November 2026 named this area without choosing a mechanism.
:::

## Design

:::mara design DES-INPUTS
:mid: 01M78FHG7FX4MX7J2W6TW28PDP
:title: Cache inputs
:status: accepted
:satisfies: REQ-INPUT-FILES
:satisfies: REQ-ENV-ALLOWLIST
:satisfies: REQ-TOOLCHAIN-KEY

Every cached target declares its inputs as Nx inputs. The plugin has no custom hasher ([[ADR-DECLARED-INPUTS]]).

| Input                 | Declared as                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crate files           | One fileset for the crate's project: every file under the crate's folder that belongs to no nested project, without the files an artifact target generates there ([[DES-ARTIFACT-STEPS]]). A list of source folders would miss files that macros and build scripts read, such as a README, templates or migrations ([[ADR-DECLARED-INPUTS]]).                                                                                                |
| Workspace files       | The real paths of the root `Cargo.toml` of the crate's workspace and of every `rust-toolchain.toml`, `rust-toolchain` and `.cargo/config.toml` between the crate and the repository root. A repository-wide named input cannot point at several lockfiles, so these are per project.                                                                                                                                                         |
| Dependency sources    | The crate-file inputs of all dependencies, through `^` inputs over the edges in [[DES-PROJECT-GRAPH]].                                                                                                                                                                                                                                                                                                                                       |
| Path dependencies     | For a path dependency that is no Nx project, because it is excluded, ignored or outside the repository, a fileset for its folder on every crate that depends on it, directly or through other crates. Where Nx cannot see those files, the plugin warns ([[DES-DIAGNOSTICS]]).                                                                                                                                                               |
| External dependencies | [[REQ-EXTERNAL-DEPS]]; the mechanism is [[DES-LOCKFILE-HASHING]]. Until that is specified, the workspace's whole `Cargo.lock` is an input.                                                                                                                                                                                                                                                                                                   |
| Tool configuration    | On `lint`, every `clippy.toml` and `.clippy.toml` between the crate and the repository root. On `fmt-check`, every `rustfmt.toml` and `.rustfmt.toml` on the same path. On `test` with the nextest runner, the workspace's `.config/nextest.toml`.                                                                                                                                                                                           |
| Environment           | One `env` input per variable in the list below, plus the variables the repository adds.                                                                                                                                                                                                                                                                                                                                                      |
| Toolchain             | A `runtime` input that runs `rustc -Vv` in the root folder of the crate's workspace, where its cargo commands run ([[DES-INVOCATION]]). The toolchain is thereby resolved as cargo will resolve it: through rustup's toolchain files, overrides and `RUSTUP_TOOLCHAIN` where rustup is installed, and through `PATH` where it is not. The folder is part of the command, so workspaces with different toolchains never share one evaluation. |
| Options               | Features, profile and target triple are target options, which Nx hashes.                                                                                                                                                                                                                                                                                                                                                                     |
| Extra                 | Runtime commands the repository adds.                                                                                                                                                                                                                                                                                                                                                                                                        |

The environment list:

- `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`, `RUSTDOCFLAGS`, `CARGO_ENCODED_RUSTDOCFLAGS`, `RUSTC`, `RUSTC_WRAPPER`, `RUSTC_WORKSPACE_WRAPPER`, `RUSTC_BOOTSTRAP` and `CARGO_BUILD_TARGET`.
- The `CARGO_BUILD_*` forms of the same settings: `CARGO_BUILD_RUSTFLAGS`, `CARGO_BUILD_RUSTDOCFLAGS`, `CARGO_BUILD_RUSTC`, `CARGO_BUILD_RUSTC_WRAPPER` and `CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER`.
- `CARGO_TARGET_<TRIPLE>_LINKER`, `CARGO_TARGET_<TRIPLE>_RUSTFLAGS` and `CARGO_TARGET_<TRIPLE>_RUNNER`, for the host triple and for every target triple a target is configured with.
- `CC`, `CXX`, `AR`, `CFLAGS`, `CXXFLAGS`, `PKG_CONFIG_PATH` and `MACOSX_DEPLOYMENT_TARGET`.
- `OPENSSL_DIR`, `OPENSSL_LIB_DIR`, `OPENSSL_INCLUDE_DIR`, `OPENSSL_STATIC` and `OPENSSL_NO_VENDOR`.
- `CLIPPY_CONF_DIR`, on `lint` only.
- `CARGO_BUILD_WARNINGS`, on every target that compiles: `build`, `check`, `lint`, `test`, `bench`, `run`, `doc` and the artifact targets, the uncached `bench` and `run` included. Cargo's `build.warnings` setting turns warnings into failures, so a result that passed with warnings allowed must not be restored where they are denied ([[EVD-CARGO-TARGET-COMMANDS]]).

A `rust-toolchain.toml` or `.cargo/config.toml` inside a member crate is hashed with the crate's files, although it does not apply to the commands the plugin runs ([[DES-INVOCATION]]). An input the plugin cannot see is the repository's to declare, through the extra environment variables and commands ([[RISK-UNDECLARED-INPUTS]]).
:::

:::mara design DES-OUTPUTS
:mid: 01M78FHG7FRNE981T1QJYYVWC4
:title: Cached outputs
:status: accepted
:satisfies: REQ-CACHE-OUTPUTS

| Target                                                            | Cached | Outputs                                                                                                                                  |
| ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `check`, `lint`, `fmt-check`, `test`                              | Yes    | None; the result only                                                                                                                    |
| `build`                                                           | Yes    | Final artifacts only, in the [[TERM-ARTIFACT-DIR]]: the executables of `bin` targets and the `cdylib` and `staticlib` files of a library |
| `doc`, on the workspace project                                   | Yes    | The whole `doc` folder of the workspace's [[TERM-ARTIFACT-DIR]] ([[DES-WORKSPACE-TARGETS]])                                              |
| `fmt`, `bench`, `run`, `audit`, `deny`, `update`, release publish | No     | None                                                                                                                                     |

`build` does not list `rlib` or `dylib` files or other files that only Cargo consumes, so a cache hit never puts such files back ([[ADR-RESULTS-ONLY-CACHE]]).

Nx can store only files inside the repository. The `cargo metadata` report names the artifact directory of each workspace. When it lies outside the repository, the `build` and `doc` targets of that workspace are not cached, and the plugin says so when the graph is created ([[DES-DIAGNOSTICS]]). Targets that store only a result stay cached, and so do the artifact targets, whose outputs lie outside Cargo's directories ([[DES-ARTIFACT-STEPS]]).

When the reports of two or more workspaces name the same artifact directory, the `doc` targets of those workspaces are not cached either, and the plugin says so in the same way. Nx restores a folder output by replacing it, so restoring one workspace's `doc` folder would delete the pages of the others ([[EVD-NX-24-TARGETS]]).
:::

:::mara design DES-BUILD-DIRS
:mid: 01M78FHG7FMKCDSEX3Y6Q65F4Y
:title: Build and artifact directories
:status: accepted
:satisfies: REQ-CACHE-OUTPUTS
:satisfies: REQ-CARGO-UNCHANGED

Cargo 1.91 and later can keep intermediate files in a [[TERM-BUILD-DIR]] (`build.build-dir`) apart from final artifacts in the [[TERM-ARTIFACT-DIR]] (`build.target-dir`). The plugin relies on that split:

- Nx outputs point only into the artifact directory.
- The recommended build directory sits outside the repository. CI caches it; Nx never does, wherever it lies.
- The plugin never references a path inside the build directory, because that layout is internal to Cargo and changed in Cargo 1.100.
- By default the plugin does not set either directory for its own commands. It uses what Cargo's configuration says, so plain cargo and rust-analyzer share both directories with it. The one exception is the opt-in separate build directory for coverage builds ([[DES-BASELINE]]).

The split does not remove lock contention: there is one lock per build directory. Running tasks as few cargo invocations as possible is [[DES-BATCH]].
:::

:::mara design DES-INVOCATION
:mid: 01M78NVF8ETK5PJ64FK45AEDFB
:title: How the plugin invokes cargo
:status: accepted
:satisfies: REQ-CARGO-UNCHANGED
:satisfies: REQ-NO-MANIFEST-WRITES

Every cargo command of a task starts in the root folder of the crate's workspace and addresses crates by their real package name and manifest path. rustup and Cargo choose the toolchain file and the configuration files by the folder a command starts in and its parents, so all tasks of a workspace use one toolchain and one configuration, which a single invocation for a group needs ([[DES-BATCH]]). A `rust-toolchain.toml` or `.cargo/config.toml` inside a member crate applies only to a cargo that the user starts in that folder, not to the plugin's commands ([[ADR-WORKSPACE-ROOT]]).

The plugin adds no flag that changes what Cargo builds or where. It sets no build or artifact directory ([[DES-BUILD-DIRS]]) and passes only what the target's options ask for.

By default the plugin does not pass `--locked`. Cargo may then create or update `Cargo.lock` during a task, exactly as it does for the same plain cargo command. That is Cargo's write, not the plugin's. With the `locked` option on, every cargo command of a task passes `--locked` and fails instead of changing the lockfile. Two kinds of command never pass the flag: `update`, whose purpose is to change the lockfile and which `--locked` fails whenever the lockfile would change, and the `cargo fmt` of `fmt` and `fmt-check`, which resolves no dependencies and rejects `--locked`. cargo-deny takes `--locked` like a cargo command, and cargo-audit only reads the lockfile ([[DES-WORKSPACE-TARGETS]]). Creating the graph never touches `Cargo.lock`, with or without the option, because its report is requested with `--no-deps` ([[DES-METADATA-REPORT]]). The environment variable `NX_RUST_LOCKED`, set to `true` or `false`, replaces the option for one run, which is how a pipeline switches it on without changing what developers get.
:::
