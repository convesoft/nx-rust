import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyFileChanges,
  FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  withoutColours,
} from "./harness";

// Checks VER-MIXED-PROJECTS, and the part of VER-CACHE-KEYS about a lockfile
// task that a file in the workspace's folder replaces, with a real cargo and
// Nx 24's own graph, task graph and hasher. In mixed-folders, the crate
// napi-addon in libs/rust/crates/addon has a package.json that names it
// @mixed/napi-addon and depends on engine, which its project.json names
// rust-engine; the workspace project in libs/rust is libs-rust.

const addon = "@mixed/napi-addon";

/**
 * The crate's folder enrolled in the package manager's workspaces instead of
 * read through a project.json, and a JS package web that depends on the
 * crate's package and whose cached build declares ^build.
 */
const consumer: FileChanges = {
  "package.json": JSON.stringify({ name: "mixed-root", private: true }),
  "pnpm-workspace.yaml": "packages:\n  - libs/rust/crates/addon\n  - apps/*\n",
  "libs/rust/crates/addon/project.json": null,
  "apps/web/src/index.ts": "export const web = 1;\n",
  "apps/web/package.json": JSON.stringify({
    name: "web",
    private: true,
    dependencies: { [addon]: "workspace:*" },
    nx: {
      targets: { build: { command: "echo web", dependsOn: ["^build"], cache: true } },
    },
  }),
};

/** Scripts in the crate's package.json, as the napi-rs template has them. */
function addonPackage(extra: Record<string, unknown>): FileChanges {
  return {
    "libs/rust/crates/addon/package.json": (json) =>
      JSON.stringify({
        ...JSON.parse(json!),
        scripts: { build: "echo napi-build", test: "echo ava", artifacts: "echo artifacts" },
        ...extra,
      }),
  };
}

/** The tasks of the task graph that `nx <args> --graph=<file>` writes, without running one. */
async function graphTasks(workspace: FixtureWorkspace, args: string[]): Promise<string[]> {
  // Outside the repository, so that Nx does not see it.
  const file = join(workspace.root, "..", "task-graph.json");
  const { status, output } = await workspace.nx([...args, `--graph=${file}`]);
  // Without the paths, whose temporary folder names nx-rust, nothing of the plugin's.
  const said = withoutColours(output).split(join(workspace.root, "..")).join("");
  expect({ status, said }).toEqual({ status: 0, said: expect.not.stringContaining("nx-rust") });
  return Object.keys(JSON.parse(readFileSync(file, "utf8")).tasks.tasks).sort();
}

function withWorkspace(
  files: FileChanges[],
  test: (workspace: FixtureWorkspace) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const workspace = FixtureWorkspace.create("mixed-folders", ...files);
    try {
      await test(workspace);
    } finally {
      workspace.remove();
    }
  };
}

describe("a crate that is also a JS package", () => {
  it(
    "give a JS consumer an edge to it, and its ^build only the crate's cargo build",
    withWorkspace([consumer], async (workspace) => {
      const graph = await workspace.graph();
      expect(graph.projects[addon].targets!.build.executor).toBe(
        "@convesoft/nx-rust:cargo-outputs",
      );
      expect(graph.dependencies).toContainEqual(
        expect.objectContaining({ source: "web", target: addon }),
      );
      expect(await graphTasks(workspace, ["run", "web:build"])).toEqual([
        `${addon}:build`,
        "libs-rust:lockfile",
        "web:build",
      ]);

      const before = (await workspace.hashTasks(["web:build"]))["web:build"].value;
      applyFileChanges(workspace.root, {
        "libs/rust/crates/engine/src/lib.rs": (source) => `${source}\npub fn changed() {}\n`,
      });
      const after = (await workspace.hashTasks(["web:build"]))["web:build"].value;
      expect(after).not.toBe(before);
    }),
    HARNESS_TIMEOUT,
  );

  it(
    "let the crate's scripts replace build and test, with their own dependsOn",
    withWorkspace([consumer, addonPackage({})], async (workspace) => {
      const targets = (await workspace.graph()).projects[addon].targets!;
      expect(targets.build.executor).toBe("nx:run-script");
      expect(targets.test.executor).toBe("nx:run-script");
      expect(targets.check.executor).toBe("@convesoft/nx-rust:cargo");
      expect(await graphTasks(workspace, ["run", "web:build"])).toEqual([
        `${addon}:build`,
        "web:build",
      ]);

      // A target default gives the script ^build, while the empty entries
      // keyed by the plugin's executors keep it from the crates' own builds.
      applyFileChanges(workspace.root, {
        "nx.json": (json) =>
          JSON.stringify({
            ...JSON.parse(json!),
            targetDefaults: {
              "@convesoft/nx-rust:cargo": {},
              "@convesoft/nx-rust:cargo-outputs": {},
              "@convesoft/nx-rust:lockfile": {},
              build: { dependsOn: ["^build"] },
            },
          }),
      });
      expect(await graphTasks(workspace, ["run", "web:build"])).toEqual([
        `${addon}:build`,
        "libs-rust:lockfile",
        "rust-engine:build",
        "web:build",
      ]);
    }),
    HARNESS_TIMEOUT,
  );

  it(
    "keep the cargo targets that nx.includedScripts leaves out",
    withWorkspace(
      [consumer, addonPackage({ nx: { includedScripts: ["artifacts"] } })],
      async (workspace) => {
        const targets = (await workspace.graph()).projects[addon].targets!;
        expect(targets.build.executor).toBe("@convesoft/nx-rust:cargo-outputs");
        expect(targets.test.executor).toBe("@convesoft/nx-rust:cargo");
        expect(targets.artifacts.executor).toBe("nx:run-script");
      },
    ),
    HARNESS_TIMEOUT,
  );

  it(
    "fail a crate's cached task where a project.json replaces the lockfile task",
    withWorkspace(
      [
        {
          "libs/rust/project.json": JSON.stringify({
            targets: { lockfile: { command: "echo replaced-lockfile" } },
          }),
        },
      ],
      async (workspace) => {
        const { status, output } = await workspace.nx([
          "run",
          `${addon}:check`,
          "--output-style=static",
        ]);

        expect(status).not.toBe(0);
        expect(output).toContain("replaced-lockfile");
        expect(withoutColours(output)).toContain(`${addon}:check`);
        // Nothing stored: the next run fails again instead of restoring a result.
        expect(
          (await workspace.nx(["run", `${addon}:check`, "--output-style=static"])).status,
        ).not.toBe(0);
      },
    ),
    HARNESS_TIMEOUT,
  );
});
