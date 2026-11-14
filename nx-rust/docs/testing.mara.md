# Testing

> **Status:** `test` runs `cargo test` for its crate. The plugin reads and
> checks `testRunner` and `affectedTests`, hashes nextest's configuration for
> `testRunner = "nextest"`, and fails graph creation for `affectedTests = true`
> among the options of `test` in a workspace without the setting. The rest of
> this page arrives with milestone 0.3: nextest and its doctests, affected
> tests and `NX_RUST_TEST_MODE`, the error for `affectedTests` without
> nextest, and the check of `--affectedTests=true` on the command line.

Every crate has one `test` target. Which runner it uses, and whether it runs
the whole suite or only the tests a change can affect, are settings. You never
deal with extra targets.

```sh
nx test api
nx affected -t test
```

## Options

| Option          | Values             | Default | Meaning                                                                                                                               |
| --------------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `testRunner`    | `cargo`, `nextest` | `cargo` | Plain `cargo test`, or [nextest](https://nexte.st)                                                                                    |
| `affectedTests` | `true`, `false`    | `false` | The workspace uses test selection with [cargo-affected](https://github.com/max-sixty/cargo-affected). Needs `testRunner = "nextest"`. |

```toml
# rust/Cargo.toml
[workspace.metadata.nx]
testRunner = "nextest"
affectedTests = true
```

Both go into the plugin options for every workspace, or into
`[workspace.metadata.nx]` for one; a crate cannot change them
([Configuration](configuration.mara.md#all-settings)). Turning on
`affectedTests` without nextest fails when the graph is created, with a message
that says so.

A crate can opt out of selection with the option of its `test` target that
`--affectedTests=false` sets for one run, and then always runs its full suite:

```toml
# rust/crates/legacy/Cargo.toml
[package.metadata.nx.targets.test.options]
affectedTests = false
```

Setting the option to `true` in a workspace without `affectedTests` fails when
the graph is created, and `--affectedTests=true` on the command line fails the
task before cargo runs: the workspace setting turns selection on.

Doctests always run when nextest is the runner: nextest does not run them, so
the plugin runs `cargo test --doc` as a second step. A group of `test` tasks
([Batching and features](execution.mara.md)) therefore takes two cargo calls
with nextest, one for the tests and one for the doctests, and three in affected
mode, where the selection of tests comes first. With `cargo test` it takes one.

## Affected tests

`affectedTests` says that a workspace is set up for selection. It puts the test
mode into the cache key, adds the baseline target to the workspace project, and
has every machine check for nextest and cargo-affected, so a missing tool shows
on your machine and not first in CI. Whether a run actually selects is a second
question, answered per run.

Each run of `test` in such a workspace is in one of two modes:

- **`affected`** runs the tests that cargo-affected selects against the
  coverage baseline, plus whole crates where a file changed that coverage
  cannot see: `build.rs`, toolchain files, `.cargo/config.toml`, proc-macro
  source and non-Rust files that tests read.
- **`full`** runs the whole suite.

The plugin does not guess the mode from branch names. You choose it with the
`NX_RUST_TEST_MODE` environment variable, and without the variable the default
depends on where the run happens:

| Where        | `NX_RUST_TEST_MODE`  | Mode       |
| ------------ | -------------------- | ---------- |
| Your machine | not set              | `affected` |
| CI           | not set              | `full`     |
| Anywhere     | `affected` or `full` | As set     |

CI is whatever Nx itself treats as CI: the `CI` variable, or the variables the
common CI systems set. So local work gets selection without any setup, and a
pipeline that sets nothing runs everything. The usual arrangement:

- The pull request pipeline sets `NX_RUST_TEST_MODE=affected`.
- The main pipeline sets nothing and runs the full suite. Nx's cache limits
  that to the crates that changed, so main gets a full run once per code state.

When selection is not possible, for example because there is no baseline, the
full suite runs, and the task output says so and gives the reason.

For a one-off full run:

```sh
NX_RUST_TEST_MODE=full nx test api
nx test api --affectedTests=false   # the same suite, under a cache key of its own
```

Setting up the baseline in CI is described under
[Continuous integration](ci.mara.md).

## Why the cache stays honest

A result for a subset of tests must never be reused as a result for the full
suite. The `test` target therefore has one more input: the **test mode**, either
`full` or `affected:<baseline commit>`. A subset result is stored under a key
that says "affected, against this baseline", and only a run in the same mode
against the same baseline can reuse it. Falling back to the full suite under an
"affected" key is safe, because it ran more than the key promises.

## Requirements

:::mara requirement REQ-TEST-RUNNER
:mid: 01M78FHG7F7FAB8GC789E3MHB9
:title: Run tests with cargo test or nextest
:status: accepted
:satisfies: NEED-FAST-TESTS

Each crate has one `test` target. The `testRunner` option selects the runner: `cargo` (the default) runs `cargo test`, and `nextest` runs cargo-nextest. No other target is added for either runner.
:::

:::mara requirement REQ-DOCTESTS
:mid: 01M78FHG7FWPF1WTP90ASPYEMV
:title: Run doctests whenever nextest is the runner
:status: accepted
:satisfies: NEED-CORRECT-CACHE

When the runner is nextest, a crate's `test` task also runs the crate's doctests, and the task succeeds only if both the nextest run and the doctests succeed. This cannot be switched off, so a `test` result means the same thing with either runner.
:::

:::mara requirement REQ-AFFECTED-TESTS
:mid: 01M78FHG7FNTNJW0STSNNP2AF5
:title: Select affected tests inside the test target
:status: accepted
:satisfies: NEED-FAST-TESTS

The `affectedTests` setting declares that a workspace uses selection. It is valid only with the nextest runner; enabling it with another runner fails when the graph is created, with a message naming the two options. In such a workspace a crate's `test` task runs either the tests selected for the current change or the full suite, and reports which of the two it did and why. The environment variable `NX_RUST_TEST_MODE`, set to `affected` or `full`, chooses for a run. Without it, a run selects on a developer's machine and runs the full suite in CI. The full suite also runs when no selection is possible. A single run can force the full suite with `--affectedTests=false`, and a crate can opt out of selection in its metadata.
:::

:::mara requirement REQ-TEST-MODE-KEY
:mid: 01M78FHG7FS5MHY2P1ZPS6D403
:title: Never store a subset result under a full-suite key
:status: accepted
:satisfies: NEED-CORRECT-CACHE

The cache key of a `test` task includes the [[TERM-TEST-MODE]] and, in affected mode, the commit of the [[TERM-BASELINE]]. A result produced by running a subset of tests is never restored for a task that is to run the full suite, nor for a subset selected against another baseline.
:::

:::mara requirement REQ-SELECTION-SAFETY
:mid: 01M78FHG7F81B81DHEYS6QEQVS
:title: Widen the selection where coverage cannot see a change
:status: accepted
:satisfies: NEED-CORRECT-CACHE

When a change touches a file whose effect on tests the coverage data cannot show, every test of each crate that file belongs to is run. This covers at least `build.rs`, toolchain files, `.cargo/config.toml`, proc-macro source and non-Rust files that tests read. When the selector cannot select at all, the full suite runs.
:::

## Design

:::mara design DES-TEST-MODE
:mid: 01M78FHG7F7NZT1HQM98QHVY34
:title: Test mode as a runtime input
:status: accepted
:satisfies: REQ-TEST-MODE-KEY
:mitigates: RISK-SUBSET-AS-FULL

The `test` target of a workspace that uses selection has a runtime input: a command of the plugin that prints `full` or `affected:<baseline commit>`. Nx hashes its output with the other inputs, so the mode and the baseline are in the key ([[ADR-ONE-TEST-TARGET]]).

The command and the test executor decide the mode by the same rule, from the environment alone ([[ADR-TEST-MODE-CHOICE]]):

1. `NX_RUST_TEST_MODE` set to `full` or `affected` asks for that mode. Any other value fails the task.
2. Without the variable, the mode asked for is `full` where Nx detects CI and `affected` elsewhere.
3. `affected` becomes `affected:<commit>` when a usable baseline exists. Without one the mode is `full`, and the task output says why.

The plugin does not look at branches. A pipeline for main that sets nothing is in mode `full`, so the full suite runs once per code state. A pull request pipeline sets `NX_RUST_TEST_MODE=affected`.

`--affectedTests=false` makes the executor run the full suite whatever the mode is. The mode command cannot see the command line, but Nx hashes the options passed there, so that run has a key of its own.

A task in affected mode may run more than its selection, up to the full suite, and still store its result under the affected key. The reverse never happens.

Nx evaluates the command afresh for every task of every run, also under the Nx daemon, in the repository root and with the task's environment: that of the `nx` command and the dotenv files Nx loads for the task ([[EVD-NX-24-INPUT-SEMANTICS]]). The executor decides the mode from the same environment. A batch process lacks the task's own dotenv files, so the batch implementation rebuilds each task's environment before it decides ([[DES-BATCH]]).
:::

:::mara design DES-TEST-RUN
:mid: 01M78FHG7FBRFVSZC9GZW2Q3CQ
:title: One test run
:status: accepted
:satisfies: REQ-TEST-RUNNER
:satisfies: REQ-DOCTESTS
:satisfies: REQ-AFFECTED-TESTS
:satisfies: REQ-SELECTION-SAFETY

With the `cargo` runner, a group's test tasks run as one `cargo test` for the selected crates, which also runs their doctests. With `nextest`, one run of a group in affected mode ([[DES-TEST-MODE]]) has five steps, of which steps 1, 3 and 5 are each one cargo command for the whole group ([[DES-BATCH]]):

1. Ask cargo-affected for the selection only: `cargo affected status --report-json <path> --report-detail full`. The report lists each selected test by binary and name, and its `cache.status` says whether selection happened or why not.
2. Add whole crates where a file that cargo-affected cannot see has changed: `build.rs`, toolchain files, `.cargo/config.toml`, proc-macro source, and non-Rust files read by tests.
3. Run one `cargo nextest run` for the group. The selection is passed through a generated configuration file, so a long list never hits the command-line length limit.
4. Map nextest's per-test results back to crates, so each Nx task gets its own result and cache entry.
5. Run the doctests with one `cargo test --doc`, because nextest does not run them. It selects crates as step 3 does; cargo skips crates without a library, and the step is left out where none has one. Its results are attributed to crates as those of `cargo test` are, below.

In mode `full`, and in a workspace without `affectedTests`, steps 1 and 2 are skipped and step 3 runs every test of the selected crates. When cargo-affected falls back to the full suite, the task output says so and gives the reason. The doctests are not narrowed: in affected mode too, each task that runs also runs all doctests of its crate.

**Attributing the output of `cargo test`.** `cargo test` with the `cargo` runner and the doctest step pass `--no-fail-fast`. When a test has failed, cargo then ends with a list of the failed targets, each with the `-p <package>` and the target flag that rerun it, such as `` `-p other --doc` ``, and it prints the same after each failing target. The list identifies the package: members of a workspace have distinct package names, and the list names a member by its bare name even where a crate outside the workspace has the same name and the command selected the member by its package ID specification ([[DES-INVOCATION]], [[EVD-CARGO-PACKAGE-SPECS]]). The headers of the blocks do not identify it: `Running unittests src/lib.rs (…/good-…)` and `Doc-tests good` name the library or test target, which two packages can share ([[EVD-CARGO-BATCH-FAILURES]]). A task passes the step when cargo exits successfully, or when cargo has printed that list and the list names no target of the task's package. Otherwise, as after a compile error, the output shows no result for the task, and it fails ([[DES-BATCH]]). A task is never reported successful when the output cannot show that its own package's tests passed: where the output cannot tell which of several packages a result belongs to, every task it could belong to fails, and the message says why. A block of output that the plugin cannot attribute to one package goes into the terminal output of every task it could belong to.

cargo-affected only selects. nextest runs the tests, and the selector is a replaceable step ([[ADR-TEST-SELECTOR]]). A crate that opts out of selection, with `affectedTests = false` among the options of its `test` target ([[DES-PLUGIN-OPTIONS]]), always contributes all its tests. Rules for non-Rust inputs such as SQL files, snapshots and templates can be added per repository; there are none by default.

Whether the report is sufficient for steps 3 and 4, and what step 1 costs, is not confirmed ([[RISK-CARGO-AFFECTED]]).
:::

:::mara design DES-TEST-PHASES
:mid: 01M78FHG7F64P52Y7055J0MYAC
:title: Separate build and run phases in the test executor
:status: accepted
:contributes_to: GOAL-FAST-FEEDBACK

Inside the test executor, building the test binaries and running them are separate phases with a defined hand-over between them. v1 runs both on one machine in one task. The split is the seam for a later distributed mode, in which one machine builds and archives the test binaries and other machines only run them ([[ADR-SINGLE-MACHINE]]).
:::

## Scenario

:::mara scenario SCN-AFFECTED-TESTS-PR
:mid: 01M78FHG7F09P5FKTNA826FM36
:title: A pull request runs only the tests its change affects
:status: accepted

A workspace uses nextest with `affectedTests`, and CI keeps a coverage baseline for main. A developer changes one function in a large crate and opens a pull request. The pull request pipeline sets `NX_RUST_TEST_MODE=affected`, restores the baseline for the pull request's base commit and runs `nx affected -t test`. The crate's `test` task is in mode `affected:<base commit>`: cargo-affected selects the tests that executed the changed function, nextest runs them together with the crate's doctests, and the result is stored under the affected key. Crates the change cannot reach are not run at all. After the merge, the main pipeline, which does not set the variable, runs the crate's `test` task in mode `full`, which the affected-mode result cannot satisfy, so the whole suite runs once and the baseline is updated.
:::
