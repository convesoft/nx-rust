# Continuous integration

> **Status:** the coverage baseline target, `coverage-baseline`, works for a
> workspace with `affectedTests`.

v1 targets a single machine: all Rust tasks of a pipeline run on one runner.
JS tasks can be distributed as before.

## Cache two things in two places

| What                             | Cached by                             | Key                                            |
| -------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Task results and final artifacts | Nx, locally or through a remote cache | The task's inputs ([Caching](caching.mara.md)) |
| Cargo's build directory          | Your CI system's cache                | Lockfile and toolchain                         |

Nx never stores the build directory. Without a warm build directory every
pipeline compiles all dependencies from scratch, and the `workspace-build`
feature-unification strategy in particular depends on it
([Batching and features](execution.mara.md)).

A pull request pipeline then needs one step:

```sh
nx affected -t lint test build
```

Every job that runs `nx` needs cargo, also a job that only builds JS projects,
because Nx asks Cargo for the crates when it builds the project graph
([Setup](setup.mara.md)).

Set `NX_RUST_LOCKED=true` in pipelines. Every cargo command that a task runs
then passes `--locked` and fails if `Cargo.lock` is out of date, instead of
updating it as plain cargo would. The exceptions are `update`, because changing
the lockfile is its job, and `fmt` and `fmt-check`, because `cargo fmt` rejects
`--locked`.

A task that Nx restores from the cache runs no cargo at all, and locked mode is
not part of its key. The `lockfile` task of each workspace is not cached,
though, and passes `--locked`: every run in which it runs fails on an outdated
`Cargo.lock`, even when every crate task is restored. A job that runs only
`fmt` or `fmt-check`, excludes task dependencies or runs no Rust task does not
check the lockfile. To check it there as well, run a command of its own in
each workspace, outside Nx:

```sh
(cd rust && cargo metadata --format-version 1 --locked > /dev/null)
```

It fails on an outdated `Cargo.lock` without changing it and compiles nothing.
It resolves the workspace's dependencies, so like a build it needs the
registry or a filled Cargo home.

To fail a pipeline on compiler and clippy warnings without changing what
developers get, set `CARGO_BUILD_WARNINGS=deny` in it; Cargo honours it from
1.97 on. The variable is part of the cache key, so a result that passed
elsewhere with warnings allowed is not reused
([Targets](targets.mara.md#warnings)).

## The coverage baseline

This section applies only with `affectedTests` on ([Testing](testing.mara.md)).
Selecting affected tests needs per-test coverage data from a commit of the main
branch, and the plugin's record of the context it was collected in. The
workspace project's `coverage-baseline` target makes both:

```sh
nx run rust:coverage-baseline
```

It runs `cargo affected collect -- --workspace --no-fail-fast` in the workspace
root, with the cargo options you give the target, and writes
`target/affected/coverage.db` and, beside it, `target/affected/nx-rust-context.json`.
cargo-affected refuses a working tree with uncommitted changes, so collect on a
clean checkout. The main pipeline maintains the baseline:

1. Restore the database and the record from the previous main run.
2. Run the full `test`. Nx's cache limits it to the crates that changed.
3. Run `coverage-baseline`, which re-collects only affected and new tests.
4. Save the database and the record to the CI cache, keyed by commit.

The main pipeline does not set `NX_RUST_TEST_MODE`, so in CI its tests run in
mode `full`.

A pull request pipeline sets `NX_RUST_TEST_MODE=affected` and restores the
database and record for its base commit. Those of an earlier main commit also
work; the diff is then wider and more tests are selected. A pipeline that
forgets the variable runs the full suite, which is slower but never wrong.

Before it collects, the target compares the record of the last collection
with the context it collects in now, and asks `cargo affected status` what the
database holds. It re-collects with `collect --diff` only where the record is
there and equal and the data is usable. It collects everything into an empty
database where there is no record (the first run, or a collection that failed
or was stopped), where the context changed (other options, another value of a
variable or runtime input that the tests hash, a new toolchain), where the
data is not usable (a lost database, or a changed lockfile, manifest,
compiler, `RUSTFLAGS` or build target), or where the oldest collection is
more commits behind `HEAD` than `fullCollectThreshold`, 100 unless you set it.
So a main pipeline whose context changes between runs pays one full
collection, and `--diff` never keeps coverage of another context under the new
record. Its output says which collection it runs and why.

The record holds the cargo options of the collection, the target triple, a
hash of each environment input of the workspace's `test` tasks and of the
output of their runtime inputs. A test run whose own differ, or a baseline
without a record, runs the full suite. So give `coverage-baseline` the same
`features`, `allFeatures`, `noDefaultFeatures` and `profile` as your test runs,
in `[workspace.metadata.nx.project.targets.coverage-baseline.options]` or on
the command line, and run it with the same environment. The collection does
not load the dotenv files that Nx loads only for `test` tasks: a variable
that the tests hash and that only `.env.test` sets makes every affected run
take the full suite, until you set the same value for the collection step as
well, for example in `.env` or in the step's environment. The target removes
the record before it collects and writes it only once cargo-affected has
succeeded, so a collection whose test fails, or that is stopped, leaves no
record, and pull requests run their full suites until the next collection
succeeds. Save and restore the two files together, never one without the
other.

A worked example for GitHub Actions, for a workspace in `rust/` whose
workspace project is `rust`:

```yaml
# .github/workflows/main.yml, on push to main
- uses: actions/cache/restore@v4
  with:
    path: |
      rust/target/affected/coverage.db
      rust/target/affected/nx-rust-context.json
    key: coverage-${{ github.sha }}
    restore-keys: coverage-
- run: pnpm nx run-many -t test
- run: pnpm nx run rust:coverage-baseline
  env:
    CARGO_BUILD_JOBS: "4"
    NEXTEST_TEST_THREADS: "4"
- uses: actions/cache/save@v4
  with:
    path: |
      rust/target/affected/coverage.db
      rust/target/affected/nx-rust-context.json
    key: coverage-${{ github.sha }}

# .github/workflows/pr.yml, on pull_request
- uses: actions/cache/restore@v4
  with:
    path: |
      rust/target/affected/coverage.db
      rust/target/affected/nx-rust-context.json
    key: coverage-${{ github.event.pull_request.base.sha }}
    restore-keys: coverage-
- run: pnpm nx affected -t test
  env:
    NX_RUST_TEST_MODE: affected
    NEXTEST_TEST_THREADS: "4"
```

Collection's memory grows with its parallelism, so the example caps it at 4
build jobs and 4 test threads. `NEXTEST_TEST_THREADS` is part of the record,
like every `NEXTEST_` variable, so the pull request pipeline sets the same
value; a pipeline that sets another runs the full suite and names the
variable. `CARGO_BUILD_JOBS` changes nothing that is compiled and is not
recorded. Restore only the database and the record, not
`target/affected/build`, where cargo-affected keeps its instrumented build;
the restore keys fall back to the newest saved baseline where the exact
commit has none, which only widens the diff. The database to save holds the
coverage of every test: 53 MB for ripgrep's 1,220 tests, 400 MB for tokio's
2,184 with all features, and 8.75 GB for rust-analyzer's 8,314, which
`actions/cache` compresses with zstd, to 2.6 MB and 404 MB for ripgrep and
rust-analyzer.

Collecting costs time, memory and cache space on every main commit. Measured
with 4 build jobs and 4 test threads:

| Per main commit                        | ripgrep, 1,220 tests | rust-analyzer, 8,314 tests |
| -------------------------------------- | -------------------- | -------------------------- |
| Plain test run of the commit           | 3.2–3.7 s            | 31–44 s                    |
| `collect --diff` after it              | 1.1–2.5 s            | 52–824 s                   |
| Full `collect` into an empty database  | 12.5–13.1 s          | 645–656 s                  |
| Database to save, `zstd -3` compressed | 53 MB, 2.6 MB        | 8.75 GB, 404 MB            |
| Peak memory of collection, cache incl. | 1.8 GiB              | 6.8 GiB                    |

Collection runs every test it re-collects under instrumentation, and its cost
grows with the number of tests and the code they reach. On rust-analyzer, whose
many fast tests run in 21 s, it cost far more on main than any selection could
save on a pull request. Slow tests make a workspace a candidate for
`affectedTests`, not a sure gain: where the slow tests are integration tests
that start a binary or read shared files, the widening of
[Testing](testing.mara.md) can select the whole suite for common changes and
leave only the overhead. Not measured here: what pull requests save after that
widening, the upkeep of the baseline over many commits, and the time to move
the database between CI runs.

Before you switch it on, measure a few representative changes in your own
repository, each committed on top of a collected commit of main:

```sh
cargo affected collect -- --workspace --no-fail-fast         # once, on main
# commit a representative change, then time each of these:
cargo affected collect --diff -- --workspace --no-fail-fast  # cost on main
NX_RUST_TEST_MODE=full nx affected -t test --skip-nx-cache      # without selection
NX_RUST_TEST_MODE=affected nx affected -t test --skip-nx-cache  # with selection
ls -l target/affected/coverage.db                            # what CI saves
```

Add the cargo arguments of your test runs, such as `--all-features`, after
`--workspace`. cargo-affected builds the instrumented tests in
`target/affected/build`, so a pipeline that caches `target` caches them as
well.

The target's options, all off by default but the threshold:

| Option                 | Use                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullCollectThreshold` | How many commits the oldest collection may lie behind `HEAD` before a full collection replaces `--diff`; 100                                                                                                                    |
| `fullCollect`          | Always collect everything into an empty database: a nightly run for tests that depend on state outside the repository, a scheduled recollection, or `collect` as the full run on main where benchmarks justify it               |
| `diffOnly`             | Never start a full collection on its own: where only a full one would do, as after a dependency update, collect nothing and keep the baseline, and leave the full collection to a scheduled or batched run with `--fullCollect` |
| `separateBuildDir`     | Build the instrumented tests in `target/affected/build` also where Cargo's configuration sets `build.build-dir`, so that they stay out of a build directory that CI caches                                                      |

A run of `test` and a collection may overlap, in one `nx` command or in two:
a test task that reads the baseline while a collection changes it runs its
full suite, and two collections of one checkout do not run at once, because
the second fails and says that the first one runs. A collection that was
killed leaves `target/affected/nx-rust-collect.lock`, which the next one takes
over; should one be killed during that takeover, it also leaves
`nx-rust-collect.lock.takeover`. That marker fails a collection only where the
collection also finds a lock whose process no longer runs, because the
takeover it would need is refused; the message names both files, which you
remove once no collection runs. Where there is no lock, the collection runs as
usual and the marker stays until someone removes it.

## Later: distributing Rust tasks

v1 does not spread Rust tasks across Nx agents. The only thing v1 does for it
is keep "build" and "run" apart inside the test executor
([[DES-TEST-PHASES]]). A distributed mode might look like this:

- One workspace-level task builds everything, writes a nextest archive of the
  test binaries and computes the test selection. Both files are Nx outputs, so
  the remote cache delivers them to agents.
- Per-crate test tasks run from the archive with a package filter. They do not
  invoke cargo, so there is no build lock and no need for batching.
- Only the build machine compiles. Its build directory stays warm through the
  CI cache, and `check` and `lint` are pinned to it.
- Only the build machine needs the coverage database; the selection travels as
  a report file.
- Agents need nextest and the same source checkout, pinned by
  `rust-toolchain.toml`.

The costs: the archive can be large and is uploaded again on every change, any
source change rebuilds it, and tests that read files by path may need changes
to run from an archive. This is a sketch, not a specification.

## Requirements

:::mara requirement REQ-BASELINE
:mid: 01M78FHG7FMF300FJ3R9NCWRAZ
:title: Maintain the coverage baseline on the main branch
:status: accepted
:satisfies: NEED-FAST-TESTS

For a workspace with `affectedTests` enabled, a workspace-level task brings the [[TERM-BASELINE]] up to date for the current commit. It re-collects only what changed when usable data from an earlier commit exists, and collects everything when no usable data exists or the earlier data is further behind than a configured threshold.
:::

## Design

:::mara design DES-BASELINE
:mid: 01M78FHG7F1EWYSCPVF4MY7YGF
:title: Baseline on main
:status: accepted
:satisfies: REQ-BASELINE

The main pipeline runs four steps per workspace:

1. Restore the coverage database and its context record from the previous main run.
2. Run the full `test`; Nx's cache limits it to crates that changed. The pipeline sets no test mode, so in CI the mode is `full` ([[DES-TEST-MODE]]).
3. Run the collection target, which runs `cargo affected collect --diff` and so re-collects only affected and new tests.
4. Save the database and the record to the CI cache, keyed by commit.

Pull request pipelines set `NX_RUST_TEST_MODE=affected` and restore the database and record for their base commit. An earlier main commit's database also works, with a wider diff.

A full `collect` replaces `--diff` when the context record of the last collection is missing, cannot be read, is of another version or differs from the context of this collection (**Choosing the collection**, below), when the report shows no usable data (first run, lost database, or a changed lockfile, manifest, compiler, `RUSTFLAGS` or build target), or when the anchors are more commits behind than a set threshold. The threshold is tuned per repository ([[RISK-BASELINE-DRIFT]]).

A full `collect` starts without the previous database: the target removes `target/affected/coverage.db`, its SQLite files `coverage.db-wal` and `coverage.db-shm`, and the context record before it (**Order of writing**, below). Over an existing database cargo-affected first deletes the rows of the current fingerprint and keeps those of up to ten earlier ones, so that on rust-analyzer a full `collect` over the previous database took 957 s against 652 s into an empty one, and the rows of a fingerprint that a changed lockfile left behind would stay in every database saved after it ([[EVD-COVERAGE-COLLECT-COST]]). The removal touches only cargo-affected's own files, never Cargo's directories. The control plane decided this on 16 November 2026 from [[RISK-COVERAGE-COST]]; `cargo affected clean`, the option not taken, deletes the rows by SQL as slowly. To undo it, the target stops removing the files.

A `collect --diff` that re-collected half of rust-analyzer's tests, after a change to a core crate, took longer than a full `collect` into an empty database, 749–824 s against 645–656 s. The target still runs `--diff` there: telling beforehand would need `cargo affected status`, which reads the database for about as long as `--diff` does before it runs a test, so that the gain would be small.

Collection is a target of the [[TERM-WORKSPACE-PROJECT]]. Restoring and saving the database are steps of the CI system, not of the plugin. Off by default and available as switches: a nightly full run for tests that depend on external state, scheduled or batched recollection after dependency updates, `collect` as the full run on main, and a separate build directory for coverage builds (**The target**, below).

**Directories of coverage builds.** By default collection sets no Cargo directory of its own ([[DES-BUILD-DIRS]]), as plain `cargo affected collect` sets none. cargo-affected builds into the artifact directory `target/affected/build` and points the profiles of build scripts there, so that without `build.build-dir` its instrumented build has a build directory of its own. With a `build.build-dir` that both share, the two builds kept their files side by side, and building normally, collecting, and building normally again compiled nothing the second time, on ripgrep and rust-analyzer with Cargo 1.100.0 ([[EVD-COVERAGE-COLLECT-COST]]). The separate build directory is therefore not needed to keep the builds from evicting each other; the switch keeps the instrumented build, about as large as the normal one, out of a build directory that CI caches. The control plane decided on 16 November 2026, from [[REQ-CARGO-UNCHANGED]] and these measurements, against a separate build directory by default; to undo it, the switch becomes the default. Cargo 1.91, the oldest supported version, was not measured: ripgrep at the measured commit needs rustc 1.96. Should an older Cargo make the two builds evict each other in one build directory, the cost is rebuilding, never a wrong result, since Cargo rebuilds what its fingerprints no longer match, and the switch for a separate build directory is the remedy.

Collection runs `cargo affected collect -- --workspace --no-fail-fast` with the cargo arguments of the test runs, such as `--all-features`, which cargo-affected's fingerprint does not hold; without `--no-fail-fast` it stopped at the first failing test and stored part of the suite. It gets git's `diff.relative` as step 1 of [[DES-TEST-RUN]] does. The database the pipeline restores and saves is `target/affected/coverage.db` in the workspace root, whatever `CARGO_TARGET_DIR` or `build.target-dir` say ([[EVD-CARGO-AFFECTED-REPORT]]).

Beside the database, the collection target writes `target/affected/nx-rust-context.json` in the workspace root, the record of the context it collected in ([[ADR-AFFECTED-BASELINE-CONTEXT]]): the cargo options of the collection that change what is compiled or run, namely `--features`, `--all-features`, `--no-default-features`, the profile and `--target`; the target triple that cargo built for; and for every environment input of the workspace's `test` tasks ([[DES-INPUTS]]), those the plugin infers, every variable of the prefixes its list names and those that `envInputs` declares, the SHA-256 of the value or a mark that it was unset, so that no value is written. The pipeline saves and restores the file with the database, and a baseline without it runs the full suite (step 1 of [[DES-TEST-RUN]]). The record is a JSON object of version 2 with the fields `cargo`, `triple`, `env` and `runtime`, which the plugin writes and reads with the same functions (`baseline-context.ts`); the triple is named as step 1 names the group's, the variables are the environment inputs of the `test` tasks as Nx expands them, the prefixed ones included, without `NX_CLOUD_ENCRYPTION_KEY` and `NX_RUST_RUN_ID`, which change nothing that is compiled or run, and `runtime` holds, for every runtime input of the `test` tasks but the test mode command, by its command, the SHA-256 of what it prints when it runs through `sh -c` in the repository root with the collection's environment, as Nx runs a runtime input ([[EVD-NX-24-INPUT-SEMANTICS]]). A record of version 1, without runtime inputs, counts as missing. The control plane decided this form on 16 November 2026 in nxr-tabkjx, which reads the record first; the maintainer added the runtime inputs on 17 November 2026 ([[ADR-AFFECTED-BASELINE-CONTEXT]]).

**Order of writing.** Every collection, full or `--diff`, first removes the context record, after the target has read it and run the `status` that choose the collection, and before cargo-affected's `collect`, and a full one removes the database files with it; the target writes the new record only after cargo-affected has ended successfully. cargo-affected 0.4.1 writes the coverage it collected and only afterwards returns a failure status, and a `--diff` that fails halfway has changed the database as well, so that a record left in place could vouch for coverage from another context: a checkout that holds baseline and record A, then collects with other features or another value of an environment input, would keep A's record beside B's coverage, and a later affected run in context A could leave out a test of a branch that only A takes. A collection that fails or is interrupted therefore leaves no record, and the next affected run takes the full suite, as [[ADR-AFFECTED-BASELINE-CONTEXT]] says for a missing record. The control plane decided this on 16 November 2026 from [[GOAL-TRUSTED-CACHE]] and [[REQ-SELECTION-SAFETY]]; to undo it, the target writes the record before collecting, which the case above shows to be unsafe.

A full `collect` from scratch took 15.7 s on ripgrep and 80 s on tokio at `-j 4` with 4 test threads, and peaked at 1.5 and 4.75 GiB ([[EVD-CARGO-AFFECTED-COST]]). On rust-analyzer it took 645–656 s and peaked at 6.8 GiB, page cache included, and `collect --diff` took 1.1–2.5 s on ripgrep and 52–824 s on rust-analyzer, against a plain test run of 3.2–3.7 s and 31–44 s for the same commits ([[EVD-COVERAGE-COLLECT-COST]], [[RISK-COVERAGE-COST]]).

**The target.** The collection target is `coverage-baseline`, on the workspace project of a workspace with `affectedTests` and of no other; `targetNames` renames it, with the check for two targets of one name ([[DES-PLUGIN-OPTIONS]]). It runs on the lockfile executor, `@convesoft/nx-rust:lockfile`, which has no batch implementation, so that a collection never joins a batch, and whose empty `targetDefaults` entry that `init` adds covers it, as it covers `hakari-check` ([[DES-WORKSPACE-TARGETS]]). It is not cached, has no `dependsOn`, and no target depends on it. It takes the options `features`, `allFeatures`, `noDefaultFeatures` and `profile`, which it passes as `test` with the nextest runner passes them, `--cargo-profile` for the profile, with the configuration for all features; adds `--locked` in locked mode and the flags of the `cargo` strategy ([[DES-INVOCATION]], [[DES-UNIFICATION]]); and takes four options of its own: `fullCollectThreshold`, an integer of commits that the inferred target sets to 100; `fullCollect`, which always collects everything into an empty database, without asking `status`, for the nightly full run, a scheduled recollection and `collect` as the full run on main; `diffOnly`, which never starts a full collection on its own and, where only one would do, collects nothing, succeeds with a warning and leaves the database and the record as they are, which still belong together, for recollection after dependency updates that a scheduled run with `fullCollect` batches; and `separateBuildDir`, which sets `CARGO_BUILD_BUILD_DIR` to `target/affected/build` in the workspace root, cargo-affected's own target directory, for the collect command alone, so that the instrumented build keeps its intermediate files there as it does without `build.build-dir`. A task whose tool is missing, cargo-affected, cargo-nextest, or `llvm-cov` and `llvm-profdata`, which cargo-affected looks for in the toolchain's sysroot, through `xcrun` on macOS and on `PATH`, fails before it changes anything, with the message of [[DES-DIAGNOSTICS]] ([[DES-GENERATORS]]). The control plane decided on 17 November 2026 in nxr-d0t9vm, from [[REQ-BASELINE]], [[REQ-CARGO-UNCHANGED]] and the switches above, that the cargo options are the target's own and not read from the crates' `test` targets, whose options can differ from crate to crate: a collection in other options than a test run's runs the full suite and names the option, which is safe; the guide says to give both the same options. To undo it, the target takes its defaults from the `test` targets of the workspace.

**Choosing the collection.** `collect --diff` re-collects the tests that a change affects and keeps every other test's rows, which the new record then vouches for, so the target first reads the record that is there before the collection, before anything removes it, and compares it with the context of this collection, with `contextDifferences` of `baseline-context.ts`, which the test runs use, and in both directions: a variable or runtime input that the old record holds and this collection's context lacks counts as a difference too. Only a record that can be read, is of the current version and equals this context in every field (cargo options, triple, environment inputs, runtime inputs) lets `--diff` run. A missing record (the first run, or a collection that failed or was stopped), an unreadable one, one of another version and one that differs each give a full collection into an empty database, without `status`, and the task's output names the case and, for a difference, what differs; with `diffOnly`, the same cases collect nothing and leave the database and the record as they are. A review found with the real cargo-affected that a collection with another value of a declared environment input chose `--diff`, re-collected nothing, wrote the record of the new value beside the coverage of the old, and let an affected run in the new context leave out a test that failed in the full run. The maintainer decided the rule on 17 November 2026 in the review of nxr-d0t9vm, from [[ADR-AFFECTED-BASELINE-CONTEXT]], [[REQ-SELECTION-SAFETY]] and [[GOAL-TRUSTED-CACHE]]; there is no safe undo. Where the record allows `--diff`, the target runs `cargo affected status --report-json <file> -- <the collection's arguments without --no-fail-fast>` in the workspace root with git's `diff.relative`, and runs `collect --diff` where cargo-affected exits with 0 and writes a report of `schema_version` 1 whose `cache.status` is `hit-exact` or `hit-with-divergence`, which names a collection whose relation to `HEAD` is `equal` or `reachable`, and in which no reachable collection's `commits_ahead` exceeds `fullCollectThreshold`. In every other case it runs a full `collect`, a failed `status` and a report it cannot read included, since a full collection is always correct and starts again from a database that cannot be read. `status` lists the tests, which builds them as the test run before it has ([[EVD-CARGO-AFFECTED-COST]]). Where `status` is stopped by a signal, the task fails without collecting. The task says which collection it runs and why. The control plane decided this rule and the threshold's default of 100 commits on 17 November 2026 in nxr-d0t9vm, from [[REQ-BASELINE]] and [[RISK-BASELINE-DRIFT]], which is not measured: the default bounds how far `--diff` drifts and costs a full collection about every 100 commits of main; to undo it, change the default, which only changes when time is spent.

**The record's content.** The target computes the record before it changes anything: from the inputs that Nx's `HashPlanInspector` lists for the `test` target of every crate of the workspace, under the name that `targetNames` gives it, the union of their environment inputs and of their runtime inputs, evaluated as `baseline-context.ts` evaluates a group's in the collection task's environment, which is that of the `nx` command with the dotenv files that Nx loads for the collection task, not those it loads for a `test` task; its own cargo options; and the triple that cargo builds for there, as step 1 of [[DES-TEST-RUN]] names it, with no `--target`, since `test` runs on the host. A group compares only its own variables and runtime inputs with the record, so the union of the workspace is a superset of what any group needs. The variables that the target sets for cargo-affected alone, git's configuration and `CARGO_BUILD_BUILD_DIR`, change nothing that is compiled or run and are recorded only where a `test` task has them among its inputs, with the value of the task's environment. A runtime input that fails stops the task before anything changes. The control plane decided this on 17 November 2026 in nxr-d0t9vm, from [[ADR-AFFECTED-BASELINE-CONTEXT]]; to undo it, the collection would have to rebuild each `test` task's environment, as a batch does ([[DES-BATCH]]).

**Collection and the test runs.** A collection changes the commits that the mode command reads when Nx hashes a `test` task ([[DES-TEST-MODE]]), and a test run of the same `nx` command or of another may overlap with it, since neither target depends on the other. Three rules keep every `test` task from selecting against a baseline that a collection is changing. The guard of [[DES-TEST-MODE]] holds as it is: while cargo-affected writes, the database has a `-wal` file, or after the removal of a full collection no file, and the mode command and the executor then read `full`; the executor's own read and its check of the report's collections give the full suite where a collection changed the commits between hashing and the run, and the record of subsets keeps a later hash of the same command from saying `full` for a subset. A collection of the same commit in another context, such as other features, changes neither the commits nor the report's collections, only the record; the test executor therefore reads the record again after `status` and runs the full suite where it is gone or differs from the one it compared ([[DES-TEST-RUN]]). Two collections of one checkout could leave the record of one beside the coverage of the other, so a collection takes a lock first, the file `target/affected/nx-rust-collect.lock` in the workspace root with its process ID: a second collection fails with a message that names the first and changes nothing. Every file of the lock appears whole and only where it did not exist: the contender writes it under a name of its own and hard-links it to the lock's name, which fails where that exists. A lock whose process no longer runs, as after a collection that was killed, is taken over only under the takeover marker `target/affected/nx-rust-collect.lock.takeover`, created the same way: holding it, the contender reads the lock again, removes it only where it still names the dead process, and creates its own as above. Two contenders therefore never both hold the lock: only the marker's holder removes a lock, one contender at a time holds the marker, a contender that read the stale lock before another took it over finds the other's process under the marker and is refused, and one that creates the lock between the removal and the taker's creation makes the taker's creation fail. A contender that finds a stale lock and the marker there, because a takeover runs or one was killed halfway, cannot tell which and fails without touching the database or the record, naming both files and saying to remove them once no collection runs. A marker beside no lock, as one that a taker killed between removing the stale lock and creating its own leaves, stops nothing: the next contender creates the lock as usual, and the marker stays until someone removes it. That plain creation is safe, because a taker that is still alive in that window then fails to create the lock, which the newcomer holds, and is refused, so that there is still exactly one holder; the maintainer decided on 19 November 2026 in the re-check of nxr-d0t9vm that the plain path does not look at the marker, which is safe and spares a removal by hand. A review found that the first form of the takeover, a removal without the marker, let a contender remove a lock that another had just taken over, so that both held it; the maintainer decided on 17 November 2026 that a takeover is atomic or does not happen. The control plane decided this on 17 November 2026 in nxr-d0t9vm, from [[GOAL-TRUSTED-CACHE]], [[REQ-SELECTION-SAFETY]] and [[RISK-SUBSET-AS-FULL]]. Not taken: making the collection depend on the workspace's `test` tasks, which orders one `nx` command but not two, and would keep `fullCollect` from serving as the full run on main. To undo the second read or the lock, drop it, which reopens the case it closes.
:::
