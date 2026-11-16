# Batching and features

> **Status:** implemented as this page describes, apart from the optional
> strict per-crate build check of the `hakari` strategy, which is not designed
> yet (nxr-ys8rx5). Nx hands the plugin's tasks to its batch executors
> without a flag, tasks of one group share their cargo commands, and each
> task gets its own result, terminal output and cache entry, under each of
> the three strategies. With the nextest runner, the call for the selection
> of affected tests comes with milestone 0.3.

Nx schedules one task per crate. Running each as its own cargo process would
queue them behind Cargo's build lock and repeat work. The plugin instead runs
each group of them with **one cargo call**, not one per crate, and reports a
result for every crate. `test` with nextest needs one more call for the
doctests, and in affected mode one before it for the selection of tests
([Testing](testing.mara.md)).

```sh
nx run-many -t test
```

```text
Nx tasks                       cargo calls
  api:test   ┐
  core:test  ├─ rust/, default features, dev profile, host   ->  1 call
  cli:test   ┘
  xtask:test ── tools/xtask/ (standalone crate)             ->  1 call

With nextest, each group takes 2 calls (tests, doctests), 3 in affected mode.
```

You do not pass a flag for this. Nx still hashes, restores and stores each task
on its own, so a cache hit for `core:test` simply leaves `core` out of the
group.

## What forms a group

A group is the tasks of one kind, such as `test` or `lint`, in one Cargo
workspace whose cargo commands would differ only in the crates they select: one
feature set, profile and target triple, and the same target options, such as a
crate's switch for `--all-targets`. Tasks that differ in any of these run
separately, one group after another. So do tasks whose `.env` files, such as
one in a crate's folder, give them different environment variables: each cargo
call runs with the environment its tasks were keyed with.

So that tasks of several crates can share an environment, a Rust build script
or test does not get the variables `NX_TASK_TARGET_PROJECT` and
`LERNA_PACKAGE_NAME`, whether its task runs on its own or in a batch, and
cannot read which Nx project it runs for; `CARGO_PKG_NAME`, which cargo sets,
names its crate.

Tasks in one group share their cargo calls: one for most targets, and with
nextest one for the tests, one for the doctests and, in affected mode, one for
the selection before them, with one more after the tests where a test failed,
which lists the tests that the run was to run. Every call of a group selects its crates the same
way, so they all compile with the same features
([Feature unification](#feature-unification)).

Some tasks run one crate per group instead, each with its own cargo command,
as every task did in milestone 0.1: where cargo would give a crate other
features depending on which other crates the same command selects. That is
the case under `hakari` for a feature set given by flags, such as the
all-features configuration, and for a triple that `.config/hakari.toml` does
not list, and under `workspace-build` for a non-host triple and for `test`
where you configured a runner for your host
([Tests under `workspace-build`](#tests-under-workspace-build)). Those runs do
not batch, so they are slower, and a dependency that two such tasks need with
different features is compiled once for each, as in milestone 0.1. A crate's
result never depends on what else runs.

Known limit: while a batch runs, Nx starts no other task. In a mixed repository
JS tasks wait for the Rust batch ([[RISK-BATCH-BEHAVIOUR]]). A batch also runs
its groups one after another, so tasks of groups of one crate that
`--parallel` would run side by side, such as the tests of two crates, run in
sequence in a batch.

## While a batch runs

A task's result appears when its group's cargo commands have ended, and one
group can take the whole run. So that you see that cargo is working:

- In Nx's terminal UI, the default in a terminal, the batch's pane shows
  cargo's lines as they arrive.
- In every other output style, the batch prints one line each time it starts
  a cargo command, such as
  `@convesoft/nx-rust: cargo test for api, core, cli (step 1 of 3)`.

These lines belong to no task: Nx does not store them, and a cache hit does
not replay them. Each task's own output, which Nx stores, is the same either
way. Under GitHub Actions, Nx holds back every line of a batch until the batch
has ended.

A Rust task that depends on a continuous task, such as a database that
`docker compose up` starts, runs in the batch. The one exception is a task
that waits (`waitFor: "ready"`) for a continuous task whose `readyWhen` is
`{ "signal": true }`: Nx gives such a task, run on its own, the server's URL
as `NX_READY_URL`, which it cannot give a batch, so the task fails and says
so. Run that command with `--batch=false`, or set `NX_BATCH_MODE=false` in the
root `.env` to run every task of the repository on its own, which turns
batching off for the tasks of every plugin.

## Two batches

`build`, `napi-build` and `doc`, whose files Nx stores, run through an
executor of their own, `@convesoft/nx-rust:cargo-outputs`; the other batched
targets run
`@convesoft/nx-rust:cargo`. Nx batches each executor's tasks apart and stores a
batch only when it ends, so the `build` batch is stored before a `test` batch
that waits for it starts, and no `cargo test` can change what Nx stores for a
`build` ([Targets](targets.mara.md#tests-that-build-a-crates-binaries)). A
command that runs both kinds shows a batch for each. Each batch forms its own
groups: a `build` that runs one crate per group still runs in the `build` batch.

- A `targetDefaults` entry keyed by `@convesoft/nx-rust:cargo` does not reach
  `build`, `napi-build` and `doc`. Key it by `@convesoft/nx-rust:cargo-outputs` as well.
- `nx add` adds an empty entry for each executor of the plugin's targets,
  this one included, where `targetDefaults` has none
  ([Setup](setup.mara.md#adding-the-plugin)).

## When something fails

A task is reported successful only when cargo's output shows that its crate
passed.

- A task fails when its own crate fails in any of its group's cargo calls, the
  doctests included, or when a crate it depends on does not compile.
- `build`, `check` and `lint` keep going after an error, so every task whose
  crate does not need the broken one still gets its own result.
- Under `workspace-build`, cargo also compiles crates you did not ask for. If
  one of those fails in a `build`, `check` or `lint` run and nothing you asked
  for depends on it, you get a warning, and no task fails.
- A failing test does not stop the others, so every other `test` task of the
  group still gets its own result.
- A compile error stops a test run before any test runs, because cargo cannot
  keep going there. Every `test` task of the group then fails, and the message
  names the crate that did not compile and says that the other crates' tests
  were not run. This is a cost of batching: when each task runs its own cargo
  command, as in milestone 0.1, an unrelated crate's tests still pass.
- Under `workspace-build`, a test run compiles the tests and libraries of
  every crate of the workspace. So a compile error in a crate you did not ask
  to test also fails every `test` task of the group, while `check` only warns
  about it.

## Dotenv files

Nx gives a task the variables of its dotenv files, such as `.env` in the
crate's folder or `.env.test` at the root, and the plugin gives cargo exactly
those, in a batch as when the task runs on its own. Before cargo runs, it
checks that the files give the same values in every way of running the task.
Where they might not, the task fails, and the message says what to change:

| The task fails where                                                                                                                                           | What to do                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A value refers, also through other values, to a variable that Nx sets differently depending on how the task runs, such as `FORCE_COLOR`                        | Remove the reference                                                                                                                                                           |
| A dotenv file defines `NX_LOAD_DOT_ENV_FILES`                                                                                                                  | Remove the definition from that file. To switch the loading of dotenv files off, set `NX_LOAD_DOT_ENV_FILES=false` in the environment of the `nx` command: in your shell or CI |
| `DOTENV_KEY` is set and a vault exists: `.env.vault`, `.local.env.vault` or `.env.local.vault` at the root, even without the plain file, or beside a task file | Remove the vault, or unset `DOTENV_KEY` for the command                                                                                                                        |
| A value refers back to itself so that Nx's expansion does not end, as `A=x${A}`                                                                                | Change the references that refer back                                                                                                                                          |
| The plugin cannot tell: Nx uses another dotenv-expand version, or the check gives up after its own limit of steps                                              | Run with `--batch=false`, or refer to fewer variables that the files define                                                                                                    |

## Feature unification

Cargo merges the features of shared dependencies across whichever crates are
built together. If the plugin simply built "whatever is affected", that set
would change on every run: dependencies would be rebuilt again and again, and a
crate's result would depend on what else happened to be in its batch.

The plugin therefore resolves features for the **whole workspace** wherever
tasks share a cargo command, with one of three strategies, and runs a crate on
its own where they cannot:

| Strategy          | Used when                                                                  | How                                                                                         | Cost                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hakari`          | The workspace has a cargo-hakari configuration and passes the checks below | Build only the selected crates; the hack crate keeps third-party features unified           | The hack crate must be kept current, and a check of it runs in every run                                                                                                                                                       |
| `cargo`           | You opt in; experimental                                                   | Cargo's `resolver.feature-unification = "workspace"`, with `-Zfeature-unification`          | Needs a nightly toolchain until Cargo stabilises it; on stable its tasks fail; a lockfile change runs every crate again                                                                                                        |
| `workspace-build` | Fallback                                                                   | Build the whole workspace, then run only the test binaries you asked for, and every doctest | Compiles unaffected crates, and compiles and runs every library's doctests in each test run; a compile error in any crate fails every `test` task of the run; needs a warm build directory; a lockfile change runs every crate |

Under `workspace-build`, plain cargo shares the plugin's builds where it
builds the whole workspace too, as `cargo build --workspace` does; a plain
`cargo build -p api` resolves features for `api` alone and can compile again
what differs, as it would after a plain `cargo build --workspace`.

To choose a strategy yourself, set `featureUnification` in
`[workspace.metadata.nx]` of one workspace, or in the plugin options for all of
them ([Configuration](configuration.mara.md#all-settings)).

### Tests under `workspace-build`

Cargo cannot leave crates out of a test run without resolving features for the
rest. So under `workspace-build` a group's `test` tasks compile the tests of the
whole workspace, also where only one task is left to run, and then:

- run only the group's own **test binaries**, through a runner that the plugin
  passes to cargo for your host. Cargo hands every test executable to it, and
  it runs those of the group's crates and skips the others;
- run the **doctests of every crate** of the workspace with a plain
  `cargo test --doc`, and keep the results of the group's crates.

```sh
cargo test --workspace --no-run
cargo test --workspace --tests --no-fail-fast --message-format=json-render-diagnostics \
  --config 'target.x86_64-unknown-linux-gnu.runner=["/usr/bin/node", "…/test-runner.js"]'
cargo test --workspace --doc --no-fail-fast
```

The runner is a small Node script, started with the Node that runs Nx. It
changes nothing that cargo compiles, is never written to a configuration file,
and passes cargo's environment on to the test unchanged. It records every test
binary it starts and how it ended, and a task passes only where that record
holds a passing run of every test binary that cargo's machine-readable messages
name for its crate; terminal settings such as `CARGO_TERM_QUIET`, and what tests
print, cannot change that. The doctests are decided by cargo and rustdoc as
without the plugin. Each task shows only its own crate's tests. With nextest,
the plugin selects the group's crates with a filterset, such as
`-E 'package(=api) | package(=core)'`, and nextest needs no runner. Your
nextest configuration applies as for a plain `cargo nextest run`: the profile
that `NEXTEST_PROFILE` chooses and its `default-filter`, so that a test that
the default filter leaves out is not run, and the task's output shows how many
tests nextest skipped.

What this costs:

- Every test run compiles and runs the doctests of every library in the
  workspace, also of crates you did not ask to test. A slow doctest elsewhere
  slows the run, one that hangs holds it up, and one with side effects, such as
  writing files, has them in every run. A failing doctest of another crate
  fails no task: each task warns and names the crate.
- A compile error in any crate's tests, examples or library stops the run, so
  every `test` task of the group fails, also for a crate you did not ask to
  test.
- A member that another member uses as a build-dependency is compiled a
  second time, with the profile for build scripts, the first time a test run
  follows a change or a plain `cargo test`, together with the member whose
  build script uses it.
- The runner starts once for each test binary of the workspace, one after
  another, which takes about 15 to 30 ms each.
- Where you configured a runner for your host, the plugin leaves it alone and
  runs each crate's tests in a cargo command of its own, which does not batch.
  It counts a runner as configured when `CARGO_TARGET_<TRIPLE>_RUNNER` is set
  for the host, or when a Cargo configuration file sets `runner` under
  `[target.<host triple>]` or any `[target.'cfg(…)']` table, also one that does
  not match your host. Each such task says so in its output.
- On macOS the runner has not been tested yet: a test that loads a dynamic
  library from the build folder may fail there, though never pass wrongly
  ([[RISK-TEST-RUNNER-MACOS]]).

### When the hack crate is enough

cargo-hakari unifies the features of third-party crates only. The plugin
therefore uses `hakari` only where it can show that this is enough, whether
`hakari` is the default or you set it. When Nx creates the graph, it checks
each workspace with a cargo-hakari configuration, `.config/hakari.toml`:

| Check                        | Fails when                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Members                      | A member asks another member for a feature, in any form: a `features` list, `default-features = false` on a member that declares a `default` feature, even `default = []`, or `other/feature` and `other?/feature` in its `[features]`; or a member's dev-dependency on itself asks for features |
| Platforms                    | `platforms` in `.config/hakari.toml` does not list your host's triple. `cargo hakari init` leaves the list empty                                                                                                                                                                                 |
| Crates outside the workspace | A crate outside the workspace depends on a member through normal or build dependencies, a `[patch]`, `[replace]` or `paths` entry points at a member, or the plugin cannot see the dependencies of a path crate outside                                                                          |
| Configuration                | `.config/hakari.toml` has a non-empty `traversal-excludes`, `final-excludes` or `registries`, `workspace-hack-line-style = "version-only"`, or another setting that the plugin does not know to leave nothing to the selection                                                                   |

If one fails, the whole workspace uses `workspace-build`, and the plugin says
why: a warning that names the check and the first crate or setting that
failed it, printed when the graph is created and at the start of every task of
the workspace. If that is how your workspace is meant to build, set
`featureUnification = "workspace-build"` in its `[workspace.metadata.nx]`: the
plugin then checks nothing and the warning goes away.

With `hakari`, the plugin also covers what the checks cannot see in advance:

- **A stale hack crate.** Every run that includes a cached task of the
  workspace's crates first runs the workspace's `hakari-check` task, which runs
  `cargo hakari generate --diff` and `cargo hakari manage-deps --dry-run`. If
  the hack crate is stale, it fails with cargo-hakari's output and no task of
  the workspace's crates runs. Run `cargo hakari generate` and
  `cargo hakari manage-deps`, and commit the result. The check is not cached.
  It reads the whole package graph, so on a machine whose Cargo home is empty
  it downloads every package of the lockfile, also those for other platforms,
  and offline it needs them there already, as `cargo fetch` leaves them.
- **Another triple.** Tasks that build for a triple that `platforms` does not
  list run one crate per cargo command. Where the triple is set in the
  repository, such as by `build.target` or a `targetTriple` in a crate's
  table, the plugin also warns and names it; one you pass with
  `--targetTriple` gets no warning.
- **Feature flags.** The all-features configuration, `noDefaultFeatures` and
  `features` run one crate per cargo command, because cargo applies them to
  the crates that a command selects. Only the default features batch.
- **Masked missing features.** A crate can stop declaring a feature it needs
  because the hack crate enables it. An optional strict per-crate build check
  catches this.

The hack crate is never published, and publishing a crate that depends on an
unpublished hack crate stops early with guidance
([Releasing](release.mara.md#dependencies-that-are-not-published)).

Under `hakari` a crate's key holds the hack crate's manifest and
`.config/hakari.toml` in place of the other members' manifests. Under
`workspace-build` and `cargo`, which build with the features of the whole
workspace, it holds what any member can change: every member's manifest, the
locked packages of every member, and the path crates outside the workspace
that any member uses. A change to `Cargo.lock` that moves any member's
packages, or to such a crate, then runs every crate of the workspace again
([Caching](caching.mara.md#lockfile-changes)). The key does not hold the
other members' sources: a compile error in another member fails the `test`
tasks that run in the same cargo command, but a crate's cached result, which
says that its own tests passed, is still restored. With
`NX_CACHE_FAILURES=true`, such a failure is stored under a key that does not
hold its cause ([What is stored](caching.mara.md#what-is-stored)).

## Feature sets and target triples

- Feature sets are Nx configurations at workspace level: the default features
  and all features.

  ```sh
  nx run-many -t test                     # default features
  nx run-many -t test -c all-features
  ```

- A crate that needs something else names it as `crate/feature`, or forms its
  own group.
- Under `hakari`, every feature set but the default features runs one crate
  per cargo command: these configurations do not batch. Under
  `workspace-build`, the whole workspace builds with the flags, which then act
  on every member, so they batch on the host.
- A platform triple for the same kind of artifact is a flag. A different kind
  of artifact, such as wasm or a Node addon, gets its own target
  ([napi and wasm artifacts](artifacts.mara.md)). Under `workspace-build`, a
  non-host triple runs one crate per cargo command, because the whole
  workspace may not build for it.
- v1 runs tests on the host triple only.

## Requirements

:::mara requirement REQ-BATCHING
:mid: 01M78FHG7FRS15ZD38BR42JSK7
:title: Run a group of tasks with one cargo command per step
:status: accepted
:satisfies: NEED-EFFICIENT-BUILDS

Tasks of one [[TERM-GROUP]] that Nx runs in the same command are served together, without the user passing a flag: with one cargo command for each step of their target, so that the number of cargo commands depends on the target and not on how many tasks the group has. Each task still has its own result, its own terminal output and its own cache entry, and a task restored from the cache takes no part in the commands. A task fails when its own crate fails in any step, or when a crate that it depends on does not compile; a failing test of another crate does not fail it. `build`, `check` and `lint` keep going after a compile error, so there a compile error in a crate that the task's crate does not need does not fail it either, while a test step that a compile error stops, in whichever crate, fails every task of that step, because none of its tests ran. Tasks whose commands would differ in more than the crates they select are never served together. Serving tasks together never lets Nx store, under one task's key, files that another task's cargo command wrote.
:::

:::mara requirement REQ-STABLE-FEATURES
:mid: 01M78FHG7FNYQZJD8HRKA23YRY
:title: Make a crate's result independent of its batch
:status: accepted
:satisfies: NEED-CORRECT-CACHE
:satisfies: NEED-EFFICIENT-BUILDS

A crate's result does not depend on which other crates run in the same Nx command, so a cached result is valid whatever ran beside it. For the tasks of a group other than a group of one crate, however many tasks it holds, the features with which a crate and its dependencies are compiled are the same whatever the command selects: two runs that select different sets of crates from one workspace compile shared dependencies with the same features, so neither rebuilds what the other built. A task that runs its crate alone in its command for one of the reasons that [[DES-BATCH]] names under "Groups of one crate" is compiled with what its crate and its dependencies ask for, the same in every run, so its result depends only on what its own key holds. Between such tasks, a shared dependency can be compiled in more than one variant, which cargo keeps side by side, so that running them in another order compiles nothing that commands for one crate each would not.
:::

## Design

:::mara design DES-BATCH
:mid: 01M78FHG7FY1VKFFHZ8G4WFDBJ
:title: Batch executor
:status: accepted
:satisfies: REQ-BATCHING
:mitigates: RISK-NX-INPUT-SEMANTICS

The plugin's cargo executor declares a `batchImplementation` and `preferBatch: true` in `executors.json`. Nx then hands the executor all runnable tasks of that executor at once, without `--batch`, and still hashes, restores and caches each task individually ([[ADR-BATCH-EXECUTOR]]).

**Two batch executors.** `build`, `napi-build` and `doc`, the targets whose files Nx stores ([[DES-OUTPUTS]]), run `@convesoft/nx-rust:cargo-outputs`, a second entry of `executors.json` with the same implementation and schema; the other batched targets run `@convesoft/nx-rust:cargo` ([[DES-TARGETS]]). Nx forms a batch from the runnable tasks of one executor and adds to it the tasks of the same executor that depend on them, stores the results and outputs of a batch only when the whole batch has ended, and awaits a batch, storing included, before it starts anything else ([[EVD-NX-24-BATCHES]]). With one executor, a crate's `build` and the `test` that waits for it ([[DES-TARGETS]]) would form one batch, the `test` group would run after the `build` group, and Nx would store the executable of `cargo test` under the key of `build`, as it did for 12 of 12 entries in [[EVD-CARGO-ARTIFACT-WRITERS]]. With two, such a `test` becomes runnable only once the batch of its `build` has run and been stored, and none of 12 entries was wrong. The batch implementation forms its groups inside each batch, below: the `cargo-outputs` batch holds the groups of `build` and `doc`, groups of one crate among them (**Groups of one crate**), and the other batch the groups of every other kind. Inside each batch the groups run one after another, in an order that the dependencies between their tasks allow, and Nx stores the batch only when all its groups have run, so splitting a group into groups of one crate changes how many cargo commands run, not when Nx stores, and no group of a `test`, of one crate or of several, runs inside the batch of the `build` it waits for. The groups of `build` and `doc` write different files, since `cargo doc` leaves the executables alone and only `doc` writes the `doc` folder. A `build` that Nx restores from the cache before a `test` batch runs is replaced on disk by the `cargo test` of that batch, while its entry stays right, as after any command that runs both ([[RISK-ARTIFACT-DIR-WRITERS]]). The guard of [[DES-TARGETS]] reads the task graph of the command, which every batch receives whole. For users, the executor of `build` and `doc` is `@convesoft/nx-rust:cargo-outputs`: a `targetDefaults` entry keyed by `@convesoft/nx-rust:cargo` no longer reaches them, [[DES-TARGET-DEFAULT-GUARD]] judges each executor's entries for its own targets, and `init` adds an empty entry for each executor of the plugin's targets, this one included, where `targetDefaults` lacks one ([[DES-GENERATORS]]).

The batch implementation splits its tasks into groups ([[TERM-GROUP]]): tasks share a group only when their cargo commands would differ in nothing but the crates they select. A group has one kind of task, Cargo workspace, feature set, profile, target triple and set of command options, and one environment, as the next paragraph describes. It runs the groups one after another, because each cargo call already uses every core and the groups of one workspace share a build lock, those that select the whole workspace first among the tasks whose dependencies have run (**Files that a batch stores**).

**Groups of one crate.** A group never passes a flag whose effect on a crate depends on which other crates the same cargo command selects, never selects crates whose features cargo would then resolve for that selection alone, and never sets a runner where the user may have configured one. Where its command would do any of these, each of its tasks forms a group of its own, which selects that crate alone, by its package ID specification as every command selects its crates ([[DES-INVOCATION]], "Selecting a crate"), as milestone 0.1 does for every task and as a plain `cargo test` of that one crate with `--all-features` does; "one cargo command per step" holds for each such group. The control plane decided this on 14 November 2026 under [[GOAL-TRUSTED-CACHE]] and [[REQ-STABLE-FEATURES]], of which the maintainer is told, because it costs speed and never a result. It applies to the cases below and to no other task; a group that holds one task for another reason is no group of one crate:

- Under every strategy, to a task of `build`, `check`, `lint` or `test` whose own options give it a feature set: `features`, `allFeatures` or `noDefaultFeatures` in the crate's table, its `project.json` or a `targetDefaults` entry ([[DES-FEATURE-SETS]]). It forms a group of its own whatever else the batch holds, also where a configuration or the command line gives other tasks the same flags, so that its result does not depend on what else runs, and its command writes no other member's stored files (**Files that a batch stores**). The plugin cannot tell a `targetDefaults` entry from a crate's own options, which Nx merges, so a feature set given to every crate there runs one crate per command; given through a configuration, it shares a command. The control plane decided this on 16 November 2026 under [[GOAL-TRUSTED-CACHE]], after a review of nxr-8f9dz2 found that a crate whose table sets `allFeatures` shared the batch of another crate's whole-workspace build, which rewrote the other crate's executable with all features before Nx stored it.
- Under `hakari`, to a feature set given by flags: `--all-features`, `--no-default-features` and every `--features`. Cargo 1.91.0 and 1.100.0 apply `--all-features` and `--no-default-features` to the selected crates only, give an unqualified name in `--features` to each selected crate that has it, and accept `crate/feature` only where a selected crate is that crate or depends on it directly, so that a crate that another selected crate depends on is compiled with other features, or the command fails, depending on what else it selects ([[EVD-HAKARI-UNIFICATION]]). Only the default features share a command.
- Under `cargo`, to every `--features`, which cargo still checks against the selected crates; under workspace unification, `--all-features` and `--no-default-features` act on every member whatever the selection, and share a command ([[EVD-HAKARI-UNIFICATION]]).
- To a triple for which features are not resolved for the whole workspace: a non-host triple under `workspace-build`, whose groups cannot build the whole workspace ([[DES-FEATURE-SETS]]), and under `hakari` a triple, or a host, that `platforms` does not list ([[DES-UNIFICATION]]).
- Under `workspace-build`, and `hakari` where it falls back to it, to the `test` tasks of a group on the host where a runner for the host is or may be configured: the selecting runner that such a group needs would replace that runner, or be combined with it or lose to it, depending on the cargo version ([[DES-TEST-RUN]], "A runner the user configured"). The control plane decided this on 14 November 2026, of which the maintainer is told.

Under `workspace-build` on the host, a group builds the whole workspace, so its flags act on every member, and it shares one command whatever its feature set. It does so however many tasks it holds: a group left with one task, because the command names one crate or Nx restored the others from the cache, still builds the whole workspace, with the selecting runner for `test` ([[DES-TEST-RUN]]), so that its crate compiles with the features of the whole workspace in every run, as its key promises. A command that selects one crate resolves features for that crate and what it depends on, so its result depends only on the crate's own dependencies, which every key of [[DES-INPUTS]] covers: the keys of the whole-workspace strategies are a superset of them, and under `hakari` a crate's key holds them with the hack crate's manifest. A crate that another task's crate depends on can then be compiled twice, once with its own task's flags and once as the dependency, and cargo keeps both builds side by side, so running the tasks in another order compiles nothing that per-crate commands would not ([[EVD-HAKARI-UNIFICATION]]). Such groups do not batch: they cost a cargo command, and its wait for the build lock, per crate and step.

**Files that a batch stores.** No cargo command of a batch writes a file that another task of the same batch stores as its output, unless that task's own command runs after it: Nx stores a batch's outputs only once the batch has ended, as the files are then, whoever wrote them ([[EVD-NX-24-BATCHES]], "Storing"). Of the `cargo-outputs` batch, only `build` groups and the compile groups of `napi-build` write files that more than one task stores. A `napi-build` compile writes the files that a `build` of the same selection writes, the whole workspace's or those of the crates it selects with `-p`, and counts as a `build` group in the rule below; the addon and its JS files in the crate's folder are written only by the post-processing of their own task, right after its group's compile ([[DES-NAPI]]). `napi-build` belongs to this batch and not to the other one because Nx stores its files: in the other batch, a `test` group could compile a crate again after a `napi-build` group and before Nx stores it, while here a `build` group and a `napi-build` group that write the files of one crate never run in one batch. A whole-workspace `build` writes the executables, `cdylib` and `staticlib` files of every member, also those of a fresh unit, which cargo links again; a group of one crate writes only its crate's, also where its feature set changes that of the members it depends on, and no file of a dependency built as a library, nor a dependency's `cdylib`, `staticlib` or executable ([[EVD-CARGO-ARTIFACT-WRITERS]], "Feature sets of one crate"). So the batch runs the whole-workspace groups first, and each group of one crate after them. A group that selects its crates with `-p`, as under `hakari` and `cargo`, writes only the files of the crates it selects, as a group of one crate does. A group runs only where no `build` group of the batch has run before it in its workspace root for a crate whose files it writes, which the control plane settled on 16 November 2026 for the groups that select crates, so that two tasks of one crate, such as its `build` in two configurations, never let one command rewrite what the other stores: a whole-workspace `build` group therefore runs only where no `build` group of the batch has run in its workspace root before it, whatever the profile and triple, as for two whole-workspace groups whose environments differ through a crate's `.env`, or whose feature sets differ through the tasks' default configurations; there each writes the other's files and no order helps. The batch then leaves its tasks unreported, together with the tasks that depend on them, and Nx runs them in a following batch process once it has stored the batch's other tasks, as it does for every task that a batch leaves out ([[EVD-NX-24-BATCHES]], "Tasks left out"); each later group follows the same rule. The control plane allowed this in place of failing such tasks before cargo with a message to run them in a separate command, provided Nx's source and a run showed it, which they did ([[VER-BATCHING]]): every task then passes, its command runs once, and Nx reports the batch once. `doc` is not concerned: it is a task of the workspace project, one per Cargo workspace, and writes only its workspace's `doc` folder, which no `build` writes, while Nx caches no `doc` whose artifact directory another workspace shares ([[DES-OUTPUTS]]). `check`, `lint` and `test` run in the other batch, whose tasks store no files, and a `test` waits for every `build` whose executables its commands replace ([[ADR-WORKSPACE-TEST-EXECUTABLES]]).

Nx computes each task's key with that task's environment, which includes the dotenv files it loads for the task: those in the crate's folder and those at the repository root named for the target or a configuration, such as `.env.test`. The batch process gets only the environment of the `nx` command and the root `.env`, `.env.local` and `.local.env` ([[EVD-NX-24-INPUT-SEMANTICS]]). A task's cargo gets, in a batch, exactly the environment that it gets when the task runs on its own. The batch implementation therefore rebuilds each task's whole environment as Nx builds it for the task run on its own, with the functions of Nx that do so, layer by layer as [[EVD-NX-24-BATCHES]] ("Task environment") records: the dotenv layer, Nx's per-task variables such as `NX_TASK_TARGET_PROJECT`, and the variables that Nx removes from every task. It splits a group further where those environments differ, and runs each cargo command with the environment of its tasks. No task runs with another environment than the one its key was computed with. Cargo gets the command's environment and the task's dotenv files, plus exactly the per-task variables that are the same in every way of running the task, alone or in a batch, in any output style, in a terminal or not, with the daemon or without; every other variable that Nx sets for a way of running is left out. Of those per-task variables, cargo never gets `NX_TASK_TARGET_PROJECT` and `LERNA_PACKAGE_NAME`, which name the task's project and alone differ between the tasks of one target and configuration, so that such tasks share an environment and a command ([[ADR-TASK-NAME-VARIABLES]]). Those are the variables by which Nx tells a task how it runs and records it, not what the task is ([[EVD-NX-24-BATCHES]], "Task environment"): its key `NX_TASK_HASH`, which Nx does not hand a batch; where Nx writes the task's terminal output and whether it captures standard error, streams or prefixes it, which follow the output style and the key; `FORCE_COLOR`, which Nx removes from a task whose output it writes to a file and sets for one whose output it pipes; `NX_PSEUDO_TERMINAL_EXEC_ARGV`, `NX_PSEUDO_IPC_PATH` and `NX_PSEUDO_IPC_FORK_ID`, which Nx's pseudo-terminal gives a task that runs on its own in a terminal, the first of them reaching the task empty; `NX_TUI_AUTO_EXIT`, `NX_VERBOSE_LOGGING` and `NX_ANALYTICS_SESSION_ID`, which the `nx` process sets from `--tui-auto-exit`, from `--verbose` and for its analytics; and `NX_SET_CLI`, `NX_ORIGINAL_FORCE_COLOR`, `NX_READY_SIGNAL_SOCKET` and `NX_READY_SIGNAL_TASK`, which Nx removes from every task and its pseudo-terminal gives back. The plugin leaves them out of every environment that it runs cargo with and asks cargo for reports with, for a task run on its own as in a batch, so that no cargo command, build script or test sees them and no result can depend on them. Nx's pseudo-terminal lays the environment that Nx built for a task over the `nx` process's own, so that a variable which Nx's per-task layer leaves without a value comes back with the `nx` process's value for a task in a terminal ([[EVD-NX-24-BATCHES]], "Task environment"); the plugin therefore gives cargo those variables as that layer gives them, in every way of running: `NX_SKIP_NX_CACHE` is `true` where the run skips the cache and absent otherwise, `NX_TASK_TARGET_CONFIGURATION` names the task's configuration or is absent, and `NX_READY_URL` reaches cargo only for a task that waits for a continuous task that reports ready by signal, the one case in which Nx gives it the variable. What Nx sets for a task run on its own after the per-task layer, `NX_FORKED_TASK_EXECUTOR` when it forks and `NX_CLI_SET` when the task's process starts, a batch process has from its start, before the batch lays the task's dotenv files over it; the batch sets both again after the task's own variables, in that order, so that a dotenv file that defines one changes the value in neither path. What then differs between two runs of a task is what differs between any two `nx` commands, `NX_INVOCATION_ANCESTOR_PIDS` and the plugin's `NX_RUST_COMMAND_ID` and `NX_RUST_NX_COMMAND`, and what the commands' own environments set differently. Nx gives a task run on its own `NX_READY_URL` only where an edge with `waitFor: "ready"` leads to a continuous task whose `readyWhen` reports ready by `signal`, the only check that reports a URL, and tells a batch nothing of it ([[EVD-NX-24-BATCHES]], "Continuous tasks"). The maintainer decided on 15 November 2026, asked what should happen with batching on by default, "Refuse only where it matters (Recommended)": a task of a batch with such an edge fails before cargo runs, with a message that names the continuous task and offers `--batch=false` for one command and `NX_BATCH_MODE=false` in the root `.env` for the repository, saying that the latter turns batching off for every task, of every plugin ([[DES-DIAGNOSTICS]]); every other continuous dependency, with another check or none, gives the task run on its own nothing that a batch lacks, and runs in the batch. So no result is stored under an environment that differs from the one of a run on its own. Not chosen: reading the URL from Nx's database of running tasks in the batch, keeping `NX_READY_URL` out of cargo's environment altogether, and an opt-out per target. A task whose preparation fails, also through an unexpected error of the plugin's own, fails alone, and the other tasks of the batch go on.

**Dotenv files.** Nx expands the dotenv files of a task run on its own in the `nx` process, before it adds the task's own variables, and the batch expands them in its own process, which Nx gives variables of its own. The variables that Nx sets, changes or removes on the way from the `nx` command to the process of a task or of a batch, or sets in its own process from the output style, the terminal UI or an option, can therefore have other values where the files are expanded, depending on how the task runs ([[EVD-NX-24-BATCHES]], "Task environment", names them). Every other variable has the same value in the `nx` process, the batch process and the task's process, so expanding a task's files gives the same values in every way of running unless the expansion looks one of those variables up. Before any cargo command, alone as in a batch, the plugin reads the dotenv files that Nx loads for the task, and nothing for a task without any, and fails the task where expanding them would look one of those variables up, with a message that names the file, the variable whose value refers to it, the variable looked up and why its value differs. A reference written in a file is not enough to look for: dotenv-expand 12.0.3, which Nx 24.0.6 pins, expands again what it substitutes, so a value of the command's environment or of another file can bring a reference, and it can assemble one from a substituted value and the file's text ([[EVD-NX-24-BATCHES]], "Dotenv expansion"). The plugin therefore follows dotenv-expand step by step through every name that it looks up. Where it cannot tell a name's value where Nx expands, as for a variable that the files define and that the command may set to an empty value, it follows every value the name can have there, and keeps the one it took for the rest of that expansion, as a name has one value in dotenv-expand's environment, so that repeated references to one variable do not multiply. A file that only defines one of those variables changes nothing that cargo sees, since each of them is left out of cargo's environment, set or removed by Nx after the dotenv files for every task, set again by the batch after the task's own variables as Nx sets it after them for a task run on its own, or given to cargo as Nx's per-task layer gives it, and passes; so do Nx's own settings in the root `.env`, such as `NX_DAEMON`, `NX_VERBOSE_LOGGING`, `NX_PARALLEL` or `NX_SKIP_NX_CACHE`, which the `nx` process loads when it starts. While Nx builds a task's dotenv layer in a batch, the batch gives each of those variables that the task's files define a value of its own, and restores its environment afterwards, also where Nx throws, so that dotenv-expand takes that value as it is, as it takes the `nx` process's own value for a task run on its own, such as `NX_ORIGINAL_FORCE_COLOR=0` under `FORCE_COLOR=0`, instead of expanding the file's value: the batch process lacks some of them, and where the file's value does not end, as `NX_ORIGINAL_FORCE_COLOR=${CMD}z` with `CMD=x${CMD}` in the command, it would run out of memory while the task alone passes ([[EVD-NX-24-BATCHES]], "Dotenv expansion").

Whether Nx loads the files at all, the `nx` process's `NX_LOAD_DOT_ENV_FILES` decides when Nx builds the task's dotenv layer, and the batch process has the same value; Nx sets it to `true` unless the command's environment or the root `.env` sets it to `false`. A dotenv file of the task can define the variable too, and the task's environment then ends with the file's value, which tells nothing of what decided: a task whose dotenv files define `NX_LOAD_DOT_ENV_FILES`, whatever the value, fails, and the message says to remove the definition from the files that it names and, to switch the loading of dotenv files off, to set `NX_LOAD_DOT_ENV_FILES=false` in the environment of the `nx` command, in the shell or the CI settings. Otherwise the task's environment has the value that decided. Where Nx loads no files, it still removes from the task each variable whose value the root `.env`, `.local.env` or `.env.local` gives, and loads nothing back, while its pseudo-terminal gives a task in a terminal the `nx` process's values back; the plugin then removes them again with Nx's own function, from every variable apart from those that Nx sets after the dotenv layer, alone as in a batch.

Unknown means fail: where the installed Nx expands with another version of dotenv-expand and a value holds a `$`, where dotenv would read the task's variables from a vault, and where the installed Nx lacks a part that the check reads, the task fails before cargo runs ([[DES-DIAGNOSTICS]]). The vault comes before every other part of the check, before the files that define `NX_LOAD_DOT_ENV_FILES`, before the return for a task without dotenv files and before the one for a run in which Nx loads none: with `DOTENV_KEY` set, in the command's environment or by a dotenv file, dotenv reads `.env.vault`, `.local.env.vault` or `.env.local.vault` at the root where Nx removes the root files' values from the task, also where the plain file is missing and whether or not Nx loads the task's files, and reads the vault beside the last of the task's files that exists where it loads them ([[EVD-NX-24-BATCHES]], "Dotenv expansion"); a task fails where any of these exists.

A task fails as well where the check stops following an expansion, with a message that says why. dotenv-expand has no limit, so the check has bounds of its own. Each tells an expansion that does not end from one that repeats, such as a list of hundreds of references to one variable, and none of the first three is reached by an expansion that dotenv-expand ends with every result within the size of one environment variable:

- **Cycle.** The expansion comes back to a state that it had: the same result, as many earlier results and, in the check's search, the same values chosen, found exactly with Brent's algorithm. dotenv-expand's next step depends only on the result and the set of earlier results that it keeps, which only grows, so from a state that comes back it repeats the same steps without end; an expansion that ends never comes back to a state.
- **Nesting.** A name's value is put in more than 64 times along one chain of insertions, each inside the text that putting in the same name's value gave, as where a variable refers to itself with text around the reference: `A=x${A}` read through `B=${A}z`. A repetition nests nothing. An expansion that does not end and does not come back to a state grows, by putting in values along a chain on which, with finitely many names, some name comes back each round, or through a replacement pattern that the length bound stops. An expansion that ends stops a name's nesting only through dotenv-expand's guards, a value equal to an earlier whole result or a result equal to the value that the name had, which a result holding a value nested many times inside the text of its own earlier insertions no longer equals. Expansions that ended in the drift test's 12,500 generated cases nested a name at most five times, and none of 1,012 cases that these bounds stopped ended in Nx's own loader ([[EVD-NX-24-BATCHES]], "Dotenv expansion").
- **Length.** A result grows beyond 131,072 characters, Linux's limit for one environment string (`MAX_ARG_STRLEN`), with which no process, cargo's included, could be started. This also stops growth that puts in no value, as through `$&` in a default, which `String.prototype.replace` reads as the reference's text.
- **Search.** The check takes more than 1,000,000 steps over all the values that it follows for names whose value it cannot tell. This is the limit of the check's own uncertainty, not of dotenv-expand, and its message says that the plugin cannot tell. One path takes a step for each reference that it puts something in for, and keeping one value per name for an expansion and putting texts without `$` in as one placeholder keep the paths few, so that only files with very many references, or with many variables that both the files and the command define with references, reach it.

**Cargo's output while a batch runs.** A task's result, with its terminal output, can be reported only once its group's commands have ended, and a group can be the whole run. The maintainer decided on 15 November 2026, asked what users should see of cargo's output while a batch runs, "Live in the terminal UI, status line elsewhere (Recommended)": where Nx runs its terminal UI, which it tells the batch process with `NX_TUI=true`, the batch process writes cargo's lines to its own standard error as they arrive, beside the file that feeds each task's result, the rendered diagnostic of a JSON message in place of the message, so that the terminal UI shows them in the batch's pane; in every other output style, which the batch process cannot tell apart, it writes one line each time a cargo command starts, naming the command, the group's crates and the step, such as `@convesoft/nx-rust: cargo test for api, core, cli (step 1 of 3)` ([[EVD-NX-24-BATCHES]], "Terminal output"). Such lines belong to no task: Nx neither stores nor replays them, and no task's stored output and no environment changes. Not chosen: live output in the terminal UI only, live output in every style, which the static styles print twice, and no live output. Under GitHub Actions' grouping, Nx holds back every line of a batch until it has ended, whatever the batch writes.

A task that Nx runs on its own, as with `--batch=false`, is a group of one task: it runs the steps that the same group runs in a batch, with cargo's standard streams as its own where it selects its crate, and, where it selects the whole workspace, its part of the steps' output once they have ended, as its result in a batch holds it. Nx runs such tasks at the same time, up to `--parallel`, and stores each once it ends, so that a whole-workspace `build` can link another task's executable again, with that build's feature set or environment, in the milliseconds before Nx copies it; whether this happens is not yet known (nxr-fpc72j).

A group runs one cargo command for each step of its target, one after another. Every target has one step, apart from `test` with the nextest runner, which has the steps of [[DES-TEST-RUN]]: the selection in affected mode, the nextest run and the doctests; and `test` with the `cargo` runner under `workspace-build`, which has three: the build, the test binaries and the doctests ([[DES-TEST-RUN]], "Under `workspace-build`"). Every step starts in the workspace root ([[DES-INVOCATION]]) and selects the crates of the group's tasks in the same way, as [[DES-UNIFICATION]] prescribes, so that every step resolves the same features ([[REQ-STABLE-FEATURES]]) and reuses what the steps before it compiled. A step in which no crate of the group takes part, such as the doctests where no crate has a library, is left out, and so is every step after one that failed every task of the group, since no task can pass it any more. Before the step of a group of cached `build` or `doc` tasks, the plugin asks cargo once for the group's directories ([[DES-OUTPUTS]]).

The plugin maps the output of every step back to one result per task, whose terminal output holds its part of each step's output, in order. It matches cargo's human-readable lines without the terminal escape sequences that cargo adds where `CARGO_TERM_COLOR=always` or `term.hyperlinks` asks for them, as CI configurations set them, and keeps the lines as cargo wrote them in each task's output; cargo's JSON messages carry none. Unknown counts as failed: a step counts as passed or failed by cargo only where cargo exited with status 0 or with 101, the status that cargo gives a command that failed, and every task of a step whose cargo was stopped by a signal, exited with another status or did not start fails. So does every task of a step of several crates whose output is not whole: JSON messages that end without `build-finished`, which cargo prints when the build has ended, that hold a line cut short or that contradict the exit status, and a list of failed test targets that does not end cargo's output, is not exactly as long as its first line announces or holds a line that names no target. Only the last such list counts, so that a list that a test prints before cargo's own changes nothing. A group of one crate runs the command that its task runs outside a batch, without the flags below, which only tell the crates of a command apart, and passes a step where cargo exits successfully, with the whole output as its own: with one crate, a failed command is a failed crate. The checks that follow cargo run for each task after the last step of its group, a group of one crate included: the lockfile post-check, on the digests that [[DES-LOCKFILE-HASHING]] names, and for `build` the check of [[DES-BUILD-INPUT-CHECK]]. A task succeeds only when cargo reported its result. When a step's command succeeds, every task of the step has passed it, with one exception: in the test binaries' step under `workspace-build`, a task passes only where the selecting runner's record shows a passing run of every test executable of its crate, so that a command that exits with 0 without that evidence fails its tasks ([[DES-TEST-RUN]], "Evidence for test binaries"). When the command fails, a task passes the step only where cargo's output shows that its crate passed, and a task whose result the output does not show fails, with a message that says why. Each step runs even when a step before it failed for some crates. What cargo reports per crate after a failure was established by experiment ([[EVD-CARGO-BATCH-FAILURES]]):

- **Builds, checks and clippy.** `build`, `check` and `lint` pass `--keep-going` and read cargo's JSON messages. With `--keep-going`, cargo still builds every target that does not need a failed one; without it, cargo starts no new job after the first failure and leaves crates unbuilt that do not depend on the failed one. The messages report each target that cargo built as a `compiler-artifact`, also when it was fresh, and each rustc error as a `compiler-message` that names the package and the target. A failing build script appears only in cargo's human-readable error, and a target that cargo did not reach because something it needs failed does not appear at all. A task of a failed command therefore passes only when the messages report an artifact for every unit of its crate that the command builds whatever else is selected, and no error for any target of the crate. A unit is a target compiled in normal mode or as a test, which the messages tell apart by `profile.test`. Counting targets alone is not enough: with `--all-targets`, a dev-dependency that does not compile keeps cargo from compiling the crate's targets as tests, while it reports the crate's library and binaries as built and no error for the crate, whose check on its own fails ([[EVD-CARGO-BATCH-FAILURES]]). The units are those of the library and the binaries, tests, examples and benchmarks that the command's flags select and whose required features the task's own selection turns on, named from the `cargo metadata` report that the group asks for the package ID specifications, as [[DES-BUILD-INPUT-CHECK]] names the targets of `build`: without `--all-targets`, the library and the binaries in normal mode; with it, also the examples in normal mode, and, as tests, the library, the binaries and the benchmarks, whose `bench` flag the report does not give, and the tests and examples whose `test` flag is on. A unit counted although the crate turned it off fails the task only when the command fails, while a unit left out could pass a task whose crate failed. A target that only another selected crate's features turn on can fail the task only through an error message. So a task fails when its own crate fails or when it needs a crate that failed, and its message names the crates that cargo reported as failed. A failure in a crate that the task does not need does not fail it. When that crate is outside the selection, which can happen under `workspace-build`, the failure is reported as a warning and fails no task.
- **Test runs.** `cargo test` and `cargo test --doc` pass `--no-fail-fast`, so a failing test binary or doctest does not stop the ones after it. `cargo test` has no `--keep-going`: a compile error in any crate that the command compiles stops it before any test runs, the tests of the crates that compiled included. nextest builds all test binaries before it runs one, so its run stops in the same way. Every test task of such a step fails, with a message that names the crates that failed to compile and says that the tests of the others were not run. Under `workspace-build` the step compiles the tests and the library of every crate of the workspace, so a compile error in a crate outside the group fails every test task of the group as well, while a `check` run only warns about it; the message then says that the crate is outside the selection. The plugin does not run the step again without the failing crate, because that would be a further command with another selection of crates. This is a cost of batching: a task that runs its own cargo command runs its crate's tests whatever the state of an unrelated crate. How the output of a test run is attributed to tasks is part of [[DES-TEST-RUN]].

Known issue: since Nx 22.7, no other task starts while a batch runs, so JS tasks wait for a Rust batch ([[RISK-BATCH-BEHAVIOUR]]).
:::

:::mara design DES-UNIFICATION
:mid: 01M78FHG7F43VP2172VYY8A41Q
:title: Feature unification strategies
:status: accepted
:satisfies: REQ-STABLE-FEATURES
:mitigates: RISK-HAKARI-GAPS

Features are never resolved for the set of crates that happens to be selected ([[ADR-WORKSPACE-FEATURES]]): a group that shares a cargo command resolves them for the whole workspace, and a task whose group cannot runs its crate alone ([[DES-BATCH]], "Groups of one crate"). One option chooses how the whole workspace is resolved:

| Strategy          | Used when                                                                  | How                                                                                                                                                                                                   | Cost                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hakari`          | The workspace has a cargo-hakari configuration and passes the checks below | Build only the selected crates; the [[TERM-HACK-CRATE]] keeps third-party features unified                                                                                                            | The hack crate must be kept current; an uncached drift check in every run                                                                                                                                                                          |
| `cargo`           | Opted in; experimental                                                     | `resolver.feature-unification = "workspace"` with `-Zfeature-unification`, both on the command line; select the crates with `-p`                                                                      | Needs a nightly toolchain until Cargo stabilises it, and fails on stable; keys follow the whole workspace ([[DES-INPUTS]])                                                                                                                         |
| `workspace-build` | Fallback, also for a workspace that fails a check below                    | Build the whole workspace; test binaries run through a selecting runner that skips the other crates, and the doctests of every crate run, of which the group keeps its own results ([[DES-TEST-RUN]]) | Compiles unaffected crates, and in every test run compiles and runs the doctests of every library; a compile error in any crate fails every test task of the group; needs a warm build directory; keys follow the whole workspace ([[DES-INPUTS]]) |

**How each strategy selects.** Every step of a group selects its crates in the same way ([[DES-BATCH]]), the selection of affected tests and the doctests included ([[DES-TEST-RUN]]):

- `hakari`, where it applies, and `cargo` select each crate with `-p` and its package ID specification ([[DES-INVOCATION]]).
- `cargo` passes `--config 'resolver.feature-unification="workspace"'` and `-Zfeature-unification` on the command line, of every command that compiles: the groups' steps, a group of one crate's included, and the commands of `doc`, `bench` and `run`, which the control plane settled on 16 November 2026 so that every command of such a workspace resolves features as its keys assume. Stable cargo ignores the setting without the flag, with a warning, and then resolves features for the selected crates alone, while it rejects the flag with an error ([[EVD-WORKSPACE-TEST-SELECTION]]). With the flag, a task on a stable toolchain fails with cargo's error instead of compiling with narrowed features. The control plane decided this on 14 November 2026 under [[GOAL-TRUSTED-CACHE]], of which the maintainer is told.
- `workspace-build`, and `hakari` where it falls back to it, select the whole workspace with `--workspace`. `build`, `check` and `lint` tell the crates apart by cargo's messages ([[DES-BATCH]]). For `test`, stable cargo has no flag that leaves out crates without narrowing features, so a group's test binaries run through the selecting runner of [[DES-TEST-RUN]], and with nextest through a filterset, and its doctests run for the whole workspace without a runner, of which the group keeps its own results ([[ADR-TEST-SELECTING-RUNNER]]). Where a runner for the host is or may be configured, the group's `test` tasks run one crate per command instead ([[DES-TEST-RUN]], "A runner the user configured").
- `-p` for one crate alone belongs only to the tasks that [[DES-BATCH]] names under "Groups of one crate": a feature set given by flags that act on the selected crates, a triple for which features are not resolved for the whole workspace, and a runner that the user may have configured for the host. Each of those selects its crate with `-p` and needs no selecting runner. Every other group selects as its strategy prescribes, however many tasks it holds: under `workspace-build`, a group left with one task, because the command names one crate or Nx restored the other tasks from the cache, selects the whole workspace, with the selecting runner for `test`, and compiles with the features of the whole workspace, as its key promises. With `-p` it would compile with its crate's own features under the same key, and a test that depends on them would pass alone and fail in a larger run, or the other way round ([[EVD-TEST-RUNNER-EVIDENCE]]).

cargo-hakari unifies neither the features of workspace members nor those of a third-party crate that depends on a member through normal or build dependencies, and a feature that only a platform-specific dependency table asks for it unifies only on the platforms that its configuration lists ([[EVD-HAKARI-UNIFICATION]]). The `hakari` strategy therefore adds the following to what hakari does.

**When the hack crate is enough.** The maintainer decided on 14 November 2026 to keep the strategy in milestone 0.2 with full detection: the plugin uses the hack crate only where it can show that doing so is safe, and otherwise falls back to `workspace-build` with a message that says why. Moving the strategy out of milestone 0.2 was the option not taken. A workspace thus uses `hakari`, whether it is the default or `featureUnification` sets it, only when it has a configuration that cargo-hakari reads, `.config/hakari.toml` in the workspace root or else `.guppy/hakari.toml` ([[EVD-HAKARI-UNIFICATION]]), that parses and whose `hakari-package` names a member, and when it passes four checks, which graph creation makes from what it reads anyway; the drift check runs before the tasks (**Drift**, below).

1. **No member asks a feature of another member, in any form.** In the `--no-deps` report ([[DES-METADATA-REPORT]]), take every dependency of a member whose path is the folder of another member, of every kind (normal, build and dev) and under every platform table, renamed, optional and inherited with `workspace = true` ones included, for which the report gives the features of `[workspace.dependencies]` and of the member merged. The check fails where such a dependency has a non-empty `features` list, or turns off default features while the other member's `features` table declares `default`, also as `default = []`, which still gives the member `feature = "default"` when it is selected itself; or where an entry of the member's `features` table names a feature of it as `<name>/<feature>` or `<name>?/<feature>`, by the dependency's name or its rename. It fails as well where a member's dev-dependency on itself, whose path is its own folder, has a non-empty `features` list: when the member is selected for its tests or with `--all-targets`, cargo compiles it with those features for every crate of the command that links it. A plain dependency with default features asks nothing beyond what the member has when it is selected itself, and turning off default features of a member that declares no `default` changes nothing ([[EVD-HAKARI-UNIFICATION]], "Features that no manifest asks for"). A use of a member through a registry or git dependency that a redirection replaces is the third check's.
2. **`platforms` lists the host.** `platforms` in the configuration lists the host's triple, as `rustc -vV` names it in the workspace root, run as graph creation runs cargo ([[DES-METADATA-REPORT]]). The host counts for every task, also one that builds for another triple, because build scripts and proc macros are compiled for it. So a workspace whose `platforms` is empty, as in the configuration that `cargo hakari init` writes ([[EVD-HAKARI-UNIFICATION]]), or lists other triples only, falls back to `workspace-build`: running every task one crate per command would give up batching altogether, while `workspace-build` batches the whole workspace. Machines with different hosts can thereby use different strategies for one workspace; their keys differ anyway, because the toolchain input names the host ([[DES-INPUTS]]). A non-host triple that `platforms` does not list makes nothing fall back. The maintainer chose on 14 November 2026 "Keep `hakari`; that triple runs per crate (Recommended)", which refines his first answer, under which the whole workspace fell back; that falling back was the option not taken. The tasks that build for such a triple run one crate per command (**Triples that `platforms` does not list**), whether graph creation knows the triple, from `build.target` or `CARGO_BUILD_TARGET` ([[DES-OUTPUTS]]) or from a `targetTriple` that the metadata tables give a target of a member or one of its configurations ([[DES-PLUGIN-OPTIONS]]), or only a task names it. A target specification file is never listed.
3. **No crate outside the workspace reaches a member through normal or build dependencies.** cargo-hakari leaves such a crate out of the hack crate, so its features, and those that it asks of the member, follow the selection; a crate that reaches a member only through a dev-dependency goes into the hack crate and passes ([[EVD-HAKARI-UNIFICATION]]). The `--no-deps` report does not show crates outside the workspace, and the full report that does is ruled out at graph creation ([[ADR-METADATA-NO-DEPS]]), so the check uses the crates outside the workspace whose dependencies the plugin knows from the reports it requests anyway ([[DES-METADATA-REPORT]]): the path crates that the members reach by path, through their dependencies of every kind and behind those through normal and build dependencies, through any number of such crates with a project or without; and the crates that the workspace's `[patch]`, `[replace]` and `paths` entries name, with the crates behind them by path ([[DES-PROJECT-GRAPH]]). The check fails where one of them reaches a member, matched by real folder, through normal or build dependencies, directly or through other such crates. Where the plugin cannot tell without the full report, it does not assume safety, and the check fails in exactly these shapes:
   - a redirection of the workspace whose crate is a member: a `[patch]` or `[replace]` entry whose path is a member's folder, or a `paths` entry below whose folder discovery finds a member. Any registry or git crate that depends on that name then depends on the member, and only `Cargo.lock` or the full report shows whether one does; graph creation reads neither ([[DES-METADATA-REPORT]]);
   - a crate among those above without a report, whose dependencies are unknown: one whose folder holds `.cargo-checksum.json` ([[ADR-SKIP-VENDORED-CRATES]]), and one whose report cargo refused with a warning ([[DES-METADATA-REPORT]]).

   No other crate can reach a member: a registry crate names no path, and what a git crate names by path lies in its own repository, so either reaches a member only through such a redirection.

4. **The configuration leaves nothing to the selection.** Some settings of cargo-hakari's configuration leave packages out of unification, and `generate --diff` and `verify` still pass ([[EVD-HAKARI-UNIFICATION]]). The control plane decided on 14 November 2026, under [[GOAL-TRUSTED-CACHE]] and with the maintainer told, that what is not shown to be safe counts as unsafe. The check therefore passes only where every key of the configuration is one of these, with a value for which experiments with cargo-hakari 0.9.39 found the features of every third-party crate the same in every selection ([[EVD-HAKARI-UNIFICATION]]):
   - `hakari-package`, which names a member, and `platforms` (the second check);
   - `resolver`: `"1"`, `"2"` or `"3"`, whatever the workspace's resolver;
   - `unify-target-host`: `"auto"`, `"none"`, `"unify-if-both"` or `"replicate-target-on-host"`;
   - `dep-format-version`: `"1"` to `"4"`; `exact-versions` and `output-single-feature`: `true` or `false`;
   - `workspace-hack-line-style`: `"full"` or `"workspace-dotted"`;
   - `traversal-excludes`, `final-excludes` and `registries`, only where they are empty.

   It fails for a non-empty `traversal-excludes` or `final-excludes`, which leave members or third-party crates out of unification; for `workspace-hack-line-style = "version-only"`, with which the members' dependency on the hack crate names no path and features followed the selection; for a non-empty `registries`, which was not tried; and for any other key or value. The configuration that `cargo hakari init` writes passes once `platforms` is filled in.

The control plane settled on 16 November 2026, under [[GOAL-TRUSTED-CACHE]] and the rule that what the plugin cannot determine falls back, what the checks do where the files leave them no answer: a configuration that is no valid TOML falls back as one without `hakari-package`, before the first check; a `platforms` that is no list of strings, and a host that `rustc -vV` names no triple for, fail the second check; a list or table of the fourth check counts as empty only where every list in it, at any depth, is empty. A target table's `targetTriple` of `host-tuple` or a target specification file is no triple that the warning about `platforms` names. To undo one, change the function of `nx-rust/src/graph/unification.ts` that makes it and this paragraph.

**Fallback.** When a check fails, the whole workspace uses `workspace-build`: its crates' targets get that strategy's inputs ([[DES-INPUTS]]), it has no `hakari-check` target, and its groups build the whole workspace ([[DES-BATCH]]). Graph creation warns, and the warning names the workspace, the check, and the first member, crate, entry or setting that fails it, in a fixed order: the checks as numbered above, and members and crates by the path of their manifests. It says what would change the outcome: for the platforms, to add the host's triple to `platforms` and run `cargo hakari generate`; for the configuration, what is missing in which file, or the key and value of the setting that the plugin does not accept; and in every case that `featureUnification = "workspace-build"` in the workspace table makes the choice explicit, which ends the warning. The warning concerns every project of the workspace, crates and workspace project, and goes the way of the other warnings found when the graph is created: printed then, by `init`, and at the start of every task of those projects, with its digest in their named input `nx-rust-warnings`, so that the keys of their tasks change when it appears or goes away ([[DES-DIAGNOSTICS]], "Warnings where they are seen"). A workspace whose strategy is `cargo` or `workspace-build`, by default or by setting, is not checked and draws no warning.

**Where the executor reads it.** Graph creation records the strategy that a workspace uses, and under `hakari` the triples of `platforms`, in the metadata of each of its projects, beside the workspace's root manifest ([[DES-PROJECT-GRAPH]]), where it gives the same graph the inputs of that strategy; the executor reads both from there and takes a project whose metadata names no strategy, as from a graph made before the strategies existed, for `workspace-build`, whose keys such a graph holds. Under `hakari`, the batch reads the host's triple and the task's triples when it forms the groups; where `rustc -vV` names no host, or a triple's folder cannot be named ([[DES-OUTPUTS]]), the task forms a group of one crate, which costs speed and never a result. The control plane settled both on 16 November 2026.

**What the choice depends on.** The checks read the members' manifests and the root manifest, through the report; the configuration file of cargo-hakari; the manifests of the crates outside the workspace and the redirection tables of the root manifest and of Cargo's configuration files, with the folders below a `paths` entry, as for the graph's edges ([[DES-METADATA-REPORT]]); and, for the host, the toolchain in the workspace root. The other triples that graph creation knows, from Cargo's configuration files, `CARGO_BUILD_TARGET` and the members' metadata tables, decide only the warning about a triple that `platforms` does not list. Graph creation reads all of them afresh in every computation ([[ADR-NO-METADATA-CACHE]]). Without the Nx daemon, every command creates the graph. With the daemon, a change to a file inside the repository that Nx sees, such as a member's manifest or `.config/hakari.toml`, makes it run every plugin's `createNodes` again, as does a command that brings another environment ([[EVD-CARGO-REDIRECTIONS]], [[EVD-NX-24-WARNING-CHANNELS]]). The new graph gives the workspace's targets the inputs of the strategy that now applies, which are part of the project configuration that Nx hashes into every key, and adds or removes the warning, whose digest is in the keys as well ([[DES-INPUTS]], "Beyond the declared inputs"). A change that flips the answer therefore changes the key of every task of the workspace's crates. A file outside the repository or one that Nx ignores, such as a `[patch]` in the Cargo home's configuration, and a toolchain switched outside the repository reach the choice only when Nx creates the graph again, as they reach the edges ([[ADR-REDIRECTION-EDGES]]); the warning about such a configuration file says so ([[DES-DIAGNOSTICS]]), and a host that changed is handled as below.

**Triples that `platforms` does not list.** When the batch implementation forms the groups of a workspace that uses `hakari`, it reads the triples that each task's cargo commands build for, as it reads them for the outputs ([[DES-OUTPUTS]]), and the host's triple with `rustc -vV` in the workspace root and the task's environment. Where one of them is not among the `platforms` that graph creation recorded in the project's metadata, the hack crate does not unify the dependencies under that platform's tables, and the task forms a group of one crate ([[DES-BATCH]], "Groups of one crate"): its command resolves features for its crate alone, which its key under `hakari` covers. That holds for a non-host triple that graph creation knows, for which it also warns, naming the triple and `platforms`, saying that the tasks for it run one crate per command and that adding it to `platforms` and running `cargo hakari generate` lets them share commands. The warning concerns every project of the workspace and is printed and keyed like the fallback warning ([[DES-DIAGNOSTICS]]). It holds as well, without a warning, for a triple that graph creation does not see: one that the command line, a `project.json`, `targetDefaults` or a dotenv file of the task gives, or one that a configuration file outside the repository picks after the daemon created the graph, and for a host whose toolchain changed since. A triple that `platforms` lists shares a command as designed: the hack crate unifies third-party features on that platform, the first check fixes the features of members, and a feature set given by flags runs one crate per command (**Feature flags**).

**Feature flags.** Cargo applies `--all-features`, `--no-default-features` and `--features` to the crates that a command selects, so under `hakari` a group with a feature set given by flags runs one crate per command ([[DES-BATCH]], "Groups of one crate"). A member that is only a dependency in such a command is then built with what its dependents ask, which the first check fixes to its default features, whatever else the Nx command runs; and the hack crate carries the third-party features that every member asks for with all its features, which `generate` takes into account ([[EVD-HAKARI-UNIFICATION]]). Under `cargo`, `--features` runs one crate per command, while `--all-features` and `--no-default-features` act on every member and share one.

**Drift.** A workspace that uses `hakari` has the target `hakari-check` on its workspace project ([[DES-WORKSPACE-TARGETS]]). It runs `cargo hakari generate --diff` and then `cargo hakari manage-deps --dry-run` in the workspace root, and fails when either fails, with cargo-hakari's output and a message that says to run `cargo hakari generate` and `cargo hakari manage-deps` and commit the result. `cargo hakari verify` is not used: it passes for a member without the dependency on the hack crate, while these two commands caught every stale case tried, a missing feature, a new member without the dependency and a hack crate that gives more than the members ask for ([[EVD-HAKARI-UNIFICATION]]). Neither command writes a file. Following the pattern of the lockfile task ([[DES-LOCKFILE-HASHING]]):

- The target is not cached and runs whenever a task that depends on it runs. Every cached target of the workspace's crates that depends on the lockfile task, and the workspace's `doc`, depends on it, and it depends on the lockfile task, so that cargo-hakari reads the lockfile that the crates' keys hold. When it fails, Nx skips the tasks that depend on it and stores nothing for a skipped task, also with `NX_CACHE_FAILURES=true` ([[EVD-NX-24-BATCHES]], "Dependents of a failed task"). It is not cached because its verdict depends on the whole package graph, which also follows files outside the repository, such as a `[patch]` in the Cargo home's configuration, as the lockfile task's verdict does. It uses an executor without a batch implementation, so it never joins a batch.
- It is the second exception that [[REQ-NO-RUST-TASK-DEPS]] makes: a target of the workspace project, not of another crate, that depends on nothing but the lockfile task, so it adds no task cycle ([[DES-PROJECT-GRAPH]]). A cached crate task whose task graph holds no dependency on it, in a run that does not exclude task dependencies, as where a `project.json` replaces the target's `dependsOn`, fails before cargo runs, as one without the lockfile task does. A run with `--exclude-task-dependencies` runs neither, and `NX_RUST_RUN_ID` keeps whatever the crate tasks store from being restored ([[DES-LOCKFILE-HASHING]], "Excluded dependencies").
- cargo-hakari is the user's to install ([[ADR-V1-SCOPE]]). Where it is missing, the task fails with the message for a missing tool ([[DES-DIAGNOSTICS]]).
- Both commands read the whole package graph through `cargo metadata`, which needs the manifest of every package in the lockfile, for every platform ([[EVD-HAKARI-UNIFICATION]], [[ADR-METADATA-NO-DEPS]]). On a machine whose Cargo home lacks them, the check downloads them, also those that the build itself does not need. Offline, through `CARGO_NET_OFFLINE` or `net.offline`, it fails until they are there, as `cargo fetch` without `--target` leaves them.
- cargo-hakari passes cargo no `--locked` and takes no such flag ([[EVD-HAKARI-UNIFICATION]]). It needs none: in locked mode the lockfile task before it fails on a stale or missing `Cargo.lock`, and cargo leaves a current one alone ([[DES-INVOCATION]]). A lockfile that changes while the run goes on fails the crate tasks through the lockfile task's post-check ([[DES-LOCKFILE-HASHING]], "Post-check").

**What the keys hold.** Under `hakari`, a crate's key leaves out the other members' manifests and holds only its own digest. In their place it holds the hack crate's manifest and the configuration file of cargo-hakari ([[DES-INPUTS]], "Hack crate"). The drift check passes only where the hack crate is what cargo-hakari generates from the members' manifests, the lockfile and its configuration, so that the hack crate's manifest then stands for what the other members ask of third-party crates, and the four graph-time checks establish that this is all that the other members can change. With a stale hack crate, a crate's result would depend on its batch under a key that does not change; but then the drift check fails and no task of the workspace's crates runs, so nothing is stored. Generating the hack crate again changes its manifest and with it every key, and undoing the change that made it stale brings back the state for which the stored results hold.

**Masked missing features.** A crate can stop declaring a feature it needs because the hack crate enables it. An optional strict per-crate build target catches this. Provisional, decided by the control plane on 16 November 2026 under [[REQ-NO-MANIFEST-WRITES]] and [[ADR-V1-SCOPE]]: the target is not designed yet and does not exist, and nxr-ys8rx5 holds it. A command line cannot build a crate without the hack crate: a `[patch]` given with `--config` cannot replace the hack crate, which is a member, and cargo-hakari's own way, `cargo hakari disable`, writes the hack crate's manifest ([[EVD-HAKARI-UNIFICATION]], "Without the hack crate"). To undo, design the target as nxr-ys8rx5 asks, which needs the user's agreement on how it builds without the hack crate.

**Publishing.** The plugin never publishes the hack crate. Publishing a crate that depends on a hack crate with `publish = false` fails before cargo runs and points to cargo-hakari's ways of publishing such a crate ([[DES-RELEASE]]).

[[RISK-HAKARI-GAPS]] records what remains that no check sees.
:::

:::mara design DES-FEATURE-SETS
:mid: 01M78FHG7FBXD8XDCTFPZQD2QA
:title: Feature sets and target triples
:status: accepted
:satisfies: REQ-BATCHING
:satisfies: REQ-STABLE-FEATURES

Feature sets are Nx configurations at workspace level: the default features and all features. Every inferred target that compiles, `build`, `check`, `lint`, `test`, `bench`, `run` and the workspace's `doc`, has the default features in its options and a configuration `all-features` that sets `allFeatures`, so that `nx run-many -t test -c all-features` runs every crate with all features; a target table can lay a configuration of that name of its own over it ([[DES-METADATA-TABLES]]). A crate that needs another set either names single features as `crate/feature` or forms its own group: a task of `build`, `check`, `lint` or `test` whose own options give it a feature set, `features`, `allFeatures` or `noDefaultFeatures` from the crate's table, its `project.json` or a `targetDefaults` entry, is a group of one crate that selects only its crate, whatever else the batch holds, so that its result does not depend on what else runs and its command writes no other member's stored files ([[DES-BATCH]], "Groups of one crate"). Because features are target options, Nx hashes them ([[DES-INPUTS]]). A feature set that a configuration or the command line gives every task of a run shares a cargo command only where the flags act on every member whatever the command selects: under `workspace-build` on the host, which builds the whole workspace, and for `--all-features` and `--no-default-features` under `cargo`. Elsewhere, and so under `hakari` for every feature set but the default features, each crate gets a command of its own ([[DES-BATCH]], "Groups of one crate").

A platform triple for the same kind of artifact is an option of the target, `targetTriple` ([[DES-PLUGIN-OPTIONS]]). Without it, `build.target` in Cargo's configuration or `CARGO_BUILD_TARGET` can pick triples, and the outputs follow them ([[DES-OUTPUTS]]). A different kind of artifact gets its own named target ([[ADR-ARTIFACT-TARGET-NAMES]]). A non-host triple is a group of its own and builds only the selected crates, because building a whole workspace for such a triple would include crates that cannot target it. Under `workspace-build`, nothing else resolves the features of such a group for the whole workspace, so each of its crates gets a command of its own, which resolves features for that crate and what it depends on ([[DES-BATCH]], "Groups of one crate"). The keys of `workspace-build` hold every member's manifest and digest and the crates outside the workspace that any member reaches ([[DES-INPUTS]]), a superset of what such a command depends on. Under `hakari`, the crates of a group for a triple that `platforms` lists share a command, in a workspace that passes every check: the hack crate unifies the third-party features on that platform, the first check fixes the features of members, and a feature set given by flags runs one crate per command; a triple that `platforms` does not list runs one crate per command ([[DES-UNIFICATION]]). v1 runs tests on the host triple only.
:::
