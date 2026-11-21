import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { wasmTriple } from "../../src/graph/wasm";
import { testEnvironment } from "./environment";
import { copyFixtureFiles, type FixtureName } from "./fixtures";
import { testHost } from "./hakari";
import { testRunFolder } from "./test-run";
import { wasmTargetInstalled } from "./wasm";

/**
 * A Cargo workspace of a fixture and the cargo commands whose third-party
 * builds every copy of the fixture gets ready-made ({@link warmBuilds}).
 */
export interface WarmedWorkspace {
  /** The workspace's folder, relative to the fixture's root, with `/` separators. */
  folder: string;
  /** The cargo commands to run in it, such as `["build", "--workspace"]`. */
  builds: string[][];
}

/**
 * The fixtures whose copies start with a `target` folder in which cargo
 * finds the crates of their registries compiled already, so that the tests
 * do not compile the same third-party crates again in every copy: per
 * fixture, its workspaces and the builds that each test would otherwise
 * repeat. A function, because the builds depend on the toolchain.
 *
 * To warm another fixture, add it here with the cargo commands its tests
 * run, as cargo runs them (the same profile, features, package selection and
 * triple; `--keep-going`, `--message-format` and the stage of a staged
 * build, which keeps the build directory, change nothing that cargo reuses).
 * Whatever a copy builds otherwise compiles as before.
 *
 * A fixture whose crates are all its own, such as `batch-groups` and
 * `workspace-tests`, gains nothing here: after `cargo clean -p` of its
 * members its template holds no build output, so it is left out.
 */
export const warmBuilds: Partial<Record<FixtureName, () => WarmedWorkspace[]>> = {
  // The host build of napi-build and the build of the workspace, and the
  // same for the host triple named, as with CARGO_BUILD_TARGET.
  "napi-addons": () => [
    {
      folder: "rust",
      builds: [
        ["build", "--workspace"],
        ["build", "--workspace", "--target", testHost()],
      ],
    },
  ],
  // The host build of the workspace, and the libraries for the wasm triple
  // that wasm-build compiles, where the toolchain has that triple.
  "wasm-packages": () => [
    {
      folder: "rust",
      builds: [
        ["build", "--workspace"],
        ...(wasmTargetInstalled()
          ? [["build", "--lib", "--workspace", "--target", wasmTriple]]
          : []),
      ],
    },
  ],
};

/**
 * Gives the copy of `fixture` at `destination` the `target` folder of each
 * of its workspaces in {@link warmBuilds}, cloned from a template that the
 * test run builds once ({@link warmTemplate}). Without a test run, or for a
 * fixture that the table does not name, it does nothing.
 */
export function placeWarmBuilds(fixture: FixtureName, destination: string): void {
  const workspaces = warmBuilds[fixture]?.();
  if (workspaces === undefined || testRunFolder() === undefined) {
    return;
  }
  const template = warmTemplate(fixture, workspaces);
  for (const { folder } of workspaces) {
    const target = join(template, ...folder.split("/"), "target");
    if (existsSync(target)) {
      // A clone of each file where the file system has them, as btrfs and
      // APFS do, and a copy elsewhere, with the template's times. Whether
      // the copy compiles its own crates does not rest on those times:
      // cargo's own cleaning removed their build output (buildTemplate).
      cpSync(target, join(destination, ...folder.split("/"), "target"), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        preserveTimestamps: true,
      });
    }
  }
}

/** How long a test process waits for another one to build a template. */
const templateWait = 600_000;

/** How long a lock file that names no owner counts as being written. */
const ownerlessLockGrace = 5_000;

/**
 * The template of `fixture` in the folder of the test run, built by the
 * first test process that asks for it ({@link buildTemplate}) while the
 * others wait. The template, a failure and the lock each appear complete or
 * not at all: the template is renamed into place when it is done, the
 * failure is written beside its name and renamed, and the lock is created
 * with its owner's process and token in it. A waiter takes over the lock of
 * an owner that died, and only one waiter can win that; a lock that names no
 * owner counts as dead after {@link ownerlessLockGrace}.
 *
 * The test run's teardown removes the templates with the run's folder.
 *
 * @throws {Error} Where a build of the template failed, in every process that asks for it.
 */
export function warmTemplate(fixture: FixtureName, workspaces: WarmedWorkspace[]): string {
  const run = testRunFolder();
  if (run === undefined) {
    throw new Error("warmTemplate needs the folder of a test run (startTestRun).");
  }
  const folder = join(run, "fixture-builds");
  mkdirSync(folder, { recursive: true });
  const template = join(folder, fixture);
  const failed = join(folder, `${fixture}.failed`);
  const lock = join(folder, `${fixture}.lock`);
  const deadline = Date.now() + templateWait;
  for (;;) {
    if (existsSync(template)) {
      return template;
    }
    if (existsSync(failed)) {
      throw new Error(readFileSync(failed, "utf8"));
    }
    const token = takeLock(lock);
    if (token !== undefined) {
      try {
        if (!existsSync(template) && !existsSync(failed)) {
          const building = `${template}.building-${process.pid}-${randomUUID()}`;
          try {
            buildTemplate(fixture, workspaces, building);
            renameSync(building, template);
          } catch (error) {
            publish(failed, error instanceof Error ? error.message : String(error));
            removeWithin(building, folder);
          }
        }
      } finally {
        releaseLock(lock, token);
      }
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`No template of ${fixture} after ${templateWait / 1000} s: ${lock} is held.`);
    }
    sleep(200);
  }
}

/**
 * Builds the template of `fixture` in `template`, a folder that must not
 * exist yet: a copy of the fixture's files ({@link copyFixtureFiles}) on
 * which each workspace runs its builds, after which `cargo clean -p` removes
 * every crate of the workspace for each triple and profile that the builds
 * used. That removes the build output of the workspace's own crates; Cargo
 * 1.91 leaves the incremental folders of their build scripts, which the
 * compiler does not reuse in a copy. The guard tests in `napi-build.spec.ts`
 * and `wasm-build.spec.ts` show that a copy compiles every crate of the
 * workspace again, also with its sources dated before the template, and
 * writes their records itself.
 *
 * Every cargo command gets the workspace's `target` folder in the template
 * as its target and build directory, with `--target-dir` and the variables
 * that take precedence over every configuration file, and the build does
 * not start unless `cargo metadata` reports those directories; so neither
 * the machine's Cargo configuration nor its environment can move what the
 * template builds or cleans elsewhere.
 *
 * @param env The environment of the cargo commands, {@link testEnvironment} by default.
 * @throws {Error} Where a cargo command fails, with its output.
 */
export function buildTemplate(
  fixture: FixtureName,
  workspaces: WarmedWorkspace[],
  template: string,
  env: NodeJS.ProcessEnv = testEnvironment(),
): void {
  if (existsSync(template)) {
    throw new Error(`${template} exists already.`);
  }
  copyFixtureFiles(fixture, template);
  for (const { folder, builds } of workspaces) {
    const cwd = join(template, ...folder.split("/"));
    const target = join(cwd, "target");
    const pinned: NodeJS.ProcessEnv = {
      ...env,
      CARGO_TARGET_DIR: target,
      CARGO_BUILD_TARGET_DIR: target,
      CARGO_BUILD_BUILD_DIR: target,
    };
    const cargo = (args: string[]): string => {
      const run = spawnSync("cargo", args, { cwd, env: pinned, encoding: "utf8" });
      if (run.status !== 0) {
        throw new Error(
          `The template build of ${fixture} failed: cargo ${args.join(" ")} in ${folder} exited with ${run.status ?? run.signal}.\n${run.stderr}`,
        );
      }
      return run.stdout;
    };
    const metadata = JSON.parse(cargo(["metadata", "--no-deps", "--format-version", "1"])) as {
      packages: { name: string }[];
      target_directory: string;
      build_directory?: string;
    };
    for (const directory of [metadata.target_directory, metadata.build_directory ?? target]) {
      if (resolve(directory) !== target) {
        throw new Error(
          `The template build of ${fixture} refuses to run: cargo would write to ${directory}, not to ${target}.`,
        );
      }
    }
    for (const args of builds) {
      cargo([...args, "--target-dir", target]);
    }
    const members = metadata.packages.flatMap(({ name }) => ["-p", name]);
    for (const selection of cleanSelections(builds)) {
      cargo(["clean", ...members, ...selection, "--target-dir", target]);
    }
  }
}

/**
 * The triple and profile options of `builds`, each combination once, and
 * the host's for each profile, for `cargo clean`.
 */
function cleanSelections(builds: string[][]): string[][] {
  const option = (args: string[], name: string): string[] => {
    const at = args.indexOf(name);
    return at < 0 ? [] : [name, args[at + 1]];
  };
  const selections = new Map<string, string[]>();
  for (const args of builds) {
    const profile = args.includes("--release") ? ["--release"] : option(args, "--profile");
    for (const triple of [[], option(args, "--target")]) {
      const selection = [...triple, ...profile];
      selections.set(JSON.stringify(selection), selection);
    }
  }
  return [...selections.values()];
}

/** Removes `path`, refusing anything that does not lie inside `root`. */
function removeWithin(path: string, root: string): void {
  const inside = relative(resolve(root), resolve(path));
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`Refusing to remove ${path}, which is not inside ${root}.`);
  }
  rmSync(path, { recursive: true, force: true });
}

/** Writes `content` to `file` beside it and renames it into place. */
function publish(file: string, content: string): void {
  const written = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(written, content);
  renameSync(written, file);
}

/**
 * Creates the lock file with this process and a token in it, in one step:
 * a hard link to a file written beforehand fails where the lock exists.
 * Where it exists and its owner died, or it names no owner for longer than
 * {@link ownerlessLockGrace}, removes it, if this process is the one waiter
 * that claims it, so that a next attempt can take it. A claim follows the
 * same rule: one whose owner died gives way to the next.
 *
 * @returns The token of the lock this process now holds, or undefined.
 */
function takeLock(lock: string): string | undefined {
  const token = `${process.pid} ${randomUUID()}`;
  if (createWithContent(lock, token)) {
    return token;
  }
  const held = readLock(lock);
  if (held === undefined || !ownerDead(held)) {
    return undefined;
  }
  // Only one waiter holds the claim for this lock; it alone removes the
  // lock, which nobody else can replace while it exists. A claim whose
  // owner died counts as a lock does, and the next claim, one number on,
  // takes over from it.
  for (let generation = 0; ; generation += 1) {
    const claim = `${lock}.claim-${held.identity}-${generation}`;
    if (createWithContent(claim, `${process.pid} claim`)) {
      break;
    }
    const claimed = readLock(claim);
    if (claimed === undefined || !ownerDead(claimed)) {
      return undefined;
    }
  }
  if (readLock(lock)?.identity === held.identity) {
    rmSync(lock, { force: true });
  }
  return undefined;
}

/**
 * Creates `file` with `content` in one step, through a hard link to a file
 * written beforehand, which fails where `file` exists.
 *
 * @returns Whether this call created it.
 */
function createWithContent(file: string, content: string): boolean {
  const written = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(written, content);
  try {
    linkSync(written, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    return false;
  } finally {
    rmSync(written, { force: true });
  }
}

/** What a lock file says: its owner's process, if it names one, and what tells this lock from others. */
function readLock(lock: string): { pid?: number; identity: string; age: number } | undefined {
  try {
    const stat = statSync(lock);
    const text = readFileSync(lock, "utf8");
    const pid = /^(\d+) \S+$/.exec(text)?.[1];
    return {
      pid: pid === undefined ? undefined : Number(pid),
      identity: createHash("sha256")
        .update(`${stat.ino} ${stat.mtimeMs} ${text}`)
        .digest("hex")
        .slice(0, 16),
      age: Date.now() - stat.mtimeMs,
    };
  } catch {
    return undefined;
  }
}

function ownerDead({ pid, age }: { pid?: number; age: number }): boolean {
  if (pid === undefined) {
    return age > ownerlessLockGrace;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Removes the lock where it is still the one this process took. */
function releaseLock(lock: string, token: string): void {
  try {
    if (readFileSync(lock, "utf8") === token) {
      rmSync(lock, { force: true });
    }
  } catch {
    // Gone already.
  }
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** What one cargo build compiled and what it found compiled already. */
export interface BuildFreshness {
  /** The targets of the workspace's own crates that cargo compiled, as `<package>:<target>`, sorted. */
  ownCompiled: string[];
  /** Those that it found compiled already. */
  ownFresh: string[];
  /** The targets of every other crate, such as those of a registry, that it compiled. */
  othersCompiled: string[];
  /** Those that it found compiled already. */
  othersFresh: string[];
}

/**
 * Runs `cargo <args> --message-format=json` in `cwd` and sorts the targets
 * it reports by whether they belong to a crate below `root` and whether
 * cargo compiled them.
 */
export function buildFreshness(cwd: string, root: string, args: string[]): BuildFreshness {
  const run = spawnSync("cargo", [...args, "--message-format=json"], {
    cwd,
    env: testEnvironment(),
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`cargo ${args.join(" ")} failed in ${cwd}:\n${run.stderr}`);
  }
  const result: BuildFreshness = {
    ownCompiled: [],
    ownFresh: [],
    othersCompiled: [],
    othersFresh: [],
  };
  for (const line of run.stdout.split("\n")) {
    if (!line.startsWith("{")) {
      continue;
    }
    const message = JSON.parse(line);
    if (message.reason !== "compiler-artifact") {
      continue;
    }
    const own = (message.manifest_path as string).startsWith(`${root}/`);
    const name = `${packageName(message.package_id)}:${message.target.name}`;
    const list = own
      ? message.fresh
        ? result.ownFresh
        : result.ownCompiled
      : message.fresh
        ? result.othersFresh
        : result.othersCompiled;
    list.push(name);
  }
  for (const list of Object.values(result)) {
    list.sort();
  }
  return result;
}

/**
 * The package's name in a package ID of Cargo's JSON messages, such as
 * `path+file:///w/crates/addon-a#0.1.0`, where it is the folder's name, or
 * `registry+https://github.com/rust-lang/crates.io-index#napi@3.16.2`.
 */
function packageName(id: string): string {
  const [url, fragment = ""] = id.split("#");
  return fragment.includes("@") ? fragment.split("@")[0] : url.replace(/^.*\//, "");
}

/**
 * Sets the times of every file below `folder` but its `target` folders to
 * 1 January 2001, older than anything cargo built, so that a crate whose
 * build state cargo still had would count as compiled already.
 */
export function backdateSources(folder: string): void {
  const time = new Date("2001-01-01T00:00:00Z");
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "target") {
        backdateSources(path);
      }
    } else if (entry.isFile()) {
      utimesSync(path, time, time);
    }
  }
}
