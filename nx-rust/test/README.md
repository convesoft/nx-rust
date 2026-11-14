# Fixture tests

The test infrastructure described under "How the plugin is tested" in
[`../docs/verification.mara.md`](../docs/verification.mara.md): fixture
repositories, a helper that loads one through the plugin and returns the
project graph, the cache-key matrix, and a cargo wrapper that logs
invocations. The unit tests in this folder and the end-to-end tests in
`nx-rust-e2e` both use it.

## Fixtures

Each folder under [`fixtures`](fixtures) is the root of a small repository
built to show one situation. Every Cargo workspace in it has a current
`Cargo.lock`, every crate builds and passes `cargo test --locked`, and its
sources are formatted as `cargo fmt` leaves them.
[`fixtures.spec.ts`](fixtures.spec.ts) checks against `cargo metadata` that
each fixture still has the workspaces and members listed there, and with
`rustfmt --check` that its sources are formatted.

| Fixture                | Situation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `subfolder-workspace`  | One workspace in `rust/`, not at the repository root. `api` has a normal dependency on `model`, a build dependency on `codegen` and a dev-dependency on `testkit`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `two-workspaces`       | A virtual workspace at the repository root (`app` depends on `util`) and a workspace in `tools/` whose root manifest is also a crate (`tools`, with the member `scaffold`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `standalone-crate`     | A workspace in `rust/` and a crate outside every workspace, `tools/xtask`, with its own lockfile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `excluded-member`      | A workspace in `rust/` whose `exclude` names `crates/legacy`, which is therefore a standalone crate with its own lockfile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `cross-workspace-path` | `server` in the `backend/` workspace depends by path on `model`, a member of the `shared/` workspace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `vendored-crate`       | `app` depends on `lib`, which depends by path on `vendor/parser`, which depends by path on `vendor/lexer`. Neither vendored crate belongs to a workspace, and the fixture's `nx.json` excludes `vendor/**` from the plugin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `name-collision`       | Two crates called `api`: a member of the `rust/` workspace and the standalone crate `tools/api`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `dev-dependency-cycle` | `model` dev-depends on `testkit`, and `testkit` depends on `model`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `different-toolchains` | The `pinned/` workspace names toolchain `1.91.0` in its `rust-toolchain.toml`, and `stable/` names `stable`. The tests never install a toolchain: without `1.91.0`, cargo fails in `pinned/`, and the tests skip it outside of CI (`pinnedToolchainAvailable()`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mixed-folders`        | A workspace in `libs/rust/` whose folder has a `project.json` without a name. In `crates/addon`, the crate `napi-addon` has a `package.json` named `@mixed/napi-addon` with an empty `project.json` beside it; `crates/engine` has a `project.json` named `rust-engine`; in `crates/unnamed`, the crate `plain` has a `project.json` without a name. `cli` depends on the three.                                                                                                                                                                                                                                                                                                                                                                                   |
| `nested-folders`       | Workspaces in `services/billing/` and `apps/Billing.API/rust_v2/`, each with one member.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `crate-shapes`         | One crate of each shape in the `rust/` workspace: `core-lib` (folder `core`) is a library with an example, `cli` a binary, `server` a library with the binaries `server` (its `default-run`) and `migrate`, `perf` a library with a bench target, and `internal` a library with `publish = false`. `cli` and `server` depend on `core-lib`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `patched-workspaces`   | `rust/`'s `[patch.crates-io]` redirects `model` to its member, `types` to the `shared/` workspace's member and `fork` to `third_party/fork`, which `nx.json` excludes. `api` and `viaw` use them through registry dependencies only; `model` depends on `util` and dev-depends on `harness`, which depend on `types`; `plain` has no dependency.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `declared-files`       | `api` in the `rust/` workspace reads files outside its folder: its build script reads `proto/greeting.proto`, which the workspace table declares under `fileInputs` for every member, and its library includes `docs/banner.txt` with `include_str!`, which its own table declares. `app` depends on `api`; `other` depends on neither.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `undeclared-files`     | Crates in the `rust/` workspace read files in `shared/` that nothing declares. `reader`, which depends on `base`, has a build script that names `shared/proto.txt` and the folder `shared/assets` with `rerun-if-changed`, and a library that includes `shared/banner.txt`. `multi` has a library and the binaries `one`, `two`, which includes `shared/tool.txt`, and `three`, which requires the feature `extra` and includes `shared/extra.txt`. `macros` is a proc macro that includes `shared/macro.txt`, `plain` an `rlib` that includes `shared/plain.txt`, and `cola`, with a library, and `colb` each have a binary `cli` that includes `shared/cli.txt`. The workspace defines the profiles `ctest` and `cbench`, which inherit from `test` and `bench`. |

A fixture has no `nx.json` unless it needs plugin options. The harness writes
one that registers the plugin, and in a fixture's own `nx.json` it points
every entry for `@convesoft/nx-rust` at the plugin under test. A fixture
must not have `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` at
its root, where the end-to-end test project keeps its own. `target` folders
are never copied.

To add a situation, add a folder, list it in `fixtureNames`
([`harness/fixtures.ts`](harness/fixtures.ts)), in `fixtures.spec.ts` and in
the table above, and generate its lockfiles with
`cargo generate-lockfile --offline`.

## Helpers

Import them from [`./harness`](harness/index.ts).

**`loadFixtureGraph(fixture, { files, env })`** copies a fixture into a
temporary folder, has Nx build the project graph there with the plugin
(see `compilePlugin()` below), and returns the projects by name, the edges and
the external nodes, together with `cargoCalls`, the cargo invocations it
took. A failed graph creation throws a `GraphCreationError` whose message
holds every error that Nx and the plugin reported, and whose `errors` holds
the message of each error that Nx or a plugin raised, without the errors that
Nx wraps around it.

```ts
const graph = await loadFixtureGraph("two-workspaces");
expect(graph.cargoCalls.map((call) => call.cwd)).toEqual([".", "tools"]);

const broken = loadFixtureGraph("two-workspaces", {
  files: { "tools/Cargo.toml": (manifest) => `${manifest}\nnot toml\n` },
});
await expect(broken).rejects.toThrow(/tools\/Cargo\.toml/);
```

`files` changes the copy before Nx sees it: a string replaces a file, `null`
deletes it, and a function receives the current content and returns the new
one. `env` sets environment variables for the graph creation.

**`describeCacheKeyMatrix(title, rows)`** defines one test per row. A row
names a fixture, an optional `base` state that both states share, a `before`
and an `after` state (`files`, `env`, and `overrides` for options passed on
the command line), and a verdict per task. Both states are built from a
fresh copy in the same folder and hashed with Nx's own task hasher, the way
`nx run` hashes the task: with the root dotenv files loaded, and with each
task's own dotenv files, such as a `.env` in a crate's folder, in the
environment that its runtime inputs see. A failing row says which inputs
changed.

```ts
describeCacheKeyMatrix("cache keys", [
  {
    change: "a change in a dev-dependency",
    fixture: "subfolder-workspace",
    after: { files: { "rust/crates/testkit/src/lib.rs": (source) => `${source}// changed\n` } },
    keys: { "api:test": "must differ", "model:test": "must not differ" },
  },
]);
```

[`cache-keys.spec.ts`](cache-keys.spec.ts) holds the rows of
`VER-CACHE-KEYS` that the plugin's inputs decide. `compareCacheKeys(row)`
returns the hashes instead of failing. A state's `prepare(workspace, env)` runs
once its files are in place, after the base's own, for steps such as a cargo
command; with `lockfileTask: true` on the row, **`runLockfileTasks(workspace,
env)`** then runs every lockfile task before the tasks are hashed, as a real run
does, so that the digest inputs have digests to read.
[`lockfile-keys.spec.ts`](lockfile-keys.spec.ts) holds the rows about
`Cargo.lock`.

**`LocalRegistry.create(crates)`** publishes crate versions, packaged by the
real `cargo package`, to a registry in a temporary folder, with a Cargo home
whose configuration puts it in place of crates.io: give commands
`CARGO_HOME: registry.cargoHome`. `publish(crate)` adds another version, and
`remove()` deletes it all. No network is needed.

**`pnpmLockfile(version, integrity)`** writes a `pnpm-lock.yaml` that lists
the plugin's package at `version`, with `tslib` behind it, and `left-pad`
beside it. With a root `package.json` and an empty
`node_modules/.modules.yaml`, without which Nx refuses a pnpm lockfile, Nx
makes npm nodes of them, as in a repository that installs the plugin.

**`FixtureWorkspace.create(fixture, files)`** is the copy both helpers use:
`graph()`, `hashTasks(tasks, { env, overrides })`, `taskFiles(tasks)`, which
lists the files of each task's key as Nx's `HashPlanInspector` does,
`glob(globs)`, which lists the files that Nx's own glob finds whatever project
holds them, without creating the graph, `nx(args, env)`, which
runs the Nx command line there and returns its status and output,
`cargoCalls()`, `files()`, which returns every file outside `node_modules`
and `.nx` with its content, `reset(files)` and `remove()`. Besides the fixture, the copy
has a `tsconfig.base.json` that lets Nx compile a plugin written in
TypeScript, such as the plugin's source or the discovery probe, and a
`node_modules`, which Nx ignores, with a link to this repository's Nx and a
copy of the cargo wrapper in `.bin`. Its Nx keeps
its sockets in a folder of their own in the test run's socket folder (see
`startTestRun()` below), which `remove()` deletes. If creating it fails,
nothing is left behind. Set `NX_RUST_KEEP_FIXTURES=1` to keep the copies for
inspection.

The commands that the copy runs, and its graph and hash calls, load the
plugins of `nx.json` into Nx's own process (`NX_ISOLATE_PLUGINS=false`)
instead of starting a plugin worker for each entry, unless the command sets
`NX_ISOLATE_PLUGINS` itself or runs with the daemon (`NX_DAEMON=true`).
Besides that choice, Nx 24 reads the variable only where it runs a
`preTasksExecution` hook, to carry the changes that the hook makes to
`process.env` from a worker to the `nx` process; in Nx's own process the hook
makes them there directly. The tests that compare plugin isolation on and off
set the variable themselves. The case without the daemon of each test that
compares it with the daemon passes **`pluginWorkers`**, which keeps Nx's
default of a worker per entry. Commands with the daemon keep Nx's default too,
and the end-to-end tests, which do not use the copy, run as a repository that
installs the plugin does.

Each graph, hash, file and glob call starts a process of its own. Nx 24 keeps
state in its modules that only a new process resets, such as each task's
environment by task id, so a process that stayed up would answer differently
after a change, unless it loaded Nx afresh for each call. One that did, and
put the process's environment, folder and globals back between calls, gave
the answers of fresh processes in every test of `cache-keys.spec.ts` and
`declared-files.spec.ts` and took about a fifth less time there, but a test
file's peak memory rose by 130 to 220 MB with it, and it depended on how Nx 24
loads itself, so it was left out (`EVD-NX-24-PROCESS-STATE`).

**`useNx(version)`** links the copy's `node_modules/nx` to a copy of this
repository's Nx whose `package.json` gives `version`, written by
**`fakeNxPackage(directory, version)`**, until `reset`. The plugin reads the
installed Nx's version there, and so does Nx, which reports that version
throughout and keeps its daemon. The copy's files are hard links where
possible, and its `node_modules` links to every package that resolves from the
real Nx, so that everything else is the real Nx. The end-to-end tests link the
test project's `node_modules/nx` to such a copy in the same way.
**`daemonLog()`** returns what the copy's Nx daemon wrote to its log, for
tests that set `NX_DAEMON=true` and stop the daemon with `nx daemon --stop`
when they are done.

**`nx(args, env, cwd)`** runs Nx in the subfolder `cwd` of the copy when it is
given. The copy's `node_modules` also links to the plugin's package that the
copy loads (`pluginPackage()`), where Nx finds the executors of the plugin's
targets and `nx g @convesoft/nx-rust:<generator>` the generators. A test that
runs a generator on an `nx.json` that lists `@convesoft/nx-rust` passes
`--skipProjectGraph`, so that it does not depend on which package the copy
links to: the package in this repository names a built entry point that only
the compiled copy has. The end-to-end tests cover graph creation with the
installed package.

**`compilePlugin()`**, which the unit tests' global setup calls after
`startTestRun()`, compiles the plugin's source into the test run's folder,
laid out as its built package, and every fixture copy of the run loads that
copy: `nx.json` names its `src/index.js` (**`pluginEntry()`**), and the copy's
`node_modules` links to it (**`pluginPackage()`**). Nx would otherwise compile
the source with swc in every process that loads the plugin, its executors or
its generators, which took about 110 ms of each graph creation and about
170 ms of each task. `tsc` compiles the copy in a process of its own, in about
a second, with the options of `tsconfig.lib.json` but for the target ES2021
and inline source maps, as Nx compiles the source, and without the type check,
which `nx build` and the editor do; a source that does not parse fails the
setup. The fixtures' commands run with `--enable-source-maps`, so that a stack
trace names the lines of the source. Without the global setup, such as in a
script that imports the harness, the fixtures load the source, `src/index.ts`
(**`pluginSourceEntry`**).

**`repositoryFiles(root)`** returns every file below `root` with its content,
leaving out `node_modules` and `.nx`, and **`changedFiles(before, after)`**
lists the paths that differ between two such results. Together they show
which files a command wrote, such as `init`, which may write `nx.json` only.
**`withoutColours(output)`** removes the colour codes that Nx writes into the
output of every command that the helpers run, as `testEnvironment` explains,
so that a test can compare the text.

**`runNx(workspace, args, env)`** runs Nx with static output, put before
`args` so that it stays Nx's own option when `args` holds `--`, and returns
the output without colours. **`taskCalls(workspace)`** returns the logged
cargo calls of tasks, without graph creation's `cargo metadata` and without
the lockfile task's `cargo update --workspace`, which
**`lockfileCalls(workspace)`** returns, and
**`sortedCalls(calls)`** puts them in a stable order. **`inFixture(fixture,
files, test)`** hands a new copy to `test` and removes it afterwards,
**`withTargetDefaults(defaults)`** is a change to `nx.json` for `files`, and
**`linesWith(output, text)`** returns the lines that contain `text`.

**`CargoWrapper.install(directory)`** writes a `cargo` that appends one JSON
line per invocation (`cwd`, `args`) to a log and then runs the real cargo in
the same folder, with the real cargo's folder first on `PATH`, so that cargo
runs the `rustc` that belongs to it. `calls(root)` returns the invocations
with folders relative to `root`, and `callsWithEnv(root)` adds the value of
`RUSTUP_AUTO_INSTALL` that each one ran with, `null` where it was unset.
Every `FixtureWorkspace` has one. Cargo is
looked up on two different `PATH`s, and the wrapper has to come first on
both:

- Graph creation, executors and batches inherit the `PATH` of the `nx`
  command. `environment(env)` puts the wrapper first there.
- `nx:run-commands` rebuilds the `PATH` of its tasks: the `node_modules/.bin`
  folders from the task's folder up to the file system root come first, then
  the folder of the Node executable, then the inherited `PATH`. Where Node's
  folder holds another cargo, as with a system Node and a system Rust, that
  cargo would win. `placeIn(folder)` writes a copy that logs to the same log
  into the workspace's `node_modules/.bin`, which comes before Node's folder
  wherever Node and cargo are installed.

[`cargo-wrapper.spec.ts`](cargo-wrapper.spec.ts) checks each way: an
`nx:run-commands` task, an executor and a batched executor all show up in the
log, and the `nx:run-commands` task finds the copy in `node_modules/.bin`. The
executor is a stand-in for the plugin's own: `cargoProbeProject(name)` writes
a `project.json` with a target of each kind, and `installProbeExecutor(root)`
installs the stand-in into `root/node_modules`. The end-to-end tests count
the calls of the installed plugin's own executor, which is the way its targets
take.

The log, and so `cargoCalls`, holds exactly the calls that resolve to the
wrapper. These do not, and run without being logged:

- a cargo started by an absolute path;
- an `nx:run-commands` task whose `cwd` lies outside the workspace, whose
  `PATH` then holds none of the workspace's `node_modules/.bin`;
- a cargo in a `node_modules/.bin` nearer to the task's folder than the
  workspace's, such as one local to a crate's folder, which
  `nx:run-commands` puts first;
- cargo's own descendants: those that use the `CARGO` variable cargo sets,
  and those that run a bare `cargo`, such as a build script's nested cargo,
  which find the real cargo first because the wrapper puts its folder first
  on `PATH`.

An `env` option that sets `PATH` on an `nx:run-commands` target does not
bypass it: Nx 24 replaces that `PATH` with the one it computes.

**`holdCargo(subcommand)`** makes the wrapper pause before the real cargo of
a call whose first argument is `subcommand`, in the commands that get its
`env` (`NX_RUST_TEST_HOLD_CARGO`): after Nx has computed the task's key and
before cargo reads `Cargo.lock`. `held()` resolves once a call waits there,
`release()` lets it go on, and `remove()` deletes the hold's folder. A test
can change the repository or run another command meanwhile.

Two consequences for tests. A test that expects no cargo call needs a
positive control, a call in the same setting that does show up in the log,
or it cannot tell "not run" from "not logged". And a nested cargo, run by a
build script or a cargo subcommand, belongs to the call that started it, not
to the plugin: a test that counts the plugin's invocations must not count it,
whether or not it shows up in the log.

**`installFixture(projectDirectory, fixture)`** replaces the content of the
end-to-end test project with a fixture, keeping the installed packages, and
registers the installed plugin. The end-to-end tests then put the wrapper
into the project's `node_modules/.bin` with `placeIn`. See
`nx-rust-e2e/src/nx-rust.spec.ts`.

With `NX_RUST_TEST_CARGO_VERSION` set, such as to `1.90.0`, the wrapper
pretends to be that Cargo, which has to be older than 1.91: `cargo --version`,
`cargo -V` and `cargo version` print the version without running cargo, and
the report of `cargo metadata` lacks `build_directory`, as the report of every
stable Cargo before 1.91 does. Other commands run the real cargo, and every
call is logged as usual.

**`ToolFolders`** is an empty folder for `PATH` and an empty Cargo home, so
that none of the tools that `init` reports or a task can need is installed,
wherever the machine keeps its own; `install(folder, name, output)` puts a
stand-in executable into one of them.

**`testEnvironment(overrides)`** is the environment for every command the
helpers run. It drops the `NX_` variables of the outer Nx run and the
variables that choose a toolchain or Cargo's directories, turns the Nx
daemon off, stops rustup from installing toolchains, and puts rustup's
folder first on `PATH`: Nx runs this repository's tests through
`nx:run-commands`, which puts the folder of the Node executable first, where
a system cargo would otherwise shadow rustup. It sets `NX_USE_LOCAL`, so
that an Nx daemon outside CI asks the installed Nx about Nx Console and AI
agent configuration instead of installing `nx@latest` from the npm registry
into `~/.nx/tmp`, which it does on every start. Nx sees neither an AI agent
nor CI, wherever the tests run, so that a test sees the same Nx in an agent's
session, on a developer's machine and in GitHub Actions: the environment
leaves out the variables from which Nx concludes that an agent runs it
(`agentVariables`), sets `CI=false` and leaves out `GITHUB_ACTIONS`. An
agent would make `nx show` print JSON and `nx run` print no task output by
default; CI turns off the daemon, sync generators before tasks and the
daemon's start-up questions; and in GitHub Actions Nx wraps each task's
output in a log group and writes to the job's summary page. It passes on the
variables from which Nx concludes that it runs in an agent's sandbox, such as
`SANDBOX_RUNTIME`: they describe a real restriction of the session, and Nx
reads them only after something has failed, to fall back where it can and
to advise on the sandbox's settings. It also leaves
out `FORCE_COLOR`, `NO_COLOR` and `NODE_DISABLE_COLORS`: Nx gives its tasks
`FORCE_COLOR`, and beside an inherited `NO_COLOR` every Node process warns
that `NO_COLOR` is ignored, in lines that `withoutColours` leaves in. Nx then
colours its output in every command, because picocolors takes any `CI` as a
request for colours, `CI=false` too. A test that needs CI, an agent or other
colours sets the variables itself. It also keeps Nx's caches out
of `/tmp/.nx/<uid>`, which Nx uses whatever `TMPDIR` says and which is
memory on some machines: Nx loads its native binary where it is installed
instead of copying it there, and Node's compile cache, whose entries are
keyed by file path, lives in the test run's folder, or is off without one.

**`startTestRun()`** and **`endTestRun()`**, which the global setup and
teardown of the unit tests and of the end-to-end tests call, create and
remove the folders that the commands of one test run share: one in the
temporary folder (`testRunFolder()`) for Node's compile cache, and one in
`XDG_RUNTIME_DIR` (`testRunSocketFolder()`), where there is one, for the
fixtures' socket folders, because a socket's path has to stay short. Nx
would otherwise leave a socket folder for every fixture in
`/tmp/.nx/<uid>/sockets`. Nx's plugin workers and daemon outlive the command
that ends them by up to a second and remove their sockets on the way out, so
`remove()` waits, for five seconds at most, until a fixture's socket folder
is empty before it deletes it; the end of the run removes what is left after
that.

**`discoveryProbeEntry`** is the path of a plugin that behaves as the plugin
under test and also appends, for each call of an entry's
`createDependencies`, what that entry discovered (a `ProbeRecord`) as a JSON
line to the file that the variable `DISCOVERY_PROBE_LOG` names. List it in a
fixture's `nx.json` in place of the plugin to check which entry sees what,
also in plugin workers, where a test cannot reach the plugin's state.

**`pinnedToolchainAvailable()`** says whether checks of `different-toolchains`
can run: rustup has the toolchain that `pinned/` names
(`pinnedToolchain`), or the tests run in CI, which installs it.

Each helper that runs Nx or cargo takes a few seconds at most; give such
tests the `HARNESS_TIMEOUT`.

Each test file runs in a Jest worker, which holds a few hundred megabytes
besides the Nx and cargo processes that its tests start, so
[`../jest.config.cts`](../jest.config.cts) runs at most three test files at
once, or fewer where Jest's default of one per core but one is lower.
