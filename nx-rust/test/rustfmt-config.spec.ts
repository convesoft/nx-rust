import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Env, FixtureWorkspace, HARNESS_TIMEOUT, runNx, taskOutput } from "./harness";

// The part of VER-SETUP about a rustfmt configuration outside the
// repository (DES-DIAGNOSTICS, "Rustfmt configuration outside the
// repository", RISK-HOST-ENVIRONMENT), with a real rustfmt: graph creation
// and the fmt-check and fmt tasks of the crates warn, no other task does,
// and no key holds the file or the warning (nxr-rpcfg4).

describe("the warning about a rustfmt configuration outside the repository", () => {
  /** A home folder and a configuration folder of their own, outside the repository. */
  let home: string;
  let xdg: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-home-")));
    xdg = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-xdg-")));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(xdg, { recursive: true, force: true });
  });

  /**
   * The environment with `HOME` and `XDG_CONFIG_HOME` set to those folders,
   * and the toolchains and Cargo home that the real home folder gives,
   * which rustup and cargo would otherwise look for in `HOME`.
   */
  const environment = (): Env => ({
    HOME: home,
    XDG_CONFIG_HOME: xdg,
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup"),
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"),
  });

  const warning = (file: string) =>
    `nx-rust: rustfmt takes its configuration from ${file} for the crates of the Cargo workspace in rust that no rustfmt.toml or .rustfmt.toml in the repository covers, but the file lies outside the repository, so Nx does not hash it, and a fmt-check result cached before a change to it can be restored afterwards.`;
  const remedy =
    'Add a rustfmt.toml to the repository root to have every machine format alike and Nx hash it, or run `nx reset` after each change to the file; --skip-nx-cache covers only the command it is given to (see "Rustfmt configuration outside the repository" in the nx-rust caching guide).';

  // rustfmt takes `Library/Application Support` in the home folder for the
  // configuration folder on macOS, where XDG_CONFIG_HOME does not count.
  const cases: [string, () => string][] = [
    ["~/.rustfmt.toml", () => join(home, ".rustfmt.toml")],
    ...(process.platform === "darwin"
      ? []
      : ([
          ["$XDG_CONFIG_HOME/rustfmt/rustfmt.toml", () => join(xdg, "rustfmt", "rustfmt.toml")],
        ] as [string, () => string][])),
  ];

  it.each(cases)(
    "names %s when the graph is created and in the fmt-check and fmt tasks of the crates, in no other task and in no key",
    async (_case, location) => {
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      const env = environment();
      const file = location();
      try {
        const tasks = ["api:fmt-check", "api:lint", "api:test", "model:fmt-check"];
        const without = await workspace.hashTasks(tasks, { env });
        mkdirSync(dirname(file), { recursive: true });
        // Two spaces where the fixture's sources indent by four.
        writeFileSync(file, "tab_spaces = 2\n");
        const withIt = await workspace.hashTasks(tasks, { env });
        const shown = await runNx(workspace, ["show", "projects"], env);
        const check = await runNx(workspace, ["run", "api:fmt-check"], env);
        const fmt = await runNx(workspace, ["run", "model:fmt"], env);
        const lint = await runNx(workspace, ["run", "api:lint"], env);
        const printed = (output: string) => ({
          warning: output.includes(warning(file)),
          remedy: output.includes(remedy),
        });

        expect({
          shown: { status: shown.status, ...printed(shown.output) },
          // rustfmt applies the file: the fixture's formatting fails the check.
          check: { status: check.status, ...printed(taskOutput(check.output, "api:fmt-check")) },
          fmt: { status: fmt.status, ...printed(taskOutput(fmt.output, "model:fmt")) },
          lint: { status: lint.status, ...printed(taskOutput(lint.output, "api:lint")) },
        }).toEqual({
          shown: { status: 0, warning: true, remedy: true },
          check: { status: 1, warning: true, remedy: true },
          fmt: { status: 0, warning: true, remedy: true },
          lint: { status: 0, warning: false, remedy: false },
        });
        for (const task of tasks) {
          expect({ task, hash: withIt[task].value }).toEqual({ task, hash: without[task].value });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "is not printed where a rustfmt.toml at the repository root covers every crate",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace", { "rustfmt.toml": "" });
      const env = environment();
      try {
        writeFileSync(join(home, ".rustfmt.toml"), "tab_spaces = 2\n");
        const shown = await runNx(workspace, ["show", "projects"], env);
        const check = await runNx(workspace, ["run", "api:fmt-check"], env);

        expect({
          shown: shown.status,
          check: check.status,
          warned: `${shown.output}${check.output}`.includes("rustfmt takes its configuration"),
        }).toEqual({ shown: 0, check: 0, warned: false });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "judges a crate from the folder of each target's source file, not from its manifest's",
    async () => {
      // model's library lies in rust/shared, beside no configuration file,
      // while model's and api's folders hold one each.
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        "rust/crates/model/Cargo.toml": (manifest) =>
          `${manifest}\n[lib]\npath = "../../shared/model.rs"\n`,
        "rust/shared/model.rs": 'pub fn name() -> &\'static str {\n    "model"\n}\n',
        "rust/crates/model/rustfmt.toml": "",
        "rust/crates/api/rustfmt.toml": "",
      });
      const env = environment();
      const file = join(home, ".rustfmt.toml");
      try {
        writeFileSync(file, "tab_spaces = 2\n");
        const model = await runNx(workspace, ["run", "model:fmt-check"], env);
        const api = await runNx(workspace, ["run", "api:fmt-check"], env);

        expect({
          model: {
            status: model.status,
            warned: taskOutput(model.output, "model:fmt-check").includes(warning(file)),
          },
          api: {
            status: api.status,
            warned: taskOutput(api.output, "api:fmt-check").includes(
              "rustfmt takes its configuration",
            ),
          },
        }).toEqual({ model: { status: 1, warned: true }, api: { status: 0, warned: false } });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // XDG_CONFIG_HOME does not count on macOS.
  (process.platform === "darwin" ? describe.skip : describe)(
    "with XDG_CONFIG_HOME in the repository",
    () => {
      it(
        "says that the keys of the other crates do not hold a per-user file that XDG_CONFIG_HOME places in a crate's folder, and nothing to that crate",
        async () => {
          const workspace = FixtureWorkspace.create("subfolder-workspace");
          const config = join(workspace.root, "rust", "crates", "api", "config");
          const env = { ...environment(), XDG_CONFIG_HOME: config };
          try {
            mkdirSync(join(config, "rustfmt"), { recursive: true });
            writeFileSync(join(config, "rustfmt", "rustfmt.toml"), "tab_spaces = 2\n");
            const shown = await runNx(workspace, ["show", "projects"], env);
            const model = await runNx(workspace, ["run", "model:fmt-check"], env);
            const api = await runNx(workspace, ["run", "api:fmt-check"], env);
            const inside =
              "nx-rust: rustfmt takes its configuration from rust/crates/api/config/rustfmt/rustfmt.toml, a per-user folder that HOME or XDG_CONFIG_HOME places in the repository, for the crates of the Cargo workspace in rust that no other rustfmt.toml or .rustfmt.toml covers, but the file lies outside the folders of those crates, so their keys do not hold it, and a fmt-check result cached before a change to it can be restored afterwards.";

            expect({
              shown: shown.output.includes(inside),
              outside: shown.output.includes("lies outside the repository"),
              model: taskOutput(model.output, "model:fmt-check").includes(inside),
              api: taskOutput(api.output, "api:fmt-check").includes(
                "rustfmt takes its configuration",
              ),
            }).toEqual({ shown: true, outside: false, model: true, api: false });
          } finally {
            workspace.remove();
          }
        },
        HARNESS_TIMEOUT,
      );
    },
  );
});
