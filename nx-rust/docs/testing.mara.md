# Testing

> **Status:** `test` runs `cargo test` for its crate, or with
> `testRunner = "nextest"` cargo-nextest and then the doctests. With
> `affectedTests`, the workspace project's `coverage-baseline` target collects
> the coverage baseline, and a run in mode `affected` runs the tests that
> cargo-affected selects against it, widened where coverage cannot see a
> change, and each task says what it ran and why.

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
`--affectedTests=false` sets for one run, and then always runs its full suite,
or the test target that its `test` option names:

```toml
# rust/crates/legacy/Cargo.toml
[package.metadata.nx.targets.test.options]
affectedTests = false
```

Setting the option to `true` in a workspace without `affectedTests` fails when
the graph is created, and `--affectedTests=true` on the command line fails the
task before cargo runs: the workspace setting turns selection on.

Doctests run when nextest is the runner, except for a task whose `test` option
names one test target ([One test target](#one-test-target)): nextest does not
run them, so the plugin runs `cargo test --doc` as a second step. A group of `test` tasks
([Batching and features](execution.mara.md)) therefore takes two cargo calls
with nextest, one for the tests and one for the doctests, and three in affected
mode, where the selection of tests comes first. With `cargo test` it takes one.
Where a test fails or nextest ends the run early, a further call,
`cargo nextest list`, tells which tests the run was to run, so that a crate
whose tests never ran, as after a global timeout or an interrupt, does not
pass.

nextest is yours to install; a `test` task that needs it and does not find it
fails before cargo runs and says how to get it, and `nx add` reports it as
well. Each task's output shows nextest's lines for its own crate's tests, the
lines on the whole run, such as how many tests your configuration skipped, and
how many of its crate's tests ran:

```text
    Starting 4 tests across 4 binaries (1 test and 7 binaries skipped, including 1 test via profile.default.default-filter)
        PASS [   0.003s] (3/4) a tests::a_unit_test
     Summary [   0.003s] 4 tests run: 4 passed, 1 skipped
a:test: nextest ran 2 tests of a, as its JUnit report shows.
```

Under the `workspace-build` strategy a group runs only its own test binaries,
through a small runner that the plugin passes to cargo, and the doctests of the
whole workspace, of which it keeps its own results; a runner that you
configured for your host makes each crate's tests run on their own instead
([Tests under `workspace-build`](execution.mara.md#tests-under-workspace-build)).

## One test target

The `test` option runs one test target of the crate, such as the integration
test in `tests/performance.rs`, as cargo's `--test` does. It works with both
runners and with the other options of `test`, such as `profile`:

```sh
nx test api --test=performance                   # cargo test -p api --test performance
nx test api --test=performance --profile=release
```

Only that target runs: no unit tests, no other test targets and no doctests,
also with nextest, where the doctest step is left out. The value goes to cargo
as it is, so a glob pattern such as `perf*` runs every test target it matches,
and a name of which the crate has no test target fails the task with cargo's
error. To give a target a short command, set the option in a configuration of
`test` in the crate's table:

```toml
# rust/crates/api/Cargo.toml
[package.metadata.nx.targets.test.configurations.performance]
test = "performance"
profile = "release"
```

```sh
nx test api -c performance
```

The option is part of the task's cache key, so the result of one test target
is never restored for the whole suite, nor for another target. A task with the
option runs its crate in a cargo command of its own, also in a batch, and never
selects affected tests: in a workspace with `affectedTests` it runs the named
target as a full run does. With nextest, your configuration still applies to
it, so its default filter can leave out tests of the target, and a target
without tests passes.

A crate whose `build` you cache and that has a binary waits for that `build`
before its tests, also where its only test target has `test = false`, because
the option can run that target and cargo then rebuilds the binary for it.

Nx reads a value of digits only on the command line as a number, which the
option refuses before cargo runs, so `--test=123` fails: set such a name as a
string in a configuration or in the crate's table, as `test = "123"`.

## Affected tests

`affectedTests` says that a workspace is set up for selection. It puts the test
mode into the cache key, adds the `coverage-baseline` target to the workspace
project, and has every machine check for nextest, cargo-affected and the
`llvm-tools` component, so a missing tool shows on your machine and not first
in CI. Whether a run actually selects is a second question, answered per run.

Selection needs a baseline: per-test coverage that cargo-affected collected
for a commit, with the plugin's record of the context it was collected in.
`coverage-baseline` makes both, in CI on the main branch or on your machine
with a clean working tree:

```sh
nx run rust:coverage-baseline        # the workspace project of rust/
nx test api                          # now selects against that baseline
```

Give the target the cargo options of your test runs, such as `features` or
`-c all-features`: a baseline collected with other features, or with other
values of the tests' environment inputs, makes every affected run take the
full suite ([Continuous integration](ci.mara.md#the-coverage-baseline)).

Each run of `test` in such a workspace is in one of two modes:

- **`affected`** runs the tests that cargo-affected selects against the
  coverage baseline for changed Rust code. Every other change runs all tests of
  the crates whose inputs hold it and of the crates that depend on them:
  `build.rs`, proc-macro source, toolchain files, `.cargo/config.toml`,
  non-Rust files and the files that `fileInputs` declares. A change to a crate
  with a binary also runs all tests of the crates that depend on it, because
  their tests may start the binary. A baseline collected with other features,
  another profile or triple, or other values of the task's environment inputs
  runs the full suite.
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

Each task of such a run says what it runs and why: a subset, with the number
of tests that cargo-affected selected; all its tests, with the change that
coverage cannot follow; or no test, because no selected test and no such
change concerns its crate, in which case the task passes with its doctests.
A group of crates still takes one cargo-affected call, one nextest run and
one doctest run, and the nextest run is left out where no test is selected:

```text
basics:test: test mode affected:0aba1a08…, because NX_RUST_TEST_MODE is not set and Nx detects no CI.
basics:test: runs a subset of its tests for this change: 1 test of basics that cargo-affected selected against the coverage baseline 0aba1a08…. This result stands for affected mode only, never for the full suite.
consumer:test: runs all tests of consumer, because rust/crates/basics/src/math.rs changed, which is an input of runner, whose binary its tests can start.
macros:test: no test of macros is selected: …
```

When selection is not possible, the full suite runs, and the task output says
so and gives the reason: there is no baseline, it was collected with other
features, another profile or triple or other values of the task's
environment inputs, a runtime input of the task now prints something else,
its record of that context is missing, as after a collection that failed or
was stopped, cargo-affected refuses or fails, git and cargo-affected disagree on what changed, a
submodule changed, or git ignores a file among the task's inputs. A baseline
whose `-wal` file is still there, from a collection that is running or was
interrupted, gives the full suite as well, and so does a baseline that a
collection created or changed after Nx computed the task's cache key, so that
the key always says which suite ran.

cargo-affected is yours to install, as nextest is, and so is the
`llvm-tools` component (`rustup component add llvm-tools`), whose `llvm-cov`
and `llvm-profdata` it runs to collect coverage. `nx add` reports them where a
workspace turns on `affectedTests`; a run in mode `affected` that needs
cargo-affected and does not find it fails before cargo runs, a run in mode
`full` warns, and `coverage-baseline` fails before it collects where one of
the three tools is missing, saying how to get it.

An affected run never stands in for the full run. One kind of change can pass
in affected mode and fail in full: code that another crate evaluates while it
compiles, such as a `const fn` used in a `const` or a `macro_rules!` macro,
leaves no coverage for that crate's tests, so a change to it selects only the
tests that run it. A build script that reads a Rust file of its own crate
needs that file in `fileInputs` for a change to it to run all of the crate's
tests.

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

Each crate has one `test` target. The `testRunner` option selects the runner: `cargo` (the default) runs `cargo test`, and `nextest` runs cargo-nextest. No other target is added for either runner. The target's `test` option runs only the test target that it names, as cargo's `--test` does, with either runner, and the result of such a run is never restored for a run without the option or with another value of it.
:::

:::mara requirement REQ-DOCTESTS
:mid: 01M78FHG7FWPF1WTP90ASPYEMV
:title: Run doctests whenever nextest is the runner
:status: accepted
:satisfies: NEED-CORRECT-CACHE

When the runner is nextest, a crate's `test` task also runs the crate's doctests, and the task succeeds only if both the nextest run and the doctests succeed. This cannot be switched off, so a `test` result means the same thing with either runner. The one exception is a task whose `test` option names a test target: with either runner it runs that target alone, without doctests, as `cargo test --test <name>` does, so its result too means the same with either runner.
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
3. `affected` becomes `affected:<commit>` when a usable baseline exists. Without one the mode is `full`, and the task output says why. The command does not start cargo-affected, whose `status` builds and lists the tests whenever it finds data ([[EVD-CARGO-AFFECTED-COST]]): it reads the commits from cargo-affected's database, `target/affected/coverage.db` in the workspace root whatever the target directory is, without writing to it, and prints them sorted and joined by `,`; where it cannot read them, as after cargo-affected changed its database, the mode is `full`. A baseline that the executor then cannot use runs the full suite under the affected key, which this design allows (below).

The plugin does not look at branches. A pipeline for main that sets nothing is in mode `full`, so the full suite runs once per code state. A pull request pipeline sets `NX_RUST_TEST_MODE=affected`.

`--affectedTests=false` makes the executor run the full suite whatever the mode is. The mode command cannot see the command line, but Nx hashes the options passed there, so that run has a key of its own. With the `test` option as well, it runs the named target, not the full suite. A task whose `test` option names a test target does not select either: it runs that target in either mode as in mode `full`, with nextest under the repository's configuration and `--no-tests=pass`, under a key that holds the option, and adds nothing to the record of subsets below, because what it runs is all that its key promises ([[DES-TEST-RUN]], "One test target"). Where cargo-affected is missing, such a task runs as it does with it and says only that the tool is missing.

A task in affected mode may run more than its selection, up to the full suite, and still store its result under the affected key. The reverse never happens.

**The command.** The mode command is a Node script in the plugin's package, which Nx runs in the repository root with the workspace root, relative to it, as its argument. In a run, it adds what it prints to the command's record (**Between hashing and the run**, below), and it writes nothing else. As for the artifact folder input of [[DES-INPUTS]], its command names Node, the script and the folder by paths that reach no key, and where the script cannot run, as for a plugin that Nx loads from its TypeScript source, it prints the line of a failure and a random value, new at each evaluation, so that no stored result is restored, and the executor of a `test` that runs says why ([[DES-INPUTS]], "Failing runtime inputs"). It reads the database with Node's `node:sqlite` and never opens it in a way that can write: only as immutable and read-only, because an ordinary read-only connection to a database in WAL mode created `-wal` and `-shm` files beside it and left them there ([[EVD-TEST-MODE-READING]]). An immutable read ignores a `-wal` file and takes no lock, so the command prints `full` wherever it cannot be sure that it read the whole, settled database: where a `-wal` file lies beside the database before the read or after it, as while a collection runs, after one was interrupted, or for a baseline restored with its `-wal` file, and where the database file's size, modification time or inode differs between the look before and the look after. Such a baseline gives `full` until a collection has closed the database cleanly, which removes the `-wal` file. It reads `SELECT DISTINCT collect_sha FROM test_regions`, the commits of every fingerprint that the database keeps, because telling the current one would mean hashing what cargo-affected hashes, and a commit too many only splits keys. A Node without `node:sqlite`, a database that cannot be read or is of another schema, one without coverage and a commit that is not lower-case hexadecimal give `full` as well. Where `NX_RUST_TEST_MODE` has another value than `full` or `affected`, the empty value included, the command prints `invalid NX_RUST_TEST_MODE=` and the value as JSON, so that a failure that Nx stores with `NX_CACHE_FAILURES=true` is never restored for a valid mode. CI is what a copy of `isCI` of Nx 24.0.6 detects, which a test compares with the installed Nx's: loading Nx in the command would cost more than the rest of it, a start of Node and one query of about 40 ms on a database of 200 MB. The input lies on the `test` of every crate of a workspace with `affectedTests`, also of one that opts out: such a crate runs its full suite, or the test target that its `test` option names, under the affected key, which this design allows, at the cost of a key per mode. Each `test` task of such a workspace says at the top of its output which suite it runs and why, and fails before cargo runs where the variable is invalid. The control plane decided these points on 16 November 2026 in nxr-539qtw, from [[GOAL-TRUSTED-CACHE]] and [[EVD-CARGO-AFFECTED-COST]]. The immutable read alone, with `full` for a `-wal` file, was decided by the control plane on 16 November 2026 in the review of nxr-539qtw, in place of a read-only connection where a `-wal` file lay beside the database, which a collection closing in between left with new `-wal` and `-shm` files; it rests on "without writing to it" above, [[REQ-CARGO-UNCHANGED]] in spirit, since the plugin leaves another tool's files alone when Nx hashes, and [[GOAL-TRUSTED-CACHE]], since `full` is always safe. To undo it, read through an ordinary read-only connection where a `-wal` file exists and accept the files it leaves; to undo the input on a crate that opts out, leave it out where the crate's own table sets `affectedTests = false`; to undo the strict reading of the variable, count the empty value as not set.

**Between hashing and the run.** Nx evaluates the command afresh for every task of every run, also under the Nx daemon, in the repository root and with the task's environment: that of the `nx` command and the dotenv files Nx loads for the task ([[EVD-NX-24-INPUT-SEMANTICS]]). The executor decides the mode from the same environment. A batch process lacks the task's own dotenv files, so the batch implementation rebuilds each task's environment before it decides ([[DES-BATCH]]). The executor reads the baseline again for itself, and a collection can create or change the baseline between the hashing of a task and its run; Nx 24 also hashes a batch task whose dependency missed the cache again after the task has run, and stores the result under that later key. Nx hands an executor neither a task's hash details nor the output of its runtime inputs: it removes `hash` and `hashDetails` from the task graph that it passes to an executor and to a batch, and gives a task run on its own only its final hash, in `NX_TASK_HASH` ([[EVD-TEST-MODE-GUARD]]). The mode command therefore keeps a record of each `nx` command, in `.nx/workspace-data/nx-rust/test-mode/<command id>/<workspace>`, by the id that the plugin's `preTasksExecution` hook gives the command and that hook runs before Nx hashes any task of it:

- Each evaluation adds the mode that its task asked for and the value that it printed. A task in affected mode runs a subset only where at least one evaluation of the command for its workspace is recorded and every one of them, those that printed `full` or a value that is never restored included, printed exactly `affected:<commits>` with the commits that the executor reads; its own evaluation is among them, since Nx hashes a task after the hook and before its run. Nx runs the command with an environment that names no task, so the record cannot tell a task's own evaluation from another's ([[EVD-TEST-MODE-GUARD]]). Otherwise the task runs its full suite under its key, which this design allows, and says that the command's tasks were hashed in different modes. A task without the command id, as one that Nx runs outside a command that calls the hook, runs its full suite as well. The maintainer decided on 17 November 2026, after a review showed that a task hashed as `full` whose dotenv file then asked for `affected` passed the check through another task's evaluation and stored a subset under its `full` key, that no evaluation is set aside; it rests on [[REQ-TEST-MODE-KEY]], [[RISK-SUBSET-AS-FULL]] and [[GOAL-TRUSTED-CACHE]], and has no safe undo.
- Before a task runs a subset, an empty one included, the executor adds its mode to the command's record of subsets. An evaluation of the same command for the workspace whose value would differ prints a value that is never restored instead, so that a key that Nx computes again after the run never says `full` or names another baseline for a subset's result. So does an evaluation that cannot add to the record, and a task whose executor cannot add its subset runs its full suite.
- After `cargo affected status`, the executor checks that every collection that the report names is among the commits it read, so that a collection that ran between its read and the report gives the full suite.

cargo-affected's `status` writes to the database while it runs, through a `-wal` file, and checkpoints into it when it ends ([[EVD-TEST-MODE-GUARD]]). A task that Nx hashes while another task's `status` runs therefore prints `full` and runs its full suite; Nx hashes the `test` of a crate when the lockfile task that it depends on has ended, so this concerns a task whose other dependencies end while another `test` already runs. The plugin's `postTasksExecution` hook removes a command's record, with any that a stopped command left more than a day ago, as far as it can: neither hook ever fails an `nx` command, and where the record cannot be written or read, a task in affected mode runs its full suite and says why. The control plane decided this guard on 16 November 2026 in nxr-tabkjx, from [[REQ-TEST-MODE-KEY]], [[GOAL-TRUSTED-CACHE]] and [[RISK-SUBSET-AS-FULL]]. Not taken: comparing the change times of the database with the start of the command, which every `status` defeats, since it changes the database, and recomputing the key in the executor, which needs inputs that Nx does not hand over. To undo it, the executor stops reading the record and the mode command stops writing it, which leaves the risk open again.

**Why hashing writes the record.** The record is what the plugin writes while Nx hashes, with its sweep of a day in `postTasksExecution`, and it stays, because nothing else carries what an evaluation printed to the executor: Nx hands the executor neither the hash details nor the output of a runtime input, and runs every evaluation in a shell of its own that passes nothing back ([[EVD-TEST-MODE-GUARD]], [[EVD-RUNTIME-INPUT-SCRIPTS]]). Without it, the executor could only assume that the task's environment and the baseline when it runs are those of its hashing, which the dotenv files of a task, a batch and a collection in between each break, and the guard above exists for those cases. Not taken: a record outside `.nx/workspace-data`, which is a write all the same; and a mode command that prints from the task's environment and from commits that the `preTasksExecution` hook reads once per command, which would end the record and the reads during another task's `status`, but rests on the same assumption about the environment, and the hook sees the command's environment, not a task's. Decided in nxr-aqgka5 on 20 November 2026, from [[GOAL-TRUSTED-CACHE]] and [[RISK-SUBSET-AS-FULL]].
:::

:::mara design DES-TEST-RUN
:mid: 01M78FHG7FBRFVSZC9GZW2Q3CQ
:title: One test run
:status: accepted
:satisfies: REQ-TEST-RUNNER
:satisfies: REQ-DOCTESTS
:satisfies: REQ-AFFECTED-TESTS
:satisfies: REQ-SELECTION-SAFETY

With the `cargo` runner, a group's test tasks run as one `cargo test`, which also runs their doctests, where the group selects each crate with `-p` and its package ID specification ([[DES-UNIFICATION]], [[DES-INVOCATION]]). Where the group's strategy builds the whole workspace, its test binaries and its doctests run in steps of their own (**Under `workspace-build`**, below). With `nextest`, one run of a group in affected mode ([[DES-TEST-MODE]]) has five steps, of which steps 1, 3 and 5 are each one cargo command for the whole group ([[DES-BATCH]]):

1. Ask cargo-affected for the selection only: `cargo affected status --report-json <path> --report-detail full -- <the cargo arguments of step 3>`, in the workspace root, with git's `diff.relative` set for that process through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`, added after any that the environment already has. cargo-affected compares the paths that `git diff` names from the top of the repository with coverage paths relative to the workspace root, and in a workspace below the top it selected nothing ([[EVD-CARGO-AFFECTED-REPORT]]). The report is used only where all of the following hold; in every other case the group runs its full suite, and each task's output gives the reason.
   - cargo-affected exits with 0, the report's `schema_version` is 1, `cache.status` is `hit-exact` or `hit-with-divergence`, and `selection.selected_tests` is a list. An unknown status counts as a refusal. The reason given is the status, with the `differing_labels` of `cache.stored_fingerprints[0]` for `miss-fingerprint`, or cargo-affected's exit status and the end of its standard error.
   - **Context.** The baseline has the plugin's record of the context it was collected in ([[DES-BASELINE]], [[ADR-AFFECTED-BASELINE-CONTEXT]]), and the group's context equals it: the cargo options of step 3 that change what is compiled or run, namely `--features`, `--all-features`, `--no-default-features`, the profile and `--target`, the target triple that cargo builds for, and, for every environment input of each task of the group ([[DES-INPUTS]]), those the plugin infers, the variables of the prefixes its list names and those that `envInputs` declares, the hash of the value, an unset variable counting as a value of its own; and, for every runtime input of each task of the group but the test mode command, the hash of its output, which the plugin runs again as Nx runs it, a command that fails counting as a difference. The reason names each option, variable or runtime input that differs, or says that the record is missing.
   - **Changed files.** The plugin asks git itself for the changed files of the whole repository, from the top of the repository, with `core.quotePath=false` and NUL-separated output, against every collection the report rests on: for each commit of `cache.collect_shas` whose `relation` is `equal` or `reachable`, `git diff --raw --no-renames -z <commit>`, which compares that commit with the working tree, staged and unstaged changes alike, and once `git ls-files --others --exclude-standard -z` for the untracked files that git does not ignore. Their union is the set of changed files that step 2 works on. A rename counts as both its paths and a deleted file as its path, and neither has to exist. An entry for a submodule, of mode `160000`, runs the full suite, because git does not name the files that changed inside it. So does a file that git ignores and that a `fileInputs` pattern of a task of the group matches, as `git ls-files --others --ignored --exclude-standard` lists it, because git cannot say whether it changed. Every changed file inside the workspace folder, other than a `.profraw` file, which cargo-affected leaves out, must appear in `selection.changed_files` by its path relative to the workspace root, so that a mismatch of paths fails safe.

   Each selected test is named by `binary_id` and `test_name`, and belongs to the member whose package name is the part of `binary_id` before the first `::`; the plugin keeps the tests of the group's crates that do not opt out, because the report lists tests of other crates too, also where it was given `-p`.

2. Widen where coverage cannot show a change's whole effect ([[ADR-AFFECTED-TESTS-WIDENING]]). Coverage narrows a changed file only where its whole effect on tests runs through code that coverage records at run time, in the same context as the baseline: a `.rs` file inside the workspace folder that `selection.changed_files` lists with `tracked_by_coverage: true`, that lies in the folder of a member that is not a proc-macro crate, the deepest such folder, and that is neither the member's build script, the file of its `custom-build` target or a folder of its own that holds that file such as `build/`, nor matched by a `fileInputs` pattern of any crate. Every other changed file widens, whatever its coverage rows say: a build script and the files that crates declare, every source file of a proc-macro crate, every file other than Rust source, such as data files, snapshots, templates, toolchain files, Cargo configuration files and what they include, and `.config/nextest.toml`, a Rust file without rows, and every file outside the workspace folder. Such a file adds every test of each crate of the group whose `test` task has it among its inputs ([[DES-INPUTS]]), the dependency sources reached through `^` included, so that the crates that depend on its crate are added too. A changed file that is an input of no crate of the group adds nothing. Where the plugin cannot match a changed file against a task's inputs, as with a named input or a pattern of the repository's own `inputs` that it does not resolve, the group runs its full suite. Where a changed file is among the inputs of the `test` task of a member with a binary target, whether it widens or narrows, that member runs every test of its integration test targets, which can start its binaries through `CARGO_BIN_EXE_<name>`. Every member of the group that depends on that member, by a Cargo dependency of any kind, an Nx dependency or a declared input that reaches its folder, runs all its tests, because coverage of a program that a test starts is not attributed to the test. A test that starts a program without any such relation is outside what the plugin can see; its cache key misses that program already without affected mode.
3. Run one `cargo nextest run` for the group. The selection is passed in `-E` arguments, which nextest unites and intersects with the repository's default filter, each of the form `(<group's filterset>) & (<part of the selection>)`; a part is `binary_id(=<id>) & (test(=<name>) | …)` for the tests of one binary, a crate that step 2 adds or that opts out is `package(=<name>)`, and `\`, `/`, `)` and `,` in a name or ID are escaped with `\`. No argument exceeds 64 KiB, because Linux refuses one of more than 128 KiB; where the arguments together would exceed 512 KiB, each part names its binary only, `binary_id(=<id>)`, which runs more tests and never fewer. A configuration file cannot carry the selection: a `default-filter` in the plugin's tool configuration yields to one in the repository's configuration, and nextest then ran what the repository's filter allowed ([[EVD-CARGO-AFFECTED-REPORT]]). Where the selection of a group is empty after step 2, step 3 is left out, and each task reports 0 selected tests. Under `workspace-build` it selects as **Under `workspace-build`** says.
4. Map nextest's per-test results back to crates, so each Nx task gets its own result and cache entry: a JUnit suite is named by the binary ID, which maps to a member as in step 1.
5. Run the doctests with one `cargo test --doc`, because nextest does not run them. It selects crates as step 3 does, with `-p`, or under `workspace-build` as below; cargo skips crates without a library, and the step is left out where none has one. Its results are attributed to crates as those of `cargo test` are, below.

In mode `full`, and in a workspace without `affectedTests`, steps 1 and 2 are skipped and step 3 runs every test of the selected crates. When cargo-affected falls back to the full suite, the task output says so and gives the reason. The doctests are not narrowed: in affected mode too, each task that runs also runs all doctests of its crate.

**How steps 1 to 3 are carried out.** The control plane decided these points on 16 November 2026 in nxr-tabkjx, from the steps above, [[GOAL-TRUSTED-CACHE]] and [[EVD-AFFECTED-RUNS]]; each can be undone on its own.

- Step 1 runs only where a task of the group selects, after the check of [[DES-TEST-MODE]] between hashing and the run, and passes cargo-affected the arguments of step 3's `cargo nextest run` without `--no-fail-fast` and `--no-tests`, which `cargo nextest list` does not take. A task run on its own takes the way of a group and prints its part of the output once its steps have ended. After the report, the executor reads the baseline's context record again and runs the full suite where it is gone or differs from the record it compared, as after a collection of the same commit in another context that ran in between ([[DES-BASELINE]], "Collection and the test runs"); the control plane decided this on 17 November 2026 in nxr-d0t9vm, and dropping the second read undoes it.
- The group's context for the comparison with the record ([[DES-BASELINE]]): the options of its tasks; the target triple as `host <triple>`, with the host's triple from `rustc -vV`, where neither Cargo's configuration nor `CARGO_BUILD_TARGET` picks one, and otherwise the pick as the toolchain input names it ([[DES-INPUTS]]); and the environment inputs of the group's `test` tasks as Nx expands them, the variables of the prefixes `CARGO_PROFILE_`, `CARGO_TARGET_` (apart from `CARGO_TARGET_DIR`) and `NEXTEST_` included, without `NX_CLOUD_ENCRYPTION_KEY` and `NX_RUST_RUN_ID`, which change nothing that is compiled or run. A variable that the group hashes and the record does not hold counts as differing.
- Every input of the group's `test` tasks that git ignores runs the full suite, not only one that a `fileInputs` pattern adds, because the plugin reads the inputs as Nx lists their files and cannot tell which pattern added one; and so does an input outside the git repository, whose changes git cannot see. To narrow it, the check would take only the filesets of `fileInputs`.
- Whose inputs hold a changed file comes from the files that Nx's `HashPlanInspector` lists for each `test` task, dependency sources included, under the name that `targetNames` gives the target, as do the runtime inputs and variables of the group's context; where the inspector cannot inspect a task, the group runs its full suite. A path that no longer exists, a deleted file or the old path of a rename, is placed with Nx's own expansion of the tasks' inputs and its native glob matcher, which the plugin trusts only where that expansion gives each task exactly the inspector's files apart from files of the repository root, which Nx adds to every task; otherwise the group runs its full suite. A path at the repository root counts for every crate.
- A declared input that reaches the folder of a member with a binary target is any input of the dependent's `test` below that folder other than the member's `Cargo.toml`, which every crate's `test` holds ([[DES-INPUTS]]). Coverage that lies in a member's crate root counts as cargo-affected reports it: a changed function in a file that coverage has no row for selects every test that ran the file.
- Each `-E` argument is `(<the packages of its parts>) & (<parts>)`, where the integration tests of a crate with a binary are `package(=<name>) & kind(test)`; the tests of one binary are split into parts of at most 32 KiB, so that a part fits an argument. Graph creation records the filesets of each crate's `fileInputs` in the metadata of its `test` (`declaredFiles`), against which step 2 matches with Nx's native glob matcher.
- Each task of the group says what it runs: a subset, with the number of selected tests and the baseline, and every integration test with the reason; all its tests, with up to three reasons; or that no test of its crate is selected, why that is enough, and that its doctests still run. A task whose selection is empty passes with that line where the group's other steps pass, and the group leaves out step 3 where no task has a test selected.

**Attributing the output of `cargo test`.** `cargo test` with the `cargo` runner and the doctest step pass `--no-fail-fast`. When a test has failed, cargo then ends with a list of the failed targets, each with the `-p <package>` and the target flag that rerun it, such as `` `-p other --doc` ``, and it prints the same after each failing target. The list identifies the package: members of a workspace have distinct package names, and the list names a member by its bare name even where a crate outside the workspace has the same name and the command selected the member by its package ID specification ([[DES-INVOCATION]], [[EVD-CARGO-PACKAGE-SPECS]]). The headers of the blocks do not identify it: `Running unittests src/lib.rs (…/good-…)` and `Doc-tests good` name the library or test target, which two packages can share ([[EVD-CARGO-BATCH-FAILURES]]). A task passes the step when cargo exits successfully, or when cargo has printed that list and the list names no target of the task's package; under `workspace-build` the test binaries' step is decided by cargo's JSON messages and the runner's record instead (**Evidence for test binaries**). The plugin relies on cargo printing that list after every test and doctest has ended, as the last lines of its standard error, and reads it, the headers and every other line of cargo's without the colours that `CARGO_TERM_COLOR=always` adds ([[DES-BATCH]]). It reads only that last list, and only where cargo exits with another status than 0; where cargo exits so and its standard error does not end with a list, every task of the step fails. A list that a test or a doctest prints, as a nested cargo whose output a test passes on does, comes before cargo's and is not read; a doctest's output reaches cargo's standard error too where `RUST_TEST_NOCAPTURE` or `--nocapture` lets it through, and cargo's list still came last ([[EVD-TEST-STEPS-SPLIT]], [[EVD-TEST-STREAM-AND-NEXTEST]]). No line that a test prints can come after cargo's list, so that such a line can at most fail tasks. Under `--workspace` in a workspace with one member, cargo leaves out `-p`, as in `` `--doc` ``; such an entry names that member. Otherwise, as after a compile error, the output shows no result for the task, and it fails ([[DES-BATCH]]). A task is never reported successful when the output cannot show that its own package's tests passed: where the output cannot tell which of several packages a result belongs to, every task it could belong to fails, and the message says why. A block of output that the plugin cannot attribute to one package goes into the terminal output of every task it could belong to.

**Under `workspace-build`.** Cargo cannot leave out whole crates without resolving features for the rest: `-p` and `--workspace --exclude` both narrow them ([[EVD-WORKSPACE-TEST-SELECTION]]). Where the group's strategy builds the whole workspace, as `workspace-build` does and `hakari` where it falls back to it, every step therefore selects `--workspace`, however many tasks the group holds, one included ([[DES-BATCH]]). The group's test binaries run through a selecting runner whose record shows which of them ran, and its doctests run for the whole workspace with a plain `cargo test --doc`, of whose results the plugin keeps those of the group's crates ([[ADR-TEST-SELECTING-RUNNER]]). With the `cargo` runner the group has three steps:

1. **Build.** `cargo test --workspace --no-run` compiles what plain `cargo test` compiles apart from the doctests: every test executable, the binaries that integration tests use, and every example, also one without `test = true`, which plain `cargo test` builds without running it ([[EVD-TEST-STEPS-SPLIT]]). A compile error stops the step and fails every test task of the group ([[DES-BATCH]]).
2. **Test binaries.** `cargo test --workspace --tests --no-fail-fast --message-format=json-render-diagnostics --config 'target.<host>.runner=[…]'`. `<host>` is the host's triple as `rustc -vV` names it in the workspace root with the group's environment, and the list starts the selecting runner of **The runner program**, with absolute paths in TOML strings. `--tests` runs the targets with `test = true`, which are those that plain `cargo test` runs besides its doctests: the library's unit tests, the binaries, the integration tests, `harness = false` ones included, and the examples and benches with `test = true`; `--lib --bins` would also run a library or a binary with `test = false`. After step 1 the step compiles nothing, apart from a member that another member uses as a build-dependency and whose library nothing but its doctests needs otherwise: step 1, as plain `cargo test` does, builds that library once for both uses with the profile of normal builds, while this step, which builds no doctest, builds it for the build script alone with the profile for build scripts, and compiles the member whose build script links it again. Both variants stay in the build directory, so this happens once after each change, and once after a plain `cargo test`, which builds only the first ([[EVD-TEST-STEPS-SPLIT]], "A member that another member builds with"). This cost was accepted on 16 November 2026 in nxr-8f9dz2, for the review of the decisions made in 0.2: building the doctests' libraries in this step would mean running the doctests through the runner, which this design keeps them out of. With `json-render-diagnostics`, cargo still renders compiler diagnostics on its standard error as it does without it, and writes its messages as JSON on its standard output, where the tests' own output follows them.
3. **Doctests.** `cargo test --workspace --doc --no-fail-fast`, without the runner and without any wrapper, so that cargo and rustdoc decide every doctest as plain `cargo test` does (**Doctest results**). The step is left out where no crate of the group has a library.

With nextest, step 3 of the run above is `cargo nextest run --workspace --no-fail-fast --no-tests=pass --tool-config-file nx-rust:<file>` with the filterset `package(=a) | package(=b)` of the group's package names, passed with `-E` and in affected mode intersected with the selection in each `-E` argument as step 3 says; nextest builds as `cargo test --no-run` does, examples included, and starts no test of another crate. `=` makes each name match exactly, and `--no-tests=pass` stays, because a group's filterset can match a crate without tests, for which nextest would otherwise fail with exit code 4. nextest needs no runner of the plugin: it starts every test as a process of its own and judges it by its exit status, and a test binary that cannot be started or loaded fails the run, as one whose library could not be loaded did with exit code 104 ([[EVD-TEST-STEPS-SPLIT]]). It exits with 0 where every test that it ran passed and with 100 where one failed. Where the filterset of the group's package names would be longer than 64 KiB, the plugin splits it into several `-E` arguments, which nextest unites. A group of one crate, as a crate whose own options set a feature set forms ([[DES-BATCH]], "Groups of one crate"), runs the commands that a developer types for that crate: `cargo nextest run --no-tests=pass -p <spec>` with the task's flags, and `cargo test -p <spec> --doc`, without the plugin's tool configuration, and passes each where it exits with 0. A runner that the user configured for the host does not split a group of the nextest runner: nextest starts no runner of the plugin's, so the user's runner applies to the tests and the doctests as under a plain `cargo nextest run` and `cargo test --doc`. The control plane decided these three points on 16 November 2026 in nxr-jb6g5y.

**nextest's configuration.** The repository's nextest configuration applies as it does for a plain `cargo nextest run`: the workspace's `.config/nextest.toml`, the profile that `NEXTEST_PROFILE` chooses, and that profile's `default-filter`, retries and other settings. The control plane decided on 14 November 2026 under [[REQ-CARGO-UNCHANGED]], of which the maintainer is told, that a `test` task with the nextest runner runs the tests that nextest runs for its crate under the repository's configuration, no more: with a `default-filter` that leaves out a failing test, the task passes as plain nextest does. `--ignore-default-filter`, which would run tests that the repository leaves out, was the option not taken. The plugin passes no `--profile`: an earlier form of the command chose a profile of the plugin's own, which overrode `NEXTEST_PROFILE`, so that with a profile `ci` that runs a failing test it skipped that test and exited with 0 where plain nextest failed ([[EVD-TEST-STREAM-AND-NEXTEST]]). The plugin's tool configuration file sets only `junit.path` of the `default` profile, to a file in a folder of the plugin's own, which every profile inherits unless it sets its own; nextest gives the repository's configuration precedence over a tool configuration, so that the file adds the report and changes no test that runs. Where the repository's profile sets its own JUnit path, nextest writes the report there and not to the plugin's file; the plugin then has no report, and where nextest exits with 100, every task of the group fails, with a message that says why. The configuration reaches the keys: `.config/nextest.toml` is an input of `test` with the nextest runner, and so is every variable whose name starts with `NEXTEST_` ([[DES-INPUTS]]), so that a changed filter or profile changes the keys; nextest's user configuration in the home folder sets display options only. Each task's terminal output holds nextest's own lines on how many tests ran and how many the configuration skipped, such as `Starting 2 tests across 3 binaries (1 test skipped via profile.default.default-filter)` and its summary, and the number of its crate's tests that the report holds, so that a crate whose tests the configuration skips shows 0 tests run; the report lists only the tests that ran. The runner reaches every key of the crate's `test` without an input of its own: the setting lies in `nx.json` or in the workspace's root `Cargo.toml`, which every such key holds ([[DES-INPUTS]], "Beyond the declared inputs"), and the nextest runner changes the target's inputs, whose toolchain command then also prints the `NEXTEST_` variables. The executor learns the runner from the target's metadata, which Nx does not hash, as it learns locked mode ([[DES-PLUGIN-OPTIONS]]).

Step 4 takes the result of each test from nextest's JUnit report, one suite per test binary; nextest's JSON messages for a run are experimental and not used. A test failed where its `testcase` holds a `failure` or an `error` element; `flakyFailure` and `rerunFailure` record tries of a test that retries let pass or fail, and a `skipped` element, which the configuration's `junit.report-skipped` adds for a test that a filter left out, marks a test that did not run. The absence of a failed test is no evidence that a test passed: nextest exits with 100 both where a test failed and where it ended the run before every test had run, on its global timeout, a signal or an interrupt, and the tests that did not run leave no trace in the report ([[EVD-NEXTEST-RUNNER-STEPS]]). A task therefore passes step 3 only where nextest exits with 0, which it gives only where every test that the run was to run finished and passed, or with 100 where the report holds no failed test of its package and every test of its package that the run was to run appears in the report as run and passed. Which tests a run was to run, the plugin learns after a run that exited with 100, from `cargo nextest list --message-format json` with the run's selection, filtersets, feature and profile flags and `--locked`, in the same folder and environment, whose stable output gives each test's package and whether it matches the run's filters, the repository's default filter among them. Where the list cannot be run or read, every task without a failed test of its own fails, with a message that says so; where tests of its package did not run, the task fails with a message that names them and says that the run was not complete. The control plane decided this on 16 November 2026 in nxr-jb6g5y, after a review found that a global timeout cached the success of a crate whose tests never ran; the list was chosen over nextest's own count of tests not run, which it prints only for people, and over its machine-readable run output, which is experimental, and it runs only after 100, so that a passing group keeps its two commands. `--no-fail-fast` keeps `fail-fast` and `max-fail` of the repository's profile from ending the run early: nextest takes the command line's choice over the profile's, and no variable sets it. Every task of the group also fails where the report contradicts the status, with a failed test after 0, where it cannot be read or ends before its elements close, and where it holds a test of a package outside the group, which the filterset lets no test of run. A suite of the report is a test binary, named by its binary ID, or a setup script, named `@setup-script:<id>`, either with `@stress-<n>` after it in a stress run; a setup script that passed decides nothing, and one that failed, or nextest's status 105 for a failed setup script, fails every task of the group with a message that names the script. A suite of any other kind fails every task with a message that names it. After 101, nextest's status for a build that failed, the message names the crates that did not compile, as for `cargo test` ([[DES-BATCH]], "Test runs"); every other status is named in the message, such as 104, which nextest gives where it cannot list the tests of a test binary. The plugin writes its tool configuration for each run into a folder of its own under the system's temporary folder and removes it afterwards, so that the run writes no file that a task stores. A task's terminal output holds its part of the output by the binary IDs that nextest's lines name, matched without the escape sequences of `CARGO_TERM_COLOR=always`, as cargo's are ([[DES-BATCH]]); the lines on the whole run go to every task, and the output decides no result ([[EVD-NEXTEST-RUNNER-STEPS]]). Step 5 is the doctest step above; it is left out where step 3 failed every task of the group, as every step after one that did ([[DES-BATCH]]).

**The selecting runner.** Cargo starts the runner for every test executable of step 2, with the program and its arguments as its arguments, in the package's folder and with the package's name in `CARGO_PKG_NAME` ([[EVD-WORKSPACE-TEST-SELECTION]]). The plugin gives it the group's crates in the variable `NX_RUST_TEST_PACKAGES`, their package names between colons, such as `:api:core:`, since a package name holds neither a colon nor white space. A package name identifies a crate here, because cargo runs the tests of members only and members have distinct package names ([[DES-INVOCATION]]). For each start, the runner:

1. **Records the start before anything else.** It creates a file of its own, exclusively, in the folder that the variable `NX_RUST_TEST_RECORD` names, which the plugin creates for the step and removes after it, naming the package as `CARGO_PKG_NAME` gives it and the program's path. Where the folder is missing, as for the command of a verbose run pasted by hand once the plugin has removed it ([[DES-INVOCATION]], "Printing the command"), it creates the folder first. Where it cannot record, as in a folder that exists and that it cannot write, it says so on standard error and exits with 125, having started nothing.
2. **Fails closed.** Where `CARGO_PKG_NAME` is missing or empty, no program is given, or `NX_RUST_TEST_PACKAGES` is missing or not of that form, it adds an error entry that names the cause, says it on standard error and exits with 125.
3. **Skips another package.** For a package that is not in the list, by exact comparison of names, it adds a skip entry and exits with 0.
4. **Runs a package of the list.** It starts the program with its arguments and with the environment that cargo gave it, less its own two variables, so that the test gets cargo's environment, `[env]` of Cargo's configuration included, as under plain cargo. When the program ends, it adds an end entry with its exit status, or the signal that ended it, and ends with the same status, or by the same signal. Where it cannot add the end entry, it exits with 125.

**Evidence for test binaries.** The plugin takes step 2's result only from cargo's JSON messages, the record and cargo's exit status, never from a line that cargo writes for people or that a test writes. Cargo writes one `compiler-artifact` message with `executable` and `profile.test` for every test executable that it runs, fresh or rebuilt, with its `package_id`, also with `CARGO_TERM_QUIET` and `CARGO_TERM_VERBOSE` set, which take away cargo's `Running` lines or put the runner's command in place of the path ([[EVD-TEST-STEPS-SPLIT]]). The stream is not only cargo's: a proc macro, which runs inside the compiler, can write lines to it while a crate that uses it is compiled, and a test while it runs. A proc macro's `{"reason":"build-finished","success":true}` came before the artifact message of a test executable on both versions, and a reading that stopped at the first `build-finished` then expected nothing and passed a task whose test never ran ([[EVD-TEST-STREAM-AND-NEXTEST]]). Nothing in the stream therefore ends the reading: every `compiler-artifact` message with `executable` and `profile.test` anywhere in the command's standard output adds an expected executable, so that a line that is not cargo's can only add an expectation, and so fail a task, never remove one. The control plane decided on 14 November 2026, of which the maintainer is told, to accept that a proc macro or a test that prints a forged artifact message fails a good run. The build counts as failed where any `build-finished` message reports `success: false` or none appears, so that a forged one can fail the step's tasks and not pass them; an artifact message whose `package_id` is no member's fails every task of the step, because cargo runs no test of another package. Step 2's stream gives the expected set, not step 1's: it is the command whose runner starts the record holds, it names every executable that it runs, and step 1 named the same executables in every experiment, so that taking its stream as well would add a second stream that compiled code can write into and no executable ([[EVD-TEST-STREAM-AND-NEXTEST]]). A package's test executables are those whose `package_id` is the package's `id` in the `cargo metadata` report ([[DES-INVOCATION]]). A task passes step 2 only where:

- no `build-finished` message reports a failure, at least one appears, and the record folder can be read; otherwise every task of the step fails;
- every test executable of its package has exactly one record, of that program, compared by real path, and of its package, and that record ends with the status 0.

A record that ends with another status or a signal is a failed test binary: libtest ends with 101 when a test failed, and a program that the loader cannot load ends with 127, which cargo reports as a failed target as well ([[EVD-TEST-STEPS-SPLIT]]). Where cargo exits with another status than 0 while no failed build and no record explains it, every task of the step fails: what the plugin cannot explain counts as a failure. Each way in which a selected test binary can fail to run ends in a failed task: a runner that cannot start, or that ends with 0 before it records anything, as under a preload in `NODE_OPTIONS`, leaves executables without a record; a runner that cannot record has started nothing; one that is killed after its start leaves no end; a list that is not of the right form leaves error entries; and a program that cannot be loaded ends with 127. Nothing of this reads a line that cargo writes for people or that a test writes, so that terminal settings, a nested cargo whose output a test passes on, and a test that prints a line shaped like cargo's cannot change a task's result. A test binary of a crate outside the group never runs.

**Doctest results.** Step 3's result for a task comes from cargo, as for a plain `cargo test --doc`: where cargo exits with 0, every doctest passed; otherwise the task passes the step where cargo's list of failed targets names no `--doc` target of its package (**Attributing the output of `cargo test`**), and where cargo exits with another status without the list, as after a library that does not compile, every task of the group fails ([[DES-BATCH]]). The last list on cargo's standard error is cargo's: a doctest that printed a list of that form did not change it, on standard output where rustdoc keeps a doctest's output and on standard error where `RUST_TEST_NOCAPTURE` or `--nocapture` lets it through, nor did `CARGO_TERM_QUIET` or `CARGO_TERM_VERBOSE`, with which cargo still printed it ([[EVD-TEST-STEPS-SPLIT]], [[EVD-TEST-STREAM-AND-NEXTEST]]). A failing doctest of a crate outside the group fails no task: each task of the group gets a warning that names the crate ([[DES-DIAGNOSTICS]]). Rustdoc decides every doctest as without the plugin: merged edition-2024 doctests keep a process each, and a `should_panic` doctest that ends with `std::process::exit` or an abort passes, as under plain cargo. The step runs the doctests of every library of the workspace, so that those of crates outside the group take time and can have side effects or hang the step; their results are discarded, and a task's result, and with it what its key promises, is that of its own crate's doctests. Rustdoc compiles every doctest whether or not it then runs it: in the research's workspace all doctests took 1.35 s without a runner against 1.45 s with a runner that skipped those of other crates ([[EVD-WORKSPACE-TEST-SELECTION]]), and on a workspace with 504 doctests the two designs could not be told apart on a loaded machine ([[EVD-TEST-STEPS-SPLIT]]).

**What each task shows.** A task's terminal output holds what concerns its own crate, as far as cargo's output tells: the compiler's messages about it; in step 2 the output after cargo's `Running` line for one of its executables, whose path the JSON names; and in step 3 the block after a `Doc-tests` header that names its library. Output that the plugin cannot attribute to one package, such as all test output where `CARGO_TERM_QUIET` leaves out the headers, or a block whose header names a library that several members have, goes into the terminal output of every task it could belong to; it decides no result. What concerns only crates outside the group is left out: the `Running` line of a skipped executable, and the doctest blocks of other crates, apart from the warning about a failing one. A compile error in a crate outside the group stops the build step and fails every task of the group, with the message of [[DES-BATCH]], and so does a warning there where Cargo denies warnings (**Denied warnings in a test step**).

**Denied warnings in a test step.** The build step under `workspace-build`, a `cargo test` or `cargo test --doc` that selects several crates with `-p`, and the build of `cargo nextest run` pass no `--message-format=json`, so cargo applies `build.warnings` itself: where it denies warnings, a warning in any crate that the step compiles stops the step before any test runs, and every test task of the step fails ([[REQ-BATCHING]]; [[DES-BATCH]], "Test runs"), also one whose crate does not use the crate with the warning. The plugin takes cargo's verdict and decides nothing itself. Where the step failed and its output holds cargo's line ``error: warnings are denied by `build.warnings` configuration``, each task's message names the packages of cargo's summaries that start with `error:`, such as ``error: `d` (lib) generated 1 warning``, says of each outside the group that it is outside the selection, as of a crate that did not compile, and names what denies warnings as the message of the JSON compile steps does ([[DES-BATCH]], "Denied warnings"): `CARGO_BUILD_WARNINGS`, or the configuration file that sets `build.warnings`, read in the same way; where neither sets it to `deny`, the message says that Cargo's `build.warnings` setting denies them, as cargo says. Cargo starts no new job after the first unit whose warnings it denies, so the message names only the packages that it compiled until then; where it names none, the message says so and points at cargo's diagnostics. Where crates did not compile as well, the message gives both causes. The warnings of crates outside the group, which a task's output otherwise leaves out, stay in the output of every task, as compile errors do. Under nextest's `--message-format json-render-diagnostics`, cargo prints the same lines on its standard error ([[EVD-CARGO-TARGET-COMMANDS]], "build.warnings in the test steps"). A Cargo older than 1.97 ignores the setting, and the steps pass as plain cargo does. A task that runs its own command, as one with the `test` option does, takes cargo's exit status and adds no message (**One test target**). Not taken: failing only the tasks whose crates reach the crate with the warning, which nxr-hwkc7z keeps in the backlog with the JSON compile steps. Decided by the maintainer on 22 November 2026 for nxr-w1qhmx: "keep failing every test task, but make the message name the crate with the warning and the setting that denies it."

**The runner program.** The runner is a Node script in the plugin's package, started as `["<node>", "<script>"]` with the Node that runs the batch implementation, by absolute paths, on Linux and on macOS. Only test executables go through it, one start for each test executable of the workspace, which cargo runs one after another: with 42 of them on a machine under load, the Node runner took 1.26 to 1.71 s, against 34 to 77 ms without a runner and 114 to 161 ms with a `/bin/sh` script ([[EVD-TEST-STEPS-SPLIT]]). The maintainer chose Node on 14 November 2026 all the same, as the control plane proposed: "Node on Linux and macOS (Recommended)", the option not taken being `/bin/sh` on Linux with Node on macOS. Node passes cargo's environment on exactly, and the shell did not: bash as `/bin/sh` rewrote `SHELLOPTS` and `BASHOPTS` into its own lists of options, where plain cargo gives the test the values of the environment and of `[env]`, and the plugin cannot hand back cargo's values, since `[env]` applies them after the plugin has started cargo. On macOS the system also removes `DYLD_*` variables when it starts a binary that System Integrity Protection protects, such as `/bin/sh`, while cargo passes a test's library path in `DYLD_FALLBACK_LIBRARY_PATH` there; Node is no such binary ([[RISK-TEST-RUNNER-MACOS]]). Options that `NODE_OPTIONS` gives apply to the runner as to every Node process, and the plugin leaves them in place: one that keeps Node from starting, or a preload that ends it before it records anything, fails the group's tasks through the evidence, with a message that names the runner's command and `NODE_OPTIONS`. The script starts nothing through `PATH`. The runner is given on the command line only and never written into a configuration file ([[REQ-CARGO-UNCHANGED]]), and neither it nor its variables change a fingerprint: cargo compiled nothing between runs with and without them, on both versions.

**A runner the user configured.** A runner given on the command line does not chain to one that the user configured. Cargo 1.100.0 replaces it. Cargo 1.91.0 appends the plugin's runner to a list from a configuration file as further arguments, fails where the file gives the runner as a string, and keeps the runner of `CARGO_TARGET_<TRIPLE>_RUNNER` in place of the plugin's ([[EVD-WORKSPACE-TEST-SELECTION]]). The plugin cannot ask cargo which runner applies, because `cargo config get` is nightly-only, and reading it as cargo does would take more than the files and variables: `include`, which Cargo 1.91 ignores and rejects in table form while Cargo 1.100 rejects it as a plain string; `cfg(…)` tables matched against the host's configuration with the command's flags, since a `--cfg` in `RUSTFLAGS` made a table apply; and cargo's error where several such tables match, which a runner on the command line hides. The control plane decided on 14 November 2026, of which the maintainer is told, against reading the user's runner and calling it from the selecting runner, because no reading could be shown to give what cargo uses in every case on both versions. Where a runner for the host is or may be configured, the group's `test` tasks instead run one crate per cargo command, each step selecting its crate with `-p` and without the selecting runner, so that the user's runner applies as in a plain `cargo test -p`, and rustdoc treats the doctests as it does with that runner under plain cargo, merged ones in one process included ([[DES-BATCH]], "Groups of one crate"); the keys of `workspace-build` are a superset of what such a command depends on. The batch implementation decides this when it forms the groups, with the group's environment and the files as they are then, and counts a runner as configured where:

- the environment has `CARGO_TARGET_<HOST>_RUNNER`, with the host's triple in capitals and `-` and `.` replaced by `_`, whatever its value;
- a configuration file that cargo may read for a command in the workspace root sets `runner` in the table `target.<host triple>`, or in any table under `target` whose key starts with `cfg(`, whether or not its expression matches the host. The files are `.cargo/config` and `.cargo/config.toml` in the workspace root and in each folder above it, both where both exist; `config` and `config.toml` in the Cargo home that `CARGO_HOME` in the group's environment names, or else in `.cargo` in the home folder; and every file that one of them adds with `include`, in any form and whatever the cargo version, with paths taken from the folder of the file that includes it;
- such a file exists and cannot be read or parsed, so that whether it sets a runner is unknown.

A task's own command passes cargo no `--config`, since no option of `test` adds arguments to cargo ([[DES-TARGET-COMMANDS]]). Each task that runs alone for this reason says so at the top of its terminal output and names the variable or file. The files inside the repository and the `CARGO_TARGET_` variables are inputs of every key ([[DES-INPUTS]]), so adding or removing such a runner changes the keys; a runner in a file outside the repository is in no key, as nothing of such a file is, and the warning for a configuration file that Nx does not hash names that file ([[RISK-HOST-ENVIRONMENT]]).

**One test target.** A task whose `test` option names a test target ([[DES-PLUGIN-OPTIONS]]) runs, under every strategy and with either runner, the command that a developer types for that target of its crate, as a group of one crate ([[DES-BATCH]], "Groups of one crate"): `cargo test -p <spec> --test <name>`, or `cargo nextest run --no-tests=pass -p <spec> --test <name>`, each with the task's flags, and the task passes where it exits with 0. Cargo then builds the crate's library and binaries and the named test executable, and runs that target alone: no unit test, no test of a binary, no other test target and no doctest ([[EVD-CARGO-TEST-TARGET-SELECTOR]]). With nextest, step 5 is left out, because a plain `cargo test --test <name>` runs no doctest and `cargo test --doc` rejects `--test` beside it. A name of which the crate has no test target, the empty one included, and a pattern that matches none, fail the task with cargo's error before any test runs. Such a task never selects affected tests: in mode `affected` it runs the named target as in mode `full`, which is all that its key promises, says so at the top of its output, and records no subset ([[DES-TEST-MODE]]); with nextest, the repository's configuration still applies to that target, its default filter among them, and a target whose tests the filter leaves out, or that has none, passes, as `--no-tests=pass` lets it (**nextest's configuration**, above). Nx hashes a task's options, those of the target and of its configuration and those given on the command line, so the key of a `test` task with the option differs from its key without it and from its key with another value, and a result of the named target alone is never restored for the whole suite ([[RISK-SUBSET-AS-FULL]]). The command builds the binaries that the target's tests start through `CARGO_BIN_EXE_<name>` as a full `cargo test` does, also for a target with `test = false`, which a plain `cargo test` leaves out and `--test` builds and runs ([[EVD-CARGO-TEST-TARGET-SELECTOR]]). So the rule of [[DES-TARGETS]] counts every target of kind `test`, whatever its `test` flag: the crate's `test` waits for its `build`, and the batch puts back the files of that `build` as for every `test` group ([[DES-BATCH]], "Files that a test batch puts back"). Under `workspace-build` the command selects the crate with `-p`, so cargo resolves features for that crate and what it depends on, as for every group of one crate, whose result the keys of the strategy cover ([[DES-BATCH]]).

cargo-affected only selects. nextest runs the tests, and the selector is a replaceable step ([[ADR-TEST-SELECTOR]]). A crate that opts out of selection, with `affectedTests = false` among the options of its `test` target ([[DES-PLUGIN-OPTIONS]]), always contributes all its tests; a task whose `test` option names a test target selects nothing, runs that target and records no subset ([[DES-TEST-MODE]]). Rules for non-Rust inputs such as SQL files, snapshots and templates can be added per repository; there are none by default.

The report gave what steps 1, 3 and 4 need on ripgrep, tokio and a fixture: nextest ran exactly the selected tests and every result mapped to its crate ([[EVD-CARGO-AFFECTED-REPORT]]). Step 1 builds the test binaries that step 3 then uses, because cargo-affected lists the tests through `cargo nextest list` with the same arguments, so its own cost is the listing and the database: 0.14 to 0.16 s on ripgrep and 0.6 to 1.4 s on tokio with a warm build directory, against full suites of 1 s and 15 s ([[EVD-CARGO-AFFECTED-COST]]). Code that another crate evaluates while it compiles, such as a `const fn` used in a `const` or a macro by example, leaves no coverage for that crate's tests; this is the one change that step 2 does not widen, and it stays a stated limit ([[ADR-AFFECTED-TESTS-WIDENING]], [[RISK-CARGO-AFFECTED]]).
:::

:::mara design DES-TEST-PHASES
:mid: 01M78FHG7F64P52Y7055J0MYAC
:title: Separate build and run phases in the test executor
:status: accepted
:contributes_to: GOAL-FAST-FEEDBACK

Inside the test executor, building the test binaries and running them are separate phases with a defined hand-over between them. v1 runs both on one machine in one task. The split is the seam for a later distributed mode, in which one machine builds and archives the test binaries and other machines only run them ([[ADR-SINGLE-MACHINE]]).

With the `cargo` runner under `workspace-build`, the build is a step of its own, `cargo test --workspace --no-run` ([[DES-TEST-RUN]], "Under `workspace-build`"). With the nextest runner, one command, `cargo nextest run`, holds both phases: nextest builds every test binary before it runs one, and the executor keeps the two apart in what it reads, a failed build, status 101, failing every task of the group as a step that stopped before any test ran, and the run's results coming from the JUnit report ([[DES-TEST-RUN]], [[EVD-NEXTEST-RUNNER-STEPS]]). The seam for a distributed mode is that step, which can become `cargo nextest archive` and `cargo nextest run --archive-file` without a change to how results are read. Proposed by the control plane on 16 November 2026 in nxr-jb6g5y and confirmed by the maintainer on 20 November 2026, since [[ADR-SINGLE-MACHINE]] names the separate phases as the one requirement of v1 for a distributed mode: a separate build command, `cargo nextest run --no-run`, would add a start of nextest to every group and contradict the two commands per group that [[DES-TEST-RUN]] and [[VER-TESTING]] count. Undoing it means adding that command as a build step before the nextest step and counting three commands per group.
:::

## Scenario

:::mara scenario SCN-AFFECTED-TESTS-PR
:mid: 01M78FHG7F09P5FKTNA826FM36
:title: A pull request runs only the tests its change affects
:status: accepted

A workspace uses nextest with `affectedTests`, and CI keeps a coverage baseline for main. A developer changes one function in a large crate and opens a pull request. The pull request pipeline sets `NX_RUST_TEST_MODE=affected`, restores the baseline for the pull request's base commit and runs `nx affected -t test`. The crate's `test` task is in mode `affected:<base commit>`: cargo-affected selects the tests that executed the changed function, nextest runs them together with the crate's doctests, and the result is stored under the affected key. Crates the change cannot reach are not run at all. After the merge, the main pipeline, which does not set the variable, runs the crate's `test` task in mode `full`, which the affected-mode result cannot satisfy, so the whole suite runs once and the baseline is updated.
:::
