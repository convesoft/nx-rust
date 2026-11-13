import { NX_VERSION } from "@nx/devkit";
import { execSync } from "child_process";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";

describe("@convesoft/nx-rust", () => {
  let projectDirectory: string;

  // This hook shells out synchronously twice, so its budget has to cover both
  // installs on a cold package manager cache. Otherwise work that succeeded
  // still fails on return.
  beforeAll(() => {
    projectDirectory = createTestProject();

    // The plugin has been built and published to a local registry in the globalSetup
    // Install the plugin built with the latest source code into the test repo
    execSync(`pnpm add -D --config.frozen-lockfile=false @convesoft/nx-rust@e2e`, {
      cwd: projectDirectory,
      stdio: "inherit",
      env: process.env,
    });
  }, 300_000);

  afterAll(() => {
    if (projectDirectory) {
      // Cleanup the test project
      rmSync(projectDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("should be installed", () => {
    // npm ls will fail if the package is not installed properly
    expect(() =>
      execSync("pnpm ls --depth 100 @convesoft/nx-rust", {
        cwd: projectDirectory,
        stdio: "inherit",
      }),
    ).not.toThrow();
  });
});

/**
 * Creates an empty Nx workspace by hand and installs Nx into it.
 *
 * `create-nx-workspace` is not used. It takes another path when it finds a
 * coding agent in the environment, and on that path it runs `git add` and
 * `git commit --amend` in the test project, which lies inside this repository.
 * Written by hand, the workspace is the same for every caller, nothing runs
 * git, and Nx has the version this repository uses instead of the latest one.
 *
 * @returns The directory where the test project was created
 */
function createTestProject() {
  const projectDirectory = join(process.cwd(), "tmp", "test-project");

  // Ensure projectDirectory is empty
  rmSync(projectDirectory, {
    recursive: true,
    force: true,
  });
  mkdirSync(projectDirectory, {
    recursive: true,
  });

  const packageJson = {
    name: "test-project",
    version: "0.0.0",
    private: true,
    devDependencies: { nx: NX_VERSION },
  };
  writeFileSync(
    join(projectDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  writeFileSync(join(projectDirectory, "nx.json"), "{}\n");
  // pnpm refuses to add a package while a build script is neither allowed nor
  // denied, so the one build script of this workspace is decided here.
  writeFileSync(join(projectDirectory, "pnpm-workspace.yaml"), "allowBuilds:\n  nx: true\n");

  // In CI pnpm expects a lockfile, and a new workspace has none.
  execSync("pnpm install --no-frozen-lockfile", {
    cwd: projectDirectory,
    stdio: "inherit",
    env: process.env,
  });
  console.log(`Created test project in "${projectDirectory}"`);

  return projectDirectory;
}
