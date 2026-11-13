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
`Cargo.lock`, and every crate builds and passes `cargo test --locked`.
[`fixtures.spec.ts`](fixtures.spec.ts) checks against `cargo metadata` that
each fixture still has the workspaces and members listed there.

| Fixture                | Situation                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subfolder-workspace`  | One workspace in `rust/`, not at the repository root. `api` has a normal dependency on `model`, a build dependency on `codegen` and a dev-dependency on `testkit`.                                                                                                |
| `two-workspaces`       | A virtual workspace at the repository root (`app` depends on `util`) and a workspace in `tools/` whose root manifest is also a crate (`tools`, with the member `scaffold`).                                                                                       |
| `standalone-crate`     | A workspace in `rust/` and a crate outside every workspace, `tools/xtask`, with its own lockfile.                                                                                                                                                                 |
| `excluded-member`      | A workspace in `rust/` whose `exclude` names `crates/legacy`, which is therefore a standalone crate with its own lockfile.                                                                                                                                        |
| `cross-workspace-path` | `server` in the `backend/` workspace depends by path on `model`, a member of the `shared/` workspace.                                                                                                                                                             |
| `vendored-crate`       | `app` depends on `lib`, which depends by path on `vendor/parser`, which depends by path on `vendor/lexer`. Neither vendored crate belongs to a workspace, and the fixture's `nx.json` excludes `vendor/**` from the plugin.                                       |
| `name-collision`       | Two crates called `api`: a member of the `rust/` workspace and the standalone crate `tools/api`.                                                                                                                                                                  |
| `dev-dependency-cycle` | `model` dev-depends on `testkit`, and `testkit` depends on `model`.                                                                                                                                                                                               |
| `different-toolchains` | The `pinned/` workspace names toolchain `1.91.0` in its `rust-toolchain.toml`, and `stable/` names `stable`. The tests never install a toolchain: without `1.91.0`, cargo fails in `pinned/`, and the tests skip it outside of CI (`pinnedToolchainAvailable()`). |

A fixture has no `nx.json` unless it needs plugin options. The harness writes
one that registers the plugin, and in a fixture's own `nx.json` it points
every entry for `@convesoft/nx-rust` at the plugin under test. A fixture
must not contain `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`,
which the end-to-end test project keeps. `target` folders are never copied.

To add a situation, add a folder, list it in `fixtureNames`
([`harness/fixtures.ts`](harness/fixtures.ts)), in `fixtures.spec.ts` and in
the table above, and generate its lockfiles with
`cargo generate-lockfile --offline`.

## Helpers

Import them from [`./harness`](harness/index.ts).

**`loadFixtureGraph(fixture, { files, env })`** copies a fixture into a
temporary folder, has Nx build the project graph there with the plugin
loaded from `src/index.ts`, and returns the projects by name, the edges and
the external nodes, together with `cargoCalls`, the cargo invocations it
took. A failed graph creation throws a `GraphCreationError` whose message
holds every error that Nx and the plugin reported.

```ts
const graph = await loadFixtureGraph("two-workspaces");
expect(graph.cargoCalls.map((call) => call.cwd)).toEqual([".", "tools"]);

const broken = loadFixtureGraph("two-workspaces", {
  files: { "tools/Cargo.toml": (manifest) => `${manifest}\nnot toml\n` },
});
await expect(broken).rejects.toThrow(/tools\/Cargo\.toml/);
```

The plugin creates no projects yet (nxr-1bv0wm), so `projects` holds only
those that a test adds with a `project.json`.

`files` changes the copy before Nx sees it: a string replaces a file, `null`
deletes it, and a function receives the current content and returns the new
one. `env` sets environment variables for the graph creation.

**`describeCacheKeyMatrix(title, rows)`** defines one test per row. A row
names a fixture, an optional `base` state that both states share, a `before`
and an `after` state (`files`, `env`, and `overrides` for options passed on
the command line), and a verdict per task. Both states are built from a
fresh copy in the same folder and hashed with Nx's own task hasher, the way
`nx run` hashes the task. A failing row says which inputs changed.

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

This row shows the intended use: it needs the `test` target, which the plugin
does not infer yet (nxr-t1ht7j). `compareCacheKeys(row)` returns the hashes
instead of failing.

**`FixtureWorkspace.create(fixture, files)`** is the copy both helpers use:
`graph()`, `hashTasks(tasks, { env, overrides })`, `nx(args, env)`, which
runs the Nx command line there and returns its status and output,
`cargoCalls()`, `reset(files)` and `remove()`. Besides the fixture, the copy
has a `tsconfig.base.json` that lets Nx compile the plugin's TypeScript
source, and a `node_modules`, which Nx ignores, with a link to this
repository's Nx and a copy of the cargo wrapper in `.bin`. If creating it
fails, nothing is left behind. Set `NX_RUST_KEEP_FIXTURES=1` to keep the
copies for inspection.

**`nx(args, env, cwd)`** runs Nx in the subfolder `cwd` of the copy when it is
given. The copy's `node_modules` also links to the plugin's package folder, so
that `nx g @convesoft/nx-rust:<generator>` runs the generators from source.
Graph creation cannot load the plugin by its package name from that link,
because the package names its built entry point: a test that runs a
generator on an `nx.json` that lists `@convesoft/nx-rust` passes
`--skipProjectGraph`, and the end-to-end tests cover the installed package.

**`repositoryFiles(root)`** returns every file below `root` with its content,
leaving out `node_modules` and `.nx`, and **`changedFiles(before, after)`**
lists the paths that differ between two such results. Together they show
which files a command wrote, such as `init`, which may write `nx.json` only.
**`withoutColours(output)`** removes the colour codes that Nx writes when the
environment asks for colours, as `nx run-many` does for this repository's
tests, so that a test can compare the text.

**`CargoWrapper.install(directory)`** writes a `cargo` that appends one JSON
line per invocation (`cwd`, `args`) to a log and then runs the real cargo in
the same folder, with the real cargo's folder first on `PATH`, so that cargo
runs the `rustc` that belongs to it. `calls(root)` returns the invocations
with folders relative to `root`. Every `FixtureWorkspace` has one. Cargo is
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

[`cargo-wrapper.spec.ts`](cargo-wrapper.spec.ts) and the end-to-end tests
check each way: an `nx:run-commands` task, an executor and a batched executor
all show up in the log, and the `nx:run-commands` task finds the copy in
`node_modules/.bin`. The executor is a stand-in for the plugin's own:
`cargoProbeProject(name)` writes a `project.json` with a target of each kind,
and `installProbeExecutor(root)` installs the stand-in into
`root/node_modules`.

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

**`testEnvironment(overrides)`** is the environment for every command the
helpers run. It drops the `NX_` variables of the outer Nx run and the
variables that choose a toolchain or Cargo's directories, turns the Nx
daemon off, stops rustup from installing toolchains, and puts rustup's
folder first on `PATH`: Nx runs this repository's tests through
`nx:run-commands`, which puts the folder of the Node executable first, where
a system cargo would otherwise shadow rustup.

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
