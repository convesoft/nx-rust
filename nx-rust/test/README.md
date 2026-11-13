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

| Fixture                | Situation                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subfolder-workspace`  | One workspace in `rust/`, not at the repository root. `api` has a normal dependency on `model`, a build dependency on `codegen` and a dev-dependency on `testkit`.                                                                           |
| `two-workspaces`       | A virtual workspace at the repository root (`app` depends on `util`) and a workspace in `tools/` whose root manifest is also a crate (`tools`, with the member `scaffold`).                                                                  |
| `standalone-crate`     | A workspace in `rust/` and a crate outside every workspace, `tools/xtask`, with its own lockfile.                                                                                                                                            |
| `excluded-member`      | A workspace in `rust/` whose `exclude` names `crates/legacy`, which is therefore a standalone crate with its own lockfile.                                                                                                                   |
| `cross-workspace-path` | `server` in the `backend/` workspace depends by path on `model`, a member of the `shared/` workspace.                                                                                                                                        |
| `vendored-crate`       | `app` depends on `lib`, which depends by path on `vendor/parser`, which depends by path on `vendor/lexer`. Neither vendored crate belongs to a workspace, and the fixture's `nx.json` excludes `vendor/**` from the plugin.                  |
| `name-collision`       | Two crates called `api`: a member of the `rust/` workspace and the standalone crate `tools/api`.                                                                                                                                             |
| `dev-dependency-cycle` | `model` dev-depends on `testkit`, and `testkit` depends on `model`.                                                                                                                                                                          |
| `different-toolchains` | The `pinned/` workspace names toolchain `1.91.0` in its `rust-toolchain.toml`, and `stable/` names `stable`. The tests never install a toolchain: without `1.91.0`, cargo fails in `pinned/`, and `fixtures.spec.ts` skips it outside of CI. |

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
expect(graph.projects.app.root).toBe("crates/app");
expect(graph.cargoCalls.map((call) => call.cwd)).toEqual([".", "tools"]);

await expect(loadFixtureGraph("name-collision")).rejects.toThrow(/tools\/api\/Cargo.toml/);
```

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

`compareCacheKeys(row)` returns the hashes instead of failing.

**`FixtureWorkspace.create(fixture, files)`** is the copy both helpers use:
`graph()`, `hashTasks(tasks, { env, overrides })`, `cargoCalls()`,
`reset(files)` and `remove()`. Besides the fixture, the copy has a
`tsconfig.base.json` that lets Nx compile the plugin's TypeScript source.
Set `NX_RUST_KEEP_FIXTURES=1` to keep the copies for inspection.

**`CargoWrapper.install(directory)`** writes a `cargo` that appends one JSON
line per invocation (`cwd`, `args`) to a log and then runs the real cargo in
the same folder. `environment(env)` puts it first on `PATH`;
`calls(root)` returns the invocations with folders relative to `root`.
Every `FixtureWorkspace` has one, which also sees the cargo calls of Nx's
plugin workers.

**`installFixture(projectDirectory, fixture)`** replaces the content of the
end-to-end test project with a fixture, keeping the installed packages, and
registers the installed plugin. See `nx-rust-e2e/src/nx-rust.spec.ts`.

**`testEnvironment(overrides)`** is the environment for every command the
helpers run. It drops the `NX_` variables of the outer Nx run and the
variables that choose a toolchain or Cargo's directories, turns the Nx
daemon off, stops rustup from installing toolchains, and puts rustup's
folder first on `PATH`: Nx puts the folder of the Node executable first,
where a system cargo would otherwise shadow rustup.

Each helper that runs Nx or cargo takes a few seconds at most; give such
tests the `HARNESS_TIMEOUT`.
