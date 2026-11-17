import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { contextTriple } from "../../src/executors/affected-run";
import {
  type BaselineContext,
  contextRuntimeCommands,
  contextVariables,
  environmentContext,
  runtimeContext,
  writeContextRecord,
} from "../../src/executors/baseline-context";
import { environmentVariables } from "../../src/graph/inputs";
import { testEnvironment } from "./environment";
import type { FixtureWorkspace } from "./workspace";

// Helpers for the selection of affected tests (DES-TEST-RUN, steps 1 to 4):
// the real tools that a collection needs, a stand-in for cargo-affected that
// replays a report, git in a fixture copy and the record of a baseline's
// context, written with the plugin's own functions.

/**
 * The folder of a real cargo-affected, looked up as cargo looks up a
 * subcommand: the folder that `NX_RUST_TEST_CARGO_AFFECTED` names, where it
 * holds `cargo-affected`, else the first folder on `PATH` that holds it, else
 * the `bin` of the Cargo home; `undefined` where none has it.
 */
export function cargoAffectedFolder(): string | undefined {
  const named = process.env.NX_RUST_TEST_CARGO_AFFECTED;
  const home = process.env.CARGO_HOME || join(homedir(), ".cargo");
  return [
    ...(named === undefined || named === "" ? [] : [named]),
    ...(process.env.PATH ?? "").split(delimiter),
    join(home, "bin"),
  ].find((folder) => folder !== "" && existsSync(join(folder, "cargo-affected")));
}

/** The LLVM major version that a `--version` or `-vV` output names, such as `23`. */
function llvmMajor(output: string): string | undefined {
  return /LLVM version:?\s+(\d+)/.exec(output)?.[1];
}

/**
 * The folder that holds the `llvm-cov` and `llvm-profdata` for the toolchain
 * of the tests' cargo, which cargo-affected runs to collect coverage, or why
 * there is none: the folder that `NX_RUST_TEST_LLVM_TOOLS` names, else the
 * `llvm-tools` component of the toolchain that `rustc` resolves to with the
 * tests' environment, and never another folder on `PATH`. A tool of another
 * LLVM major version than that toolchain's cannot read its profiles, so it
 * does not count either.
 */
export function llvmTools(): { folder: string } | { problem: string } {
  const env = testEnvironment();
  const rustc = spawnSync("rustc", ["-vV"], { env, encoding: "utf8" });
  const toolchainLlvm = llvmMajor(rustc.stdout ?? "");
  const host = /^host: (\S+)$/m.exec(rustc.stdout ?? "")?.[1];
  const named = process.env.NX_RUST_TEST_LLVM_TOOLS;
  let folder: string;
  if (named !== undefined && named !== "") {
    folder = named;
  } else {
    const sysroot = spawnSync("rustc", ["--print", "sysroot"], { env, encoding: "utf8" });
    if (sysroot.status !== 0 || host === undefined) {
      return {
        problem: "rustc cannot name its sysroot and host, where the llvm-tools component lies",
      };
    }
    folder = join(sysroot.stdout.trim(), "lib", "rustlib", host, "bin");
  }
  for (const tool of ["llvm-cov", "llvm-profdata"]) {
    if (!existsSync(join(folder, tool))) {
      return {
        problem: `${tool} of the llvm-tools component of the toolchain that rustc resolves to (${rustc.stdout?.split("\n")[0] ?? "unknown"}) is not in ${folder}, and NX_RUST_TEST_LLVM_TOOLS names no other folder`,
      };
    }
  }
  const toolLlvm = llvmMajor(
    spawnSync(join(folder, "llvm-cov"), ["--version"], { env, encoding: "utf8" }).stdout ?? "",
  );
  if (toolLlvm === undefined || toolLlvm !== toolchainLlvm) {
    return {
      problem: `llvm-cov in ${folder} is of LLVM ${toolLlvm ?? "unknown"}, and the toolchain that rustc resolves to uses LLVM ${toolchainLlvm ?? "unknown"}, so it cannot read that toolchain's coverage`,
    };
  }
  return { folder };
}

/**
 * A stand-in for cargo-affected in a folder of its own, for the runs whose
 * point is what the plugin does with a report: `cargo affected status` writes
 * the report in the file that `NX_RUST_STUB_AFFECTED_REPORT` names to the
 * path after `--report-json`, appends its arguments as a JSON line to the
 * file that `NX_RUST_STUB_AFFECTED_LOG` names, and exits with
 * `NX_RUST_STUB_AFFECTED_STATUS`, 0 by default.
 */
export class StubCargoAffected {
  readonly folder = mkdtempSync(join(tmpdir(), "nx-rust-affected-stub-"));
  readonly report = join(this.folder, "report.json");
  readonly log = join(this.folder, "calls.log");

  constructor() {
    const script = join(this.folder, "cargo-affected");
    writeFileSync(
      script,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs");',
        "const args = process.argv.slice(2);",
        'if (process.env.NX_RUST_STUB_AFFECTED_LOG) fs.appendFileSync(process.env.NX_RUST_STUB_AFFECTED_LOG, JSON.stringify(args) + "\\n");',
        'const at = args.indexOf("--report-json");',
        "if (at !== -1 && process.env.NX_RUST_STUB_AFFECTED_REPORT) fs.copyFileSync(process.env.NX_RUST_STUB_AFFECTED_REPORT, args[at + 1]);",
        'process.stderr.write("stub cargo-affected\\n");',
        'process.exit(Number(process.env.NX_RUST_STUB_AFFECTED_STATUS || "0"));',
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
  }

  /** The variables that point the stand-in at its report and log. */
  env(status = 0): Record<string, string> {
    return {
      NX_RUST_STUB_AFFECTED_REPORT: this.report,
      NX_RUST_STUB_AFFECTED_LOG: this.log,
      NX_RUST_STUB_AFFECTED_STATUS: String(status),
    };
  }

  /** Writes the report that the next `status` gives. */
  writeReport(report: object): void {
    writeFileSync(this.report, JSON.stringify(report));
  }

  /** The arguments of each call so far. */
  calls(): string[][] {
    return existsSync(this.log)
      ? readFileSync(this.log, "utf8")
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as string[])
      : [];
  }

  remove(): void {
    rmSync(this.folder, { recursive: true, force: true });
  }
}

/** A report of `cargo affected status --report-detail full` with schema 1, as cargo-affected 0.4.1 writes it. */
export function affectedReport(options: {
  status?: string;
  collect: { sha: string; relation?: string }[];
  changed: { path: string; tracked: boolean }[];
  selected: { binary: string; test: string }[] | null;
  differingLabels?: string[];
}): object {
  return {
    schema_version: 1,
    cargo_affected_version: "0.4.1",
    command: "status",
    cache: {
      status: options.status ?? "hit-exact",
      current_fingerprint: "f".repeat(64),
      current_components: [],
      stored_fingerprints: [
        {
          fingerprint: "e".repeat(64),
          last_seen: "2026-11-16T20:58:35Z",
          diff_count: options.differingLabels?.length ?? 0,
          differing_labels: options.differingLabels ?? [],
        },
      ],
      collect_shas: options.collect.map(({ sha, relation }) => ({
        sha,
        relation: relation ?? "equal",
        row_count: 1,
      })),
    },
    selection: {
      summary: { mode: options.selected === null ? "full-suite-no-listing" : "selection" },
      changed_files: options.changed.map(({ path, tracked }) => ({
        path,
        tracked_by_coverage: tracked,
        hunks_by_sha: [],
        tests_pulled_total: 0,
        tests_pulled_by_reason: {},
      })),
      selected_tests:
        options.selected === null
          ? null
          : options.selected.map(({ binary, test }) => ({
              binary_id: binary,
              test_name: test,
              kind: "affected",
              reasons: [],
            })),
    },
  };
}

/** The environment for git in a fixture copy: no user configuration, a fixed author. */
export function fixtureGitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...testEnvironment(),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "nx-rust",
    GIT_AUTHOR_EMAIL: "nx-rust@example.com",
    GIT_COMMITTER_NAME: "nx-rust",
    GIT_COMMITTER_EMAIL: "nx-rust@example.com",
  };
}

/** Runs git in `cwd` and returns its standard output. */
export function gitIn(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, env: fixtureGitEnvironment(), encoding: "utf8" });
}

/** Makes `root` a git repository with one commit of everything in it; returns that commit. */
export function initGitRepository(root: string): string {
  gitIn(root, ["init", "-q", "-b", "main"]);
  return commitAll(root, "fixture");
}

/** Commits every change in `root`; returns the new commit. */
export function commitAll(root: string, message: string): string {
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "--allow-empty", "-m", message]);
  return gitIn(root, ["rev-parse", "HEAD"]).trim();
}

/** The `test` tasks of the affected-tests fixture's crates. */
export const affectedTestTasks = ["basics", "macros", "app", "runner", "consumer"].map(
  (crate) => `${crate}:test`,
);

/**
 * Writes the record of the context of a collection in `workspaceRoot`
 * (`DES-BASELINE`) for a collection run with `env` and `cargo`: every
 * variable that a `test` task hashes and the prefixed ones of `env`, the
 * declared ones in `declared` included, and the output of every runtime
 * input of `tasks` but the test mode's, run as Nx runs them, with the
 * plugin's own functions.
 */
export async function writeBaselineContext(
  workspace: FixtureWorkspace,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  options: {
    cargo?: Partial<BaselineContext["cargo"]>;
    declared?: string[];
    tasks?: string[];
  } = {},
): Promise<void> {
  const names = contextVariables(
    [...environmentVariables, "CARGO_BUILD_WARNINGS", ...(options.declared ?? [])],
    env,
  );
  const listed = await workspace.taskRuntimeInputs(options.tasks ?? affectedTestTasks);
  const runtime = runtimeContext(
    contextRuntimeCommands(Object.values(listed).flat()),
    workspace.root,
    env,
  );
  if ("problem" in runtime) {
    throw new Error(runtime.problem);
  }
  writeContextRecord(workspaceRoot, {
    version: 2,
    cargo: {
      features: [],
      allFeatures: false,
      noDefaultFeatures: false,
      profile: null,
      target: null,
      ...options.cargo,
    },
    triple: contextTriple(workspaceRoot, env),
    env: environmentContext(names, env),
    runtime: runtime.runtime,
  });
}

/**
 * An environment in which cargo finds no cargo-affected, whatever the
 * machine has: `PATH` without the folders that hold it, with a Cargo home of
 * its own whose `bin` links every other program of the machine's Cargo home,
 * such as rustup's proxies and cargo-nextest.
 */
export class HiddenCargoAffected {
  readonly home = mkdtempSync(join(tmpdir(), "nx-rust-no-affected-"));

  constructor() {
    const bin = join(this.home, "bin");
    mkdirSync(bin);
    const real = join(process.env.CARGO_HOME || join(homedir(), ".cargo"), "bin");
    for (const name of existsSync(real) ? readdirSync(real) : []) {
      if (name !== "cargo-affected") {
        symlinkSync(join(real, name), join(bin, name));
      }
    }
  }

  /** `env` with `PATH` and `CARGO_HOME` that hide cargo-affected. */
  env(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const path = (env.PATH ?? "")
      .split(delimiter)
      .filter((folder) => folder !== "" && !existsSync(join(folder, "cargo-affected")));
    return {
      ...env,
      CARGO_HOME: this.home,
      PATH: [join(this.home, "bin"), ...path].join(delimiter),
    };
  }

  remove(): void {
    rmSync(this.home, { recursive: true, force: true });
  }
}
