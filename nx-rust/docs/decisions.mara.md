# Decisions and risks

The choices behind nx-rust, the risks it carries, and the evidence the choices
rest on. Most of this comes from a design discussion recorded on 12 November 2026.

## Decisions

:::mara decision ADR-NEW-PLUGIN
:mid: 01M78FHG7FZFXQ6B84EG2CKHRS
:title: Build a new plugin that closes the gaps of the existing ones
:status: accepted
:justifies: REQ-DEPENDENCY-EDGES
:justifies: REQ-EXTERNAL-DEPS
:justifies: REQ-MULTI-WORKSPACE
:justifies: REQ-BATCHING

Three projects were read before this design. [eddacraft/nxrust](https://github.com/eddacraft/nxrust) (v0.3.0) is the closest prior art and already reads overrides from Cargo metadata. [@monodon/rust](https://github.com/Cammisuli/monodon) (3.0.0, requires Nx 22) is the plugin the Nx documentation lists, and the reference for Nx release on `Cargo.toml`. [max-sixty/cargo-affected](https://github.com/max-sixty/cargo-affected) (0.4.1, self-described as very early) selects tests by coverage on top of nextest.

None of them is a dependency of this design, except cargo-affected, which is optional. nx-rust is a separate plugin whose design starts from the gaps found in nxrust ([[EVD-NXRUST-GAPS]]): dev-dependencies missing from the graph, the whole lockfile as an input, no batching and no handling of feature unification, unhashed build-script and Cargo configuration inputs, an in-memory metadata cache with the workspace fixed at the Nx root, and builds that restore `rlib` files into Cargo's directory.
:::

:::mara decision ADR-CARGO-SOURCE-OF-TRUTH
:mid: 01M78FHG7F2CB9W8YBQ9DNXCB0
:title: Take projects, targets and dependencies from cargo metadata
:status: accepted
:justifies: REQ-INFERRED-PROJECTS
:justifies: DES-METADATA-REPORT
:justifies: DES-DISCOVERY

A second description of a crate, such as a `project.json`, has to be written, kept in step with `Cargo.toml` and reviewed, and it drifts. Cargo already knows the members, their targets and their dependencies, and reports them through `cargo metadata`. The plugin takes everything from that report and needs no per-crate Nx file. The cost is one cargo call per workspace when the graph is created, and a design that is limited to what Cargo reports plus the metadata tables.

It also means that every machine that computes the graph needs cargo, including one that only runs JS tasks. When cargo is missing or rejects a manifest, graph creation fails. Leaving the Rust projects out instead was rejected: that machine would have another graph and other cache keys than the rest of the team, and `nx affected` would skip crates without saying so.
:::

:::mara decision ADR-METADATA-NO-DEPS
:mid: 01M78RC7T7GK1RSH8S11ZV38EZ
:title: Build the graph from cargo metadata without dependency resolution
:status: accepted
:justifies: DES-METADATA-REPORT

`cargo metadata` can resolve the whole dependency graph or, with `--no-deps`, report only the workspace's own packages. The full report was the first assumption. It needs the manifest of every dependency, so on a machine without a filled Cargo cache it downloads the crates of the lockfile, and it creates or updates `Cargo.lock` on the way. Nx builds the project graph for every command, also for JS-only work and in every CI job, and each of those machines needs cargo ([[ADR-CARGO-SOURCE-OF-TRUTH]]). The full report would add a registry download to all of them.

The plugin therefore asks with `--no-deps`. That report still names the members, their targets, their declared dependencies with paths and features, the metadata tables and Cargo's directories, which is all that projects, targets and edges need ([[EVD-CARGO-NO-DEPS]]). What it lacks is the resolved versions of external crates. Only per-crate lockfile hashing needs those, and `Cargo.lock` holds them. The cost is that the plugin reads `Cargo.lock` itself for that purpose, and that a path dependency outside the workspace needs a report of its own.
:::

:::mara decision ADR-MULTI-WORKSPACE
:mid: 01M78FHG7FZZT4VV8SYT01Z2B2
:title: Support several Cargo workspaces through a workspace context
:status: accepted
:justifies: REQ-MULTI-WORKSPACE
:justifies: DES-DISCOVERY

Repositories that add Rust to an existing monorepo rarely have one Cargo workspace at the Nx root: they have a workspace in a subfolder, tools as standalone crates, and sometimes several workspaces. Requiring one root workspace would force a restructuring before the plugin can be tried. The plugin supports any number of workspaces anywhere, and hangs everything Cargo scopes to a workspace off one [[TERM-WORKSPACE-CONTEXT]]: lockfile, build directory, toolchain, batch and coverage database. Standalone crates are workspaces of one and share no build directory; the plugin does not hide that.
:::

:::mara decision ADR-PROJECT-NAMES
:mid: 01M78FHG7FAG0YENBEH7FQ7WX1
:title: Name projects after crates and fail on a collision
:status: accepted
:justifies: REQ-PROJECT-NAMES

The crate name is what a Rust developer types, so it is the Nx project name. With several workspaces two crates can share a name. Deriving unique names automatically, for example from paths, would make names unpredictable and would change them when a second crate appears. A collision is therefore an error naming both paths, and the user fixes it with a per-crate name or a per-workspace prefix in metadata. Because commands always use the real package name and manifest path, the Nx name is free to differ. A crate whose folder also is a JS project is the exception. Nx applies `package.json` and `project.json` after every plugin, so the name set there wins, and neither the crate name nor its `name` override can change it ([[EVD-NX-PROJECT-MERGE]]).
:::

:::mara decision ADR-WORKSPACE-PROJECT-NAME
:mid: 01M7A8AKF5KKZ457ED2PX0NX4D
:title: Name the workspace project after its folder's path
:status: accepted
:justifies: REQ-PROJECT-NAMES
:justifies: REQ-METADATA-OVERRIDES
:justifies: DES-PROJECT-GRAPH
:justifies: DES-METADATA-TABLES

Agreed with the maintainer on 13 November 2026, for a [[TERM-WORKSPACE-PROJECT]] whose root manifest defines no crate. Cargo has no name for a workspace ([[EVD-WORKSPACE-PROJECT-NAMES]]), so the plugin derives one: the path of the workspace folder from the root of the Nx workspace, with each `/` replaced by `-`. Such a name is determined by the workspace's folder alone: it needs no configuration and does not depend on which other workspaces or crates exist, so it does not change when one appears, and the objection of [[ADR-PROJECT-NAMES]] to names derived from paths does not apply. Nx also accepts the folder itself where a project name is expected. The root of the Nx workspace has no such path, and its folder name differs between checkouts, so a workspace there is called `cargo-workspace`. Rejected: the folder's last segment, which is Nx's own default for a `project.json` without a name but lets `a/rust` and `b/rust` collide; the path with a `-workspace` suffix, which collides less often but is longer; one fixed name, which every workspace after the first would have to override; `rust` at the root, which a workspace in `rust/` gets too; and the name in the root `package.json`, which would name a Cargo project from a JS file. The names are not unique. `services/billing/` and `services-billing/` both give `services-billing`, the root and a folder `cargo-workspace/` both give `cargo-workspace`, and a folder named like one of its own crates gives that crate's name. Each of these fails like any other collision between two projects of this plugin, and the `name` in `[workspace.metadata.nx.project]` resolves it.

A collision between any two of the plugin's projects, crates or workspace projects, fails with the plugin's error, so that the user learns both manifests and both remedies; one with a JS project stays Nx's error, as for crates. The override is the sub-table `[workspace.metadata.nx.project]`, holding the `name`, `tags` and `targets` of a package table, because [[ADR-METADATA-KEY]] makes the `nx` table hold what a `project.json` holds while the workspace table's own keys are defaults for the members. Rejected: `workspaceProject`, which is long; `root`, which Nx uses for a project's folder; and a flat `name` in the workspace table, which reads as a default for members and leaves the project's own targets without a place. When the root manifest defines a crate, that crate's table already configures the project, so the sub-table is an error instead of a second place for the same settings. The workspace's name prefix stays with the members, whose names it separates; a workspace project's default name comes from its folder, and a collision of that name is resolved with the project's own `name`. Names are neither checked nor rewritten beyond `/` to `-`: Nx accepts any string, and the characters that are awkward on its command line are rare in folder names and fixed with the override. Where the workspace folder already is an Nx project, Nx merges the two and names the result ([[EVD-NX-PROJECT-MERGE]]); the plugin accepts that as it does for a crate, because [[REQ-WORKSPACE-PROJECT]] fixes the project's root.
:::

:::mara decision ADR-ALL-DEP-KINDS
:mid: 01M78FHG7F89HNQ2GAMHTHFRC2
:title: Keep every dependency kind in the graph, including cycles
:status: accepted
:justifies: REQ-DEPENDENCY-EDGES
:justifies: DES-PROJECT-GRAPH

Leaving dev-dependencies out of the graph means a change in a crate used only by another crate's tests does not invalidate those cached tests. All three kinds are therefore edges.

Cargo allows cycles through dev-dependencies. Three treatments were considered: drop the edge that closes the cycle and add the crate's files as explicit inputs, fail graph creation, or keep the edge. Nx 24 fails only on a cycle between tasks, not between projects ([[EVD-NX-24-INSPECTION]]), and the plugin's targets declare no dependencies between crates ([[ADR-NO-RUST-BUILD-DEPS]]). The edge is kept, so `nx graph` shows what Cargo sees and no workspace that Cargo accepts is rejected. If a user's own `dependsOn` turns the project cycle into a task cycle, Nx reports it. Nx 24 hashes `^` inputs over a project cycle stably ([[EVD-NX-24-INPUT-SEMANTICS]]).
:::

:::mara decision ADR-EXTERNAL-NODES
:mid: 01M78FHG7FYRBX038BA9MX7YXN
:title: Represent external crates as graph nodes
:status: accepted
:justifies: REQ-EXTERNAL-DEPS
:justifies: DES-LOCKFILE-HASHING

With the whole `Cargo.lock` as an input, any dependency update invalidates every crate of the workspace. Each direct external dependency becomes a node with the prefix `cargo:` instead, so a crate can be hashed on the dependencies it uses. This is agreed in principle; the hashing mechanism is not designed yet.

Neither is the identity of a node. Several workspaces have several lockfiles, and one lockfile can hold several versions of a crate, so a name without a version cannot stand for all of them. The nodes are therefore created only together with the hashing design, and until then the whole lockfile stays an input.
:::

:::mara decision ADR-METADATA-KEY
:mid: 01M78FHG7FQK38H3AQ3ZN130A0
:title: Keep overrides under the nx key of Cargo metadata
:status: accepted
:justifies: REQ-METADATA-OVERRIDES
:justifies: DES-METADATA-TABLES
:accepts: RISK-METADATA-KEY-COLLISION

Overrides live in `Cargo.toml`, next to what they override, in `[package.metadata.nx]` and `[workspace.metadata.nx]`. The key `nx` mirrors the `nx` property that Nx reads from `package.json` and holds what a `project.json` would hold, which is short and familiar to Nx users. The alternatives were `nx-rust`, named after the package as Cargo tools usually do, and a split between `nx` for project settings and `nx-rust` for plugin switches. `nx` was chosen with the known cost that another Nx plugin for Rust could claim the same key.
:::

:::mara decision ADR-NX-TARGET-NAMES
:mid: 01M78FHG7FTBB2RVZTTTWPYG1P
:title: Use Nx target names by default
:status: accepted
:justifies: REQ-TARGET-NAMES
:justifies: DES-TARGETS
:accepts: RISK-TARGET-DEFAULTS

The plugin is written first for mixed JS/TS and Rust repositories, whose pipelines run `nx affected -t lint test build`. With Cargo's names, clippy would be skipped until every pipeline adds `clippy`. Inferred targets therefore use the Nx name where Nx projects conventionally have a target for the same job: clippy runs as `lint`, and `test` and `build` keep their names. Every name can be changed in the plugin options, so Cargo's names are an opt-in. The cost is that target defaults written for JS targets of the same name also reach Rust targets.

Formatting was decided separately. Nx has a convention for it, but it is the built-in commands `nx format:check` and `nx format:write`, not a target. They run prettier or oxfmt over files and cannot be made to run rustfmt in Nx 24 ([[EVD-NX-FORMAT]]). Naming the rustfmt targets `format-check` with `format-write` or `format` was considered. They keep Cargo's names, `fmt-check` and `fmt`, so that nobody takes them for that command: `format` is a reserved command name, and `nx format <project>` would silently run Nx's formatter instead of `cargo fmt`.

`check` has a counterpart: `typecheck`, which the TypeScript plugin of `@nx/js` infers and which the CI workflow that Nx generates runs beside `lint`, `test` and `build` ([[EVD-NX-24-TARGETS]]). It keeps Cargo's name all the same. That pipeline already runs `lint`, and clippy checks everything `cargo check` does, so a Rust `typecheck` would only check every affected crate a second time; clippy does not reuse what `cargo check` compiled for the crate itself ([[EVD-CARGO-TARGET-COMMANDS]]). A repository that wants the name can rename the target. The remaining targets (`doc`, `bench`, `run`) and the targets of the workspace project (`audit`, `deny`, `update`) have no Nx counterpart and keep the names of Cargo and the tools.
:::

:::mara decision ADR-NO-RUST-BUILD-DEPS
:mid: 01M78FHG7FCE6NXVG4J9K82XME
:title: Put no build dependencies between Rust crates
:status: accepted
:justifies: REQ-NO-RUST-TASK-DEPS
:justifies: DES-TARGETS

Cargo builds a crate's dependencies itself, so a `dependsOn: ["^build"]` between crates adds no ordering that is needed. It only starts one cargo process per dependency, and they queue on the build lock ([[EVD-NXRUST-BUILD-DEPS]]). Invalidation is handled by `^` inputs. JS consumers of an artifact depend on the artifact target.

The first design also made `^build` on edges from JS projects to Rust crates an opt-in. Nx leaves no room for that: a JS target that declares `^build` gets the `build` task of every project it depends on that has such a target, and neither the plugin nor the dependency can decline ([[EVD-NX-24-INSPECTION]]). The plugin therefore adds no dependency to JS projects and removes none. A JS target's own `^build` runs the native `build` of the crates its project depends on directly and stops there, because those targets declare no dependencies. The cost is a native build that a consumer of a wasm package or a Node addon does not need; batching folds such builds into one cargo call ([[DES-BATCH]]). Renaming the native build so that `^build` would miss it was rejected, because `nx affected -t build` would then skip Rust ([[ADR-NX-TARGET-NAMES]]).
:::

:::mara decision ADR-RESULTS-ONLY-CACHE
:mid: 01M78FHG7FYVQP1W5GZC509GEF
:title: Cache task results and final artifacts, never Cargo's intermediates
:status: accepted
:justifies: REQ-CACHE-OUTPUTS
:justifies: DES-OUTPUTS
:justifies: DES-BUILD-DIRS

Cargo's build directory is large, its layout is internal and changes between Cargo versions, and restoring parts of it from another run confuses Cargo's own freshness checks. Nx therefore stores what a consumer needs: the result of a check or test, and the final artifacts of a build. Cargo keeps its build directory, which CI caches as a whole. A cache hit on `build` gives back a binary, not a warm compiler state; the next real compile relies on the build directory.

Final artifacts are the files that something other than Cargo consumes: executables, and `cdylib` and `staticlib` libraries. An `rlib` or `dylib` only feeds further Rust compilation and stays Cargo's. Nx can store only files inside the repository, so where the artifact directory lies outside it, the targets that would store artifacts run uncached. Caching their result without the files would restore a build that has no binary.
:::

:::mara decision ADR-DECLARED-INPUTS
:mid: 01M78FHG7FGX22WZF138Z8K89G
:title: Describe cache keys with declared inputs, not a custom hasher
:status: accepted
:justifies: DES-INPUTS
:justifies: REQ-ENV-ALLOWLIST

Nx deprecates custom hashers and plans to remove them in Nx 25 ([[EVD-NX-24-INSPECTION]]). Task-based affected, the default in Nx 24, selects tasks by matching changed files against their declared inputs, so complete file inputs are also what make `nx affected` correct. Environment and runtime inputs only change keys: a change to them alone makes no task affected ([[EVD-NX-24-INPUT-SEMANTICS]]). All cache inputs are therefore declared: filesets, `^` inputs, environment variables, runtime commands and target options. Environment variables come from a fixed, extendable list, never the whole environment, because a key that includes everything never repeats.

For files the choice goes the other way. The whole folder of a crate is an input, not a list of source folders. A list would invalidate less, but it misses what macros and build scripts read: a README included as crate documentation, templates, migrations, protocol definitions, and sources at a path the manifest names. Running a crate's tasks again after a change that could not affect them is the accepted side of that trade. A negated pattern in the repository's own configuration takes files out of the folder's input, on the repository's responsibility.
:::

:::mara decision ADR-BATCH-EXECUTOR
:mid: 01M78FHG7F9MD0KQ68Y5CC4HK5
:title: Run tasks through an Nx batch executor
:status: accepted
:justifies: REQ-BATCHING
:justifies: DES-BATCH
:accepts: RISK-BATCH-BEHAVIOUR

Nx decides what runs and what is cached, per crate. Cargo should still be invoked as few times as possible, because each invocation takes the build lock and resolves the workspace again. An executor with `batchImplementation` and `preferBatch: true` gets both: Nx hashes, restores and caches each task, and the plugin runs one cargo call per group. The known cost is that Nx starts no other task while a batch runs.
:::

:::mara decision ADR-WORKSPACE-FEATURES
:mid: 01M78FHG7F9M47HN1VS68YT9K3
:title: Always resolve features for the whole workspace
:status: accepted
:justifies: REQ-STABLE-FEATURES
:justifies: DES-UNIFICATION
:justifies: DES-FEATURE-SETS

A batch of whatever is affected changes the set of crates built together on every run. Because of [[TERM-FEATURE-UNIFICATION]], that changes the features of shared dependencies, which causes rebuild churn and makes a crate's result depend on its batch. The plugin therefore resolves features for the whole workspace on every run. Three strategies do this at different costs: `hakari` where the workspace already uses cargo-hakari, Cargo's own `feature-unification` setting as an experimental opt-in, and building the whole workspace as the fallback that always works.
:::

:::mara decision ADR-ONE-TEST-TARGET
:mid: 01M78FHG7FWYPHVZ9TAHHZ0A5N
:title: Keep one test target and put the mode in the cache key
:status: accepted
:justifies: REQ-AFFECTED-TESTS
:justifies: REQ-TEST-MODE-KEY
:justifies: DES-TEST-MODE

Affected-test selection could be a second target beside `test`. Users would then have to know which one to run where, and pipelines would differ between branches. Instead there is one `test` target that decides inside whether to run a subset or the full suite. What keeps the cache honest is the [[TERM-TEST-MODE]] in the key: a runtime input that prints `full` or `affected:<baseline commit>`.
:::

:::mara decision ADR-TEST-MODE-CHOICE
:mid: 01M78NVF8E9Q5SD8FDP09ADE2D
:title: Let the consumer choose the test mode, with a default per environment
:status: accepted
:justifies: DES-TEST-MODE
:justifies: REQ-AFFECTED-TESTS

The first design said the mode is `full` on the main branch and `affected` elsewhere. The plugin cannot tell reliably which of the two it is on: CI checkouts are detached or shallow, pull requests are tested on merge commits, and release branches and merge queues are neither. Asking Git whether HEAD is contained in the default branch was considered and rejected for the same reasons. The pipeline knows what it is running, so the consumer chooses: the environment variable `NX_RUST_TEST_MODE` names the mode of a run.

Two things follow. The `affectedTests` setting does not choose a mode. It declares that a workspace uses selection, which adds the baseline target and the mode input and makes every machine check the setup, so a missing tool shows on a developer's machine and not first in CI. And the default without the variable depends on where the run happens: `affected` on a developer's machine, so that local work gets selection without any setup, and `full` where Nx detects CI ([[EVD-NX-24-INSPECTION]]), so that a pipeline that sets nothing, such as the one for main, runs the whole suite. A pull request pipeline asks for `affected` explicitly.

An environment variable switches selection on, and not a command-line flag, because the command that puts the mode into the cache key can read the environment but not the `nx` command line. The flag `--affectedTests=false` can only force the full suite.
:::

:::mara decision ADR-TEST-SELECTOR
:mid: 01M78FHG7FH90JZ8ESEP4R4HCJ
:title: Use cargo-affected only to select and nextest to run
:status: accepted
:justifies: DES-TEST-RUN
:justifies: REQ-DOCTESTS

cargo-affected can both select and run tests, but it is very early and has no archive support. The plugin asks it for the selection only and runs the tests itself through nextest, which keeps per-crate results under the plugin's control, keeps the selector replaceable, and leaves room for a distributed mode. nextest does not run doctests, so they run through `cargo test --doc` whenever nextest is the runner; that is not optional.
:::

:::mara decision ADR-ARTIFACT-TARGET-NAMES
:mid: 01M78FHG7FYRNEHZNVW6V2DWJ0
:title: Give each kind of artifact its own target name
:status: accepted
:justifies: REQ-ARTIFACT-TARGETS
:justifies: DES-ARTIFACT-STEPS

A different kind of artifact gets its own target name (`napi-build`, `wasm-build`); a different flavour of the same artifact is a flag. One `build` target with a configuration per artifact was rejected for four reasons. Nx's `dependsOn` names a target and cannot pin a configuration of it ([[EVD-NX-24-INSPECTION]]), so a JS app could not depend on the wasm build. `nx run-many -t build -c wasm` would run the default native build on every crate without a wasm configuration. One configuration applies per invocation, so native plus wasm would take two commands. And a named target exists only on crates that produce that artifact.
:::

:::mara decision ADR-NO-WASM-PACK
:mid: 01M78FHG7F6KP7TGK6B0447FHY
:title: Call cargo and the wasm-bindgen CLI directly
:status: accepted
:justifies: DES-WASM

wasm-pack is not a base to build on: the rustwasm organisation was sunset in 2025 and wasm-pack was slated for archiving. The plugin runs `cargo build` and the `wasm-bindgen` CLI itself, which also lets the compile step take part in batching.
:::

:::mara decision ADR-SINGLE-MACHINE
:mid: 01M78FHG7FYYRPH4D9BRH2Y94M
:title: Target a single machine in v1
:status: accepted
:justifies: DES-TEST-PHASES

Spreading Rust tasks across Nx agents needs answers that are not available yet: where Nx computes hashes, whether targets can be pinned to one machine, and how batched tasks are assigned to agents. v1 runs all Rust tasks of a pipeline on one machine. The only v1 requirement for a later distributed mode is a seam: the test executor keeps building and running as separate internal phases.
:::

:::mara decision ADR-COMPATIBILITY
:mid: 01M78FHG7FFBVZPZCQKJNXGT0P
:title: Support Nx 24, Cargo 1.91+, Linux and macOS
:status: accepted
:justifies: REQ-COMPATIBILITY
:justifies: DES-BUILD-DIRS

Nx 24 makes task-based affected the default, which the cache design relies on. The plugin supports the Nx majors its end-to-end suite has passed on, which is Nx 24 at first. The batch executor interface and the way Nx evaluates inputs are not stable across majors ([[RISK-UPSTREAM-CHANGES]]), so a later major joins the package's peer dependency range only once the suite passes on it. Promising "Nx 24 and later" was rejected, because it would claim behaviour nobody has checked. Cargo 1.91 is the first version with a separate build directory, so there is one cache model and no degraded mode for older toolchains. Windows hosts need their own handling of paths, shells and linkers and are left out of v1. A repository with an older Nx or Cargo gets a clear error.
:::

:::mara decision ADR-V1-SCOPE
:mid: 01M78FHG7FTPVXE53KP8PW9NR7
:title: Limit what v1 does
:status: accepted
:justifies: REQ-NO-MANIFEST-WRITES
:justifies: REQ-DIAGNOSTICS
:justifies: REQ-COMPATIBILITY
:accepts: RISK-UNDECLARED-INPUTS
:accepts: RISK-HOST-ENVIRONMENT

The plugin stays a thin layer between Nx and Cargo. It does not install toolchains or tools: rustup, nextest, cargo-affected, cargo-hakari and the `wasm-bindgen` CLI are the user's to install, and the plugin reports what is missing. It does not build hermetically: there is no sandbox and no remote execution, and it trusts Cargo and a declared set of inputs. It does not write `Cargo.toml`, `Cargo.lock` or `.cargo/config.toml` outside generators, release and tasks the user runs to change them. It does not run on Windows hosts.

Also outside v1: cross-compiling Node addons to other platforms, wasm tests, publishing napi and wasm packages to npm, tests on triples other than the host, migration from `@monodon/rust`, formatting Rust through `nx format` ([[EVD-NX-FORMAT]]), and distributed execution ([[ADR-SINGLE-MACHINE]]). Adding any of these needs a recorded need and decision first.
:::

:::mara decision ADR-SETUP-GENERATORS
:mid: 01M78FHG7FYKPH14862MWJ4KJB
:title: Ship init and crate generators in v1
:status: accepted
:justifies: REQ-INIT
:justifies: REQ-CRATE-GENERATORS

v1 has an `init` generator behind `nx add`, and `library` and `binary` generators that wrap `cargo new`. Because projects are inferred, generators are a convenience: a crate created with plain `cargo new` works the same. A generator that migrates a repository from `@monodon/rust` is left for later.
:::

:::mara decision ADR-WORKSPACE-ROOT
:mid: 01M78NVF8ENATA4CGDH3PMYVSF
:title: Run cargo in the workspace root and key the toolchain found there
:status: accepted
:justifies: DES-INVOCATION
:justifies: DES-INPUTS
:justifies: REQ-TOOLCHAIN-KEY

rustup picks the toolchain file, and Cargo its configuration files, from the folder a command starts in and its parents, not from the manifest of the crate being built. A command for a group of crates has one such folder. The plugin therefore starts every cargo command in the workspace root, and the toolchain is a property of the workspace ([[TERM-WORKSPACE-CONTEXT]]). Starting each task in its crate's folder was rejected: per-crate files would apply as they do for a developer who works in that folder, but crates with such files could not share an invocation.

The first design keyed the toolchain with `rustup run <channel> rustc -Vv`, with the channel read from the toolchain file. That needs rustup, and it misses a toolchain chosen through `RUSTUP_TOOLCHAIN` or `rustup override`, which cargo honours. Plain `rustc -Vv`, run in the workspace root, asks the question cargo will ask, with or without rustup.

The cost is that a toolchain or configuration file inside a member crate changes the cache key without changing what Nx runs, and that a developer who starts cargo inside such a crate builds differently from Nx. The documentation says so. Nx 24 runs a runtime input through `sh -c` in the repository root, so the toolchain command can change into the workspace root first ([[EVD-NX-24-INPUT-SEMANTICS]]).
:::

:::mara decision ADR-CI-LINUX-ONLY
:mid: 01M78KFR0QP1XDDHMYRA2RTNET
:title: Run CI on Linux only for the moment
:status: accepted
:accepts: RISK-MACOS-UNVERIFIED

GitHub's hosted macOS runners are in short supply in November 2026, so jobs on them wait long or do not start. The plugin is a JavaScript package with no platform-specific build, so only test runs are affected: this repository's CI runs its unit and end-to-end tests on Linux only for the moment. macOS stays a supported host ([[ADR-COMPATIBILITY]]), and code must not assume Linux. What is deferred is the check: no macOS run backs the claim until the jobs are added, and [[VER-SETUP]] says so. When macOS runners are usable again, the macOS jobs are added to the workflow, the macOS part of the verification is restored, and this decision and its risk are retired.
:::

:::mara decision ADR-NO-ERROR-CODES
:mid: 01M7A67WRX56A7M56CJZ7VF326
:title: Name problems in words, without error codes, in v1
:status: accepted
:justifies: DES-DIAGNOSTICS

A diagnostic says what is wrong, where, and what to do ([[REQ-DIAGNOSTICS]]). In v1 it carries no code. Nx 24 shows no numbered codes in its diagnostics, and the cargo messages seen while designing the generators carried none either ([[EVD-NX-24-SETUP]], [[EVD-CARGO-NEW]]), so a code would stand alone in a user's output. Once published, a code is an interface to keep stable and to document. Tests check the facts a message names instead.

Codes may be introduced later without breaking anything, because adding a code to a message takes away nothing a user or a script relies on. They would serve people or tools that need to refer to one problem across releases: a documentation page per problem, filtering warnings in a pipeline, or wording that changes often. One possible scheme is a stable code for each row of [[DES-DIAGNOSTICS]], listed in the setup guidance and never reused for another problem. Whether to introduce codes, and in what form, is decided when such a need arises.
:::

:::mara decision ADR-DECLARED-FILE-INPUTS
:mid: 01M7ACMK1QTQXRJFFNXHPB53FS
:title: Declare files outside a crate instead of learning them from builds
:status: accepted
:justifies: REQ-BUILD-SCRIPT-INPUTS
:justifies: REQ-FILE-INPUTS-HASHABLE
:justifies: REQ-BUILD-INPUT-CHECK
:justifies: DES-INPUTS
:justifies: DES-BUILD-INPUT-CHECK

A build script, a macro or a test can read files outside its crate's folder, which the crate-file input does not cover. The cache key has to name such files before the task runs, and nothing reports them then: neither the `cargo metadata` report nor Cargo's JSON messages carry them ([[EVD-CARGO-NO-DEPS]], [[EVD-CARGO-DEP-INFO]]). Only Cargo's records of a finished build do. The repository therefore declares these files in its Cargo manifests under `fileInputs`, and the plugin turns each pattern into an Nx fileset. The key is named to pair with the keys that add environment variables and commands to the key.

Three alternatives were rejected:

- **Learning the paths from earlier builds.** Only `cargo build` leaves a documented record, the dependency file beside each artifact. The records of `check`, `lint`, `test` and `doc` exist only in the build directory, whose layout moved between Cargo 1.97 and 1.100 and which the plugin never reads ([[DES-BUILD-DIRS]]). Records exist per machine and only after a build, so a fresh CI checkout has none: its first run would either compute a key without the files, which a shared cache could later answer with a result built from other files, or a key that never hits. Carried in a runtime input, the learned files would change keys but never make a task affected, because task-based affected matches changed files against declared file inputs only ([[ADR-DECLARED-INPUTS]], [[EVD-NX-24-INPUT-SEMANTICS]], [[EVD-NX-24-FILE-INPUTS]]).
- **Scanning `build.rs` and the sources for literal paths.** Build helpers such as tauri-build and bindgen print `rerun-if-changed` for paths they compute, and a proc macro can open files itself ([[EVD-CARGO-DEP-INFO]]). A scan would find a part and suggest it found all.
- **Leaving the files out of v1.** A runtime command under `runtimeInputs` that hashes the files changes keys, but `nx affected` ignores it. A change to a shared protocol definition would then leave `nx affected -t build` green without building the crates that embed it, which [[NEED-AFFECTED]] rules out.

A declaration also covers what no record shows: a file that a proc macro opens by itself, which Cargo does not track either. Its cost is that the repository has to state the files. To catch what it forgot, a `build` task that ran cargo compares the dependency files Cargo wrote with its inputs, and fails when one names a repository file that no input covers ([[REQ-BUILD-INPUT-CHECK]]). It fails instead of warning because Nx stores every successful result and an executor cannot report success without it being stored, so a warning would leave a result under a key known to miss a file ([[EVD-NX-24-FILE-INPUTS]]). Nx Cloud can record the files a task reads, but nothing records them without it, so that is no substitute.
:::

:::mara decision ADR-GRAPH-NO-TOOLCHAIN-INSTALL
:mid: 01M7AN094P6S3K7M62DNC8P15H
:title: Let rustup install no toolchain while the graph is created
:status: accepted
:justifies: DES-METADATA-REPORT

A workspace's `rust-toolchain.toml` can pin a toolchain that the machine lacks, and rustup installs such a toolchain the first time a command needs it, unless `RUSTUP_AUTO_INSTALL=0` is set ([[EVD-RUSTUP-MISSING-TOOLCHAIN]]). The plugin runs cargo whenever Nx creates the project graph, also on a machine that only works on JS projects. It therefore runs every cargo command of graph creation with `RUSTUP_AUTO_INSTALL=0`: a pinned toolchain that is missing fails graph creation with rustup's message, which names it, and creating the graph downloads nothing ([[ADR-V1-SCOPE]]). Where cargo is no rustup proxy, the variable has no effect. The cargo commands of tasks get no such setting, so a task installs a missing toolchain exactly when the same plain cargo command would ([[REQ-CARGO-UNCHANGED]]).

Leaving rustup's default was rejected, because `nx graph`, or any Nx command that creates the graph, could then download a toolchain unasked. Setting the variable for tasks as well was rejected, because a task would then fail where the same plain cargo command succeeds.
:::

## Risks

Several risks below are assumptions that the design rests on and that nobody
has checked yet. Each of those has a spike in the backlog, and milestone 1.0
closes them.

:::mara risk RISK-METADATA-KEY-COLLISION
:mid: 01M78FHG7F58QYEVQ7DX5KNQK5
:title: Another tool claims the nx metadata key
:status: accepted
:likelihood: unlikely
:consequence: moderate
:threatens: NEED-CONFIG-IN-CARGO

Another Nx plugin for Rust, or Nx itself, could start reading `[package.metadata.nx]` with a different meaning. Manifests would then carry settings two tools interpret differently, and one of them would have to move to another key. [[ADR-METADATA-KEY]] accepts this.
:::

:::mara risk RISK-TARGET-DEFAULTS
:mid: 01M78FHG7FAJAK7K2EN2P4XE8C
:title: Target defaults written for JS reach Rust targets
:status: accepted
:likelihood: likely
:consequence: major
:threatens: NEED-EFFICIENT-BUILDS
:threatens: NEED-CORRECT-CACHE

Because Rust targets share the names `build`, `lint` and `test` with JS targets, a `targetDefaults` entry keyed by a bare name applies to them. Nx 24 lays the entry over the inferred target: its `dependsOn`, `inputs`, `outputs` and `cache` replace the inferred values unless a list keeps them with `"..."`, and its `options` reach the executor ([[EVD-NX-TARGET-DEFAULTS]]). A `dependsOn: ["^build"]` then adds a build of every crate a crate depends on ([[EVD-NXRUST-BUILD-DEPS]]); batching ([[DES-BATCH]]) puts them in one batch with the build that needs them. An `inputs` list written for a JS tool drops the toolchain, environment and workspace inputs from the key, so a result built under other settings is restored. An `outputs` list drops the artifacts, so a cache hit restores no binary, and `cache: true` caches the targets that the plugin leaves uncached because their artifacts lie outside the repository. A `filter` on projects, plugin or executor keeps an entry away from Rust targets ([[EVD-NX-24-INSPECTION]]), but a `plugin` filter cannot select targets from `package.json` scripts or `project.json` files. [[REQ-TARGET-DEFAULT-GUARD]] is the planned mitigation.
:::

:::mara risk RISK-UNDECLARED-INPUTS
:mid: 01M78FHG7F7QAFW6P09CQYEPJA
:title: A task reads something its cache key does not cover
:status: accepted
:likelihood: possible
:consequence: major
:threatens: GOAL-TRUSTED-CACHE
:threatens: NEED-CORRECT-CACHE

A build script, proc macro or test can read files outside the crate, environment variables outside the allowlist, or the network. A change there does not change the key, and a stale result is restored. The plugin declares what it knows: it hashes the whole folder of a crate and of a path dependency without a project, and warns where Nx cannot see such a dependency's files. A repository adds the files outside a crate that the crate reads ([[REQ-BUILD-SCRIPT-INPUTS]]), and variables and commands. A `build` that ran cargo fails when Cargo's dependency files name a repository file that no input covers ([[REQ-BUILD-INPUT-CHECK]]).

What remains: a file that a proc macro opens without an include macro, which Cargo does not track and no dependency file shows; files that only `check`, `lint`, `test` or `doc` read, or that tests open at run time, since Cargo records those reads only in its build directory or not at all; any undeclared read of a crate whose `build` does not run through Nx, as in a pipeline that runs only `lint` and `test`; files outside the repository, which Nx cannot hash; environment variables outside the list; and the network ([[EVD-CARGO-DEP-INFO]]). Without a sandbox the plugin cannot detect these. [[ADR-V1-SCOPE]] accepts this.
:::

:::mara risk RISK-HOST-ENVIRONMENT
:mid: 01M78FHG7F36BVH0EP3K2REH3E
:title: A result is restored on a machine that differs in ways the key cannot see
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: NEED-CORRECT-CACHE

The key contains the toolchain, including the host triple, and the target triple. It does not contain system libraries, the linker, the C toolchain version, or Cargo and tool configuration outside the repository, such as `$CARGO_HOME/config.toml` or a rustfmt configuration in the home directory. With a cache shared between unlike machines of one triple, a test result or a dynamically linked binary from one can be restored on another where it would behave differently. A repository can add a runtime input that tells its machines apart. [[ADR-V1-SCOPE]] accepts this.
:::

:::mara risk RISK-SUBSET-AS-FULL
:mid: 01M78FHG7FECGDXGMB8MB75DPD
:title: A subset test result is reused as a full-suite result
:status: accepted
:likelihood: unlikely
:consequence: severe
:threatens: REQ-TEST-MODE-KEY
:threatens: GOAL-TRUSTED-CACHE

If the result of running selected tests were stored under the key of the full suite, the main branch could show green for tests that never ran. [[DES-TEST-MODE]] prevents it by putting the mode and the baseline commit into the key. The remaining exposure is the mode command reporting another mode than the one the task runs in, for example when Nx reuses an old evaluation or runs the command in another environment than the task ([[RISK-NX-INPUT-SEMANTICS]]).
:::

:::mara risk RISK-NX-INPUT-SEMANTICS
:mid: 01M78FHG7FWVEHYKF3KRPQYTWN
:title: Nx evaluates inputs differently from what the design assumes
:status: accepted
:likelihood: unlikely
:consequence: major
:threatens: REQ-TEST-MODE-KEY
:threatens: REQ-TOOLCHAIN-KEY
:threatens: NEED-AFFECTED
:threatens: REQ-ENV-ALLOWLIST

The design assumed that a runtime input is evaluated afresh on each run, also under the Nx daemon; that its command runs through a shell from the repository root, so that it can change into a workspace folder, and with the environment of the `nx` command; that task-based affected treats runtime inputs and batched tasks the way the cache does; and that `^` inputs hash stably when projects form a cycle. Nx 24.0.6 confirms most of this ([[EVD-NX-24-INPUT-SEMANTICS]]). It evaluates a runtime input once per task of every run, also under the daemon, through `sh -c` in the repository root, with the environment of the `nx` command plus the dotenv files it loads for the task. Batched and unbatched runs select the same tasks and share their keys, and `^` inputs hash stably over a project cycle. Two differences remain.

In a batch, Nx computes each task's key with an environment it rebuilds for that task from dotenv files, but starts the batch process with the environment of the `nx` command, into which it loaded only the root `.env`, `.env.local` and `.local.env`, and in another order of priority. The two differ when a file in the crate's folder or a root file named for a target or configuration, such as `.env.test`, sets a variable; when `.env.local` and `.local.env` set it differently; and when a shell value equal to a root file's value is unloaded for the task ([[EVD-NX-24-INPUT-SEMANTICS]]). A test mode, a toolchain or a listed variable is then in the key of a task that runs with another value. A result could be stored under a key that does not describe it, a subset result under the full-suite key among them ([[RISK-SUBSET-AS-FULL]]). This takes batching and dotenv files that set one of these variables. [[DES-BATCH]] rebuilds each task's environment from the same files and runs every cargo call with it. That copy of Nx's loading is the remaining exposure: a later Nx that reads other files, or in another order, would bring the gap back.

Task-based affected selects tasks by changed files, never by environment variables or the output of runtime commands. A toolchain update without a change to a toolchain file, or a new value of a listed variable, makes no task affected, although it changes the keys. A task that does run still misses the cache, so no stale result is restored, but `nx affected` does not run the tasks such a change reaches.
:::

:::mara risk RISK-BATCH-BEHAVIOUR
:mid: 01M78FHG7FARJNEMM2EFX7XFY9
:title: Nx batches behave worse than the design needs
:status: accepted
:likelihood: likely
:consequence: moderate
:threatens: REQ-BATCHING
:threatens: NEED-EFFICIENT-BUILDS

Since Nx 22.7 no other task starts while a batch runs, so in a mixed repository JS tasks wait for the Rust batch. Per-task results and per-task caching from a batch executor also still have to be confirmed on the supported Nx versions. [[ADR-BATCH-EXECUTOR]] accepts the waiting; a failure of per-task caching would need a different design.
:::

:::mara risk RISK-HAKARI-GAPS
:mid: 01M78FHG7F2NTRC9DZ1NMXWY7V
:title: cargo-hakari does not unify everything the plugin relies on
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: REQ-STABLE-FEATURES

cargo-hakari's documentation describes unification of third-party dependencies only. If it does not unify features that one workspace crate enables on another, building only the selected crates gives batch-dependent results. [[DES-UNIFICATION]] detects such features and falls back to building the whole workspace, which costs time where it applies. A stale hack crate and features masked by it are covered by the drift check and the optional strict build. To check with a small workspace.
:::

:::mara risk RISK-CARGO-AFFECTED
:mid: 01M78FHG7F5EH60R4TW2E645EW
:title: cargo-affected does not deliver what the test design assumes
:status: accepted
:likelihood: possible
:consequence: major
:threatens: REQ-AFFECTED-TESTS
:threatens: NEED-FAST-TESTS

cargo-affected describes itself as very early. The design assumes that `status --report-json --report-detail full` lists tests precisely enough to build a nextest filter and to map results to crates, and that `status` is cheap although it lists tests through nextest, which needs built test binaries. If either fails, selection costs more than it saves or cannot be done. The selector is a replaceable step and the feature is off by default. To check on a real workspace.
:::

:::mara risk RISK-COVERAGE-COST
:mid: 01M78FHG7F5ES0QNZ84J94JZQ2
:title: Collecting coverage costs too much on main
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: NEED-FAST-TESTS

The baseline needs `cargo affected collect` or `collect --diff` on every main commit. Instrumented builds and runs are slower and use a different build configuration. If the overhead is large, the main pipeline slows down more than pull requests speed up. To benchmark on a real workspace; a separate build directory for coverage builds is available as a switch.
:::

:::mara risk RISK-BASELINE-DRIFT
:mid: 01M78FHG7F90XWFCQ150XBFKGM
:title: Selection gets noisy as the baseline falls behind
:status: accepted
:likelihood: possible
:consequence: minor
:threatens: NEED-FAST-TESTS

A pull request compared against an older baseline has a wider diff and selects more tests. How quickly that happens is inferred from how cargo-affected stores its data, not measured. The consequence is lost time, not a wrong result. The full recollect threshold in [[DES-BASELINE]] is the control. To measure.
:::

:::mara risk RISK-UPSTREAM-CHANGES
:mid: 01M78FHG7F662HG5KVZQEN15Z3
:title: Unstable upstream interfaces change under the plugin
:status: accepted
:likelihood: likely
:consequence: moderate
:threatens: NEED-EFFICIENT-BUILDS
:threatens: NEED-FAST-TESTS

Several things the plugin uses are not stable: Cargo's `resolver.feature-unification`, whose name or values could still change; the layout of the build directory, which changed in Cargo 1.100; cargo-affected's commands and report format; and Nx's batch executor interface. The plugin avoids the build directory layout entirely, keeps the `cargo` strategy experimental and the selector replaceable, and supports only the Nx majors it has been verified on ([[ADR-COMPATIBILITY]]). To track Cargo's stabilisation.
:::

:::mara risk RISK-MIXED-PROJECT-MERGE
:mid: 01M78FHG7FMS3SAP65G9TME7FF
:title: Two plugins describe one folder differently
:status: accepted
:likelihood: almost-certain
:consequence: moderate
:threatens: NEED-JS-BRIDGE
:threatens: REQ-WORKSPACE-PROJECT
:threatens: REQ-PROJECT-NAMES

A napi or wasm crate usually has `Cargo.toml` and `package.json` side by side, so this plugin and Nx's `package.json` plugin both create a project for the folder. Nx merges them into one project, and it applies `package.json` and `project.json` after every plugin listed in `nx.json` ([[EVD-NX-PROJECT-MERGE]]). The project is therefore named by `package.json`, or by a `project.json` that sets a name, and not after the crate. A script or `project.json` target that has the name of an inferred target, such as `build` or `test`, and runs something else replaces the inferred target, with its cache settings and inputs, without a message. The same happens to the workspace project when a Cargo workspace sits in a folder that already is an Nx project, such as a repository root with a `project.json` or with an `nx` key in its `package.json`. An edge that names such a project by its crate name is dropped without a message or fails graph creation, while a `dependsOn` entry that names it is rewritten to the new name. [[REQ-MIXED-PROJECTS]] is the planned mitigation. Checked on Nx 24.0.6; to check again on each Nx major the plugin supports.
:::

:::mara risk RISK-NAPI-TOOLING
:mid: 01M78FHG7F2Q33HWV789RWB7T7
:title: The napi CLI does not fit the two-step build
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: REQ-ARTIFACT-TARGETS

[[DES-NAPI]] assumes that the napi CLI can post-process an existing cargo build, so that compiling stays in the batch. If the CLI insists on running cargo itself, `napi-build` leaves the batch and takes the build lock on its own. It is also unknown whether napi crates need a special feature to link under `cargo test`. To check both.
:::

:::mara risk RISK-MACOS-UNVERIFIED
:mid: 01M78KFPPYBZHRM9B41K0TG46Q
:title: macOS support breaks without anyone noticing
:status: accepted
:likelihood: possible
:consequence: moderate
:threatens: REQ-COMPATIBILITY

While CI runs on Linux only, nothing runs the plugin on macOS. A change that works on Linux can fail there, for example through a case-insensitive file system, a different linker and library naming for Node addons, or different toolchain paths, and the failure reaches users first. Until macOS runs exist, the claim that macOS is supported rests on the design and not on test runs. [[ADR-CI-LINUX-ONLY]] accepts this for the moment.
:::

## Evidence

:::mara evidence EVD-NXRUST-GAPS
:mid: 01M78FHG7F71QFJZNFBAATR6N4
:title: Gaps found in nxrust v0.3.0
:status: accepted
:supports: ADR-NEW-PLUGIN

Reading eddacraft/nxrust at v0.3.0 (last commit 22 October 2026) on 12 November 2026, in particular its product specification, its cache and toolchain design, `src/graph.ts`, `src/utils/cache-inputs.ts` and `plans/issues.md`, showed:

- Dev-dependencies are dropped from the graph, so a change in a dev-only workspace crate does not invalidate the dependent's cached tests.
- The whole `Cargo.lock` is an input, so any lockfile change invalidates every crate.
- There is no batching and no handling of feature unification.
- `build.rs` `rerun-if-changed` paths and intermediate `.cargo/config.toml` files are not hashed.
- The `cargo metadata` cache is in memory only, and the Cargo workspace must sit at the Nx root.
- `build` restores `rlib` files into Cargo's `target/`.

This is a reading of source and documents, not a test of the plugin.
:::

:::mara evidence EVD-NXRUST-BUILD-DEPS
:mid: 01M78FHG7FKCEAGRQKJ36NF8WZ
:title: Inherited ^build turned a 52-second test run into 40 minutes
:status: accepted
:supports: ADR-NO-RUST-BUILD-DEPS
:supports: RISK-TARGET-DEFAULTS

nxrust's issue log records this as ISS-001, "Cross-language ^build inheritance amplifies cargo lock contention" (`plans/issues.md`, lines 8 to 31, in eddacraft/nxrust at commit 53572b2 of 22 October 2026). The measurement comes from nxrust's consumer workspace, eddacraft/anvil-001, pull request #1729. There, JS tests inherited `^build` across to the Rust crates, and `pnpm test` took 40m03s. After the script was split into `test:js && test:rust` it took 31 to 52 seconds, a 46-fold speedup. The entry states that the useful work was about 52 seconds and that the rest was cargo builds queued on the `target/` lock. The same figures are cited in `plans/modules/10-wasm-napi.aps.md`, under the cross-language `dependsOn` contract.

This is a secondary record: what was read, on 12 November 2026, is nxrust's account of the measurement, not the anvil-001 pull request itself. The measurement was not reproduced here.
:::

:::mara evidence EVD-NX-24-INSPECTION
:mid: 01M78FHG7F32NTNKGXVJT9QA2A
:title: What Nx 24.0.6 declares about batching, inputs, cycles and affected
:status: accepted
:supports: ADR-ARTIFACT-TARGET-NAMES
:supports: ADR-BATCH-EXECUTOR
:supports: ADR-DECLARED-INPUTS
:supports: ADR-ALL-DEP-KINDS
:supports: ADR-COMPATIBILITY
:supports: ADR-NO-RUST-BUILD-DEPS
:supports: ADR-TEST-MODE-CHOICE
:supports: RISK-TARGET-DEFAULTS

Inspection of the `nx` 24.0.6 package installed in this repository, on 12 November 2026:

- **`dependsOn`.** An object entry accepts `projects`, `dependencies`, `target`, `params`, `options`, `inputs` and `waitFor`, and no other property (`schemas/project-schema.json`). Nothing selects a configuration of the dependency's target.
- **`^` dependencies.** An entry with `dependencies: true`, which is what `^build` stands for, adds the named target of every project the task's project depends on that has it. For a dependency without that target, the walk continues to that project's own dependencies. Nothing lets a plugin, or the project depended on, exclude itself (`tasks-runner/create-task-graph.js`).
- **Batching.** An `executors.json` entry accepts `batchImplementation` and `preferBatch`. Without `--batch`, the scheduler batches a task only when its executor sets `preferBatch`. It forms one batch per executor, from the runnable tasks of that executor and the tasks of the same executor that depend on them (`tasks-runner/tasks-schedule.js`).
- **Custom hashers.** The `hasher` entry and its types are marked "deprecated: Use target inputs instead. This will be removed in Nx 25".
- **Affected.** `affected.legacy` in `nx.json` is described as "Select every task of each affected project, instead of only the tasks whose inputs a change reaches" and defaults to `false`, so selection by task inputs is the default.
- **Cycles.** Running a command fails with "the task graph has a circular dependency" when tasks form a cycle, unless `NX_IGNORE_CYCLES` is set (`tasks-runner/run-command.js`). No check that rejects a cycle between projects was found.
- **Target defaults.** A `targetDefaults` value can be an array of entries, each with a `filter` on `plugin`, `projects` or `executor`.
- **Inputs.** Input kinds include `fileset`, `runtime`, `env` and `externalDependencies`.
- **Plugin interface.** `createNodes` receives all matching files at once and may return `externalNodes`; `createNodesV2` is a deprecated alias. A plugin entry in `nx.json` accepts `include` and `exclude` lists beside `options` (`config/nx-json.d.ts`).
- **Option overrides.** The options passed on the command line are part of a task's hash (`hasher/task-hasher.js`).
- **CI detection.** `isCI()` reports CI when `CI` is set to anything but `false`, or when one of the variables that the common CI systems set is present, such as `GITHUB_ACTIONS`, `GITLAB_CI` or `BUILDKITE` (`utils/is-ci.js`).

This is a reading of type definitions, schemas and compiled source. It shows what Nx declares, not how it behaves in every case; behaviour is checked by the spikes named under the risks.
:::

:::mara evidence EVD-NX-TARGET-DEFAULTS
:mid: 01M7A0NA0X5XDW6MEQNS90EWC2
:title: How Nx 24.0.6 lays target defaults over inferred targets
:status: accepted
:supports: RISK-TARGET-DEFAULTS
:supports: ADR-NX-TARGET-NAMES

An experiment on 13 November 2026 with `nx` 24.0.6, Node.js 26.12.0, pnpm 12.18.0 and rustc 1.100.0, in a throwaway pnpm workspace outside this repository. A stand-in plugin, listed in `nx.json` by its package name, made projects of two crates, `app` and its path dependency `core-lib`, and gave each the `build` and `test` targets that [[DES-TARGETS]] and [[DES-INPUTS]] describe: no `dependsOn`, `cache: true`, a named input for the crate folder with its `^` form, an `env` input for `RUSTFLAGS`, a `runtime` input for `rustc -Vv`, and an executor with `batchImplementation` and `preferBatch`. The executor ran no cargo; it recorded what it received and wrote a file into the declared output. Beside the crates were a JS project whose `build` is a `package.json` script and one whose `build` came from a second stand-in plugin. Each variant of `targetDefaults` was read back with `nx show project <name> --json`. Runs used `nx run <project>:build --output-style=static`, with `NX_DAEMON=false` and `NX_CACHE_DIRECTORY` set to a folder that was emptied before each variant. The Nx sources read alongside are `project-graph/utils/project-configuration-utils.js`, and `target-defaults.js` and `target-merging.js` in `project-graph/utils/project-configuration/`.

- **Precedence.** Nx merges the targets of the plugins listed in `nx.json` first, then target defaults, then the targets of `project.json` and `package.json` files. A target default therefore overrides an inferred target, and a project's own file overrides the target default.
- **Replaced, not merged.** An entry keyed `build` with `dependsOn: ["^build"]`, `inputs: ["default", "^default"]`, `outputs: ["{projectRoot}/dist"]` and `cache: false` replaced each of these four values on both crates. A field the entry does not set kept its inferred value. `options` were merged key by key, and the executor received the entry's option beside the inferred ones.
- **Options.** An entry keyed `test` with `options: { passWithNoTests: true }` passed the option to the executor. With `additionalProperties: false` in the executor's schema, `nx run core-lib:test` failed instead, and the batch worker printed only an unhandled rejection with a `SchemaError`, naming neither the option nor the entry.
- **Spread.** A list containing `"..."`, such as `inputs: ["...", "{workspaceRoot}/.tool-versions"]`, kept the inferred entries in that place and added the others.
- **Cache key.** With `inputs: ["default", "^default"]` from a default, `nx run core-lib:build --exclude-task-dependencies` ran with `RUSTFLAGS` unset and then with `RUSTFLAGS=-Copt-level=1`. The second run restored the first result from the cache, including the file written under the empty `RUSTFLAGS`. Without the entry, or with `"..."` in its list, the second run executed.
- **Outputs.** With `outputs: ["{projectRoot}/dist"]` from a default, a second run after deleting the inferred output folder was a cache hit that restored no file. Without the entry the hit restored the file.
- **Task graph.** With `dependsOn: ["^build"]` from a default, `nx run app:build` also ran `core-lib:build`. Both tasks reached the executor in one batch, and the task graph in the executor's context held the dependency.
- **Filters.** Array entries with `filter.plugin` set to the JS stand-in's name, with `filter.projects` set to `["tag:lang:js"]`, `["!tag:lang:rust"]` or `["packages/*"]`, where the crates carried the tag `lang:rust`, or with `filter.executor` set to `nx:run-commands` all left the crates' targets as inferred. `filter.plugin` compares with the `name` a plugin module exports or, if it exports none, with its entry in `nx.json`. It matched no target from a `package.json` script, not even as `nx/core/package-json`: Nx records a source plugin only for targets from the plugins listed in `nx.json`.
- **Key precedence.** A key naming the target's executor is chosen before the key naming the target, even when its value is empty. With an empty entry keyed by the stand-in's executor beside a `build` entry, the crates' `build` stayed as inferred and the JS `build` targets took the `build` entry. An entry that sets another `executor`, such as `@nx/js:tsc`, was dropped for targets with a different executor.
- **What a plugin sees.** `createNodes` receives `targetDefaults` as written in `nx.json`, not the merged targets. `createDependencies` receives `context.projects` with the merged targets. The batch executor found the merged target in `context.projectsConfigurations` and the added dependency in `context.taskGraph`. Nx's resolver for target defaults, `readTargetDefaultsForTarget`, is exported only from `nx/src/devkit-internals`.

The stand-ins ran no cargo, so this shows how Nx merges, hashes and schedules targets of this shape, not what inherited builds cost in time.
:::

:::mara evidence EVD-NX-24-INPUT-SEMANTICS
:mid: 01M7A0X81J8XAG79EE2DFXFEZD
:title: How Nx 24.0.6 evaluates runtime inputs, selects affected tasks and hashes a cycle
:status: accepted
:supports: ADR-WORKSPACE-ROOT
:supports: ADR-TEST-MODE-CHOICE
:supports: ADR-ALL-DEP-KINDS
:supports: DES-INPUTS
:supports: RISK-NX-INPUT-SEMANTICS

Experiments on 13 November 2026 with `nx` 24.0.6, the version this repository installs, cargo and rustc 1.100.0, rustup with the toolchains 1.97.1, 1.98 and 1.100.0, Node 26.12.0 and git 2.56.0, on Linux x86-64 with bash as `/bin/sh`. The throwaway workspace lay outside this repository and had the default task-based affected. It held two Cargo workspaces: `rs`, whose `rust-toolchain.toml` selects 1.98, with the members `a`, `b` and `d`, where `b` depends on `a`, `a` has `b` as a dev-dependency and `d` depends on `b`; and `rs2`, with the member `c` and no toolchain file. A local plugin made each crate a project, with an edge for every dependency kind from `cargo metadata --no-deps`, and gave it two cached targets with the inputs of [[DES-INPUTS]]: the crate's folder as a named input and `^` over it, the workspace's `Cargo.toml` and `rust-toolchain.toml`, the runtime input `cd <workspace> && rustc -Vv`, a runtime input running a Node script that logged each evaluation with its working directory, `$0` and environment, and one `env` input. `probe` (`nx:run-commands`) logged `NX_TASK_HASH`. `test` used an executor with `batchImplementation` and `preferBatch: true` that ran `cargo test` once per Cargo workspace and logged its environment. The commands were `nx run-many -t probe --skip-nx-cache`, also with `-p` for subsets and from a crate's folder, `nx run-many -t test` with and without `--batch=false`, `nx affected -t probe --base=main --head=HEAD --explain=stdout` and `nx affected -t test --base=main --head=HEAD --skip-nx-cache` with and without `--batch=false`. Each case ran with `NX_DAEMON=false` and again with `NX_DAEMON=true`, the daemon started by `nx daemon --start` with variables that later commands did not set. Both modes gave the same results and the same hashes:

- **Evaluation.** Nx evaluated a runtime input once per task, not once per run: four tasks with the same command gave four evaluations. Every run evaluated it again, also when the daemon reused its cached project graph, and a changed output of the command, read from a file outside the workspace, changed the hashes of the next run.
- **Shell and folder.** The command ran through `sh -c` (`$0` was `sh`), in the repository root, also when `nx` was started in a crate's folder. `cd rs && rustc -Vv` worked. The hash of `a` was the same with and without `RUSTUP_TOOLCHAIN=1.98`, that of `c` was not, and `RUSTUP_TOOLCHAIN=1.97.1` changed every hash: the toolchain file of the folder the command changed into applied.
- **Environment.** The command saw the environment of the `nx` command. Variables that only the daemon's process had were not visible to it, and a `PATH` with another `rustc` in front changed the hashes under the daemon too. Nx added the dotenv files it loads for the task: a variable set in `rs/d/.env` reached the command of `d` only, one in a root `.env.test` reached the commands of `test` tasks, and a value set in the shell won over both, unless it equalled a root file's value (see the load order below). With `RUSTUP_TOOLCHAIN=1.97.1` in `rs/d/.env`, the hash of `d` differed from that of a run with the same file and `NX_LOAD_DOT_ENV_FILES=false`, and the hashes of `a` and `b` did not change; with `1.98` in that file, the two runs gave the same hash.
- **Batches.** Nx hashed each task of a batch with that task's environment, but started the batch process with the environment of the `nx` command and the root `.env`, `.env.local` and `.local.env` only (`getEnvVariablesForBatchProcess` in `tasks-runner/task-env.js`). With `NX_RUST_TEST_MODE=full` in `rs/d/.env` or in a root `.env.test`, and the variable unset in the shell, the runtime input printed `full` while the batch process had no value; with `--batch=false`, each task's process had `full`. A value in the root `.env` reached both. Root files that apply to every task still gave a mismatch: with `NX_RUST_TEST_MODE=full` in `.env.local`, `affected` in `.local.env` and nothing in the shell, every runtime input printed `full` and the batch process had `affected`. With `affected` in the shell and in `.env` and `full` in `.env.test`, the runtime inputs printed `full` and the batch process had `affected`. Without dotenv files, batched and unbatched runs restored each other's results, four of four either way.
- **Load order.** As read in the installed source (`utils/dotenv.js`, `tasks-runner/task-env.js` and `tasks-runner/task-env-paths.js`): at start, Nx loads `.local.env`, `.env.local` and `.env` from the repository root into its own environment, in that order of priority and below the shell, and the batch process inherits that environment. For a task, Nx copies that environment, unloads each variable whose value equals the one the root `.env`, `.local.env` or `.env.local` gives it, and then loads the task's files with variable expansion; the first file to set a variable wins, and no file overrides a value still present. It reads the project's folder first and then the repository root. In each, the identifiers are `<target>.<configuration>`, `<non-atomized target>.<configuration>`, `<configuration>`, `<target>` and `<non-atomized target>`, as far as they apply, each read as `.env.ID.local`, `.env.ID`, `.ID.local.env` and `.ID.env`, followed by `.env.local`, `.local.env` and `.env`. Because the unloading compares values, a shell value equal to a root file's value is removed before the task's files load, and a task file can then supply another value.
- **Affected.** `nx affected` selected tasks by changed files only. A commit changing a source file of `a` or of `b` selected `a`, `b` and `d`; one of `d` selected `d`, one of `c` selected `c`, a change of `rs/rust-toolchain.toml` selected `a`, `b` and `d`, and a new root `README.md` selected nothing. Without a changed file, a new value of the `env` input, `RUSTUP_TOOLCHAIN=1.97.1` or a new output of a runtime command selected nothing, while `nx run-many` found none of the four tasks in the cache. In each of these seven cases, `nx affected -t test` ran the same tasks batched and with `--batch=false`.
- **Cycle.** The hashes of `a`, `b` and `d` stayed the same across runs of all three together and of each alone, in either order. A change in `a` or in `b` changed all three hashes, and undoing it restored them. No run reported a task cycle.

One evaluation of `rustc -Vv` took about 6 ms on this machine, and one of the Node script about 14 ms.

These results support [[ADR-WORKSPACE-ROOT]], [[ADR-TEST-MODE-CHOICE]], [[ADR-ALL-DEP-KINDS]] and the toolchain, environment and `^` inputs of [[DES-INPUTS]]. They contradicted an assumption of [[DES-TEST-MODE]] and [[DES-BATCH]] as first written: in a batch, the executor and cargo can run with other values than the key was computed with, through a per-task dotenv file, through the different priority of `.env.local` and `.local.env`, or through an unloaded shell value. A toolchain set in one crate's `.env` also shows that the tasks of one Cargo workspace need not share a toolchain. [[RISK-NX-INPUT-SEMANTICS]] records what remains. The workspace was a toy and ran on one machine, so this says nothing about the cost of per-task evaluation in a large workspace or about macOS.
:::

:::mara evidence EVD-CARGO-NO-DEPS
:mid: 01M78RC7T7182TG80N949GFTTC
:title: What cargo metadata --no-deps reports, offline and without a lockfile
:status: accepted
:supports: ADR-METADATA-NO-DEPS

An experiment with cargo 1.99.1 on 12 November 2026. The workspace had two members, a path dependency between them, a path dependency on a crate outside the workspace, two registry dependencies, `nx` metadata tables and no `Cargo.lock`. Cargo ran with an empty Cargo home and `--offline`.

- `cargo metadata --format-version 1 --no-deps` succeeded and created no `Cargo.lock`. Adding `--locked` changed nothing.
- The full report failed in the same setting, because it could not find the registry dependencies.
- The `--no-deps` report listed the two members as packages, with their targets and crate types, and the workspace and package `metadata` tables. Each declared dependency carried its name, version requirement, kind, features and source, and a path dependency carried the absolute path of its folder. `resolve` was null. `workspace_root`, `target_directory` and `build_directory` were present.
- The crate outside the workspace was not among the packages. It appeared only as the path in its dependent's entry.
- Run in a crate that lies inside the workspace folder without being a member, the command failed with Cargo's message "current package believes it's in a workspace when it's not", which names both manifests and the remedies.

The workspace was a toy, so this says nothing about how long the call takes on a large one.
:::

:::mara evidence EVD-NX-PROJECT-MERGE
:mid: 01M7A0S43EXZZGRM5WND8Z0BBG
:title: How Nx 24.0.6 merges two plugins' projects at one root
:status: accepted
:supports: RISK-MIXED-PROJECT-MERGE
:supports: REQ-WORKSPACE-PROJECT
:supports: REQ-PROJECT-NAMES
:supports: ADR-PROJECT-NAMES
:supports: DES-PROJECT-GRAPH
:supports: REQ-INFERRED-PROJECTS
:supports: REQ-METADATA-OVERRIDES
:supports: DES-METADATA-TABLES

An experiment on 13 November 2026 with `nx` and `@nx/js` 24.0.6, TypeScript 6.0.3, pnpm 12.18.0, Node 26.12.0 and cargo 1.100.0 on Linux, together with a reading of the same `nx` package (`project-graph/utils/project-configuration-utils.js`, `project-configuration/project-nodes-manager.js` and `target-merging.js`, `plugins/package-json/create-nodes.js`).

The throwaway pnpm workspace, outside this repository, had a Cargo workspace at its root (`members = ["crates/*"]`) with three member crates: `napi-addon`, `spike-core`, and `spike-cli`, which had path dependencies on the other two. The folder of `napi-addon` also held a `package.json` named `@spike/napi-addon`, which `pnpm-workspace.yaml` listed (`crates/*` and `packages/*`), with the scripts `build`, `test` and `prepublishOnly` and with `nx.tags`. A JS package `@spike/web` in `packages/web` depended on it with `workspace:*`. The root `package.json`, named `spike-root`, had no `nx` key unless a case says so. A stand-in for this plugin, the only plugin in `nx.json` unless a case says so, ran `cargo metadata --format-version 1 --no-deps --offline` for each workspace root manifest. It returned one project per member, named after the crate, with tags, metadata and `build` and `test` targets that ran cargo; `build` set `cache`, `inputs`, `outputs` and `metadata.description`. It also returned a project named `cargo-workspace` at the workspace folder, with `fmt`, `audit` and `deny`. Its `createDependencies` returned, in this order, an edge from the workspace project to each member (`napi-addon`, `spike-cli`, `spike-core`) and then one for each path dependency (`spike-cli` to `napi-addon`, then to `spike-core`). Depending on the case, it named each end by the stand-in's own name or by the name that `context.projects` lists for the project at that root. Each case was read with `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false pnpm exec nx graph --file=out/graph.json` and `nx show projects`, and one target was run with `nx run`.

- **Order.** Nx merges all projects returned for one root into one project. It merges the plugins listed in `nx.json` in their order, then target defaults, then its built-in `package.json` and `project.json` plugins, in that order. No position in `nx.json` puts a plugin after those two.
- **Name.** A later layer replaces the name. A folder whose `package.json` Nx reads takes its name from that file (`nx.name`, or else `name`), and a `project.json` that sets a name overrides both, whatever the order in `nx.json`. A `project.json` without a name kept the earlier name. Of two plugins listed in `nx.json`, the later one's name won. Nx reads a `package.json` only when the package manager's workspaces list it or a `project.json` sits beside it, and the root `package.json` also when it has an `nx` key. A crate's `package.json` outside the workspaces left the crate's project, name and targets unchanged.
- **Targets.** Targets with different names were all kept. By `isCompatibleTarget` in `target-merging.js`, two targets with one name are merged when either of them names no executor, or when both name the same executor and, for `nx:run-commands` and `nx:run-script`, the same command or script, or one of them none. A merge keeps the earlier target's settings and lets each setting of the later one replace its counterpart: a `project.json` target `build` with `executor: "nx:run-commands"` and only `inputs`, or with `inputs` and no executor, kept the cargo command, `cache`, `outputs` and metadata and replaced the list of inputs. Any other target of the same name replaces the earlier one, with its `cache`, `inputs` and `outputs`. Only the earlier target's metadata can remain, merged under the later target's when the later one has metadata of its own: a `project.json` `build` with another command and no metadata left nothing of the cargo target. A `package.json` script is a target with the executor `nx:run-script` and with metadata, so the scripts `build` and `test` replaced the cargo targets while the stand-in's `description` stayed in their metadata, and `nx run` of the merged project's `build` ran the script. Between `@nx/js/typescript` and the stand-in, the plugin listed later in `nx.json` won `build`, and the TypeScript `build` came with its own `dependsOn: ["^build"]`.
- **Tags, implicit dependencies and metadata.** The tags of all layers were united and their implicit dependencies combined. Metadata was merged key by key: objects such as `targetGroups` were combined, lists under one key concatenated, and a plain value such as `description` replaced by the later layer's.
- **Edges.** In `createDependencies`, `context.projects` is keyed by the merged names, and each entry carries its root. Nx adds a plugin's edges one at a time, in the order returned. An edge whose target was the crate name of a project that `package.json` had renamed was dropped without a message, and the edges around it were kept. An edge whose source was such a name failed graph creation with "Source project does not exist". Nx added none of the edges after it, while those before it stayed in its partial graph. When the root `package.json` renamed the workspace project, the invalid source came first and no edge of the stand-in was kept. With an edge from `napi-addon` to `spike-core` inserted after the three edges from the workspace project, those three were kept and the two after it were not. Edges whose ends were looked up by root were all present. A `dependsOn` entry that named the crate was rewritten to the merged name, and the JS package's `workspace:*` dependency became an edge to the merged project.
- **Workspace project at the root.** Without a root `project.json` and without an `nx` key in the root `package.json`, the workspace project stood alone under the stand-in's name. With either, it merged into the root project and took that file's name. The root scripts `audit` and `lint` and a `project.json` target `fmt` replaced or joined the workspace targets by the rules above, and the merged project depended on every member.
- **Collisions.** A crate and a JS package with one name in different folders made Nx fail with its own message, "The following projects are defined in multiple locations", which lists both folders and recommends a `project.json`. A lookup by root in `context.projects` finds only one of two projects that share a name. When the stand-in returned an edge with the missing end undefined, Nx failed with "Cannot read properties of undefined (reading '1')" instead.

For a crate folder that also is a JS project, no plugin listed in `nx.json` can set the project's name. [[REQ-PROJECT-NAMES]], [[ADR-PROJECT-NAMES]] and [[DES-PROJECT-GRAPH]] therefore name such a project by its `package.json` or `project.json`; until 13 November 2026 they named every project after its crate or its `name` override. For the review of 13 November 2026, the following were re-run in the same workspace, with `outputs` added to the stand-in's `build`: the target merges and replacements, both edge orders, the dropped edges, the `dependsOn` rewrite, the names given by `nx.name` with and without a named `project.json`, and the TypeScript `build`. The other outcomes are from the first run. The stand-in modelled the planned plugin; the plugin itself and other Nx versions were not tested.
:::

:::mara evidence EVD-WORKSPACE-PROJECT-NAMES
:mid: 01M7A8AKF5NT40CMP6236AFA2V
:title: How Cargo 1.100.0 and Nx 24.0.6 treat names for a workspace project
:status: accepted
:supports: ADR-WORKSPACE-PROJECT-NAME
:supports: REQ-PROJECT-NAMES
:supports: DES-PROJECT-GRAPH
:supports: DES-METADATA-TABLES

Experiments on 13 November 2026 with cargo 1.100.0, `nx` 24.0.6 and Node 26.12.0 on Linux, in throwaway folders outside this repository, together with a reading of the same `nx` package. The Nx workspaces linked the `node_modules` of this repository, had a root `package.json` and listed one stand-in plugin in `nx.json`. Its `createNodesV2` matched `**/name.txt` and returned a project at that file's folder, named by the file's content, with targets `fmt` and `audit` that echo the folder. Commands ran with `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false NX_NO_CLOUD=true NX_TUI=false`, and runs with `--output-style=static --skip-nx-cache`.

- **Cargo has no workspace name.** In a virtual manifest, `name` under `[workspace.package]` made `cargo check --offline` warn `unused manifest key: workspace.package.name`. `cargo metadata --no-deps --offline --format-version 1` reported `workspace_root` as an absolute path, and `[workspace.metadata.nx]` with its nested `project` table (`name`, `tags`, `targets.sqlx-prepare.command`) unchanged under the report's top-level `metadata`. For a root manifest with both `[package]` and `[workspace]`, the report carried `[package.metadata.nx]` on that package and `[workspace.metadata.nx.project]` at the top level.
- **Cargo package names.** `cargo metadata` on a one-package manifest rejected the names `a.b`, `a:b`, `a/b`, `a+b`, `a b` and `a~b` ("characters must be Unicode XID characters (numbers, `-`, `_`, or most letters)"), `@a` (not a Unicode XID start character) and `1abc` (starts with a digit), and accepted `abc`, `a_b`, `a-b`, `Rust-WS` and `ü-crate`.
- **Nx accepts any name.** The stand-in created projects named `rust`, `a.b`, `@ws/rust`, `a:b`, `a b`, `Rust-WS`, `rust+ws`, `ws/rust`, `cargo:ws`, `ü-rust`, `a,b`, `!bang`, `x*y`, `tag:foo`, `a#b`, `rust/` and `.dot`. `nx show projects` listed all of them, and for each one `nx run <name>:fmt`, `nx fmt <name>` and `nx show project <name> --json` reached that project. Nx checks only that a name is present and unique (`validateProject` in `project-graph/utils/project-configuration/target-normalization.js`).
- **Patterns.** `nx run-many -t fmt -p <name>` ran exactly that project for each name except two: `-p 'a,b'` split into `a` and `b` and ran five projects, and `-p '!bang'` excluded that project and ran every other one. A pattern without glob characters that is not exactly a project name matches the names that contain it as a whole word, ignoring case and counting `-` and `@` as part of a word, and only when no name matches, a project folder: `-p Rust` ran `rust`, `@ws/rust`, `rust+ws`, `ws/rust` and `rust/` (`utils/find-matching-projects.js`). With a `:` in a name, `nx run` tries every split of the string against the graph and warns when more than one fits (`utils/split-target.js`); `nx run a:b:fmt` and `nx run cargo:ws:fmt`, which no other project made ambiguous, ran.
- **Folders.** A project named `rust-workspace` in `rustdir/` was reached by `nx fmt rustdir`, `nx run rustdir:fmt`, `nx show project rustdir --json`, `-p rustdir` and `-p directory:rustdir`, and one named `services-billing` in `services/billing/` by `nx fmt services/billing` and `nx run services/billing:fmt`; `nx fmt ./rustdir` failed with "Cannot find project". When a name is not found, `nx run`, `nx <target> <project>` and `nx show project` fall back to the same pattern matching and accept a single match (`command-line/run/run-one.js`, `command-line/show/project.js`). Inside `rustdir/`, a bare `nx fmt` ran that project (`config/calculate-default-project-name.js`).
- **Root.** In a second workspace with the stand-in's project `cargo-workspace` at the root, a project `sub-crate` in `sub/` and a root `package.json` named `exp-root-pkg`, `nx fmt` from the root, `nx fmt .`, `-p .` and `-p directory:.` each ran the root project. `nx show project . --json` named the root project `cargo-workspace` without a root `project.json` and without an `nx` key; `exp-root-pkg` with `"nx": {}` in the `package.json`, and also with a root `project.json` of `{}`; and `repo` with a root `project.json` that sets that name. In each of these cases the project kept `fmt` and `audit`. With a `project.json` of `{}` and a root `package.json` without a name, graph creation failed.
- **Default names.** For the review, a second stand-in matched `**/ws.txt` and named its project by the agreed rule: the path from the root with each `/` replaced by `-`, `cargo-workspace` at the root, or the file's content when it had any. Projects in `services/billing/` and `services-billing/` both got `services-billing`, and projects at the root and in `cargo-workspace/` both got `cargo-workspace`. In both cases Nx failed with "The following projects are defined in multiple locations", listing the two folders.
- **When Nx reads a `package.json`.** With that stand-in and the name `billing-override` set for `services/billing/`, the project kept `billing-override` after a `project.json` of `{}` was added to that folder with no `package.json` beside it, and took `@acme/billing` once a `package.json` of that name was added beside the `project.json`. Without the `project.json`, that `package.json` left `billing-override` in place, with or without an `nx` key, until the root `package.json` listed `services/*` under `workspaces`. At the root, `cargo-workspace` gave way to the root `package.json` name when the workspace patterns included `.`, through `"workspaces": ["."]` in that file or `packages: ["."]` in `pnpm-workspace.yaml`, and stayed when `pnpm-workspace.yaml` listed only `packages/*`. Nx therefore reads a `package.json` when the package manager's workspace patterns include it or when a `project.json` sits beside it, and the root `package.json` also when it has an `nx` key; a nested `package.json` with only an `nx` key is not read (`plugins/package-json/create-nodes.js`).
- **Nx's default.** For a `project.json` without a name, Nx uses the last segment of its folder in lower case, and `.` at the root (`config/to-project-name.js`); read, not run.
- **Checkouts.** The checkout of this repository in which the work was done is a folder named `t3-978a6461-ca0fb10813ae42be`, not `nx-rust`.

How often a workspace folder has the name of one of its own crates was not measured, and macOS was not tested.
:::

:::mara evidence EVD-NX-FORMAT
:mid: 01M78JWQAZK1MDJ6GC4M70ZCXX
:title: nx format cannot run rustfmt in Nx 24.0.6
:status: accepted
:supports: ADR-NX-TARGET-NAMES

Inspection of the `nx` 24.0.6 package installed in this repository, and two experiments, on 12 November 2026:

- **A command, not a target.** `nx format:check` and `nx format:write` (alias `nx format`) are built-in commands. They run the workspace's one formatter over changed files, over `--projects` or over `--all`, and they run no targets (`command-line/format/format.js`).
- **Two formatters, no hook.** The formatter is oxfmt or prettier, detected from configuration files or from the dependencies in the root `package.json`, oxfmt first. Any other formatter is an error; there is no plugin hook (`utils/formatters/`).
- **A reserved name.** `format` is in the list of known commands that Nx checks before it treats the first argument as a target (`bin/init-local.js`). `nx format <project>` therefore runs the built-in command, never a target named `format`.
- **prettier.** Before Nx calls prettier it keeps only the files whose extension or name is in `prettier.getSupportInfo()`, called without plugins. With prettier 3.10.1 that call does not list `.rs`; it does when a plugin that declares `.rs` is passed explicitly. A prototype prettier plugin that pipes a file through `rustfmt --emit stdout` (rustfmt 1.10.0) formatted and checked `.rs` files through the plain `prettier` CLI. So a rustfmt plugin for prettier is feasible, but `nx format` drops `.rs` files before prettier sees them.
- **oxfmt.** Given a `.rs` file and a `Cargo.toml`, oxfmt 0.78.0 ignored the `.rs` file and reported the `Cargo.toml` as unformatted. Its configuration schema has no setting for plugins or external formatters. In a workspace that uses oxfmt, `nx format:write` therefore reformats `Cargo.toml` files and leaves Rust sources alone.

The prototype was not run through `nx format` itself; that Nx filters `.rs` out is read from its source, and that the filter excludes plugin languages was tested against prettier directly. Covering Rust in `nx format` would need Nx to pass the configured plugins to its filter, and would still not reach workspaces that use oxfmt.
:::

:::mara evidence EVD-CARGO-NEW
:mid: 01M7A66QH6W8544G03RW7GAX0G
:title: What cargo new does inside a repository and a workspace
:status: accepted
:supports: DES-GENERATORS
:supports: DES-DIAGNOSTICS

Experiments with cargo 1.100.0 (3acc79c0c 2026-11-05) on Linux, on 13 November 2026, in throwaway git repositories (`git init`, no commit) outside this repository. No folder pinned a toolchain.

- **A git repository inside the crate.** In a repository where `rust/` existed and `rust/crates/` did not, `cargo new rust/crates/core` created `.git` and a `.gitignore` inside the new crate. Where the parent folder existed, `cargo new direct` created neither. `cargo new --vcs none newparent2/a/b`, with no folder of that path present, created neither.
- **Members.** In a workspace with `members = ["crates/*"]`, `cargo new --lib rust/crates/core` left the workspace manifest unchanged. `cargo new --bin rust/tools/cli` printed "Adding `cli` as member of workspace at …" and appended `"tools/cli"` to `members`, keeping the existing entry. In a workspace without a `members` key, `cargo new --vcs none --lib ws-nomembers/crates/a` added `members = ["crates/a"]`. With a workspace inside another workspace's folder, the crate was added to the nearer workspace only.
- **Exclude.** In a workspace with `members = ["crates/*"]` and `exclude = ["vendor/*"]`, `cargo new --vcs none --lib ws-exclude/vendor/v` appended `"vendor/v"` to `members` and left `exclude` as it was. `cargo metadata --no-deps --format-version 1` then listed `v` among the members: the explicit member overrode `exclude`.
- **Inheritance.** In a workspace whose `[workspace.package]` set `edition = "2021"` and `license = "MIT"` and which had `[workspace.lints.rust]`, the new manifest had `edition.workspace = true`, `license.workspace = true` and `[lints] workspace = true`. With `--edition 2024`, it had `edition = "2024"` and still `license.workspace = true`.
- **Name.** `cargo new --vcs none --bin --name my-tool rust/crates/tool-dir` created the package `my-tool` in the folder `tool-dir`. Without `--name`, the package took the folder's name; for `core`, cargo warned that the name may be confused with the standard library's package.
- **Outside a workspace.** `cargo new --vcs none --lib standalone-parent/s` wrote `edition = "2024"` and changed no other manifest. Inside the folder of a valid package without a `[workspace]` table, the new crate was its own workspace root, according to `cargo metadata`. When the enclosing package's manifest was invalid, cargo still created the crate and warned that compiling it may not work.
- **An existing folder.** `cargo new --vcs none --lib rust/crates/ed`, run a second time, failed with "destination `…` already exists" and exit status 101, and changed nothing.
- **Options.** `cargo new --help` lists `--vcs` (`git`, `hg`, `pijul`, `fossil`, `none`), `--bin` (the default), `--lib`, `--edition` (2015, 2018, 2021, 2024), `--name` and `--registry`.

Only one Cargo version was tried, on Linux. The messages observed carried no error codes.
:::

:::mara evidence EVD-CARGO-DIRECTORIES
:mid: 01M7A6739R6CSCWVAQ2JJWDHF2
:title: Where Cargo puts its two directories, and which versions report them
:status: accepted
:supports: DES-GENERATORS
:supports: DES-DIAGNOSTICS

Experiments on Linux on 13 November 2026, in throwaway folders outside this repository, with `cargo metadata --no-deps --format-version 1`. No folder pinned a toolchain, and the older toolchains were already installed and selected with `cargo +<version>` under `RUSTUP_AUTO_INSTALL=0`.

- **Default.** Without configuration, cargo 1.100.0 reported `build_directory` and `target_directory` both as `<workspace>/target`, inside the workspace folder. For a crate that is its own workspace, that is a folder inside the crate.
- **Template.** With `[build] build-dir = "{cargo-cache-home}/build/{workspace-path-hash}"` in a `.cargo/config.toml` above the workspace, cargo 1.100.0 reported a `build_directory` below the Cargo home (`~/.cargo/build/21/d5123ee45e798c`) and the same `target_directory` as before.
- **Versions.** For a one-crate package, the report of cargo 1.89 had no `build_directory` key, and the reports of cargo 1.97.1 and 1.100.0 had it. The other top-level keys were the same in all three: `metadata`, `packages`, `resolve`, `target_directory`, `version`, `workspace_default_members`, `workspace_members` and `workspace_root`.

Cargo's source settles where the field begins. It was added to `cargo metadata` by rust-lang/cargo pull request #15377, merged on 2 April 2025, while `build.build-dir` was unstable. In the Cargo that Rust 1.90.0 ships (rust-lang/cargo commit 840b83a, package version 0.91.0), `src/cargo/ops/cargo_output_metadata.rs` writes `build_directory` only when the unstable `-Zbuild-dir` flag is on, and leaves the key out otherwise; unstable flags work only on nightly. In the Cargo that Rust 1.91.0 ships (commit ea2d978, package version 0.92.0), it always writes the field, and Cargo's changelog lists the stabilisation of `build.build-dir` under 1.91. The report of a stable Cargo therefore has `build_directory` from 1.91 on. The source was read through GitHub, at the cargo commits that the `src/tools/cargo` submodule of rust-lang/rust names at the tags `1.90.0` and `1.91.0`. Cargo 1.90 and 1.91 were not run here, because no toolchain was downloaded.
:::

:::mara evidence EVD-RUSTUP-MISSING-TOOLCHAIN
:mid: 01M7AN00P9TZ5VQQT8SSXTHC4V
:title: What rustup 1.29.3 and Nx 24.0.6 do when a pinned toolchain is missing
:status: accepted
:supports: DES-METADATA-REPORT
:supports: RISK-NX-INPUT-SEMANTICS
:supports: ADR-GRAPH-NO-TOOLCHAIN-INSTALL

Experiments on 13 November 2026 on Linux x86-64 with rustup 1.29.3, whose proxies came first on `PATH`, and with `nx` 24.0.6, in throwaway folders outside this repository. A folder's `rust-toolchain.toml` named the toolchain `1.92.0`, which was not installed. Every command that could reach rustup ran with `RUSTUP_AUTO_INSTALL=0`, and rustup listed the same toolchains afterwards.

- **rustup's default.** Earlier that day, while the test fixtures were built and with the variable unset, a plain `rustup show active-toolchain` in a folder whose toolchain file named `1.91.0`, missing then, downloaded and installed that toolchain without asking. That case was not run again.
- **Missing toolchain.** In the pinned folder, `cargo metadata --no-deps --format-version 1` and `rustc -Vv` each wrote nothing to standard output, wrote `error: toolchain '1.92.0-x86_64-unknown-linux-gnu' is not installed` and ``help: run `rustup toolchain install` to install it`` to standard error, and exited with status 1. So did `sh -c 'cd pinned && RUSTUP_AUTO_INSTALL=0 rustc -Vv'`, the form a runtime input takes, started in the parent folder with the variable unset.
- **Folder.** In a workspace whose root pinned nothing, a member and a path dependency outside the workspace each pinned `1.92.0` in their own folder. `cargo metadata` started in the root folder succeeded, for the workspace and with `--manifest-path` naming the path dependency, while the same calls started in the member's and in the dependency's folder failed as above. The folder a command starts in decides which toolchain file applies, not the manifest it reads.
- **Without rustup.** With the cargo and rustc 1.99.1 of the Arch Linux `rust` package first on `PATH`, which are no rustup proxies, both commands succeeded in the pinned folder with the variable set: cargo reported the package, and `rustc -Vv` reported 1.99.1. Such a toolchain ignores the toolchain file and the variable.
- **Nx.** In a workspace whose cached `nx:run-commands` target had the runtime input `cd ../pinned && RUSTUP_AUTO_INSTALL=0 rustc -Vv` as its only input, `nx run` with the daemon off ran the task, succeeded and printed nothing about the failed command, and a second run restored the task from the cache. With `1.93.0`, also missing, pinned instead, the key changed. With runtime commands such as `echo A >&2; exit 1`, the key followed what the command wrote to standard error, and neither its exit status nor its text: `exit 1`, `exit 2` and `exit 0` after the same `echo A >&2` gave one key, and so did `exit 3` and `exit 4` without output.

So `RUSTUP_AUTO_INSTALL=0` turns rustup's download of a pinned toolchain into a failure whose message names the toolchain, and it changes nothing where cargo is no rustup proxy. Nx 24.0.6 does not fail a task whose runtime input fails: it keys the task on the command's output, for a missing toolchain rustup's message, and runs the task. A runtime input therefore cannot make the computation of a key fail, as the toolchain row of [[DES-DIAGNOSTICS]] and [[VER-SETUP]] expect, and such a key names the toolchain only as the toolchain file does: for a channel such as `stable`, not the release that cargo would install.
:::

:::mara evidence EVD-NX-24-SETUP
:mid: 01M7A67N99XVQ7ZV6NVRJB0W8N
:title: How Nx 24.0.6 adds a plugin, runs generators and shows plugin output
:status: accepted
:supports: DES-GENERATORS
:supports: DES-DIAGNOSTICS

Inspection of the `nx`, `@nx/devkit` and `@nx/js` 24.0.6 packages installed in this repository, and experiments with that `nx` package, on 13 November 2026. Paths are relative to `nx/dist/src/` unless another package is named.

Read in the compiled source:

- **`nx add`.** For a package outside Nx's own package group, `nx add <package>` installs `latest` unless a version is given, then runs `nx g <package>:init` with the terminal attached, adding `--keepExistingVersions` or `--updatePackageScripts` only when the init schema declares them. When `init` fails, the command exits with status 1 and the package stays installed (`command-line/add/add.js`, `command-line/init/configure-plugins.js`).
- **The graph comes first.** `nx g` creates the project graph, with every registered plugin, before it runs any generator, unless `--skipProjectGraph` is given (`command-line/generate/generate.js`).
- **Dry run.** Nx lists a generator's changes to its file tree after the generator returns, and writes them and runs the callback the generator returns only without `--dry-run` (`generate.js`). It takes `dryRun` out of the options it hands the generator and sets `NX_DRY_RUN` to `true` or `false` for the run (`generate.js`, `command-line/generate/command-object.js`).
- **Prompts.** Prompts for options appear only when standard output is a terminal and `CI` is not `true` (`utils/params.js`).
- **Directory.** The devkit helper for project names and roots resolves a generator's `directory` against the folder `nx` runs in, unless the path already starts with that folder (`@nx/devkit`, `generators/project-name-and-root-utils.js`). `@nx/js:library` requires `directory`, takes it from the first positional argument, and has an optional `name` (`@nx/js`, `generators/library/schema.json`).
- **Plugin output.** Plugin workers run with their standard output and error piped into the process that started them (`project-graph/plugins/isolation/isolated-plugin.js`), and the daemon's standard output and error go to its log file (`daemon/client/client.js`). The plugin interface has no channel for warnings (`project-graph/plugins/public-api.d.ts`).
- **Environment.** A client's first message carries its environment to the daemon, which applies it, forwards it to the plugin workers and recomputes a graph that was created under other values (`daemon/client/client.js`, `daemon/server/handle-client-env.js`).
- **Ignored paths.** Besides what `.gitignore` and `.nxignore` exclude, Nx always ignores only `**/node_modules`, `**/.git`, `**/.nx/cache`, `**/.nx/workspace-data` and `**/.yarn/cache`, as printed by calling `getHardcodedIgnorePatterns()` from `nx/src/native`.
- **Codes.** A search of `nx/dist/src` found no numbered codes for user-facing diagnostics, such as `NX` followed by digits.
- **TOML.** `nx` depends on `smol-toml`; `@nx/devkit` has no TOML dependency.

Observed in a throwaway git repository outside this one, with that `nx` package linked into its `node_modules`, Node.js 26.12.0, one `Cargo.toml` and a local plugin file listed in `nx.json` whose `createNodes` printed a line with `console.warn`, including the value of an environment variable:

- With `NX_DAEMON=false`, `nx show projects` printed the line in the terminal.
- With `NX_DAEMON=true`, the terminal showed only the project list, and the line appeared in `.nx/workspace-data/d/daemon.log`. A second run with the same environment did not run the plugin again. A run with the variable changed made the daemon log "Graph recompute necessary due to env variable refresh. Changed keys: …", and the plugin printed the new value there.
- A second local plugin whose module threw when loaded made `nx run js-app:build`, the `package.json` script of a JS project, fail with "Failed to load 1 Nx plugin(s)" and the thrown message, exit status 1. `nx show projects` and `nx g <package>:init` failed the same way. `nx --version` still worked, and so did `nx g <package>:init --skipProjectGraph`, which ran the generator.
- A `crate/target` folder that neither `.gitignore` nor `.nxignore` covered was part of the crate's project: Nx's file map listed `crate/target/junk.rs` among the project's files, and the plugin was handed a `Cargo.toml` from `crate/target/package/`. With `target/` in `.nxignore` alone, neither happened. Neither did it for `crate/.nx/cache/target` and `crate/node_modules/target`, which `git check-ignore` confirmed neither ignore file covered, with `.gitignore` holding only `/.nx` and no `.nxignore`: Nx's fixed exclusions kept the files of both out of the file map, and the plugin was not handed the `Cargo.toml` under `crate/.nx/cache/target/package/`.

Observed with pnpm 12.18.0 in a second throwaway repository, whose `package.json` linked that `nx` package, and a local package whose `init` generator threw: `nx add probe-plugin@file:<folder>` added the package to `package.json` and `pnpm-lock.yaml` and installed it, then failed with the generator's message and exit status 1. The package stayed in `package.json` and `node_modules`, and `nx.json` was unchanged.
:::

:::mara evidence EVD-CARGO-TARGET-COMMANDS
:mid: 01M7A4FCEFVN0W56WPDHWWW88N
:title: What cargo, rustfmt and rust-analyzer 1.100 do with the commands of the inferred targets
:status: accepted
:supports: DES-TARGET-COMMANDS
:supports: DES-WORKSPACE-TARGETS
:supports: ADR-NX-TARGET-NAMES
:supports: DES-INPUTS
:supports: DES-INVOCATION
:supports: DES-BATCH

Experiments on 13 November 2026 with cargo 1.100.0 (3acc79c0c 2026-11-05), rustc 1.100.0, clippy 0.1.100, rustfmt 1.11.0 and rust-analyzer 1.100.0, all from one rustup toolchain, in a throwaway virtual workspace outside this repository. Its members were `a`, a library with a `harness = false` bench and a deliberate unused variable, and `b`, a crate with two binaries, `b` and `second`, that depends on `a`. `a` also depended on `ext`, a path dependency outside the workspace. For one check cargo 1.89.0, 1.91.0, 1.96.0, 1.97.0, 1.97.1 and 1.98.1 were used as well, each with a target directory of its own; 1.91.0, 1.96.0 and 1.97.0 were installed with the minimal profile into a rustup home of their own.

- **check and clippy.** `cargo check --all-targets -p a` checked `ext` and `a`. A following `cargo clippy --all-targets -p a` checked `a` again and reused `ext`. Alternating `cargo clippy --all-targets -p a` with `cargo clippy --all-targets -p a -- -D warnings` checked `a` again on every switch, and the run with `-D warnings` failed on the warning.
- **build.warnings.** `CARGO_BUILD_WARNINGS=deny cargo clippy --all-targets -p a` failed with "warnings are denied by `build.warnings` configuration", and a plain `cargo clippy --all-targets -p a` afterwards checked nothing again. `CARGO_BUILD_WARNINGS=deny cargo check -p a` failed in the same way with cargo 1.97.0, 1.97.1, 1.98.1 and 1.100.0, and with cargo 1.89.0, 1.91.0 and 1.96.0 it succeeded with the warning and no notice about the setting. Cargo's configuration reference (doc.rust-lang.org/cargo/reference/config.html, read the same day) gives the same boundary for `build.warnings`: "MSRV: Respected as of 1.97". With cargo 1.100.0 and `CARGO_BUILD_WARNINGS=deny`, `cargo run -p b --bin second` and `cargo bench -p a` failed the same way on the warning in `a`, since both compile it.
- **rust-analyzer.** `rust-analyzer --print-config-schema` gives `cargo.allTargets` the default `true`, `check.allTargets` the default of `cargo.allTargets`, `check.workspace` the default `true` and `check.command` the default `"check"`. The editor's check is therefore `cargo check --workspace --all-targets`.
- **Nightly benches.** With a bench in `b` that uses `#![feature(test)]`, `cargo check --all-targets -p b` failed on stable with E0554, while `cargo check -p b` passed. So did `cargo check -p a -p b`, while `cargo check --all-targets -p a -p b` failed with E0554: one call cannot check `a` with `--all-targets` and `b` without.
- **fmt.** `cargo fmt --check --all` reported files of `ext` as well as of the members, and `cargo fmt --all` rewrote `ext`'s source. `cargo fmt --check` without flags, run in the workspace root, reported exactly the members' files, both in this virtual workspace and in a second one whose root manifest is a package with one more member. `cargo fmt --check -p a -p b` checked both crates. A package ID spec after `-p` was rejected as "not a member of the workspace", while `--manifest-path crates/a/Cargo.toml` selected `a`. `cargo fmt --check` exited with 1 when a file needed formatting. `cargo fmt --locked -p a`, `cargo fmt --check --locked -p a` and `cargo fmt -p a --locked` failed with exit code 2 and "unexpected argument '--locked' found"; `cargo fmt --help` lists no `--locked`, `--offline` or `--frozen`.
- **doc.** `cargo doc --no-deps -p a` and then `cargo doc --no-deps -p b` wrote `doc/a`, `doc/b` and `doc/second`, one folder per documented library or binary, and `doc/src/a`, `doc/src/b` and `doc/src/second`, beside files that both runs shared: `crates.js`, `search.index`, `src-files.js`, `static.files`, `help.html` and `settings.html`. `crates.js` listed `a` after the first run and `a`, `b` and `second` after the second. `doc/a/index.html` loads its styles from `../static.files/`. `cargo doc --no-deps --workspace` documented both members in one run.
- **run.** `cargo run -p b` failed with "`cargo run` could not determine which binary to run" and listed `b, second`; `cargo run -p b --bin second -- x` ran `second`. `cargo run -p a -p b` failed because `--package` cannot be given more than once.
- **bench.** `cargo bench -p a` ran on stable: the library's test harness in bench mode and then the `harness = false` bench.
- **update.** After a new path dependency was added to a manifest, `cargo update --locked` failed with "cannot update the lock file … because --locked was passed to prevent this", and `cargo update` then updated `Cargo.lock`. Without such a change, `cargo update --locked` succeeded.

The workspace was a toy, so nothing here says how long these commands take on a large one.
:::

:::mara evidence EVD-CARGO-AUDIT-DENY
:mid: 01M7A4FCEFMBYHR6YR0ZANHNS3
:title: What cargo-audit 0.23.0 and cargo-deny 0.20.2 read, fetch and write
:status: accepted
:supports: DES-WORKSPACE-TARGETS
:supports: DES-INVOCATION

Experiments on 13 November 2026 with cargo-deny 0.20.2 and cargo-audit 0.23.0, installed with `cargo install --locked` into a throwaway folder, and cargo 1.100.0, with a Cargo home of their own that started empty. The workspace, outside this repository, had one member `x` with `license = "MIT"` that depended on the registry crate `itoa`, whose license is `MIT OR Apache-2.0`. Every command ran in the workspace root.

- **No configuration.** Without a configuration file, `cargo deny check` warned "unable to find a config path, falling back to default config", rejected the licenses of `itoa` and `x`, and exited with code 4; advisories, bans and sources passed. A configuration that allows MIT and Apache-2.0 made the license check pass when it was `deny.toml`, `.deny.toml` or `.cargo/deny.toml` in the workspace root. `cargo deny --help` says the configuration defaults to `deny.toml` in the current folder.
- **Network.** Both tools fetched the RustSec advisory database into the Cargo home: cargo-audit printed "Fetching advisory database from `https://github.com/RustSec/advisory-db.git`" and loaded 1490 advisories. cargo-audit also updated the crates.io index.
- **Lockfile.** After a dependency was added to the member's manifest, `cargo deny check` updated `Cargo.lock`. `cargo deny --locked check` failed instead with Cargo's "cannot update the lock file … because --locked was passed to prevent this" and left the file unchanged. `cargo audit` scanned the old `Cargo.lock`, which did not list the new dependency, and left it unchanged. Its options include `--no-fetch` and `--stale`, and none like `--locked`.
- **cargo-audit configuration.** An invalid `.cargo/audit.toml` in the workspace root made `cargo audit --no-fetch` fail with a TOML parse error. The same file as `audit.toml` in the workspace root, or as `.cargo/audit.toml` in the member's folder, was ignored.

What these tools report thus depends on the advisory database at the time they run, not only on files in the repository.
:::

:::mara evidence EVD-NX-24-TARGETS
:mid: 01M7A4FCEFW4N06285629BJCB1
:title: What Nx 24.0.6 does with continuous, sequential and overlapping targets
:status: accepted
:supports: DES-TARGET-COMMANDS
:supports: DES-WORKSPACE-TARGETS
:supports: DES-OUTPUTS
:supports: ADR-NX-TARGET-NAMES

An experiment and a reading of the `nx`, `@nx/js` and `@nx/workspace` 24.0.6 packages installed in this repository, on 13 November 2026, with Node.js 26.12.0. The experiment used a throwaway workspace outside this repository with two projects, `a` and `b`, whose targets ran shell commands through `nx:run-commands`. Nx ran as `node <repository>/node_modules/nx/dist/bin/nx.js` with `NX_DAEMON=false`, `NX_NO_CLOUD=true` and `NX_TUI=false`.

- **Overlapping outputs.** Each project's cached `doc` target wrote a folder of its own under `out/doc` and a shared `out/doc/crates.js`, and declared `{workspaceRoot}/out/doc` as its output. After `nx run a:doc` and `nx run b:doc`, `out/doc` held both folders. A second `nx run a:doc` was a cache hit, after which `out/doc` held only `a`'s folder and `a`'s `crates.js`: the restore replaced the whole folder. The native cache documents `copyFilesFromCache` as replacing each output that exists (`native/index.d.ts`).
- **Continuous tasks that exit.** A target with `continuous: true` printed a line and exited. Run alone with `nx run a:oneshot`, it succeeded. As the dependency of another target, `nx run a:after` failed with `Task "a:oneshot" is continuous but exited with code 0` and exit code 1 (`tasks-runner/task-orchestrator.js`).
- **A project without a target.** `nx run a` failed with "Both project and target have to be specified".
- **Batches.** Without `--batch`, a task joins a batch only if its executor has a batch implementation and sets `preferBatch`, and only if the task's `parallelism` is not `false`. A continuous task stays out of a batch only when another task depends on it or it declares `readyWhen` (`processTaskForBatches` and `canBatchTaskBeScheduled` in `tasks-runner/tasks-schedule.js`).
- **Parallelism.** While a task with `parallelism: false` runs, no other task starts, and such a task starts only when no other task runs (`canBeScheduled` in `tasks-runner/tasks-schedule.js`).
- **Readiness.** A target accepts `continuous`, `readyWhen` and `parallelism` (`schemas/project-schema.json`). `readyWhen` waits for a `url`, a `port`, a `command` or `logMatches`, and a dependent waits for it only with `waitFor: "ready"` on its `dependsOn` entry; the default is `started`.
- **nx watch.** `nx watch` runs its command once for each batch of changes and takes the next batch only after the command has exited, so it cannot restart a command that keeps running (`command-line/watch/watch.js`).
- **Command names.** `run` and `watch` are Nx commands, so `nx run <project>` never runs a target named `run`. `check`, `doc`, `bench`, `fmt`, `fmt-check`, `audit`, `deny`, `update` and `typecheck` are not command names (the command handlers of `command-line/nx-commands.js` and `isKnownCommand` in `bin/init-local.js`).
- **typecheck.** `@nx/js` adds its TypeScript plugin with the target name `typecheck` (`src/utils/typescript/add-typescript-plugin.js`), and the CI workflow generator of `@nx/workspace` writes `nx affected -t lint test build typecheck` when a workspace has that target (`src/generators/ci-workflow/ci-workflow.js`).

The targets of the experiment ran no cargo. The points marked with a source file were read, not run.
:::

:::mara evidence EVD-CARGO-DEP-INFO
:mid: 01M7ACMK1Q7ATJKRRHC2WPJE1Z
:title: Where Cargo records the files that build scripts and macros read
:status: accepted
:supports: ADR-DECLARED-FILE-INPUTS
:supports: DES-BUILD-INPUT-CHECK
:supports: RISK-UNDECLARED-INPUTS

Experiments on 13 November 2026 with cargo and rustc 1.100.0 (cargo 3acc79c0c 2026-11-05) and, where named, cargo 1.98.1, 1.97.1 and 1.91.0, on Linux x86-64, in throwaway folders outside this repository, with no Cargo configuration in the home folder and no toolchain pinned. The fixture was a virtual workspace `ws` with the members `app` and `dep`, beside the folders `proto`, `shared` and `assets` outside it. `app` depended on `dep` by path. Its build script printed `cargo::rerun-if-changed` for `../../../proto/app.proto`, for the folder `../../../assets` and for `build.rs`, read the proto file and set a variable with `cargo::rustc-env`; its library used `include_str!` on `shared/data.txt`, its binary called the library, and an integration test used `include_bytes!` on `shared/test-data.bin`. `dep`'s build script named `../../../proto/dep.proto`, and its library included `shared/dep.txt`. Later steps added `pm`, a proc-macro crate whose macro read `shared/pm.txt` with `std::fs`, used by `app2`, which also depended on the registry crate `libc` (built with `--offline` from the local registry cache); `gen`, whose build script wrote a file into `OUT_DIR`, which its library included with `include!`, and named `/etc/hostname`; and `cd`, with the crate types `cdylib`, `rlib` and `staticlib`, whose library included a file with a space in its name.

- **check, clippy, test and doc.** After `cargo check --workspace`, `cargo clippy --workspace --all-targets`, `cargo test --workspace --no-run` and `cargo doc --workspace`, `find target -name '*.d'` showed dependency files only under `target/debug/build/<package>/<hash>/out/`, in the build directory of the default layout, and none in `target/debug` itself or in `target/doc`. The build script's `rerun-if-changed` lines were in `build/<package>/<hash>/run/stdout`, and its fingerprint `run-build-script-build-script-build.json` listed the paths under `RerunIfChanged`, relative to the package's folder. rustc's dependency file for the library, `out/app-<hash>.d`, listed `crates/app/src/../../../../shared/data.txt` beside the source, and an `# env-dep:PROTO_LEN=7` line. The file that the integration test included appeared only in the test's dependency file in the build directory.
- **build.** `cargo build --workspace` also wrote `target/debug/app.d`, `libapp.d` and `libdep.d` beside the binary and the `rlib` files, in Makefile syntax with absolute paths. `app.d` listed both proto files, the `assets` folder as one path, both build scripts, both included text files and the sources of `app` and `dep`; `libdep.d` listed only `dep`'s files. None listed the file of the integration test. With `build.build-dir` set to a folder outside the workspace, the three files stayed in `target/debug`, and every other dependency file was in the build directory. With cargo 1.97.1 and the same setting, `cargo build --workspace` wrote the three files in `target/debug` as well, and the build script's record lay at `<build directory>/debug/build/app-<hash>/output` instead.
- **More of build.** `app2.d` listed the sources of `app2` and `pm` and no file of `libc`. `libgen.d` listed `/etc/hostname` and the generated file under `target/debug/build/`. For `cd`, Cargo wrote `libcd.a`, `libcd.rlib`, `libcd.so` and a single `libcd.d`, which escaped the space as `with\ space.txt`. After a change to `app`'s library, `cargo build -p app` wrote `app.d` and `libapp.d` again and not `libdep.d`. After `app.d` was deleted, `cargo build -p app` compiled nothing and wrote it again. With `--config build.dep-info-basedir=<folder>`, the paths were relative to that folder.
- **Fresh builds.** Whether a build that compiles nothing gives the records a new time differs between versions and crates. In a second workspace with three crates, one without a build script, one whose build script named only `build.rs` with `rerun-if-changed`, and one whose build script named a folder, two further `cargo build --workspace` runs with cargo 1.100.0 kept the time of all three records; with cargo 1.98.1 and 1.97.1 they kept the time of the crate without a build script and gave the other two new times. In the first fixture, cargo 1.100.0 gave `app.d` and `libapp.d` a new time on each of three fresh builds of `app`. With all three versions, a deleted record was there again after the next build, which compiled nothing. A record is thus present after every successful build, and its time says nothing about that build.
- **Stale records.** `cargo build -p dep` wrote `libdep.d` for the library-only crate `dep`, listing `proto/dep.proto` and `shared/dep.txt`. After `app` got a second binary `extra` with `required-features = ["x"]`, `cargo build -p app --features x` wrote `extra.d`, and a later `cargo build -p app` left it with its old time. `cargo build -p app --release` and `cargo build -p app --target x86_64-unknown-linux-gnu` wrote `app.d` and `libapp.d` in `target/release` and `target/x86_64-unknown-linux-gnu/debug`, beside those in `target/debug`. A crate `wide` whose build script printed `cargo::rerun-if-changed=../..` got `crates/wide/../..`, the workspace folder that holds `target`, as one path in `libwide.d`.
- **Which records a build exports.** A third workspace, built with debug information and incremental compilation off to save space, had a library-only crate `lib-only`; a crate `multi` with the library `multicore`, the binaries `one`, `two-dash` and `three`, the last with `required-features = ["extra"]`, and a feature `full = ["extra"]`; a crate `cd` with the crate types `cdylib` and `staticlib`; a proc-macro crate `pm`; and a profile `fast` that inherits `release`. A script named the records that `cargo build -p <crate>` should export from the `cargo metadata --no-deps` report and the build's features, profile and triple, and compared them, in thirteen builds, with the files outside the build directory that the `compiler-artifact` messages of the same build with `--message-format=json` named, the messages serving only as a check. Every build agreed: `multi` without features, with `--features extra`, `--features full` and `--all-features`, with `--release`, `--profile fast` (folder `target/fast`), `--target x86_64-unknown-linux-gnu` alone and with `--release` (folder `target/x86_64-unknown-linux-gnu/<profile>`), and with `CARGO_BUILD_TARGET` set to that triple and no `--target` (the same folder); `lib-only`; `cd` in `dev` and `release`; and `pm`. The library's record was `lib<name>.d` with `-` replaced by `_` (`liblib_only.d`, `libmulticore.d`, `libcd.d`, `libpm.d`), a binary's kept its name (`two-dash.d`), and `three.d` was exported exactly when `extra` was on.
- **The naming matrix.** A fourth workspace had eight crates: libraries of the crate types `rlib` (the crate `k-rlib`), `cdylib`, `staticlib`, all three together, and `proc-macro`; a crate with a binary only; one with a library and the binary `k-libbin-cli`; and a proc macro with a binary. Its root manifest defined the profiles `c_dev`, `c_release`, `c_test` and `c_bench`, each with `inherits` naming the profile of that name without `c_`. Each crate was built on its own with `cargo build -p <crate> --profile <profile> --message-format=json` for each of the eight profiles, under each triple mode: no triple, `--target x86_64-unknown-linux-gnu` (the host), `--target x86_64-unknown-linux-musl` (with 1.100.0, the only toolchain with another triple installed), `CARGO_BUILD_TARGET` set to the host triple, and `[build] target` set to the host triple in `.cargo/config.toml`. For every build, a script named the records from the `cargo metadata --no-deps` report, the profile and the triple, and compared them with the files that the `compiler-artifact` messages named outside the build directory, the messages serving only as a check. With cargo 1.100.0, 256 of 320 builds agreed. The 56 builds where the configuration chose the triple differed for every crate but the plain proc macro: cargo wrote the records to `target/x86_64-unknown-linux-gnu/<profile>`, and the names, which knew no triple, pointed at `target/<profile>`. In those builds a record of the same name lay in the triple folder after the call, and a proc macro's library record, in `target/<profile>`, agreed. For the `cdylib`-only crate and the musl triple, the 8 builds failed with "cannot produce cdylib … as the target `x86_64-unknown-linux-musl` does not support these crate types"; for the crate with all three types, cargo warned "dropping unsupported crate type `cdylib`" and wrote `libk_multi.d`, as named. With cargo 1.91.0, 200 of 256 builds agreed, and the other 56 were the configured-triple builds again. Together the builds showed: a proc macro's library record lies in `target/<profile folder>` whatever the triple, while a binary of the same crate follows the triple; `test` writes to `debug` and `bench` to `release`, like `dev` and `release`; and a custom profile writes to a folder of its own name, whichever profile it inherits from. In the shared target folder, once a build for a named triple had left a record of the same name there, the check's guard for a triple it cannot know also skipped the host-folder records of 14 later builds without a triple, with each toolchain.
- **Records after a change.** In fresh workspaces with one crate and the files `old.txt`, `new.txt`, `a.txt` and `b.txt` beside it, with cargo 1.91.0 and 1.100.0 alike: an `rlib` that included `old.txt`, built with `--target x86_64-unknown-linux-gnu`, then turned into a proc macro that included `new.txt` and built the same way, left `target/x86_64-unknown-linux-gnu/debug/libc.d` listing `old.txt` and wrote `target/debug/libc.d` listing `new.txt`; turned back into an `rlib` that included `old.txt`, it wrote the triple folder's record again, listing `old.txt`, and left the host folder's listing `new.txt`. A `--release` build that included `old.txt`, followed by a change to `new.txt` and a `dev` build, left `release/libc.d` listing `old.txt` and wrote `debug/libc.d` listing `new.txt`; the same held for a build with `--target` followed by one without. A crate with a feature `x` that included `a.txt` with it and `b.txt` without it, built with `x`, without, with `x` and with `x` again, compiled one unit, one, none and none, and `debug/libc.d` listed `a.txt`, `b.txt`, `a.txt` and `a.txt`: a record follows the call's feature set also when nothing compiles. After a binary `two` was removed from the manifest, the next build left `debug/two.d` in place.
- **Where such names fall short.** With `[build] target = "x86_64-unknown-linux-gnu"` in `.cargo/config.toml` and no `--target`, `cargo build -p multi` exported its records to `target/x86_64-unknown-linux-gnu/debug`, while an older `target/debug/one.d` remained. `cargo build -p multi -p user`, where `user` depends on `multi` with `features = ["extra"]`, built and exported `three` as well. Two crates `cola` and `colb` with a binary `cli` each, built in one call, gave the warning "output filename collision" and one `cli.d`, which listed only `colb`'s source. `cargo build -p multi --bin one` reported the library only by its files in the build directory and exported only `one.d`, which listed the library's source beside the binary's.
- **Links.** A crate `linky` whose library used `include_str!` on `shared/alias.txt`, a symbolic link to `shared/data.txt`, got the link's spelling `crates/linky/src/../../../shared/alias.txt` in `liblinky.d`. After `data.txt` changed, `cargo build -p linky -v` reported `linky` dirty, naming that path, and compiled it again.
- **JSON messages.** `cargo build --workspace --message-format=json` gave `build-script-executed` messages with the keys `cfgs`, `env`, `linked_libs`, `linked_paths`, `out_dir`, `package_id` and `reason`, and `compiler-artifact` messages whose `filenames` held the artifacts and no dependency file. No message named a `rerun-if-changed` path.
- **What Cargo tracks.** After `proto/app.proto` changed, the next `cargo build` ran `app`'s build script and compiled `app` again. `cargo build -p app -v` reported `app` dirty, naming the path `crates/app/../../../assets`, after a file in that folder changed and again after a file was added to it. After `shared/pm.txt` changed, `cargo build -p app2` finished in 0.00s without compiling, and the binary still printed the old content: Cargo does not track a file that a proc macro opens itself.
- **Build helpers.** In the sources in the local registry, tauri-build 2.6.3 prints `cargo:rerun-if-changed` for paths it computes from its configuration (`src/codegen/context.rs`, from line 91), and bindgen 0.72.1 prints it for the headers that a binding includes (`lib.rs`, lines 1302 and 1307). include_dir 0.7.4 tracks a folder only with its `nightly` feature, through `proc_macro::tracked_path`, and otherwise expands to an `include_bytes!` per file (`include_dir_macros/src/lib.rs`).
- **Documentation.** The Cargo book of the 1.100.0 toolchain (`reference/build-cache.html`, "Dep-info files") says that the file with the `.d` suffix next to each compiled artifact indicates the files the artifact depends on, that these files are "intended to be used with external build systems", and that their paths are absolute unless `build.dep-info-basedir` is set. The same page calls the intermediate artifacts in the build directory "internal to Cargo and the Rust compiler".

The workspace was a toy on Linux, so the names of macOS libraries, such as `.dylib`, were not seen.
:::

:::mara evidence EVD-NX-24-FILE-INPUTS
:mid: 01M7ACMK1QCT1DZYXHK8C0D50R
:title: How Nx 24.0.6 treats files outside a project and stores task results
:status: accepted
:supports: ADR-DECLARED-FILE-INPUTS
:supports: DES-INPUTS
:supports: DES-BUILD-INPUT-CHECK

Experiments on 13 November 2026 with the `nx` 24.0.6 package installed in this repository, linked into a throwaway git repository outside it, with Node.js 26.12.0 and git 2.56.0, and a reading of that package. Nx ran as `node node_modules/nx/dist/bin/nx.js` with `NX_DAEMON=false`, `NX_NO_CLOUD=true` and `NX_TUI=false`. The repository had two projects whose cached `build` target ran `echo` through `nx:run-commands`: `a`, with the inputs `{projectRoot}/**/*` and the runtime input `sha256sum shared/a.txt`, and `b`, with `{projectRoot}/**/*` and a fileset for `{workspaceRoot}/shared/b.txt`. Both files lay outside the projects' folders.

- **Affected.** `nx affected -t build --files=shared/a.txt,shared/b.txt` ran `b:build` only, and `nx affected -t build --files=shared/a.txt` ran no task. The runtime input still keyed the cache: `nx run a:build` was a cache hit twice in a row and a miss after `shared/a.txt` changed.
- **Outside the repository.** With a fileset for `{workspaceRoot}/../outside.txt` on `b`, Nx printed no error or warning, and `nx run b:build` was a cache hit after that file changed.
- **Ignored files.** With `gen/` in `.gitignore` and a fileset for `{workspaceRoot}/gen/g.txt`, `b:build` was a cache hit after the file changed. With `"includeIgnored": true` on the same fileset, it was a miss after the change and a hit on the next run. Yet `nx affected -t build --files=gen/g.txt` ran no task, and neither did `nx affected -t build --base=HEAD~1 --head=HEAD` after a commit that changed only `gen/g.txt`, added with `git add -f`. A third project `c` with an `includeIgnored` fileset for `nested/sub/h.txt`, a file that `nested/.gitignore` ignored, was selected both with `--files` and after a commit that changed only that file. With `nxig/` in a root `.nxignore`, a project with an `includeIgnored` fileset for `nxig/n.txt` missed the cache after that file changed, and `--files=nxig/n.txt` selected nothing. For `vendor/node_modules/f.txt`, which only Nx's fixed exclusion of `node_modules` folders covers, a project with such a fileset missed the cache after the change and was selected both with `--files` and after a commit that changed the file. As read in the source, Nx drops each changed file that the root `.gitignore` or `.nxignore` matches before it matches changed files against inputs, whatever the filesets say (`calculateFileChanges` in `project-graph/file-utils.js`, with `getIgnoreObject` in `utils/ignore.js`, which reads those two root files only).
- **Symbolic links.** In a second, clean repository that ignored `.nx`, project `h` declared `shared/alias.txt`, a symbolic link to `shared/data.txt`, and project `i` declared `shared/data.txt`, both without `includeIgnored`. After `data.txt` changed, `h` was a cache hit with the same `NX_TASK_HASH` as before, and `i` missed with a new one. A commit that changed only `data.txt` selected `i` and not `h`, while `--files=shared/alias.txt` selected `h`. In the first repository, a declared link's hash stayed the same after its destination changed, with and without `includeIgnored` and with the daemon, changed after `nx reset` and after `touch -h` on the link, and then reflected the destination's content: Nx hashes the destination when it first reads the link and keeps that hash until the link itself changes or `nx reset` clears it.
- **Failed tasks.** As read in the source, Nx stores a task's result only when the task is cacheable and its exit code is 0, unless `NX_CACHE_FAILURES` is `true` (`shouldCacheTaskResult` in `tasks-runner/task-orchestrator.js`). A fourth project `d` had a cached target whose command appended a line to a log and exited with 1. Run twice without the variable, it executed twice. Run twice with `NX_CACHE_FAILURES=true`, it executed once, and the second run exited with 1 without executing; after a change to an input file, it executed again. A batch executor reports a `TaskResult` per task, with `success` and an optional `status` of `success`, `failure` or `skipped`, and with nothing else that decides whether the result is stored (`config/misc-interfaces.d.ts`).
- **Recorded reads.** A target accepts an `ultracache` setting whose modes record the files a task reads and let the recording stand in for the declared inputs (`on`, the default), report undeclared reads (`warn`, and `error`, which behaves as `warn` for now), or record nothing (`off`). The typings call it Nx Cloud only and say that "nothing in the OSS runner records or applies IO" (`UltracacheMode` in `native/index.d.ts`, `ultracache/config.d.ts`).

The targets of the experiment ran no cargo. The points marked with a source file were read, not run.
:::

:::mara evidence EVD-NX-24-OPTION-SEMANTICS
:mid: 01M7AD4BCYERDMG40D5WH2XMAK
:title: What Nx 24.0.6 does with dependency inputs, target merges and its own flags
:status: accepted
:supports: DES-PLUGIN-OPTIONS
:supports: DES-INPUTS

An experiment and a reading of the `nx` 24.0.6 package installed in this repository, on 13 November 2026, with Node.js 26.12.0.

The experiment ran in a throwaway Git repository outside this one, with this repository's `node_modules` linked in. Its `nx.json` defined a named input `crate` as `["{projectRoot}/**/*"]`, and it had two projects with `project.json` files. Project `b` redefined `crate` with an `env` entry `B_NAMED` and a `runtime` entry `echo b-named`, and its `test` target had the inputs `crate`, `^crate`, `{ "env": "B_TARGET" }` and `{ "runtime": "echo b-target" }`. Project `a` had an implicit dependency on `b`, a file `a/docs/readme.md`, and a `test` target with the inputs `crate`, `^crate` and `!{projectRoot}/docs/**`. Nx's `HashPlanInspector` (`hasher/hash-plan-inspector.js`) listed the inputs of each task with `NX_DAEMON=false`. Then `nx run a:test --exclude-task-dependencies --output-style=static` ran with `NX_DAEMON=false` and a fresh `NX_CACHE_DIRECTORY`, after each change of a variable or file.

A second experiment, after the review of the option reference the same day, used rustc 1.100.0 and a throwaway workspace with a stand-in plugin, `stand-in`, that infers for each crate of a Cargo workspace a `test` target running `cargo test` with the input `{projectRoot}/**/*`, and a `probe` target whose executor records the options it receives. A crate's `project.json` laid targets over the inferred ones, which Nx merges with the same function as a plugin's own tables; projects were read back with `nx show project <name> --json`.

- **Inputs of a dependency.** The plan of `a:test` held `B_NAMED` and `echo b-named` from the named input of `b`, and neither `B_TARGET` nor `echo b-target` from the target of `b`. With `B_NAMED` changed, `a:test` ran again; with only `B_TARGET` changed, it was restored from the cache. The source splits a target's inputs the same way: entries of a named input that a `^` input names are hashed for each dependency, and the target's other entries for the task's own project only (`splitInputsIntoSelfAndDependencies` in `hasher/task-hasher.js`).
- **Negated patterns.** `a/docs/readme.md` was not in the plan of `a:test`, and a change to it was a cache hit. A negated pattern in a target's inputs takes out files that another entry of the same list brings in. In the second experiment a test of crate `a` compared `include_str!("../docs/value.txt")` with `1`, and the crate's `project.json` set the `inputs` of `test` to `["...", "!{projectRoot}/docs/**"]`. After `nx run a:test` passed and the file was changed to `2`, `nx run a:test` restored the passing result from the cache, while `cargo test -p a` in the workspace root failed with exit code 101. With `["..."]` alone, the same change made `nx run a:test` run and fail. An excluded file that a macro reads therefore gives a stale result.
- **`nx.json`.** `nx.json` was among the files of every task's plan, although no input named it.
- **Merging two configurations of one target.** `mergeTargetConfigurations` in `project-graph/utils/project-configuration/target-merging.js`, with `getMergeValueResult` and `mergeArrayValue` in `utils.js` beside it: a field that the later configuration sets replaces the earlier value; `options` and `configurations` are merged key by key; a list without the element `"..."` replaces the earlier list, and `"..."` stands for the earlier entries at its place. When both configurations name an executor and the executors differ, or both run `nx:run-commands` with different commands, the targets are incompatible (`isCompatibleTarget`): the later one is used in place of the earlier one, and the earlier options are discarded. A `command` becomes `nx:run-commands` with that command (`resolveCommandSyntacticSugar`). In the second experiment, a `probe` target in `project.json` with the inferred executor and an option `x` kept the inferred inputs and options and added `x`; with the executor `nx:noop`, or with a `command`, the target had no inputs left and only the options of `project.json`.
- **Nx's own flags.** In the second experiment each flag was passed to `nx run b:probe`, `nx run-many -t probe -p b` and `nx affected -t probe --files=<a file of b>`, and the probe recorded whether the option arrived. `--target`, `--configuration`, `--exclude` and `--parallel` never reached the executor, under any of the three commands, and `--runner=zzz` made all three fail. `--projects` reached it under `run` and `affected` but not under `run-many`, which selects projects with it, and `--project` reached it under `run-many` and `affected` but not under `run`, which takes it as the project to run (`command-line/yargs-utils/shared-options.js`). `--profile=release` reached it under all three: Nx switches its own task profiling on with the environment variable `NX_PROFILE` (`tasks-runner/run-command.js`), not with a flag. So did `--features`, `--allFeatures`, `--noDefaultFeatures`, `--targetTriple`, `--allTargets`, `--noDeps`, `--bin` and `--affectedTests`, the option names of [[DES-PLUGIN-OPTIONS]]. An option named `target`, `configuration`, `exclude`, `parallel` or `runner` could not be given on the command line at all.
- **`--verbose`.** All three commands consume `--verbose` as Nx's own flag: it is not among a task's overrides. Nx then supplies verbosity to the executor of a single task itself: it adds `verbose: true` to the options when the executor's schema declares a `verbose` property or sets `additionalProperties: true` (`applyVerbosity` in `utils/params.js`). In a third experiment on 13 November 2026, with a stand-in executor recording its options, `nx run`, `nx run-many` and `nx affected` with `--verbose` delivered `"verbose": true` under a schema with `additionalProperties: true` and under one that declares a boolean `verbose`, and no `verbose` under a schema that does neither. A batch implementation with the schema that declares `verbose` and `preferBatch` set received no `verbose` in its tasks' options under any of the three commands. In the same runs `--affectedTests=true` reached the executor under all three commands, as `true` among the options and as `"true"` among the task's overrides in the task graph, in a batch as well.
- **`env` of `nx:run-commands`.** That executor's `env` option holds "Environment variables that will be made available to the commands" (`executors/run-commands/schema.json`).

In the first experiment the projects came from `project.json` files, not from a plugin. That a plugin's named inputs are hashed in the same way is read from the source, where both reach the hasher as project configuration.
:::

:::mara evidence EVD-CARGO-NX-TABLES
:mid: 01M7AD4BCY1KGNGB0BSH140SNV
:title: How cargo 1.100.0 reports the nx tables of the option reference
:status: accepted
:supports: DES-PLUGIN-OPTIONS
:supports: DES-METADATA-TABLES

An experiment with cargo 1.100.0 and rustc 1.100.0 on 13 November 2026, with an empty Cargo home and `--offline`, in a throwaway workspace outside this repository. Its root `Cargo.toml` listed the members `crates/*` and excluded `tools/x`, and its `[workspace.metadata.nx]` table set `tags`, `namePrefix`, `envInputs` and a `project` sub-table with `name`. The member `api` set `name` and `implicitDependencies` in `[package.metadata.nx]`, `inputs = ["...", { env = "DATABASE_URL" }, "!{projectRoot}/docs/**"]` in `[package.metadata.nx.targets.test]`, and `affectedTests = false` and `features` among that target's options. The excluded crate `tools/x` had a `[workspace.metadata.nx]` table of its own with `testRunner`.

- `cargo metadata --format-version 1 --no-deps --offline` in the workspace root reported both tables as written: the `"..."` string, the inline table inside the list and the booleans kept their types and order, under `metadata.nx` of the workspace and of the package. A member without a table had `null` there.
- `cargo build --offline` built the workspace without a warning about any of the keys.
- In `tools/x`, the report named that folder as the workspace root, with one member and the crate's `[workspace.metadata.nx]` table as the workspace's metadata, and `cargo build --offline` built it. A standalone crate can therefore carry workspace settings in its own manifest.
:::

:::mara evidence EVD-CARGO-LOCKED-CHECK
:mid: 01M7AD4BCY0KKX34EHF23320MQ
:title: cargo metadata --locked fails on an outdated lockfile without changing it
:status: accepted
:supports: DES-INVOCATION

An experiment with cargo 1.100.0 on 13 November 2026, in the workspace of [[EVD-CARGO-NX-TABLES]] with two members and no registry dependencies, an empty Cargo home and `--offline`. After `cargo generate-lockfile`, a path dependency of `api` on `core` was added to `api`'s manifest, so that `Cargo.lock` was out of date.

- `cargo metadata --format-version 1 --no-deps --locked --offline` succeeded: the report that builds the graph does not notice an outdated lockfile.
- `cargo metadata --format-version 1 --locked --offline` exited with code 101 and the message "cannot update the lock file … because --locked was passed to prevent this". `Cargo.lock` was byte for byte unchanged.
- After `cargo generate-lockfile`, the same command succeeded.

`cargo metadata` without `--no-deps` resolves the dependencies, so in a workspace with registry dependencies it needs what the full report needs, the registry or a filled Cargo home ([[EVD-CARGO-NO-DEPS]]). That case was not run here.
:::

:::mara evidence EVD-NX-PLUGIN-ENTRIES
:mid: 01M7ABYX5EADNXFRHAA2F17VBK
:title: How Nx 24.0.6 runs several entries of one plugin
:status: accepted
:supports: DES-METADATA-REPORT

A reading of the `nx` 24.0.6 package and an experiment on 13 November 2026 with cargo 1.100.0 and Node 26.12.0 on Linux. The experiment ran through the plugin's own tests (`nx-rust/test/discovery.spec.ts`), which list a stand-in that behaves as the plugin twice in `nx.json`, with `include` filters that split the manifests between the two entries, and build the graph with plugin isolation on and off.

- **Isolation on**, Nx's default: Nx starts one plugin worker per entry, keyed by the plugin, the workspace root and the entry's position in `nx.json` (`project-graph/plugins/isolation/load-isolated-plugin.js`). Two entries of one plugin run in two processes and share nothing.
- **Isolation off** (`NX_ISOLATE_PLUGINS=false`): Nx loads the plugin module once per process with `require` and gives each entry a shallow copy of its exports (`plugins/load-resolved-plugin.js`), so a module-level variable is shared by all entries. An entry without `options` passes `undefined` to both hooks, so their arguments do not tell entries apart. Nx calls `createDependencies` as a method of the entry's copy and the `createNodes` function as a member of the pair it read from that copy (`plugins/loaded-nx-plugin.js`).
- **Order.** Nx starts the `createNodes` calls of all entries of one computation one after another in a single synchronous loop, and calls `createDependencies` once all of them have settled, also when one of them failed (`utils/project-configuration-utils.js`, `project-graph.js`).
- **Measured.** With a workspace's root manifest given to one entry and its members to the other, the workspace was reported twice with isolation on, once in each worker. With isolation off it was reported once, when the second entry reused the report that the first had requested in the same computation. The version of the plugin reviewed on 13 November 2026 kept the result of `createNodes` in one module-level variable: with isolation off, both entries' `createDependencies` then received the discovery of the second entry.

The plugin therefore makes each entry's copy carry a `createNodes` of its own and finds the entry in `createDependencies` through that copy. These are Nx internals, which the tests check in both modes and which have to be checked again for another Nx major.
:::

:::mara evidence EVD-NEXTEST-CARGO-FLAGS
:mid: 01M7AH88BCFA99QFV4EGE16JHW
:title: cargo-nextest takes the Cargo profile as --cargo-profile
:status: accepted
:supports: DES-PLUGIN-OPTIONS

An experiment on 13 November 2026 with cargo-nextest 0.9.151, the prebuilt binary from `https://get.nexte.st/latest/linux`, and cargo and rustc 1.100.0, in a throwaway crate with a unit test, a doctest, a feature `extra` and a Cargo profile `custom` that inherits from `dev`. No `.config/nextest.toml` existed.

- `cargo nextest run --profile custom` failed with exit code 96 and "profile `custom` not found (known profiles: default, default-miri)": nextest reads `--profile` as a profile of its own configuration.
- `cargo nextest run --cargo-profile custom` built with Cargo's profile `custom`, into `target/custom`, and ran the test under nextest's profile `default`.
- `cargo test --doc --profile custom` built with the profile `custom` and ran the doctest.
- `cargo nextest run` accepted `--features`, `--all-features`, `--no-default-features` and `--target` as cargo does; its help lists them beside `--cargo-profile`.
:::

:::mara evidence EVD-NX-24-ENTRY-CONTEXT
:mid: 01M7AH88BCK4ZK4JY2X0N7C9C0
:title: What each entry of a plugin sees of the others in Nx 24.0.6
:status: accepted
:supports: DES-PLUGIN-OPTIONS

An experiment on 13 November 2026 with `nx` 24.0.6 and Node.js 26.12.0, in a throwaway Git repository outside this one. A Cargo workspace in `rust/` had the members `a`, `b` and `hidden`, and `.nxignore` named `rust/crates/hidden`. `nx.json` listed a stand-in plugin twice: one entry with `include` set to `rust/Cargo.toml` and `rust/crates/a/**` and the option `testRunner` set to `cargo`, the other with `include` set to `rust/crates/b/**` and `rust/crates/hidden/**` and `testRunner` set to `nextest`. The stand-in's `createNodes` for `**/Cargo.toml` recorded the files it received, the `plugins` of `context.nxJsonConfiguration`, and, for every entry naming the stand-in, the result of `findMatchingConfigFiles` applied with that entry's `include` and `exclude` to the output of `globWithWorkspaceContext(workspaceRoot, ["**/Cargo.toml"])`. `nx show projects` ran with plugin isolation on (the default), with `NX_ISOLATE_PLUGINS=false`, and with the Nx daemon on.

- **Every entry sees all.** In every mode both entries' contexts held both entries of `plugins`, with their `include` patterns and options. With isolation on, and with the daemon, the two entries ran in two processes; with isolation off, in one.
- **Nx's assignment can be recomputed.** For each entry, applying its own `include` and `exclude` to the files of the workspace context gave exactly the files that Nx handed to it, also leaving out the manifest under the `.nxignore` path that the second entry's `include` matched. So each entry can tell which entries receive manifests of a workspace, and with which options.
- **Source.** Nx passes the whole `nx.json` as `nxJsonConfiguration` to each entry's `createNodes` and chooses its files with `findMatchingConfigFiles(files, include, exclude)` (`project-graph/utils/project-configuration-utils.js`). Both that function and `globWithWorkspaceContext` are exported from `nx/src/devkit-internals` only, an interface that can change between majors ([[RISK-UPSTREAM-CHANGES]]).

The stand-in was not the plugin; how the plugin's two entries share reports is [[EVD-NX-PLUGIN-ENTRIES]].
:::

## Sources

Pages and repositories read for the design discussion, on 12 November 2026.

- [eddacraft/nxrust](https://github.com/eddacraft/nxrust): `docs/product-spec.md`, the cache design document, `src/graph.ts`, `src/utils/cache-inputs.ts`, `plans/issues.md`, `plans/modules/10-wasm-napi.aps.md`
- [max-sixty/cargo-affected](https://github.com/max-sixty/cargo-affected): README, `docs/report-json.md`, architecture notes
- [nrwl/nx](https://github.com/nrwl/nx) source at main: `misc-interfaces.ts`, `tasks-schedule.ts`, `tasks-runner/utils.ts`
- [Nx: Add Language Support to Nx](https://nx.dev/docs/kb/add-language-support.md)
- [Nx 23.3 release post](https://nx.dev/blog/nx-23-3-release): task-based affected, batched oxlint executor
- [Nx batch parallelism repro](https://github.com/ineentho/nx-batch-parallelism-repro)
- [@monodon/rust 3.0.0 release](https://github.com/Cammisuli/monodon/releases/tag/rust-3.0.0)
- [Cargo build cache reference](https://doc.rust-lang.org/beta/cargo/reference/build-cache.html): build-dir and target-dir
- [Call for Testing: Build Dir Layout v2](https://blog.rust-lang.org/2026/03/13/call-for-testing-build-dir-layout-v2)
- [Rework Cargo Build Dir Layout](https://goals.rust-lang.org/2025h2/cargo-build-dir-layout.html): build cache locking
- [Cargo unstable features](https://doc.rust-lang.org/cargo/reference/unstable.html): feature-unification
- [cargo-hakari: about workspace-hack crates](https://docs.rs/cargo-hakari/latest/cargo_hakari/about/index.html)
- [nextest filterset reference](https://nexte.st/docs/filtersets/reference/)
- [nextest: archiving and reusing builds](https://nexte.st/docs/ci-features/archiving/)
- [Sunsetting the rustwasm GitHub org](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org)
- [napi-rs: cross build](https://napi.rs/docs/cross-build)
