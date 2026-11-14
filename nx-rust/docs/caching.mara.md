# Caching

> **Status:** each task's cargo command starts in the workspace root, and
> locked mode works as [Where cargo runs](#where-cargo-runs) describes. The
> inferred targets declare the inputs and outputs of this page, those that it
> caches are cached, and the `lockfile` task keys each crate on the packages
> it reaches in `Cargo.lock`. `envInputs`, `runtimeInputs` and `fileInputs`
> work, and `build` checks its dependency files against its inputs. Every
> workspace counts as using the `workspace-build` strategy (nxr-k64tm5).

Nx caches the **result** of a Rust task and, for a few targets, its **final
artifacts**. It never stores or restores Cargo's intermediate files: Cargo owns
its build directory, and Cargo's own incremental build does the rest.

The rule behind every choice on this page is cache correctness over cache
ambition. Running more than a cache key promises is fine. Running less is not.

## What is in a cache key

| Input                 | Details                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crate files           | Every file in the crate's folder, except the files a `napi-build` or `wasm-build` target generates there, and except `Cargo.lock` when the crate sits at the root of its workspace                                                                                                                             |
| Workspace files       | The root `Cargo.toml`, and every `rust-toolchain.toml`, `.cargo/config.toml` and `.cargo/config` between the crate and the repository root                                                                                                                                                                     |
| Dependency sources    | The same files of every crate this one depends on, including dev- and build-dependencies, with the root `Cargo.toml` of its workspace. A path dependency that is not an Nx project counts with its whole folder and the files it declares, and a crate with a project behind it like a dependency of this one. |
| Declared files        | Files outside the crate's folder that its `Cargo.toml` or its workspace's lists under `fileInputs`, and those that the crates it depends on list ([below](#files-outside-the-crate))                                                                                                                           |
| External dependencies | The locked version, source and checksum of every package the crate reaches in its workspace's `Cargo.lock`, after the workspace's `lockfile` task has let cargo bring the file up to date                                                                                                                      |
| Member manifests      | With the `cargo` or `workspace-build` feature strategy, the `Cargo.toml` of every member of the workspace                                                                                                                                                                                                      |
| Plugin                | The version of nx-rust and, where your JS lockfile lists nx-rust, the npm packages it depends on                                                                                                                                                                                                               |
| Tool configuration    | `clippy.toml` for `lint`, `rustfmt.toml` for `fmt-check`, and `.config/nextest.toml` for tests that nextest runs                                                                                                                                                                                               |
| Environment           | A fixed list of variables that change Rust builds, such as `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUSTC_WRAPPER`, `CARGO_BUILD_TARGET`, `CC` and `CFLAGS`, and every `CARGO_PROFILE_*` and `CARGO_TARGET_*` variable but `CARGO_TARGET_DIR`. [[DES-INPUTS]] has the full list. You can add more.                        |
| Toolchain             | The output of `rustc -Vv`, run in the root folder of the crate's workspace                                                                                                                                                                                                                                     |
| Target triples        | On `build` and `doc`, the triples that Cargo's configuration and `CARGO_BUILD_TARGET` pick when the task runs, also from a configuration file outside the repository                                                                                                                                           |
| Options               | Features, profile and target triple                                                                                                                                                                                                                                                                            |

Never all environment variables: a key that changes with every shell is no
cache at all.

Entries of the `default` named input in your `nx.json` that are not patterns
under `{projectRoot}`, such as `sharedGlobals`, count for every crate as well.
A crate's own folder counts whole whatever your `default` says about it.

Nx also puts into every key what no input names: `nx.json`, and the
configuration of the crate's project and of the crates it depends on, such as
the options of each of their targets. A changed option of one target, also one
from a `project.json` or `targetDefaults`, runs every task of that crate and
of the crates that depend on it again, and any change to `nx.json` runs them
all again. That costs time, never a stale result.

A crate's warnings count too: when a warning that the plugin prints at the
start of the crate's tasks appears or goes away, those tasks and the tasks of
the crates that depend on it run again, so that a result restored from the
cache shows the warnings that apply now
([Error messages and warnings](setup.mara.md#error-messages-and-warnings)). A
warning that names a path outside the repository, such as your Cargo home,
gives machines with different such paths different keys for the crates
concerned.

A crate that `[patch]`, `[replace]` or `paths` may put in place of a
dependency counts as a dependency of every crate that may use it, and so does
a crate with a project that such a crate without a project depends on by path
([The dependency graph](workspaces.mara.md#the-dependency-graph)).

The whole crate folder is an input, so a README, a template or a migration
that a macro or build script reads is covered, at the price that a change to
any file in the crate runs its tasks again. You can leave files out with a
negated pattern in a target's `inputs`
([Configuration](configuration.mara.md#changing-an-inferred-target)). That is
your statement that the target does not read them: if a macro such as
`include_str!`, a build script or a test still reads an excluded file, Nx
restores results produced with its old content.

If a build script or test reads something outside this list, add it: a file
([below](#files-outside-the-crate)), an environment variable, or a command
whose output should be part of the key. Typical cases are a system library
version or a code generator.

```toml
# rust/Cargo.toml
[workspace.metadata.nx]
envInputs = ["PROTOC", "DATABASE_URL"]
runtimeInputs = ["protoc --version"]
```

`envInputs` and `runtimeInputs` work in the plugin options for every crate, in
`[workspace.metadata.nx]` for the members of a workspace and in
`[package.metadata.nx]` for one crate. The three add up, and what a crate adds
also reaches the keys of the crates that depend on it, because they compile it
too. An input that you add to one target's `inputs` stays with that target
([Configuration](configuration.mara.md#changing-an-inferred-target)).

`nx affected` selects tasks by changed files only. A change that reaches a
task only through an environment variable or a command's output, such as a new
`RUSTFLAGS` or a toolchain update without a change to a `rust-toolchain.toml`,
changes the keys but selects no task. No stale result is restored, because a
task that runs misses the cache, but the tasks that the change reaches do not
run. After such a change, for example when your pipeline moves to a new
toolchain, run the targets for every project with `nx run-many` instead of
`nx affected`: the tasks whose keys stayed the same are restored from the
cache. A toolchain pinned to a version in `rust-toolchain.toml` changes only
with a commit, which `nx affected` sees.

## Files outside the crate

A build script can name files outside its crate's folder with
`cargo::rerun-if-changed`, and a macro such as `include_str!` can pull them in,
for example protocol definitions that several crates share. The plugin does
not guess these paths: list them under `fileInputs`, as glob patterns relative
to the `Cargo.toml` that holds them.

```toml
# rust/crates/api/Cargo.toml
[package.metadata.nx]
fileInputs = ["../../../proto/**/*.proto", "../../../README.md"]
```

- The files count for every cached target of the crate and of every crate that
  depends on it, from the first run on, and `nx affected` sees a change to
  them.
- In `[workspace.metadata.nx]` the patterns apply to every member. A crate has
  its workspace's patterns and its own.
- Files that Git ignores can be listed too, and are hashed. `nx affected` does
  not see a change to a file that the root `.gitignore` or `.nxignore` ignores,
  though; `nx run-many` still runs the tasks again, because their keys change.
- A symbolic link in a pattern before its first wildcard counts as the file or
  folder it points to. A wildcard does not follow links: `**` skips a linked
  folder, and Nx keeps the first hash of a linked file that `*` matches, so
  list the linked folder or file itself.
- A pattern that leaves the repository, also through a symbolic link, or
  points into Cargo's build or artifact directory, stops graph creation, and
  so does a `..` after a wildcard. Nx does not track files outside the
  repository; cover those with a command under `runtimeInputs`.

Whenever `build` runs cargo, also when nothing needs compiling, the plugin
reads the dependency files that Cargo writes beside the crate's library and
binaries, such as `target/debug/libapi.d` and `target/debug/api.d`. If one
names a file in the repository that none of the task's inputs covers, the task
fails, lists the files and shows the `fileInputs` line to add. Where Cargo's
configuration or `CARGO_BUILD_TARGET` picks the target triple, it reads them
in that triple's folder. A record that the plugin cannot attribute with
certainty, for example for a triple whose folder it cannot name, such as
`host-tuple`, is not read. With
`build.dep-info-basedir` set, Cargo records a path that runs through a symbolic
link and then `..` as the file that its text names, so the check can name a
file that was not read; the `fileInputs` line it shows still lets the build
pass. The other crates built in the same cargo call keep their results. A failed task is never cached as a success;
with `NX_CACHE_FAILURES=true`, Nx replays the failure until its key changes,
which adding the line does.

Other targets are not checked this way, because Cargo keeps their records only
inside its build directory. A file that only tests read is yours to list. So is
a file that a proc macro opens by itself: Cargo does not track it either, and
plain `cargo` will not rebuild when it changes.

## Lockfile changes

A crate's key does not hold the whole `Cargo.lock`, only the packages the crate
reaches in it. Each workspace has a `lockfile` task that runs in every Nx run
that includes one of its crates' cached tasks. It runs
`cargo update --workspace`, which leaves an up-to-date lockfile alone and
updates an outdated one exactly as your next `cargo build` would. It then
writes one digest per crate into `.nx/workspace-data/nx-rust/lockfile`. Every
cached task of a crate except `fmt-check` waits for it and reads the crate's
digest. A digest covers the version, source and checksum of each package the
crate depends on, directly or through other crates, for every platform and
feature set, and which version of a package each of them uses.

```text
rust/Cargo.lock: ryu 1.0.23 -> 1.0.24, which only "api" reaches

nx affected -t test
  rust:lockfile   runs and writes new digests
  api:test        runs: its digest changed
  core:test       restored from the cache: its digest is the same
```

After a change to `Cargo.lock` or to a manifest, `nx affected` selects the
cached tasks of every crate of that workspace, because Nx cannot tell which
ones the change reaches. The keys can: the crates whose digest stayed the same
are restored from the cache, so they cost a lookup, not a build.

- Add a dependency and run `nx build` as you would run `cargo build`: the
  `lockfile` task lets cargo add it to `Cargo.lock` first, and the crates are
  keyed on the result. A missing `Cargo.lock` is created the same way.
- In locked mode the `lockfile` task fails on an outdated or missing
  `Cargo.lock` with cargo's message, and no task of that workspace's crates
  runs.
- The `lockfile` task costs one cargo call per workspace in every run, also
  when everything else is restored from the cache. On a machine whose Cargo
  home is empty, that call fetches the registry index entries the build would
  fetch anyway.
- Features are not part of the digest. `Cargo.lock` does not record them; the
  features a crate asks for are in its `Cargo.toml` and its target options,
  which are inputs anyway.
- A `Cargo.lock` that git ignores is read all the same.
- With `--exclude-task-dependencies` the `lockfile` task does not run. The
  crates' cached tasks then run and store nothing that a later run restores.
- A cached crate task that runs without the `lockfile` task in a run that does
  not exclude task dependencies, for example because a `project.json` replaces
  its `dependsOn`, fails before cargo runs: its key would hold no digest. Keep
  the dependency with `"..."`, as in `"dependsOn": ["...", "^codegen"]`.
- A cached task fails when `Cargo.lock` changes while it runs, for example
  because you edited a manifest during the run, or because another `nx`
  command that ran at the same time updated the lockfile, so that its key no
  longer describes what cargo built. Nx stores nothing for it; run it again.
- A workspace whose root `Cargo.toml` Nx hands to no entry of the plugin, for
  example because an `exclude` of the plugin's entry in `nx.json` names it,
  has no `lockfile` task. Its crates' `build`, `check`, `lint` and `test` then
  run uncached, and graph creation warns.
- If the workspace folder also is a JS project with a script or target called
  `lockfile`, that one replaces the plugin's task, as it would any target of
  that name. Rename the plugin's task through `targetNames`
  ([Configuration](configuration.mara.md)).

A change to your JS lockfile changes Rust keys only where it changes nx-rust or
a package that nx-rust depends on. Which Rust tasks `nx affected` then selects
depends on whether your JS lockfile lists nx-rust. If it does not, the Rust
targets name no npm package, and a JS lockfile change selects none of them. If
it does, the choice is `projectsAffectedByDependencyUpdates` in the `@nx/js`
section of `pluginsConfig` in `nx.json`. Nx's default, `all`, selects every
Rust task after any change to the JS lockfile, and those whose keys did not
change are restored from the cache. With `auto`, Nx selects them only when the
change reaches nx-rust or what it depends on.

A Cargo workspace or crate at the repository root is the exception, because it
shares its folder with your JS package. Nx counts the JS lockfile as
configuration of the project there, so any change to it selects that project's
tasks and the tasks of its crates. The folder is also an input, `package.json`
and the JS lockfile with it, and Nx links the project to the npm packages that
`package.json` lists. A change to either file therefore changes the keys of
`doc` on a workspace project there, of every cached target of a crate at the
root and of every crate that depends on that crate, directly or through other
crates: those tasks run, and so does the uncached `lockfile` task. The tasks of
the other crates are restored from the cache. A Cargo workspace in a
subfolder, such as `rust/`, avoids both.

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
  rustup are all respected. Nx runs `rustc -Vv` with each task's environment, so
  a `RUSTUP_TOOLCHAIN` in a crate's `.env` gives that crate's tasks another
  toolchain, in their keys and when they run. Plain `cargo` does not read
  `.env` files. If that toolchain is not installed, computing the
  key does not install it: the task gets a key that matches no stored result
  and runs, and its cargo installs the toolchain as plain `cargo` would.
- Cargo may create or update `Cargo.lock` during a task, as it does for plain
  `cargo`. With the `locked` option, or `NX_RUST_LOCKED=true` for one run,
  every cargo command of a task passes `--locked` and fails instead. Three
  targets never pass it: `update`, which exists to change the lockfile, and
  `fmt` and `fmt-check`, because `cargo fmt` reads no lockfile and rejects the
  flag. `audit` runs cargo-audit, which only reads `Cargo.lock` and has no such
  flag. Building the project graph never touches `Cargo.lock`.
- In locked mode, every run in which the `lockfile` task runs fails on an
  outdated `Cargo.lock`, also when every crate task is then restored from the
  cache. A run of `fmt` or `fmt-check` alone, one with
  `--exclude-task-dependencies` and one without Rust tasks do not check it; for
  that, see
  [Continuous integration](ci.mara.md#cache-two-things-in-two-places).

## What is stored

| Target                                                            | Cached | Stored                                                            |
| ----------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `check`, `lint`, `fmt-check`, `test`                              | Yes    | Nothing but the result and the terminal output                    |
| `build`                                                           | Yes    | Final artifacts only: executables, `cdylib` and `staticlib` files |
| `doc`, on the workspace project                                   | Yes    | The workspace's whole doc folder                                  |
| `lockfile`, on the workspace project                              | No     | Nothing; its digests stay in `.nx/workspace-data`                 |
| `fmt`, `bench`, `run`, `audit`, `deny`, `update`, release publish | No     | Nothing                                                           |

A cache hit on `test` means "these tests passed for exactly these inputs", and
nothing is copied. A cache hit on `build` restores the binary. It does not
restore `rlib` files or anything else Cargo would need to continue compiling;
the next real compile uses whatever is in the build directory.

Nx can store only files inside the repository. If Cargo's artifact directory
lies outside it, for example through `CARGO_TARGET_DIR` or a symbolic link,
`build` and `doc` run uncached, and the plugin says so. The plugin follows
symbolic links to the folder that cargo writes to, and names that folder. `doc` also runs uncached, with the same
notice, when two workspaces share one artifact directory: restoring one
workspace's doc folder would delete the other's pages.

The plugin has to know the folder that cargo writes to:

- Where `build.target` in Cargo's configuration or `CARGO_BUILD_TARGET`
  picks the target triple, `build` and `doc` store the files in that
  triple's folder, such as `target/x86_64-unknown-linux-musl/release`, and a
  list of triples in each triple's folder. The `targetTriple` option wins
  over both, as `--target` does for cargo.
- The plugin reads `CARGO_BUILD_TARGET` when Nx creates the graph. Set it in
  the shell or in the repository's root `.env`, not in a `.env` file that
  Nx loads only for a task, such as one in the crate's folder: there a
  cached `build` or `doc` fails before cargo runs. Pass
  `--targetTriple=<triple>` instead.
- The Nx daemon does not watch Cargo configuration files outside the
  repository, such as `~/.cargo/config.toml`. After you change the triple
  there, a cached `build` or `doc` neither restores the result of the old
  triple nor runs: it fails before cargo runs until you run `nx reset`, or
  stop the daemon with `nx daemon --stop`.
- Where the configuration picks `host-tuple`, a target specification file,
  or a triple only in a file that `include` adds, `build` and `doc` run
  uncached, and the plugin says so. Give the triple as the `targetTriple`
  option of those targets to cache them.
- `build` and `doc` refuse the profiles `dev`, `test` and `bench`, whose
  artifacts Cargo puts in the folders `debug` and `release`. Leave `profile`
  unset for `dev` and `test`, and use `release` for `bench`.
- A `targetDefaults` entry in `nx.json` that sets `cache: true` on a target
  that the plugin leaves uncached fails graph creation
  ([Target defaults that reach Rust targets](targets.mara.md#target-defaults-that-reach-rust-targets)).
  A `project.json` or `package.json` that does so makes the task fail before
  cargo runs, with the reason.

## Cargo's two directories

Since Cargo 1.91, intermediate files and final artifacts can live in separate
directories:

```toml
# .cargo/config.toml
[build]
build-dir = "{cargo-cache-home}/build/{workspace-path-hash}" # intermediate files
target-dir = "target" # final artifacts
```

- Of Cargo's two directories, Nx outputs point only into the **artifact
  directory**.
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

The cache key of a crate's cached target covers every file in the crate's folder, except the `Cargo.lock` of its workspace when the crate sits at the workspace root, whose packages reach the key as [[REQ-EXTERNAL-DEPS]] says, and it covers the workspace files that apply to it, every `rust-toolchain.toml`, `.cargo/config.toml` and `.cargo/config` at any level between the crate and the repository root, the configuration files of the tool the target runs, and the files of every crate it depends on through normal, build or dev-dependencies, with the root manifest of each such crate's workspace, from which that crate inherits fields. A path dependency that has no Nx project contributes its whole folder to the key of every crate that depends on it. A crate that `[patch]`, `[replace]` or `paths` may put in place of a registry or git dependency counts as a dependency of every member that may use it ([[DES-PROJECT-GRAPH]]); where it has no Nx project, or where its edge is left out because it would close a cycle, its folder is an input of that member's targets. Inputs name real paths per project, because a repository can hold several lockfiles and toolchain files. A negated pattern in the repository's own configuration of a target removes the files it matches from that target's key, on the repository's responsibility.
:::

:::mara requirement REQ-ENV-ALLOWLIST
:mid: 01M78FHG7FB30V9FZNFF0TFHC1
:title: Hash a fixed, extendable list of environment variables
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of a cached target includes the values of a fixed list of environment variables that are known to change Rust builds, and of every variable whose name starts with `CARGO_PROFILE_` or `CARGO_TARGET_`, which set a profile's or a target triple's settings, apart from `CARGO_TARGET_DIR`. A repository can add variables and commands whose output joins the key. The plugin never hashes the whole environment.
:::

:::mara requirement REQ-TOOLCHAIN-KEY
:mid: 01M78FHG7FRC3KSSDACETE745J
:title: Key each task on the toolchain it uses
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of a cached target includes the identity of the Rust toolchain that the plugin's cargo commands use for that task, which is the one that applies in the root folder of its workspace with the task's environment. Two tasks that use different toolchains never share a toolchain identity in their keys, and a toolchain update changes the keys of exactly the tasks that use it.
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

A cargo command that the plugin runs uses the same build directory, the same artifact directory and the same default flags as the equivalent plain `cargo` command in that workspace, so that builds through Nx and builds through plain cargo or rust-analyzer reuse each other's work. The plugin generates no files inside crates. Nx's own data folder, `.nx/workspace-data`, which Nx and git ignore, belongs to no crate and to neither of Cargo's directories, also where it lies in the folder of a crate at the repository root.
:::

:::mara requirement REQ-BUILD-SCRIPT-INPUTS
:mid: 01M78FHG7FC47G6VCHVQBY6JT2
:title: Hash the declared files outside a crate that build scripts and macros read
:status: accepted
:satisfies: NEED-CORRECT-CACHE
:satisfies: NEED-AFFECTED
:mitigates: RISK-UNDECLARED-INPUTS

A repository can declare files outside a crate's folder that the crate's build script, macros or tests read, such as files that a build script names with `cargo::rerun-if-changed` or that `include_str!` pulls in. It declares them in the crate's manifest and, for every member of a workspace, in the workspace's root manifest; the declarations of the two add up. Declared files are part of the cache key of every cached target of the crate and of every crate that depends on it, also when Git ignores them. A change to a declared file makes those tasks affected, except for a file that the repository's root `.gitignore` or `.nxignore` ignores: Nx leaves such files out of the changed files it matches against inputs, so a change to one alone changes the keys and makes no task affected. A symbolic link that a declaration names counts as the file or folder it points to. A link that only a wildcard of a declaration reaches covers the file it points to in neither way: Nx keeps the hash of the link's destination until the link itself changes or `nx reset` clears the hashes Nx keeps, and does not descend into a linked folder, so a change there alone changes no key and makes no task affected; the linked file or folder itself is what has to be declared ([[EVD-NX-24-FILE-INPUTS]]). Declarations come from the manifests, not from earlier builds, so they apply from the first run ([[ADR-DECLARED-FILE-INPUTS]]). Files inside the crate's folder are inputs already ([[REQ-INPUT-FILES]]).
:::

:::mara requirement REQ-FILE-INPUTS-HASHABLE
:mid: 01M7AE8CZ89406C7ZQ4FS2ST0V
:title: Reject a declared file pattern that Nx cannot hash
:status: accepted
:satisfies: NEED-CORRECT-CACHE
:satisfies: NEED-CLEAR-FAILURES
:mitigates: RISK-UNDECLARED-INPUTS

A declaration of files outside a crate ([[REQ-BUILD-SCRIPT-INPUTS]]) that resolves outside the repository, or into Cargo's build or artifact directory, fails graph creation with a message that names the manifest and the declaration. For a declaration outside the repository, the message points to the commands whose output a repository can add to the key instead ([[REQ-ENV-ALLOWLIST]]).
:::

:::mara requirement REQ-BUILD-INPUT-CHECK
:mid: 01M7ACMK1QH5F72B0567M3WNP1
:title: Fail a build that read a repository file outside its inputs
:status: accepted
:satisfies: NEED-CORRECT-CACHE
:satisfies: NEED-CLEAR-FAILURES
:mitigates: RISK-UNDECLARED-INPUTS

When the cargo call of a `build` task has built the task's crate without error, also when nothing needed compiling, and a record that Cargo exported for the crate's library or one of its binaries names a file inside the repository that none of the task's file inputs covers, the task fails, so that no success is cached for it. The plugin names these records from what it knows without asking cargo, and reads none that it cannot name with certainty. A file reached through a symbolic link counts as covered only when the inputs cover the file the link points to. The failure names each such file and the declaration that would cover it ([[REQ-BUILD-SCRIPT-INPUTS]]). Files outside the repository, files in Cargo's build or artifact directory, and files that Nx ignores inside a directory that Cargo records as one path are not reported. When one cargo call builds several crates, only the tasks of the crates that read such a file fail.
:::

## Design

:::mara design DES-INPUTS
:mid: 01M78FHG7FX4MX7J2W6TW28PDP
:title: Cache inputs
:status: accepted
:satisfies: REQ-INPUT-FILES
:satisfies: REQ-ENV-ALLOWLIST
:satisfies: REQ-TOOLCHAIN-KEY
:satisfies: REQ-BUILD-SCRIPT-INPUTS
:satisfies: REQ-FILE-INPUTS-HASHABLE

Every cached target declares its inputs as Nx inputs. The plugin has no custom hasher ([[ADR-DECLARED-INPUTS]]).

| Input                 | Declared as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crate files           | One fileset for the crate's project: every file under the crate's folder that belongs to no nested project, without the files an artifact target generates there ([[DES-ARTIFACT-STEPS]]). A list of source folders would miss files that macros and build scripts read, such as a README, templates or migrations ([[ADR-DECLARED-INPUTS]]). A negated pattern in the repository's own `inputs` of a target removes files from it, on the repository's responsibility ([[DES-PLUGIN-OPTIONS]]). For the crate at the root of its workspace, which every [[TERM-STANDALONE-CRATE]] is, the fileset also leaves out the workspace's `Cargo.lock`, which reaches the key only through the crate's digest ([[DES-LOCKFILE-HASHING]]).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Workspace files       | The real paths of every `rust-toolchain.toml`, `rust-toolchain`, `.cargo/config.toml` and `.cargo/config` between the crate and the repository root, and of every file inside the repository that such a configuration adds with `include`, which cargo takes from the folder it starts in and not from a dependency's ([[EVD-CARGO-DEPENDENCY-SIDE]]); Cargo reads `.cargo/config` where both exist. The root `Cargo.toml` of the crate's workspace is in the crate's named input, because the crate inherits fields from it also where another workspace builds it. A repository-wide named input cannot point at several lockfiles, so these are per project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Dependency sources    | The crate-file inputs of all dependencies, through `^` inputs over the edges in [[DES-PROJECT-GRAPH]], among them the crates with a project that the crate reaches only through path dependencies on crates without one, or behind a redirected crate without one that it may use: each brings its folder, its declared files and its own dependencies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Member manifests      | Under the `cargo` and `workspace-build` strategies of [[DES-UNIFICATION]], the `Cargo.toml` of every member of the crate's workspace: a feature that one member switches on in a shared dependency also reaches the other members built with it ([[EVD-CARGO-LOCKFILE]]). Under `hakari` the [[TERM-HACK-CRATE]], a dependency of every member, carries those features, and the input is not added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Declared files        | Each pattern of `fileInputs` in the crate's `[package.metadata.nx]` and its workspace's `[workspace.metadata.nx]`, resolved against the folder of the manifest that holds it, as a fileset with `includeIgnored` in the crate-file input. Every cached target of the crate thereby has it, and its dependents through `^` ([[REQ-BUILD-SCRIPT-INPUTS]]).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Path dependencies     | For a path dependency that is no Nx project, because it is excluded, ignored, outside the repository or a crate whose folder holds `.cargo-checksum.json`, a fileset for its folder, and the root manifest of its workspace where that is another file, on every crate that depends on it, directly or through other crates. This holds whether or not the plugin has a report for the crate; without one, the path dependencies behind it are not known. Each path names the crate at the real path of its folder, so a path through a symbolic link to a crate with a project is that project's edge and no fileset. A crate with a project behind it gets no fileset here, because the edge to it brings it with what lies behind it (dependency sources). Where Nx cannot see those files, the plugin warns ([[DES-DIAGNOSTICS]]).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Redirected crates     | The crates of [[DES-PROJECT-GRAPH]]'s redirected uses, the crates with a project behind a redirected crate without one included: through the member's edge and `^` inputs; without an Nx project, like a path dependency without one, the warning included, and without a report its folder alone, its path dependencies not followed; where the edge is left out, as a fileset for the folder, the root manifest of the workspace and the declared files of the crate and of each crate that [[DES-PROJECT-GRAPH]] says the edge would have brought, on the member's targets, the warning of a path dependency without a project included for one that Nx cannot see.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| External dependencies | On every cached target of a crate other than `fmt-check`, the crate's lockfile digest: a `dependentTasksOutputFiles` input for the crate's file among the outputs of its workspace's lockfile task, on which the target depends; on `doc`, the digests of all members ([[DES-LOCKFILE-HASHING]]). No cached target that runs cargo has `Cargo.lock` as a file input: Nx hashes such a target before the run starts, before the lockfile task can update the file ([[EVD-NX-24-LOCKFILE-UPDATE]]). Each target with a digest input also has an `env` input for `NX_RUST_RUN_ID` ([[DES-LOCKFILE-HASHING]]).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Plugin                | `externalDependencies: ["@convesoft/nx-rust"]` where Nx has a node for the package, so that the key holds the plugin's package and the packages it depends on, as the JS lockfile locks them, and no other external node of the Nx graph. Without an `externalDependencies` input, Nx hashes every external node, so each change to a JS lockfile would change the key of every Rust task ([[EVD-NX-24-EXTERNAL-NODES]]). Naming a package without a node fails the hash of every task that names it, and Nx creates a node only from a JS lockfile that it analyses and that lists the package ([[EVD-NX-24-PLUGIN-VERSION]]). Where the plugin cannot establish both, it declares `externalDependencies: []` and puts its own version into the option `pluginVersion` of every target it infers ([[DES-PLUGIN-OPTIONS]]). It establishes them as Nx's JS plugin decides: the lockfile is that of the package manager that `nx.json` names or whose lockfile is in the repository root, Nx analyses it unless `pluginsConfig` in `nx.json` says otherwise, Nx sees it, and it lists the package with a version from a registry; a plugin that `nx.json` names by path runs from another folder than the installed package and takes the option. Each of its executors declares that option, so it draws no warning, and leaves it out of the cargo command ([[DES-UNKNOWN-OPTIONS]]); Nx hashes it into each task of the project. Every inferred target has this input, the uncached ones too: on the lockfile task, `audit`, `deny` and `update` it only decides what `nx affected` selects, so that an upgrade of the plugin selects them and a change to the JS lockfile outside the plugin's package does not ([[EVD-NX-24-PLUGIN-VERSION]]). |
| Tool configuration    | On `lint`, every `clippy.toml` and `.clippy.toml` between the crate and the repository root. On `fmt-check`, every `rustfmt.toml` and `.rustfmt.toml` on the same path. On `test` with the nextest runner, the workspace's `.config/nextest.toml`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Environment           | One `env` input per variable in the list below, plus the variables the repository adds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Toolchain             | A `runtime` input that runs `rustc -Vv` in the root folder of the crate's workspace, where its cargo commands run ([[DES-INVOCATION]]), and then prints the variables of the task's environment whose names start with `CARGO_PROFILE_` or `CARGO_TARGET_`, below. The toolchain is thereby resolved as cargo will resolve it: through rustup's toolchain files, overrides and `RUSTUP_TOOLCHAIN` where rustup is installed, and through `PATH` where it is not. The folder is part of the command, so workspaces with different toolchains never share one evaluation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Triples               | On a cached `build` and `doc`, a `runtime` input, one per workspace, whose command runs the plugin's own script in the workspace root with the task's environment. It prints the triples that cargo will build for there without `--target`, read with the function that graph creation uses for the outputs ([[DES-OUTPUTS]]), as text that names the triples, none, or a triple that cannot be named with its reason, and no path. The command names Node and the script by absolute paths, which reach no key, because Nx hashes what a runtime input prints and not its command ([[EVD-CARGO-TRIPLE-FOLDERS]]). Where the script cannot run, as for a plugin that Nx loads from its TypeScript source, the command prints a random value instead, new at each evaluation, so that no stored result is restored. Nx evaluates the command once for each task, not once for each workspace ([[EVD-CARGO-TRIPLE-FOLDERS]]).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Options               | Features, profile and target triple are target options, which Nx hashes. A triple that Cargo's configuration or the graph's environment picks is text in the outputs of `build` and `doc`, which Nx hashes with the project's configuration ([[DES-OUTPUTS]]).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Extra                 | Runtime commands the repository adds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The toolchain command prints what `rustc -Vv` writes to standard output, run with `RUSTUP_AUTO_INSTALL=0` and with its standard error discarded, and when `rustc -Vv` fails, as for a pinned toolchain that is not installed, it prints a random value instead, new at each evaluation, so that no result stored under that key is ever restored and the task runs as plain cargo does ([[ADR-GRAPH-NO-TOOLCHAIN-INSTALL]]).

The environment list:

- `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`, `RUSTDOCFLAGS`, `CARGO_ENCODED_RUSTDOCFLAGS`, `RUSTC`, `RUSTC_WRAPPER`, `RUSTC_WORKSPACE_WRAPPER`, `RUSTDOC`, `RUSTC_BOOTSTRAP` and `CARGO_BUILD_TARGET`.
- The `CARGO_BUILD_*` forms of the same settings: `CARGO_BUILD_RUSTFLAGS`, `CARGO_BUILD_RUSTDOCFLAGS`, `CARGO_BUILD_RUSTC`, `CARGO_BUILD_RUSTC_WRAPPER`, `CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER` and `CARGO_BUILD_RUSTDOC`.
- Every variable whose name starts with `CARGO_PROFILE_` or `CARGO_TARGET_`, which set a profile's or a triple's settings, other than `CARGO_TARGET_DIR`, which says where the artifacts go and not what they are. Their names hold a profile's or a triple's name, so no list of `env` inputs can name them all: the toolchain command prints each with its value, sorted, in the same process as `rustc -Vv`.
- `CC`, `CXX`, `AR`, `CFLAGS`, `CXXFLAGS`, `PKG_CONFIG_PATH` and `MACOSX_DEPLOYMENT_TARGET`.
- `OPENSSL_DIR`, `OPENSSL_LIB_DIR`, `OPENSSL_INCLUDE_DIR`, `OPENSSL_STATIC` and `OPENSSL_NO_VENDOR`.
- `CLIPPY_CONF_DIR`, on `lint` only.
- `CARGO_BUILD_WARNINGS`, on every target that compiles: `build`, `check`, `lint`, `test`, `bench`, `run`, `doc` and the artifact targets, the uncached `bench` and `run` included. Cargo's `build.warnings` setting turns warnings into failures, so a result that passed with warnings allowed must not be restored where they are denied ([[EVD-CARGO-TARGET-COMMANDS]]).

**Named input.** The crate-file input is the project's named input `default`, which its targets name as `default` and `^default`. Every Nx project has a `default`, Nx's own or the one in `nx.json`, and a `^` input fails the hash of a task whose project depends on a project without that named input ([[EVD-NX-24-INPUTS-OUTPUTS]]), as a crate can depend on a JS project. A JS project that depends on a crate and hashes `^default` thereby hashes the crate's input. Besides the crate's folder, it holds the root manifest of the crate's workspace, from which the crate inherits fields such as its edition and lints also where another workspace builds it ([[EVD-CARGO-DEPENDENCY-SIDE]]).

**The repository's `default`.** A crate's `default` replaces the one in `nx.json` for the crate's project, so it keeps every entry of the repository's `default` but its file sets under `{projectRoot}`, negated or not: named inputs such as `sharedGlobals`, `env`, `runtime` and `externalDependencies` entries and file sets under `{workspaceRoot}` reach the crate's key and its dependents'. What a crate hashes of its own folder is the whole folder, which only the crate's own configuration of a target can narrow. The plugin's targets name no other named input, so `production` and the like reach no Rust target.

**Beyond the declared inputs.** Nx puts two parts into every task's key that no input names: the file `nx.json`, and the project's configuration, which is, for each of the project's targets, its executor, `inputs`, `outputs`, `options`, `configurations` and `parallelism`, and the project's root, named inputs and tags ([[EVD-NX-OPTION-VALIDATION]], "Cache key"). A key also holds the configuration of each project whose named input it hashes through `^` inputs ([[EVD-NX-24-PLUGIN-VERSION]]). Any change to `nx.json`, also one that reaches no Rust target, therefore changes every key. A changed option or configuration of one target of a crate, also from a `project.json`, a `package.json` or `targetDefaults`, changes the keys of every task of that crate and of the crates that depend on it, and so does a changed script in a `package.json` of the crate's folder that Nx reads, because Nx hashes the script with its `nx:run-script` target. Nx's hash of the project's configuration leaves out each target's `metadata`, `cache` and `dependsOn` and the project's `metadata`, so a change to them reaches a key only through the file it is written in, where that file is among the task's inputs, as a `project.json` in the crate's folder is. The plugin cannot take these parts out of a key. They make tasks run more often than their inputs require, never less. The plugin uses the named inputs for one purpose of its own: a project with warnings gets a named input that no target names and that holds a digest of them, so that a change of its warnings changes the keys of its tasks and of the tasks that depend on it ([[DES-DIAGNOSTICS]], "Warnings where they are seen").

**A project at the repository root.** A crate or a workspace project at the repository root shares its folder with the repository's JS package. Its crate-file input, the whole folder, then covers the root `package.json` and the JS lockfile, and Nx's JS plugin gives the project, which owns that `package.json`, an edge to each npm package it lists, so that the `^default` of the project's targets hashes those packages and the packages behind them, beside what the plugin input names ([[EVD-NX-24-EXTERNAL-NODES]], [[EVD-NX-24-PLUGIN-VERSION]]). Any change to either file, also outside the plugin's package, therefore changes the key of `doc` on a workspace project there, of every cached target of a crate at the repository root, and of every cached target of a crate that depends on that crate, directly or through other crates, because its `^default` holds that crate's folder. The lockfile task, whose inputs name neither the folder nor `^default`, keeps its key, and so do the tasks of the crates that do not depend on a crate at the repository root. A workspace in a subfolder shares no folder with the JS package, and the keys of its crates follow the JS lockfile only through the plugin input, unless they depend on a crate at the repository root. This limit is accepted: the tasks it reaches run after a change that cannot affect them, and none is restored with a stale result. What `nx affected` selects in this layout is in [[DES-LOCKFILE-HASHING]].

**Redirected uses.** Nx asks for a plugin's targets before it merges the projects of every plugin and entry, so the plugin works out the redirected uses for the inputs with the projects of its own entry. A redirected crate that another entry gives a project counts there as one without a project, and its folder joins the member's inputs beside the edge that the dependencies of the merged graph add.

**Uncached targets.** `fmt`, `bench` and `run` are not cached, but declare the inputs of `fmt-check`, `build` and `build`, so that `nx affected` selects them when what they read changes. They do not depend on the lockfile task, so `bench` and `run`, `build` and `doc` where the plugin leaves them uncached ([[DES-OUTPUTS]]), and the targets of the crates of a workspace without a lockfile task ([[DES-LOCKFILE-HASHING]]) name the workspace's `Cargo.lock`, read also where Git ignores it, in place of the digest and of `NX_RUST_RUN_ID`, as `audit` and `update` do ([[DES-WORKSPACE-TARGETS]]).

The variables and commands that the repository adds, with `envInputs` and `runtimeInputs` in the plugin options, in the workspace table or in a crate's table ([[DES-PLUGIN-OPTIONS]]), go into the crate's own named input, the one that its dependents hash through `^` inputs, and not onto single targets. A dependent's key therefore changes with them, also in another workspace, because Nx hashes the `env` and `runtime` entries of a dependency's named input into the dependent's key and those of a dependency's target into no other key ([[EVD-NX-24-OPTION-SEMANTICS]]).

**Declared files.** Task-based affected matches changed files against filesets, so `nx affected` selects the tasks of the crate and of its dependents when a declared file changes. `includeIgnored` makes Nx hash a declared file that Git ignores. Nx leaves a file that the root `.gitignore` or `.nxignore` ignores out of the changed files before it matches them, also when a fileset with `includeIgnored` names it, so a change to such a file changes the keys and makes no task affected. The workspace project receives its members' patterns through its dependency on every member ([[DES-WORKSPACE-TARGETS]]). The declared files of a crate travel with its folder: wherever the plugin puts a crate's folder into another crate's inputs beside the `^` inputs, as for a path dependency without a project, the crates behind it, a redirected crate whose edge is left out with the crates that its edge would have brought, or an assumed use, it also puts there the filesets of the crate's own `fileInputs` and its workspace's, resolved and checked as for a project; they are read from the crate's report, so a crate without one, such as one whose folder holds `.cargo-checksum.json` or whose report failed, adds its folder alone.

The plugin resolves each pattern's fixed part, its segments before the first one with a glob character, to its real path, `..` and symbolic links included, and declares that path with the rest of the pattern, and also each link that the fixed part passes, at the path where the link itself lies. Nx fails the hash of every task whose fileset with `includeIgnored` has a `.` or `..` segment. Nx keeps the hash of a link to a file until the link itself changes or `nx reset` clears the hashes Nx keeps, and matches changed files by their own paths, so a fileset for the link alone would change no key and make no task affected when the file or folder it points to changes, and one for the real path alone would make no task affected when the link is replaced by one that points elsewhere ([[EVD-NX-24-FILE-INPUTS]]). A link that passes outside the repository fails graph creation as a real path there does. A link that only the glob part reaches stays unresolved, because resolving it would mean walking the tree at graph creation: Nx's `**` does not descend into a linked folder, and a link to a file that a wildcard matches keeps its first hash, so the repository declares the linked folder or file itself. Graph creation fails with a message that names the manifest and the pattern for a pattern with a `..` segment after a glob character, which could lead anywhere; for one whose real path lies outside the repository, with a message that points to the runtime commands, because Nx hashes no file by a path that leaves the repository and `nx affected` sees no change to a file outside it; and for one whose real path lies in the build or artifact directory of the crate's workspace, whose files are Cargo's outputs ([[REQ-FILE-INPUTS-HASHABLE]], [[ADR-DECLARED-FILE-INPUTS]], [[DES-DIAGNOSTICS]]).

A `rust-toolchain.toml` or `.cargo/config.toml` inside a member crate is hashed with the crate's files, although it does not apply to the commands the plugin runs ([[DES-INVOCATION]]). An input the plugin cannot see is the repository's to declare, through `fileInputs` and the extra environment variables and commands. A `build` that read an undeclared file in the repository fails ([[DES-BUILD-INPUT-CHECK]], [[RISK-UNDECLARED-INPUTS]]).
:::

:::mara design DES-BUILD-INPUT-CHECK
:mid: 01M7ACMK1QPYW1JQ7G9ETNAZ7H
:title: Check a build's dependency files against its inputs
:status: accepted
:satisfies: REQ-BUILD-INPUT-CHECK

The executor checks a `build` task after every cargo call that builds the task's crate without error, also when cargo compiled nothing because everything was fresh, since a run that skipped the check would cache a success for the same inputs that failed it before. After such a call the records are in place: cargo keeps them, and writes a missing one again without compiling. Whether it also gives them a new time differs between Cargo versions and crates, so the check does not depend on when a record was written ([[EVD-CARGO-DEP-INFO]]). A task is not checked when cargo failed for its crate, nor on an Nx cache hit, which runs nothing. Nor is it checked where the installed Nx lacks the internal parts of Nx through which the check matches files with the task's inputs, which only an Nx that the plugin does not support can: the task then prints a warning that the check did not run, and Nx caches its result without it ([[DES-DIAGNOSTICS]], [[REQ-COMPATIBILITY]]).

1. **What it reads.** The records that `cargo build -p <crate>` exports for the call, named by the plugin from what it already knows, without asking cargo. The `build` task selects its crate with `-p` and no target flag ([[DES-TARGETS]]), so cargo builds the crate's library and each binary whose required features are on, and exports one record for each beside its file in the [[TERM-ARTIFACT-DIR]]. From the crate's targets in the `cargo metadata` report, with their kinds and `required-features`, and from the task's feature selection, profile and target triple, the plugin names:
   - `lib<name>.d` for the library, whatever its crate types, with each `-` in the library's name replaced by `_`;
   - `<name>.d` for each binary whose required features are all features of the crate that the task's selection turns on, directly or through other features of the crate to any depth, as cargo resolves them: a `<dependency>/<feature>` entry for an optional dependency also turns on the crate's feature of the dependency's name, while `dep:<name>` and the weak `<dependency>?/<feature>` turn on none, and an optional dependency that a platform limits is not counted, so that a binary only it would turn on is not named ([[EVD-CARGO-DEP-INFO]]); a binary that requires a feature of a dependency is not named;
   - for a proc macro's library, in `<artifact directory>/<profile folder>` whatever the triple, because cargo builds a proc macro for the host;
   - for every other library and every binary, in `<artifact directory>/<triple>/<profile folder>` for each triple that the call builds for, and in `<artifact directory>/<profile folder>` where it builds for none. The triples are the task's own, or else those that `build.target` in Cargo's configuration and `CARGO_BUILD_TARGET` in the task's environment pick, read as the executor reads them when the task starts ([[DES-OUTPUTS]]).

   The profile folder is `debug` for `dev` and `test`, `release` for `release` and `bench`, and the profile's own name for any other profile, also one that inherits from one of those four. The plugin passes cargo no flag for this ([[DES-INVOCATION]]) and reads nothing in the build directory ([[DES-BUILD-DIRS]]). What Nx caches as outputs plays no part, so a crate that is only an `rlib` is checked like any other.

   A record at a name and folder that the rule derives for this call is this call's own. Cargo writes the record of every target that a call builds from that call: it rewrites a record whose content differs and writes a missing one again, also when nothing compiles, so a feature set that changes back restores the matching list ([[EVD-CARGO-DEP-INFO]]). Records that other builds left at other names or folders are never read, because the rule does not derive them: those of another profile, triple or feature set, of a binary whose required features are off or that was removed or renamed, and of the crate before it changed kind, such as a library built for a named triple that has since become a proc macro. In a batch, each group's records are read right after its call, before a later call can rewrite them. With cargo 1.91.0 and 1.100.0, for libraries of the crate types `rlib`, `cdylib`, `staticlib`, all three together and `proc-macro`, a binary alone, a library with a binary, and a proc macro with a binary, under the profiles `dev`, `release`, `test`, `bench` and a custom profile inheriting from each, without a triple, with the host triple and, with 1.100.0, another installed triple named by `--target`, and with `CARGO_BUILD_TARGET`, the names agreed exactly with the records that cargo reported wherever the build succeeded. Where Cargo's configuration chose the triple, names that knew no triple agreed for proc macros' libraries only ([[EVD-CARGO-DEP-INFO]]); the folders that [[DES-OUTPUTS]] names for such a configuration are those that cargo writes to ([[EVD-CARGO-TRIPLE-FOLDERS]]).

2. **Records it cannot name with certainty.** The check reads none of these, so the reads that they record go unchecked:
   - **A triple without a name.** When the task names no triple and Cargo's configuration or the task's environment picks one whose folder [[DES-OUTPUTS]] cannot name, such as `host-tuple`, the call's records can lie in a triple folder, while older records remain in `<artifact directory>/<profile folder>`. A record whose folder depends on the triple, which is every record but a proc macro's library record, is then read there only when no record of the same name lies in any `<artifact directory>/<folder>/<profile folder>`. Because cargo writes a record for every target it builds, the absence of one in a triple folder after the call shows that the call built for no triple. Where one exists, from this call or from an earlier build for another triple, that target is not checked. A proc macro's library record is read as named in this case too, since its folder does not depend on the triple, and that absence would prove nothing for it.
   - **A shared name.** A record name that targets of two crates with the same artifact directory share, such as two binaries called `cli`, is not read: cargo warns of an output filename collision and keeps a single record, that of the crate it built last.
   - **Features turned on by another crate.** When one call builds several crates, another selected crate can turn on a feature that a binary requires. Cargo then builds that binary and exports its record, but the rule knows only the task's own selection and does not name it, so reads that only the binary's own sources make are not checked.
3. **What a record holds.** In Makefile syntax, with spaces escaped by a backslash, every path that Cargo would rebuild the target for: the crate's sources, the files that `include_str!` and `include_bytes!` read, the paths that the build script names with `rerun-if-changed`, and the same of the crate's path dependencies, but nothing of a registry crate. A path keeps the spelling it was given, a symbolic link's included, and a directory named with `rerun-if-changed` appears as one path. The paths are absolute, or relative to `build.dep-info-basedir` where that is set. Cargo writes such a relative path normalised as text, each `..` removed with the name before it, so that a path running through a symbolic link and then `..`, such as one that a build script names with `rerun-if-changed`, is recorded as another file than the one read. The check then names that file, and declaring it lets the build pass: the record no longer holds the path that was read.
4. **Paths.** Each path is resolved to the file it names: against the folder that `build.dep-info-basedir` gives, with `..` removed, symbolic links followed and, on a file system that ignores case, with the case of the names stored on disk. A path whose file lies outside the repository root is left out: Nx cannot hash it, and [[RISK-HOST-ENVIRONMENT]] covers what it stands for. So is a path whose file lies in the build or artifact directory of the crate's workspace, as the `cargo metadata` report names them, such as code that a build script generates in `OUT_DIR`.
5. **Directories.** A remaining path that is a directory is enumerated, and the enumeration prunes Cargo's build and artifact directories and everything that Nx ignores, that is what `.gitignore` and `.nxignore` exclude and Nx's fixed exclusions such as `node_modules` and `.git`, without entering them. It does not follow a symbolic link to a folder. Only the files that remain take part in the comparison. A directory such as the one that `rerun-if-changed=../..` names can hold the workspace's `target` folder, so the check never compares Cargo's outputs and never walks the build directory.
6. **Compare.** A file is covered when Nx's own matching of the task's file inputs includes the file's resolved path: the crate's folder, a workspace file, the folder of a crate it depends on or of a path dependency without a project, or a `fileInputs` pattern of the crate, its workspace or a crate it depends on ([[DES-INPUTS]]). The check thereby fails a build only when Nx's key leaves the file out. A file that a negated pattern in the task's own `inputs` leaves out is not covered either, so a `build` that reads such a file fails instead of being cached ([[DES-PLUGIN-OPTIONS]]). A file that the task's inputs reach only through a symbolic link, because only a pattern for the link matches, is not covered: Nx keeps the hash of a link's destination until the link itself changes or `nx reset` clears the hashes Nx keeps, so that key would miss a change to the file ([[EVD-NX-24-FILE-INPUTS]]). How the comparison treats case on a file system that ignores it is reasoned and not run, because no check runs on macOS yet ([[ADR-CI-LINUX-ONLY]]). Each task is compared with its own inputs, so a file that a shared path dependency reads can be covered for one task of a batch and not for another.
7. **Fail.** If a file is not covered, the task fails. The message names the crate and each such file relative to the repository root, and shows the `fileInputs` line for the crate's `[package.metadata.nx]` that would cover them, with each file relative to the crate's folder; for a file reached through a symbolic link, it names the file the link points to and the link. For files found under a directory that the build script names, it names that directory as well, since a pattern for the directory also covers files added there later ([[DES-DIAGNOSTICS]]). A failed task is never stored as a success, so no success is cached under the incomplete key. By default Nx stores no failure either, and the next run builds and checks again. With `NX_CACHE_FAILURES=true`, Nx stores the failure and replays it while the key stays the same; adding the `fileInputs` line changes a manifest that is an input of the task, and with it the key ([[EVD-NX-24-FILE-INPUTS]]). A warning instead would leave a success in the cache under a key known to miss a file ([[ADR-DECLARED-FILE-INPUTS]]).

**Batches.** The check runs for each task after the cargo call of its group ([[DES-BATCH]]). A failure fails only the tasks whose records name an uncovered file. The other tasks of the group keep their own results and are cached as usual.

**Limits.** Only `cargo build` writes these files. `check`, `lint`, `test` and the workspace's `doc` keep their dependency files in the build directory, whose layout is internal to Cargo, so their reads are not checked: a file that only tests read, through `include_str!` or at run time, relies on its declaration. A file that a proc macro opens without an include macro appears in no dependency file, because Cargo does not track it ([[EVD-CARGO-DEP-INFO]], [[RISK-UNDECLARED-INPUTS]]).
:::

:::mara design DES-OUTPUTS
:mid: 01M78FHG7FRNE981T1QJYYVWC4
:title: Cached outputs
:status: accepted
:satisfies: REQ-CACHE-OUTPUTS

| Target                                                            | Cached | Outputs                                                                                                                                   |
| ----------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `check`, `lint`, `fmt-check`, `test`                              | Yes    | None; the result only                                                                                                                     |
| `build`                                                           | Yes    | Final artifacts only, in the [[TERM-ARTIFACT-DIR]]: the executables of `bin` targets and the `cdylib` and `staticlib` files of a library  |
| `doc`, on the workspace project                                   | Yes    | The whole `doc` folder of the workspace's [[TERM-ARTIFACT-DIR]] ([[DES-WORKSPACE-TARGETS]])                                               |
| `lockfile`, on the workspace project                              | No     | The crates' digests, in `.nx/workspace-data/nx-rust/lockfile/`, declared so that the crate tasks can hash them ([[DES-LOCKFILE-HASHING]]) |
| `fmt`, `bench`, `run`, `audit`, `deny`, `update`, release publish | No     | None                                                                                                                                      |

`build` does not list `rlib` or `dylib` files or other files that only Cargo consumes, so a cache hit never puts such files back ([[ADR-RESULTS-ONLY-CACHE]]).

Nx can store only files inside the repository. The `cargo metadata` report names the artifact directory of each workspace, as cargo's configuration or `CARGO_TARGET_DIR` spells it, and cargo writes to the folder that the system reaches through that path ([[EVD-CARGO-DIRECTORIES]]). Where a symbolic link comes before a `..`, that is not the folder that the path names as text. The plugin therefore follows every symbolic link of the path, also one to a folder that does not exist yet, and takes the folder it reaches, relative to the repository's real path: that folder decides whether the directory lies inside the repository, whatever the reported path says, and the outputs and the plugin's warnings name it. When it lies outside the repository, the `build` and `doc` targets of that workspace are not cached, and the plugin says so when the graph is created ([[DES-DIAGNOSTICS]]). Targets that store only a result stay cached, and so do the artifact targets, whose outputs lie outside Cargo's directories ([[DES-ARTIFACT-STEPS]]).

When the reports of two or more workspaces name the same artifact directory, the `doc` targets of those workspaces are not cached either, and the plugin says so in the same way. Nx restores a folder output by replacing it, so restoring one workspace's `doc` folder would delete the pages of the others ([[EVD-NX-24-TARGETS]]). Cargo reports the directory as its configuration or `CARGO_TARGET_DIR` spells it, `..` segments, symbolic links and a trailing separator included ([[EVD-CARGO-DIRECTORIES]]). Two reports therefore name the same directory where their paths agree once `.` and `..` are taken as text, or once every symbolic link is followed as well, a link to a folder that does not exist yet included. Either agreement counts: two folders taken for one only cost `doc` its caching, while one folder taken for two lets a restore delete pages.

**Paths.** Nx interpolates outputs from a task's options ([[EVD-NX-24-INPUTS-OUTPUTS]]). A run whose `targetTriple` option names a triple passes it as `--target`, which replaces what Cargo's configuration and environment pick. Without it, cargo builds for the triples that `build.target` in its configuration and `CARGO_BUILD_TARGET` pick, into each triple's folder, also for the host's own triple, and for no triple into the artifact directory itself ([[EVD-CARGO-TRIPLE-FOLDERS]], [[ADR-TRIPLE-OUTPUTS]]). Cargo reports these triples nowhere, so the plugin reads them when it creates the graph, as cargo does for a command started in the workspace root:

- `build.target` in the configuration files of the workspace root, of each folder above it and of the Cargo home, with the files they include, and of `.cargo/config` and `.cargo/config.toml` in one folder the former, as cargo reads them. A string in a deeper folder wins over one above it, a file's own value over the files it includes, and a later include over an earlier one. Lists from several files are joined, and cargo refuses a string beside a list, in `cargo metadata` too, so that graph creation fails.
- `CARGO_BUILD_TARGET` in the environment of graph creation: that of the `nx` command, with the repository's root `.env`, `.local.env` and `.env.local`, which Nx hands to the daemon as well ([[EVD-NX-24-SETUP]], [[EVD-CARGO-TRIPLE-FOLDERS]]). It replaces a string, or the absence of one, with one triple, its whole value, and adds its words to a list.

`build` names its files in `<artifact directory>/{options.targetTriple ?? <triple>}/{options.profile ?? debug}` for each picked triple, and in `<artifact directory>/{options.targetTriple ?? .}/{options.profile ?? debug}` where none is picked; `doc` names the `doc` folder in the same folders up to the triple. Nx counts equal outputs once, so a run that names a triple stores that triple's folder once. For an empty list, cargo builds nothing, and the outputs name `{options.targetTriple}` without a fallback, which Nx drops where the run names no triple. A library's `cdylib` and `staticlib` files are named for Linux and for macOS, and Nx stores the ones that exist. Every other target declares an empty list of outputs, because Nx gives a target called `build` without outputs folders of its own. `build` and `doc` reject the profiles `dev`, `test` and `bench`, whose folders Cargo calls `debug`, `debug` and `release`: the executor fails such a task before cargo runs, and its message names the profile to use instead, none for `dev` and `test` and `release` for `bench`.

**Triples that cannot be named.** Nothing is cached where the plugin cannot name these folders. It cannot name the folder of `host-tuple`, which cargo replaces with the host's triple, of a target specification file, of an empty triple or of a value that is no triple name, nor the folders of a `build.target` that a file added by `include` sets where reading and ignoring that file pick different triples: Cargo 1.91 ignores `include`, and later versions apply it. Where Cargo's configuration or the graph's environment picks such a value, `build` and `doc` are inferred uncached unless their own options name a triple and no configuration of theirs clears it: Nx's `cache` belongs to the target, not to a configuration, so a triple that only a configuration names does not count. Their outputs then name `{options.targetTriple}` without a fallback. The plugin says so when the graph is created, naming the value, what picks it and the `targetTriple` option ([[DES-DIAGNOSTICS]]), and the executor fails a cached run that names no triple before cargo runs.

**Triples that only a task picks.** Outputs are fixed when the graph is created, and an output reads no environment variable ([[EVD-CARGO-TRIPLE-FOLDERS]]). A `CARGO_BUILD_TARGET` that only a dotenv file of the task sets, such as a `.env` in the crate's folder or a root `.env.build`, is unknown then. So is a change to a configuration file that the Nx daemon does not watch, such as the Cargo home's or one above the repository: the daemon keeps the graph, and with it the outputs, that it created before. A cached `build` or `doc` therefore has a runtime input that prints the triples that cargo will use when the task runs ([[DES-INPUTS]]), so that its key follows them whatever the graph holds, and a result stored for one triple is never restored for another. When such a task whose run names no triple starts, the executor reads the triples again, from the task's environment and the configuration files as they are then, with the same function, and fails the task before cargo runs where they differ from those its outputs name or cannot be named. Where the configuration alone now picks other triples than at graph creation, the graph is out of date, and the message says that the configuration changed after Nx created the project graph and to run `nx reset`, or stop the daemon, and run the task again; otherwise it names the triples, what picks them and the `targetTriple` option ([[DES-DIAGNOSTICS]]). Nx stores nothing for a failed task.

**Keys.** The triples reach the key whichever way they are picked: the option as an option, and the triples that cargo will use as the output of the runtime input, which also covers `CARGO_BUILD_TARGET`, an `env` input of its own, and configuration files outside the repository, which no file input covers ([[DES-INPUTS]]). The picked triples are also text in the outputs, which Nx hashes with the project's configuration ([[EVD-CARGO-TRIPLE-FOLDERS]]). A stored result exists only for a run whose outputs and runtime input named the same triples, so a key that matches it promises the folders that it restores.

**Per project.** Each inferred target carries in its metadata, under `cargo.uncached`, why the plugin leaves it uncached in its project, for every target that it does not cache: by design, or for one of the reasons above. A `targetDefaults` entry that caches such a target fails graph creation ([[DES-TARGET-DEFAULT-GUARD]]), and the executor fails a task whose configuration caches it anyway, such as through a `project.json`, before cargo runs, so that Nx stores no result for it.
:::

:::mara design DES-BUILD-DIRS
:mid: 01M78FHG7FMKCDSEX3Y6Q65F4Y
:title: Build and artifact directories
:status: accepted
:satisfies: REQ-CACHE-OUTPUTS
:satisfies: REQ-CARGO-UNCHANGED

Cargo 1.91 and later can keep intermediate files in a [[TERM-BUILD-DIR]] (`build.build-dir`) apart from final artifacts in the [[TERM-ARTIFACT-DIR]] (`build.target-dir`). The plugin relies on that split:

- Of Cargo's two directories, Nx outputs point only into the artifact directory.
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

Every cargo command of a task starts in the root folder of the crate's workspace and addresses crates by their real package name and manifest path. rustup and Cargo choose the toolchain file and the configuration files by the folder a command starts in and its parents, so the same toolchain and configuration files apply to all tasks of a workspace, which a single invocation for a group needs ([[DES-BATCH]]). A task's environment can still choose another toolchain, for example through `RUSTUP_TOOLCHAIN` in a crate's `.env`: the task then runs and is keyed with that toolchain ([[DES-INPUTS]]) and shares no cargo call with tasks whose environment differs. A `rust-toolchain.toml` or `.cargo/config.toml` inside a member crate applies only to a cargo that the user starts in that folder, not to the plugin's commands ([[ADR-WORKSPACE-ROOT]]).

The plugin adds no flag that changes what Cargo builds or where. It sets no build or artifact directory ([[DES-BUILD-DIRS]]) and passes only what the target's options ask for.

By default the plugin does not pass `--locked`. Cargo may then create or update `Cargo.lock` during a task, exactly as it does for the same plain cargo command. That is Cargo's write, not the plugin's. The lockfile task makes that write with `cargo update --workspace` before the crate tasks run, byte for byte as their own cargo commands would, also in a run where every crate task is then restored from the cache; it too is Cargo's write ([[DES-LOCKFILE-HASHING]]). With the `locked` option on, every cargo command of a task passes `--locked` and fails instead of changing the lockfile. Two kinds of command never pass the flag: `update`, whose purpose is to change the lockfile and which `--locked` fails whenever the lockfile would change, and the `cargo fmt` of `fmt` and `fmt-check`, which resolves no dependencies and rejects `--locked`. The `cargo update --workspace` of the lockfile task does pass it, and then only checks the lockfile. cargo-deny takes `--locked` like a cargo command, and cargo-audit only reads the lockfile ([[DES-WORKSPACE-TARGETS]]). Creating the graph never touches `Cargo.lock`, with or without the option, because its report is requested with `--no-deps` ([[DES-METADATA-REPORT]]). The environment variable `NX_RUST_LOCKED`, set to `true` or `false`, replaces the option for one run, which is how a pipeline switches it on without changing what developers get. Locked mode is no input of a task's key, so it guards only the tasks that run. Every run in which the lockfile task runs fails on an outdated lockfile, even when every crate task is then restored from the cache ([[DES-LOCKFILE-HASHING]]). A run of `fmt` or `fmt-check` alone, or one that excludes task dependencies, runs no lockfile task and does not check it. A pipeline that is to check the lockfile in such a run, or in one without Rust tasks, runs `cargo metadata --format-version 1 --locked` in each workspace root as a command of its own, outside Nx's cache, which fails on such a lockfile without changing it ([[EVD-CARGO-LOCKED-CHECK]]).
:::
