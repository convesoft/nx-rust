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

Load each fixture through the plugin and compare the graph with the expected one. Every member is a project rooted at its crate, and no file appears in any crate. A repository with a workspace at the root, one in a subfolder and a standalone crate yields all their members, with one cargo invocation per workspace, counted, when one plugin entry receives every manifest. Two entries that split one workspace's manifests cost one invocation each when Nx runs them in separate processes, and one in all when they share a process. An excluded member is a standalone crate. A crate used by path from a second workspace is one project, with an edge from its consumer, and its targets address its home workspace. A crate under a path ignored by `.gitignore` or `.nxignore`, or matched by `exclude`, has no project. Two crates with one name fail graph creation with an error containing both manifest paths; a `name` override or a workspace prefix resolves it, and the generated commands still carry the real package name and manifest path. Each workspace has exactly one workspace project that depends on every member, and a workspace whose root manifest defines a crate has no extra project. Normal, build and dev-dependencies each produce an edge. A fixture with a dev-dependency cycle keeps both edges, and `nx run-many -t test` on it runs without a task-cycle error. A crate that depends by path on an excluded crate has no edge to it and has that crate's folder among its inputs. With an empty Cargo home and Cargo set to offline, a fixture that has registry dependencies still yields its graph.

A workspace project whose root manifest defines no crate is named after its folder, with each `/` replaced by `-` and punctuation and case otherwise unchanged: `rust` for a workspace in `rust/`, `services-billing` for one in `services/billing/`, `apps-Billing.API-rust_v2` for one in `apps/Billing.API/rust_v2/`, and `cargo-workspace` for one at the root of a fixture repository that has no root `project.json`, no `nx` key in its root `package.json` and no package-manager workspace pattern that includes the root. A workspace name prefix leaves that name unchanged, and a `name` in `[workspace.metadata.nx.project]` replaces it. In the root fixture with a root `project.json` that sets a name, with a root `project.json` without one, with an `nx` key in the root `package.json`, and with a workspace pattern that includes the root, the folder holds one project, named by that `project.json` or else by the root `package.json`. It has the workspace project's targets and depends on every member, also when `[workspace.metadata.nx.project]` sets a `name`, which then has no effect. A workspace in a subfolder that holds a `project.json` without a name and no `package.json` keeps the default name, or the `name` set in `[workspace.metadata.nx.project]`. A workspace project named like a crate, and two workspace projects with one name, such as workspaces in `services/billing/` and `services-billing/` or at the root and in `cargo-workspace/`, fail graph creation with the plugin's error, which contains both manifest paths and the remedy for each: the `name` in `[workspace.metadata.nx.project]` for a workspace project, and the `name` override or the workspace prefix for a crate. A workspace project named like a JS project in another folder fails graph creation with Nx's own error.
:::

:::mara verification VER-CONFIGURATION
:mid: 01M78FHG7FNJ8YXT3BC2KGEXDK
:title: Apply overrides from Cargo metadata and plugin options
:status: accepted
:methods: test
:verifies: REQ-METADATA-OVERRIDES
:verifies: REQ-TARGET-NAMES

In a fixture, `[package.metadata.nx]` sets a project name, tags, an option of an inferred target and an extra target, and `[workspace.metadata.nx]` sets defaults. The graph shows the overridden name, the tags, the option on the inferred target and the extra target. A value set for a crate replaces the workspace default for that crate only, except tags: a crate has the workspace's tags and its own. No file other than Cargo manifests is involved. With default options a crate has `lint`, `test` and `build` targets, and `nx run-many -t lint` in a mixed fixture runs both a JS lint target and clippy. With a renaming in the plugin options, the target appears under the new name and not under the default one, for each inferred target, the artifact targets and the targets of the workspace project included.

In a workspace whose root manifest defines no crate, `[workspace.metadata.nx.project]` sets a name, tags, an option of an inferred target of the workspace project and an extra target. The graph shows them on the workspace project, whose tags also include those of the workspace table, while a target set under `[workspace.metadata.nx.targets]` appears on the members and not on the workspace project. A `[workspace.metadata.nx.project]` table in a root manifest that defines a crate fails graph creation with an error that names the manifest and `[package.metadata.nx]`.

In a fixture whose crate folder also has a `package.json` that Nx reads, the project has the name from that file whatever `name` the crate's metadata sets, and the tags of both.
:::

:::mara verification VER-UNKNOWN-OPTIONS
:mid: 01M7A93PSW34W2D2S2H4MD3R8X
:title: Ignore and report options the executor does not know
:status: accepted
:methods: test
:verifies: REQ-UNKNOWN-OPTIONS
:verifies: REQ-UNKNOWN-METADATA-OPTIONS

In a mixed fixture whose `nx.json` has the entry `test: { options: { passWithNoTests: true } }` under `targetDefaults`, `nx run-many -t test build --coverage` with an empty cache succeeds for every Rust task, and the cargo wrapper logs the same invocations as for the run without the entry and the flag. The output of each Rust `test` task has two lines. One names `passWithNoTests` and the task, says that the option comes from the workspace's configuration, names `nx show target <project>:test --json` and `sourceMap`, and suggests a `filter` and an empty entry keyed by the target's executor. The other names `coverage` as passed on the command line. The output of each Rust `build` task has only the second line. A second identical run restores every Rust task from the cache and prints the same lines, and a run with `passWithNoTests: false` restores no Rust task. With an empty entry keyed by the executor of `test` beside the `test` entry, or with that entry narrowed by a `filter` that excludes the crates, no line names `passWithNoTests`. With `--batch=false` the lines are the same.

Only flags typed on the command line get the line that says so: `--coverage` also after `--`, and on a dependency that a `dependsOn` entry with `params: "forward"` reaches. Each of the following gets the line that names the workspace's configuration:

- a `build` task that receives `passWithNoTests` from a dependent `test` through `options: "forward"`;
- `passWithNoTests: false` in a crate folder's `project.json`, beside the `test` entry, beside an empty entry keyed by the executor of `test`, and with the `test` entry narrowed by a `filter` that excludes the crates;
- under `-c ci`, the option in the entry's `configurations.ci` while the `project.json` sets it in `options`;
- an option under `nx.targets.test.options` in the `package.json` of a crate's folder that the package manager's workspaces list;
- the entry `run: { options: { watch: true } }`, for each `run` task.

With `test` configured with `coverage`, `nx run <crate>:test -- -- --coverage` keeps the configured value, and no line names `coverage` as passed on the command line.

For a target started in code, the check promises only what the conditions of `DES-UNKNOWN-OPTIONS` give. In the fixtures, a caller target depends on the started target with `params: "forward"` and starts it through `runExecutor`, passing its own context. Such an invocation gets no forwarded arguments when its merged options lack an option that Nx parsed from the arguments after `--` and that `run` does not declare, or hold it with a different value. For an unknown option that it holds with a value other than the override in the caller's graph task, it gets the line that names the workspace's configuration. The cases:

- `nx run <crate>:<caller> --coverage`, where the caller starts `build` with `coverage: "from-code"`, gives that `build` the line that names the workspace's configuration.
- The same command, where the caller starts `build` with nothing while `build` is configured with `coverage: "configured"`, gives the same line.
- `nx run <crate>:<caller> -- --port 3000`, where the caller starts `run` with `args: "--from-code"` and `port: 4000`, gives that binary `--from-code` and not `--port 3000`.
- The same command, where the caller starts `run` with `args: "--from-code"` alone and no `port` is configured, gives the same result.
- A caller that does not depend on the started target gives these results too, because its graph holds no task for that target.

The tested limit, which is no guarantee: when the merged options hold the same value, whether the caller passed it or the target's configuration supplied it, the invocation is treated as the scheduled one. These cases show it:

- During `nx run <crate>:<caller> --coverage`, a caller that starts `build` with `coverage: true` gets the line that names `coverage` as passed on the command line.
- So does a caller that starts `build` with nothing while `build` is configured with `coverage: true`.
- During `nx run <crate>:<caller> -- --port 3000`, a caller that starts `run` with `args: "--from-code"` alone, while `run` has `port: 3000` in its options, gives the binary `--from-code` and `--port 3000`.
- So does the same caller when `port: 3000` is in the configuration `ci` and the caller names `ci` or `ci` is `run`'s `defaultConfiguration`.
- So do arguments after `--` that name only `run`'s own options, such as `-- --bin server`.

Two crates of one group whose `project.json` files give the option different values still share one cargo invocation.

`nx run <crate>:run --coverage` gives a line that names `coverage` as passed on the command line, and the binary gets no argument. With the daemon on and off:

- `nx run <crate>:run -- --port 3000` passes exactly `--port 3000` to the binary and gives no line, and a task that this `run` depends on through a `dependsOn` entry without `params: "forward"`, also a continuous one, passes nothing to its binary;
- `nx run <crate>:run --args="--port 3000"` passes `--port 3000`;
- `nx run <crate>:run --bin <name> --args="--port 3000"` starts that binary with `--port 3000`, while `nx run <crate>:run --bin <name> -- --port 3000` starts cargo without `--bin`;
- `nx run <crate>:run -- --profile` fails with Nx's message that `profile` does not match the schema, and `--args="--profile"` passes `--profile` to the binary.

A key under `[package.metadata.nx.targets.test.options]` that is no option of the executor of `test` fails graph creation with a message that names the manifest, the target `test` and the key. So does the same key in each of these tables, whose messages also name the configuration where there is one:

- `[workspace.metadata.nx.targets.test.options]`;
- `[package.metadata.nx.targets.test.configurations.ci]`;
- `[workspace.metadata.nx.targets.test.configurations.ci]`;
- `[workspace.metadata.nx.project.targets.doc.options]` and `[workspace.metadata.nx.project.targets.doc.configurations.ci]`, in a root manifest that defines no crate.

With known keys only, graph creation succeeds.
:::

:::mara verification VER-TARGETS
:mid: 01M78FHG7F71BA7Q5ACKA99V9M
:title: Infer targets and no task dependencies
:status: accepted
:methods: test
:verifies: REQ-INFERRED-TARGETS
:verifies: REQ-NO-RUST-TASK-DEPS

For fixture crates of each shape (library only, binary, with benches, producing a wasm package, producing a Node addon, `publish = false`), the inferred targets are exactly the expected set: `run` only with a binary target, `bench` only with a bench target, an artifact target only on crates that produce that artifact, and no release targets with `publish = false`. No inferred target of any Rust crate has a `dependsOn` entry that resolves to a target of another Rust crate, and the task graph of `nx run-many -t build test lint` over a workspace with dependencies between crates has no edges between Rust tasks. The plugin adds no `dependsOn` entry to any JS project. In a mixed fixture where a JS target declares `^build` and its project depends on a crate, the task graph holds the `build` of that crate and no `build` of the crates behind it.

Through a cargo wrapper that logs invocations, each per-crate target runs the command of [[DES-TARGET-COMMANDS]] with the crate's real package name: `check` and `lint` with `--all-targets`, and without it for a crate whose metadata switches the option off; `fmt-check`, `fmt` and `bench` with nothing more; `run` with `--bin` when the option names a binary, and with the arguments given after `--` passed on to the binary. `nx run <crate>:run --bin <name> --args="--port 3000 --log a,b"` passes exactly `--port 3000 --log a,b` to that binary. The value of `args` is split as `DES-TARGET-COMMANDS` says: `--args="a '' b"` gives the three words `a`, an empty word and `b`; `--args='a\ b "c d" e'` gives `a b`, `c d` and `e`; `--args="a | b; c > d && e"` gives the words `a`, `|`, `b;`, `c`, `>`, `d`, `&&` and `e`; and `--args="'open"`, with an unterminated quote, and `--args='a\'`, whose value ends in a backslash, each fail the task with a message that names `args` and start no binary. `--args=3000` fails with Nx's message that `args` does not match the schema, while `--args=" 3000"` and `-- 3000` pass the one word `3000`. With `args` set in the crate's metadata and `-- --verbose` on the command line, the binary gets the words of `args` and then `--verbose`. Given together with `--`, `--bin` and `--args` before it do not reach the task, and `-- --profile`, the name of one of `run`'s options, fails with Nx's message that `profile` does not match the schema. No command carries `-D warnings` or another flag that denies warnings. `nx run-many -t run` over two crates with binaries starts two cargo invocations, and `bench` has `parallelism: false`. A crate whose metadata makes `run` continuous with a `readyWhen` check is started before a dependent that waits for it, and without that override a dependent of `run` starts after the binary has exited.

Each workspace project has `doc`, `audit` and `update`, and `deny` only in a fixture with `deny.toml`, `.deny.toml` or `.cargo/deny.toml` in its workspace root. With cargo-audit and cargo-deny removed from `PATH`, the graph has the same projects and targets. `doc` runs `cargo doc --no-deps --workspace`, `audit` runs `cargo audit`, `deny` runs `cargo deny check` and `update` runs `cargo update`, each in the workspace root. With `doc`'s option for `--no-deps` switched off, `doc` runs `cargo doc --workspace`. `fmt`, `bench`, `run`, `audit`, `deny` and `update` are never restored from the cache. After a change to `Cargo.lock` alone, `nx affected` selects `audit`, `deny` and `update` of that workspace; after a change to `.cargo/audit.toml`, it selects `audit`; after a change to the cargo-deny configuration file or to a member's manifest, it selects `deny`. With cargo-audit or cargo-deny removed from `PATH`, `audit` or `deny` fails with the message [[DES-DIAGNOSTICS]] gives for a missing tool, naming the tool and how to get it.
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

Keys must differ after: a change in any file of the crate's folder, such as a source file, `build.rs`, `Cargo.toml`, a README or a template; a change in a normal, build or dev-dependency crate, also two edges away; a change in an excluded crate that the crate depends on by path, directly or through another crate; a change in the root `Cargo.toml`, in a `rust-toolchain.toml` at crate or workspace level, or in a `.cargo/config.toml` at crate level, workspace level or a folder in between; a change in a `clippy.toml` for `lint`, in a `rustfmt.toml` for `fmt-check`, and in `.config/nextest.toml` for a `test` that nextest runs; a change of each environment variable in the list and of a variable the repository added, `CARGO_BUILD_WARNINGS` among them for every target that compiles; a change in the output of an added runtime command; a toolchain update, and another toolchain chosen through `RUSTUP_TOOLCHAIN`; a change of features, profile or target triple; a locked version bump of an external crate the crate depends on, directly or transitively; a switch of test mode between `full` and `affected`, and between two baseline commits; for artifact targets, another target triple or another version of a post-processing tool.

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

Every cargo command the plugin runs starts in the root folder of its workspace: in a fixture with a `rust-toolchain.toml` inside a member crate, the Nx tasks of that crate use the workspace's toolchain. After a manifest edit that needs a lockfile update, a task updates `Cargo.lock` as plain cargo would; with the `locked` option, or with `NX_RUST_LOCKED=true`, the task fails instead and `Cargo.lock` is unchanged. In locked mode `deny` fails in the same way, while `update` updates `Cargo.lock`, and `fmt` and `fmt-check` run, pass `--locked` to no command and give the same results as without locked mode. Creating the graph for a workspace that has no `Cargo.lock` creates none.

In a fixture whose crate depends by path on a crate outside its workspace, and whose workspace has a member that Nx excludes, `nx run-many -t fmt` changes files of the crates that have projects and of no other crate. A `doc` cache hit restores the workspace's whole `doc` folder. With two workspaces that share one artifact directory, `doc` is not cached and graph creation says so, while their `build` and `test` stay cached.
:::

:::mara verification VER-BATCHING
:mid: 01M78FHG7FRB1N8C3QP3YJZZAM
:title: Run groups as single cargo invocations with stable features
:status: accepted
:methods: test
:verifies: REQ-BATCHING
:verifies: REQ-STABLE-FEATURES

Through a cargo wrapper that logs invocations, `nx run-many -t test` over a workspace of several crates starts one cargo invocation per group and none per crate, without `--batch`. Each task has its own status and terminal output, and a second run restores every task from the cache with no cargo invocation. After a change to one crate, only that crate and its dependents run, in one invocation. A failing test in one crate fails that crate's task and no other. A compile error in one crate fails the tasks of that crate and of the crates that depend on it, and the tasks of unrelated crates in the same invocation still succeed. Under `workspace-build`, a compile error in a crate that is outside the selection and that no selected crate depends on fails no task and is reported as a warning. Tasks of two kinds, two workspaces, two profiles or two feature sets form separate invocations, which run one after another, and so do the `check` tasks of two crates of one workspace whose metadata sets `--all-targets` differently; there both tasks succeed when the crate without the flag has a bench that stable rejects under it. With `RUSTFLAGS` set in one crate's `.env`, that crate's task runs in an invocation of its own with that value, and the other tasks run without it.

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

The end-to-end suite runs on Linux against the oldest supported Nx and Cargo and the latest of each. The same runs on macOS are deferred ([[ADR-CI-LINUX-ONLY]]); until they exist, this verification establishes [[REQ-COMPATIBILITY]] for Linux only. The package's peer dependency range on `nx` names exactly the majors the suite has passed on. With an older Cargo or Nx, the plugin stops with an error that names the version found and the version required. With an Nx major newer than the supported ones, graph creation fails with an error that names the major found and the supported majors, also in a repository without a crate. With `NX_RUST_ALLOW_UNSUPPORTED_NX=true` it succeeds instead and warns, naming the major found and the supported majors, also while the Nx daemon creates the graph; with an older Nx the variable changes nothing. With a supported Cargo, the version check adds no cargo invocation to the one per workspace that [[VER-GRAPH]] counts.

`nx add` in a fresh workspace with a Cargo workspace installs the package, and `init` adds the plugin entry to `nx.json` and changes no other file: no crate, no Cargo manifest and no `.cargo/config.toml`. The schema of `init` declares no options. For each row of the table of tools in [[DES-GENERATORS]], a fixture that meets the row's condition and lacks the tool gets a warning that names the tool, what needs it and how to get it, and a fixture that does not meet it lists the absent tool on the one line marked "not needed by your settings". So a missing cargo-audit is always on that line, and a missing cargo-deny is on it unless a workspace root holds a cargo-deny configuration file. `init` names each workspace whose build directory is inside the repository together with the suggested `build.build-dir` setting, and it prints the fixture's graph-time warnings. Run a second time on a `nx.json` whose plugin entry carries options, `init` leaves that entry exactly as it is and prints its report again.

For each problem that [[DES-DIAGNOSTICS]] reports as an error when the plugin loads or the graph is created, `init` fails with the message that graph creation gives and leaves `nx.json` unchanged. As that table stands, the cases are: cargo removed from `PATH`; a manifest for which `cargo metadata` fails; a workspace whose Cargo is older than 1.91; a workspace that pins a toolchain that is not installed, after which no toolchain has been installed; an Nx major older or newer than the supported ones, also in a workspace without a `Cargo.toml`; two crates of one project name; `affectedTests` without the nextest runner; and a key under `options` or a configuration of a target table in Cargo metadata that the target's executor does not know. With a newer Nx major and `NX_RUST_ALLOW_UNSUPPORTED_NX=true`, `init` registers the plugin and warns. In a workspace without a `Cargo.toml` and with a supported Nx, `init` registers the plugin, runs no cargo and says how to create a crate.

The `library` and `binary` generators create crates that equal the output of `cargo new --vcs none` with the same options, also when folders on the way to the crate do not exist yet, and no crate contains a `.git` folder. Their schemas declare `directory`, `name` and `edition` and no other option. Run from a subfolder of the repository, a relative `directory` is resolved against that subfolder, as for Nx's own generators. The workspace manifest lists each crate as a member exactly once, whether a glob covers it or not, and gets a `members` list when it had none. `name` and `edition` reach the manifest, and without `edition` the crate takes the edition that `[workspace.package]` sets. A folder that the enclosing workspace's `exclude` matches fails with a message that names the manifest and the pattern, and nothing is created. Outside every workspace the crate is standalone, and the output says that it has its own `Cargo.lock` and build directory. With `--dry-run`, the output names the cargo command and no file changes. Into a folder that exists already, the generator fails with cargo's message and changes nothing.

For each tool the plugin can need, removing it from `PATH` and running a task that needs it fails with a message that names the tool, the feature that needs it and a way to get it; nothing is installed. In a workspace with `affectedTests`, a `test` run in mode `full` without cargo-affected succeeds and warns that the tool is missing. Contradictory options fail when the graph is created, with a message that names the options and the manifest. With cargo removed from `PATH`, and with a manifest that cargo rejects, graph creation fails with a message that names the manifest and carries cargo's error, and no project of any workspace is left out instead. A workspace that pins a toolchain that is not installed fails graph creation with a message that names the toolchain and the workspace. When the toolchain file changes to name such a toolchain after the graph was created, computing the cache key of a task in that workspace fails the same way. No toolchain gets installed in either case, and the cargo commands that tasks run get no `RUSTUP_AUTO_INSTALL` setting from the plugin.

A path dependency on a crate whose files Nx cannot see, such as one under a git-ignored path, produces a warning that names the crate and the dependency. A build directory inside the repository that Nx does not ignore, by any of its rules, produces a warning that names the directory and advises adding it to `.gitignore`, and so does such an artifact directory. In that fixture, neither `.gitignore` nor `.nxignore` covers the directory, and it lies under no folder that Nx always ignores. The same directory produces no warning when only `.nxignore` excludes it, nor when it lies under a folder that Nx always ignores, such as `.nx/cache` or `node_modules`, while neither ignore file covers it ([[EVD-NX-24-SETUP]]). Each of these warnings, and the warning for an artifact directory outside the repository, appears when the graph is created with `NX_DAEMON=false`, appears in the output of a task of the crate or workspace concerned with the daemon on, and is printed by `init`.
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
