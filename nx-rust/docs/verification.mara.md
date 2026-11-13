# Verification

How we establish that nx-rust meets its requirements and goals. Each definition
says what to check and what to expect. A definition is not a result: results
come from actual test runs, cited when an issue is closed.

## How the plugin is tested

- **Fixture workspaces.** Small Cargo workspaces under version control, each
  built to show one situation: a workspace in a subfolder, two workspaces, a
  standalone crate, an excluded member, a path dependency across workspaces, a
  vendored crate that is excluded and used by path, a name collision, a
  dev-dependency cycle, workspaces with different toolchains.
- **Graph tests** load a fixture through the plugin and compare projects,
  targets, inputs and edges with the expected graph. They need `cargo` but
  compile nothing.
- **The cache-key matrix** is a table of pairs of states with a verdict: "keys
  must differ" or "keys must not differ". A test computes the task hashes for
  both states with the real Nx hasher and checks the verdict.
- **End-to-end tests** install the built plugin into a fresh Nx workspace
  together with a fixture and run real `nx` commands against a real toolchain,
  counting cargo invocations and reading cache hits from Nx's output.

Checks that need an optional tool (nextest, cargo-affected, cargo-hakari,
`wasm-bindgen`, the napi CLI) run only where that tool is installed, and CI
installs all of them.

CI runs on Linux only for the moment. The macOS runs are deferred until
GitHub's macOS runners are usable again ([[ADR-CI-LINUX-ONLY]]), so no check on
this page has been run on macOS.

## Requirement checks

:::mara verification VER-GRAPH
:mid: 01M78FHG7FRWN7AJA7BVM1E4AE
:title: Build the expected graph from fixture workspaces
:status: accepted
:methods: test
:verifies: REQ-INFERRED-PROJECTS
:verifies: REQ-MULTI-WORKSPACE
:verifies: REQ-CROSS-WORKSPACE-DEPS
:verifies: REQ-SKIP-CRATES
:verifies: REQ-PROJECT-NAMES
:verifies: REQ-WORKSPACE-PROJECT
:verifies: REQ-DEPENDENCY-EDGES

Load each fixture through the plugin and compare the graph with the expected one. Every member is a project rooted at its crate, and no file appears in any crate. A repository with a workspace at the root, one in a subfolder and a standalone crate yields all their members, with one cargo invocation per workspace, counted. An excluded member is a standalone crate. A crate used by path from a second workspace is one project, with an edge from its consumer, and its targets address its home workspace. A crate under a path ignored by `.gitignore` or `.nxignore`, or matched by `exclude`, has no project. Two crates with one name fail graph creation with an error containing both manifest paths; a `name` override or a workspace prefix resolves it, and the generated commands still carry the real package name and manifest path. Each workspace has exactly one workspace project that depends on every member, and a workspace whose root manifest defines a crate has no extra project. Normal, build and dev-dependencies each produce an edge. A fixture with a dev-dependency cycle keeps both edges, and `nx run-many -t test` on it runs without a task-cycle error. A crate that depends by path on an excluded crate has no edge to it and has that crate's folder among its inputs. With an empty Cargo home and Cargo set to offline, a fixture that has registry dependencies still yields its graph.

A workspace project whose root manifest defines no crate is named after its folder, with each `/` replaced by `-` and punctuation and case otherwise unchanged: `rust` for a workspace in `rust/`, `services-billing` for one in `services/billing/`, `apps-Billing.API-rust_v2` for one in `apps/Billing.API/rust_v2/`, and `cargo-workspace` for one at the root of a fixture repository that has no root `project.json`, no `nx` key in its root `package.json` and no package-manager workspace pattern that includes the root. A workspace name prefix leaves that name unchanged, and a `name` in `[workspace.metadata.nx.project]` replaces it. In the root fixture with a root `project.json` that sets a name, with a root `project.json` without one, with an `nx` key in the root `package.json`, and with a workspace pattern that includes the root, the folder holds one project, named by that `project.json` or else by the root `package.json`. It has the workspace project's targets and depends on every member, also when `[workspace.metadata.nx.project]` sets a `name`, which then has no effect. A workspace in a subfolder that holds a `project.json` without a name and no `package.json` keeps the default name, or the `name` set in `[workspace.metadata.nx.project]`. A workspace project named like a crate, and two workspace projects with one name, such as workspaces in `services/billing/` and `services-billing/` or at the root and in `cargo-workspace/`, fail graph creation with the plugin's error, which contains both manifest paths and the remedy for each: the `name` in `[workspace.metadata.nx.project]` for a workspace project, and the `name` override or the workspace prefix for a crate. A workspace project named like a JS project in another folder fails graph creation with Nx's own error.
:::

:::mara verification VER-CONFIGURATION
:mid: 01M78FHG7FNJ8YXT3BC2KGEXDK
:title: Apply overrides from Cargo metadata and plugin options
:status: accepted
:methods: test
:verifies: REQ-METADATA-OVERRIDES
:verifies: REQ-TARGET-NAMES

In a fixture, `[package.metadata.nx]` sets a project name, tags, an option of an inferred target and an extra target, and `[workspace.metadata.nx]` sets defaults. The graph shows the overridden name, the tags, the option on the inferred target and the extra target. A value set for a crate replaces the workspace default for that crate only, except tags: a crate has the workspace's tags and its own. No file other than Cargo manifests is involved. With default options a crate has `lint`, `test` and `build` targets, and `nx run-many -t lint` in a mixed fixture runs both a JS lint target and clippy. With a renaming in the plugin options, the target appears under the new name and not under the default one, for each inferred target, the artifact targets included.

In a workspace whose root manifest defines no crate, `[workspace.metadata.nx.project]` sets a name, tags, an option of an inferred target of the workspace project and an extra target. The graph shows them on the workspace project, whose tags also include those of the workspace table, while a target set under `[workspace.metadata.nx.targets]` appears on the members and not on the workspace project. A `[workspace.metadata.nx.project]` table in a root manifest that defines a crate fails graph creation with an error that names the manifest and `[package.metadata.nx]`.
:::

:::mara verification VER-TARGETS
:mid: 01M78FHG7F71BA7Q5ACKA99V9M
:title: Infer targets and no task dependencies
:status: accepted
:methods: test
:verifies: REQ-INFERRED-TARGETS
:verifies: REQ-NO-RUST-TASK-DEPS

For fixture crates of each shape (library only, binary, with benches, producing a wasm package, producing a Node addon, `publish = false`), the inferred targets are exactly the expected set: `run` only with a binary target, `bench` only with a bench target, an artifact target only on crates that produce that artifact, and no release targets with `publish = false`. No inferred target of any Rust crate has a `dependsOn` entry that resolves to a target of another Rust crate, and the task graph of `nx run-many -t build test lint` over a workspace with dependencies between crates has no edges between Rust tasks. The plugin adds no `dependsOn` entry to any JS project. In a mixed fixture where a JS target declares `^build` and its project depends on a crate, the task graph holds the `build` of that crate and no `build` of the crates behind it.
:::

:::mara verification VER-CACHE-KEYS
:mid: 01M78FHG7FR5BWJMDVC9GHC213
:title: Check the cache-key matrix
:status: accepted
:methods: test
:verifies: REQ-INPUT-FILES
:verifies: REQ-ENV-ALLOWLIST
:verifies: REQ-TOOLCHAIN-KEY
:verifies: REQ-EXTERNAL-DEPS
:verifies: REQ-TEST-MODE-KEY
:verifies: REQ-ARTIFACT-CACHE

Compute task hashes with the real Nx hasher for pairs of states and check the verdict.

Keys must differ after: a change in any file of the crate's folder, such as a source file, `build.rs`, `Cargo.toml`, a README or a template; a change in a normal, build or dev-dependency crate, also two edges away; a change in an excluded crate that the crate depends on by path, directly or through another crate; a change in the root `Cargo.toml`, in a `rust-toolchain.toml` at crate or workspace level, or in a `.cargo/config.toml` at crate level, workspace level or a folder in between; a change in a `clippy.toml` for `lint`, in a `rustfmt.toml` for `fmt-check`, and in `.config/nextest.toml` for a `test` that nextest runs; a change of each environment variable in the list and of a variable the repository added; a change in the output of an added runtime command; a toolchain update, and another toolchain chosen through `RUSTUP_TOOLCHAIN`; a change of features, profile or target triple; a locked version bump of an external crate the crate depends on, directly or transitively; a switch of test mode between `full` and `affected`, and between two baseline commits; for artifact targets, another target triple or another version of a post-processing tool.

Keys must not differ after: a change in a crate that is not a dependency; a change of an environment variable outside the list; a locked version bump of an external crate outside the crate's resolved dependencies; a toolchain update for a toolchain the crate does not use, in a fixture where two workspaces use different toolchains; a change in a file that an artifact target generates in the source tree; a change in the lockfile or toolchain file of another workspace.
:::

:::mara verification VER-CARGO-UNCHANGED
:mid: 01M78FHG7FWJHMH4NRBANQ4A87
:title: Leave cargo, its directories and the manifests alone
:status: accepted
:methods: test
:methods: inspection
:verifies: REQ-CARGO-UNCHANGED
:verifies: REQ-CACHE-OUTPUTS
:verifies: REQ-NO-MANIFEST-WRITES

In an end-to-end fixture, run `nx run-many -t build test lint` and then the equivalent plain cargo commands: cargo reports nothing to compile. In the other order, the Nx tasks compile nothing either. After a full cycle of Nx commands, `git status` shows no new or changed file inside any crate and no change to `Cargo.toml`, `Cargo.lock` or `.cargo/config.toml`. With the build directory configured outside the repository, the Nx cache entry of each task contains no file from it, and a `build` entry contains only the named final artifacts. Delete the artifact and restore `build` from the cache: the artifact is back, and the modification times of files in the build directory are unchanged. Inspect the declared outputs of every inferred target and confirm that none names a path inside the build directory. The `build` entry of a `cdylib` or `staticlib` crate contains the library file, and no entry contains an `rlib`. With the artifact directory outside the repository, `build` and `doc` are not cached, graph creation says so, and `test` is still cached.

Every cargo command the plugin runs starts in the root folder of its workspace: in a fixture with a `rust-toolchain.toml` inside a member crate, the Nx tasks of that crate use the workspace's toolchain. After a manifest edit that needs a lockfile update, a task updates `Cargo.lock` as plain cargo would; with the `locked` option, or with `NX_RUST_LOCKED=true`, the task fails instead and `Cargo.lock` is unchanged. Creating the graph for a workspace that has no `Cargo.lock` creates none.
:::

:::mara verification VER-BATCHING
:mid: 01M78FHG7FRB1N8C3QP3YJZZAM
:title: Run groups as single cargo invocations with stable features
:status: accepted
:methods: test
:verifies: REQ-BATCHING
:verifies: REQ-STABLE-FEATURES

Through a cargo wrapper that logs invocations, `nx run-many -t test` over a workspace of several crates starts one cargo invocation per group and none per crate, without `--batch`. Each task has its own status and terminal output, and a second run restores every task from the cache with no cargo invocation. After a change to one crate, only that crate and its dependents run, in one invocation. A failing test in one crate fails that crate's task and no other. A compile error in one crate fails the tasks of that crate and of the crates that depend on it, and the tasks of unrelated crates in the same invocation still succeed. Under `workspace-build`, a compile error in a crate that is outside the selection and that no selected crate depends on fails no task and is reported as a warning. Tasks of two kinds, two workspaces, two profiles or two feature sets form separate invocations, which run one after another. With `RUSTFLAGS` set in one crate's `.env`, that crate's task runs in an invocation of its own with that value, and the other tasks run without it.

For each feature-unification strategy that can be set up in a fixture: build a subset of crates, then a different subset that shares a third-party dependency whose features differ between the subsets. The second run does not recompile that dependency, and the hash and result of a crate present in both runs are identical. In a `hakari` fixture where one member enables a feature of another member, the plugin uses `workspace-build` for that workspace and says so; with a stale hack crate, the drift check fails.
:::

:::mara verification VER-TESTING
:mid: 01M78FHG7F4RZ7Y316GEAW105Y
:title: Run tests with either runner and select affected tests safely
:status: accepted
:methods: test
:verifies: REQ-TEST-RUNNER
:verifies: REQ-DOCTESTS
:verifies: REQ-AFFECTED-TESTS
:verifies: REQ-TEST-MODE-KEY
:verifies: REQ-SELECTION-SAFETY
:verifies: REQ-BASELINE

With the default runner, a crate's `test` task runs `cargo test`; with `testRunner = "nextest"` it runs nextest, and the crate has no additional test target in either case. With nextest, a fixture whose only failing test is a doctest fails its `test` task.

`affectedTests` with the `cargo` runner fails graph creation with a message that names both options. In a workspace with `affectedTests`, a run without `NX_RUST_TEST_MODE` is in mode `affected` when no CI variable is set and in mode `full` when `CI` is set; with the variable set to `affected` or `full` it is in that mode in both places, and any other value fails the task. With `affectedTests` off, the variable changes nothing. With nextest, cargo-affected and a baseline, in mode `affected`: a change in one function runs only the tests that cover it, and the output says that a subset ran. A change to `build.rs`, a toolchain file, `.cargo/config.toml`, a proc-macro crate's source or a non-Rust file read by a test runs every test of the crates concerned. Without a usable baseline the full suite runs and the output gives the reason. `--affectedTests=false` runs the full suite, and a crate that opted out always runs all its tests. A result stored in affected mode is not restored for a run in mode `full` or against another baseline, while a full-mode result is restored for a full-mode run with equal inputs. Results of one nextest run are attributed to the right crates: a failure in one crate leaves the other crates' tasks successful. With `NX_RUST_TEST_MODE=full` in a root `.env.test` and nothing in the shell, a batched `test` run on a developer machine runs the full suite and stores it under the `full` key.

The baseline target, on a workspace with an earlier database, re-collects only affected and new tests; with no database, or with one further behind than the threshold, it collects everything.
:::

:::mara verification VER-ARTIFACTS
:mid: 01M78FHG7FQF8SPHQVG92FZBN7
:title: Build and cache napi and wasm artifacts
:status: accepted
:methods: test
:verifies: REQ-ARTIFACT-TARGETS
:verifies: REQ-ARTIFACT-CACHE

A fixture crate that produces a wasm package has `wasm-build` and no `napi-build`, a Node addon crate the reverse, and an ordinary crate neither. A `cdylib` crate without a dependency on `napi` or `wasm-bindgen` has neither target. `artifacts = []` in a crate's metadata removes an inferred artifact target, and `artifacts = ["wasm"]` adds `wasm-build` where the rule does not infer it. `wasm-build` produces the `.wasm` file and JS glue for each JS flavour, and the result loads in a browser-like runner. `napi-build` produces a `.node` file with JS and type definitions for the host triple, and Node can load it. A JS project whose build depends on the artifact target builds it first and is affected by a change to the crate. The generated files are restored from the cache on a second run, and changing them by hand does not change the target's hash. The compile step of an artifact target shares a cargo invocation with other builds of its group. A `wasm-bindgen` CLI whose version differs from the crate's fails with a message that names both versions.
:::

:::mara verification VER-SETUP
:mid: 01M78FHG7F2C09346B53ZGK2EZ
:title: Set up, generate and diagnose
:status: accepted
:methods: test
:methods: demonstration
:verifies: REQ-COMPATIBILITY
:verifies: REQ-INIT
:verifies: REQ-CRATE-GENERATORS
:verifies: REQ-DIAGNOSTICS

The end-to-end suite runs on Linux against the oldest supported Nx and Cargo and the latest of each. The same runs on macOS are deferred ([[ADR-CI-LINUX-ONLY]]); until they exist, this verification establishes [[REQ-COMPATIBILITY]] for Linux only. With an older Cargo or Nx, the plugin stops with an error that names the version found and the version required. `nx add` in a fresh workspace with a Cargo workspace adds the plugin entry to `nx.json`, changes no file inside a crate, and lists a tool that the fixture's settings need and that is absent. The `library` and `binary` generators create crates that equal the output of `cargo new`, and the workspace manifest lists them as members exactly once. For each tool the plugin can need, removing it from `PATH` and running a task that needs it fails with a message that names the tool, the feature that needs it and a way to get it; nothing is installed. In a workspace with `affectedTests`, a `test` run in mode `full` without cargo-affected succeeds and warns that the tool is missing. Contradictory options fail when the graph is created, with a message that names the options and the manifest. With cargo removed from `PATH`, and with a manifest that cargo rejects, graph creation fails with a message that names the manifest and carries cargo's error, and no project of any workspace is left out instead. A path dependency on a crate under a git-ignored path produces a warning that names the crate and the dependency.
:::

## Outcome checks

:::mara validation VAL-MIXED-REPO
:mid: 01M78FHG7FNP9RYQ1PNN0KTGR3
:title: Run a real mixed repository through one set of commands
:status: accepted
:methods: demonstration
:validates: GOAL-ONE-MONOREPO
:validates: GOAL-FAST-FEEDBACK
:exercises: SCN-ADOPT
:exercises: SCN-MIXED-CHANGE

Adopt the plugin in a real Nx monorepo that has JS/TS projects and at least one Cargo workspace with a crate consumed from JS. Its pipeline uses the same `nx affected` command for both languages and contains no Rust-specific step other than tool installation and the build directory cache. Over at least twenty pull requests, compare with the previous setup: Rust tasks ran only for pull requests that could affect them, the wall-clock time of the Rust part of a typical pull request is no worse than a tuned plain cargo pipeline with a warm build directory, and no pull request needed manual help to get the right tasks to run. Record shortfalls as issues or as changes to this knowledge.
:::

:::mara validation VAL-CARGO-PARITY
:mid: 01M78FHG7FAY110WZM8PBA7NSX
:title: Rust developers work as before
:status: accepted
:methods: demonstration
:methods: inspection
:validates: GOAL-CARGO-NATIVE
:exercises: SCN-ADOPT

In the repository of [[VAL-MIXED-REPO]], developers who work only on Rust continue to use plain `cargo` and rust-analyzer. After adoption there is no `project.json` or generated file in any crate and no setting that exists only for Nx outside the `nx` metadata tables and `nx.json`. Switching between `nx` and `cargo` commands on the same crate triggers no rebuild of unchanged code, and rust-analyzer's check on save does not invalidate the Nx-driven build. Ask those developers whether anything about their workflow changed; record what did.
:::

:::mara validation VAL-CACHE-TRUST
:mid: 01M78FHG7FYW60Y8SGM0JTPGBF
:title: Cached results match uncached runs
:status: accepted
:methods: test
:methods: analysis
:validates: GOAL-TRUSTED-CACHE
:exercises: SCN-AFFECTED-TESTS-PR

In the repository of [[VAL-MIXED-REPO]], run a scheduled job that executes every cached Rust target with the cache disabled on the current main commit and compares each result with what the cache would have restored. Over at least thirty days, no task that the cache reports as successful fails when it really runs, apart from tests already known to be flaky. Each mismatch is analysed down to the input that the key missed, and recorded as an issue and, where it shows a gap in [[DES-INPUTS]], as a change to this knowledge.
:::
