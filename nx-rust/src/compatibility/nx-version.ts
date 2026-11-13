import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The name of the plugin's package. */
const packageName = "@convesoft/nx-rust";

/**
 * The variable that lets the plugin continue, with a warning, on an Nx major
 * newer than the supported ones, when it is `true` (`REQ-COMPATIBILITY`).
 */
export const allowUnsupportedNxVariable = "NX_RUST_ALLOW_UNSUPPORTED_NX";

// The plugin's own package.json: two folders up from this file, in the source
// tree (nx-rust/src/compatibility) and in the built package
// (dist/nx-rust/src/compatibility) alike.
const pluginPackageJson = join(__dirname, "..", "..", "package.json");

let supportedMajors: readonly number[] | undefined;

/**
 * The Nx majors that this version of the plugin supports: those that the
 * peer dependency range on `nx` in its `package.json` names.
 *
 * @throws {Error} When the package has no such range, or one that
 *   {@link majorsOfRange} cannot read: the package is broken.
 */
export function supportedNxMajors(): readonly number[] {
  if (supportedMajors === undefined) {
    let range: unknown;
    try {
      range = JSON.parse(readFileSync(pluginPackageJson, "utf8"))?.peerDependencies?.nx;
    } catch (error) {
      throw brokenPackage(`its package.json could not be read (${reason(error)})`);
    }
    if (typeof range !== "string") {
      throw brokenPackage("its package.json has no peer dependency range on nx");
    }
    supportedMajors = majorsOfRange(range);
  }
  return supportedMajors;
}

/**
 * The majors that a peer dependency range names, such as `[24]` for `^24`
 * or `[24, 25]` for `^24 || ^25.1.0`. Each alternative has to stand for one
 * whole major from some release on: `^24`, `^24.1.0`, `24`, `24.x` or
 * `24.x.x`.
 *
 * @throws {Error} For any other range.
 */
export function majorsOfRange(range: string): number[] {
  const majors = range.split("||").map((alternative) => {
    const match = /^\^?(\d+)(?:\.(?:\d+|x)){0,2}$/.exec(alternative.trim());
    if (match === null || (!alternative.trim().startsWith("^") && /\.\d/.test(alternative))) {
      throw brokenPackage(`it cannot read the peer dependency range on nx "${range}"`);
    }
    return Number(match[1]);
  });
  return [...new Set(majors)].sort((a, b) => a - b);
}

/** "Nx 24", "Nx 24 and 25" or "Nx 23, 24 and 25". */
export function describeNxMajors(majors: readonly number[]): string {
  const names = majors.map(String);
  return `Nx ${names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}`;
}

/** The Nx installed in a repository. */
export interface InstalledNx {
  /** The version that its `package.json` gives, such as `24.0.6`. */
  version: string;
  /** The major of {@link InstalledNx.version}. */
  major: number;
}

/**
 * The Nx installed in the repository at `workspaceRoot`: the `nx` package
 * that resolves from there, where Nx itself looks for the installed Nx
 * (`.nx/installation` first, then the repository root), or, failing that,
 * the `nx` package that resolves from the plugin, its peer dependency.
 *
 * @throws {Error} When no `nx` package can be found or read.
 */
export function installedNx(workspaceRoot: string): InstalledNx {
  let packageJson: string;
  try {
    packageJson = resolveNxPackageJson(workspaceRoot);
  } catch (error) {
    throw new Error(
      [
        `nx-rust could not find the nx package installed in ${workspaceRoot}: ${reason(error)}.`,
        `It checks that the installed Nx is one that ${packageName} supports. Install nx in the repository, then run the command again.`,
      ].join("\n"),
    );
  }
  let version: unknown;
  try {
    version = JSON.parse(readFileSync(packageJson, "utf8"))?.version;
  } catch (error) {
    throw new Error(
      `nx-rust could not read the version of Nx from ${packageJson}: ${reason(error)}.`,
    );
  }
  const major = typeof version === "string" ? /^(\d+)\./.exec(version)?.[1] : undefined;
  if (typeof version !== "string" || major === undefined) {
    throw new Error(
      `nx-rust could not read the version of Nx from ${packageJson}: its version is ${JSON.stringify(version)}.`,
    );
  }
  return { version, major: Number(major) };
}

function resolveNxPackageJson(workspaceRoot: string): string {
  try {
    return require.resolve("nx/package.json", {
      paths: [join(workspaceRoot, ".nx", "installation"), workspaceRoot],
    });
  } catch {
    return require.resolve("nx/package.json");
  }
}

/** What the plugin does with the installed Nx. */
export type NxVerdict =
  | { kind: "supported" }
  /** Stop with this message. */
  | { kind: "error"; message: string }
  /** Continue after printing this message. */
  | { kind: "warning"; message: string };

/**
 * Whether the plugin runs with `installed`: yes for a supported major; an
 * error for an older one, and for a newer one unless
 * `NX_RUST_ALLOW_UNSUPPORTED_NX` is `true` in `env`, which makes it a
 * warning. The messages name the version found and the supported majors.
 */
// @mara implements REQ-COMPATIBILITY
// @mara implements DES-DIAGNOSTICS
export function nxVerdict(
  installed: InstalledNx,
  supported: readonly number[],
  env: NodeJS.ProcessEnv,
): NxVerdict {
  if (supported.includes(installed.major)) {
    return { kind: "supported" };
  }
  const supportedNx = describeNxMajors(supported);
  const found = `Nx ${installed.version}, which is installed in this repository`;
  const allow = env[allowUnsupportedNxVariable];
  if (installed.major < Math.min(...supported)) {
    return {
      kind: "error",
      message: [
        `nx-rust does not support ${found}: this version of ${packageName} supports ${supportedNx}.`,
        `Upgrade Nx to a supported version with \`nx migrate\`, or use a version of ${packageName} that supports Nx ${installed.major}.`,
        ...(allow === undefined
          ? []
          : [
              `${allowUnsupportedNxVariable} applies only to Nx majors newer than the supported ones.`,
            ]),
      ].join("\n"),
    };
  }
  const untested = `nx-rust has not been checked with ${found}: this version of ${packageName} supports ${supportedNx}.`;
  if (allow === "true") {
    return {
      kind: "warning",
      message: [
        untested,
        `It continues because ${allowUnsupportedNxVariable} is true, but nobody has checked its cache keys and batching on Nx ${installed.major}. Use a version of ${packageName} that supports Nx ${installed.major} once there is one.`,
      ].join("\n"),
    };
  }
  return {
    kind: "error",
    message: [
      untested,
      `Use a version of ${packageName} that supports Nx ${installed.major}, or set ${allowUnsupportedNxVariable}=true to try this one with Nx ${installed.major}: nobody has checked its cache keys and batching on that major.`,
      ...(allow === undefined
        ? []
        : [
            `${allowUnsupportedNxVariable} is ${JSON.stringify(allow)}; only the value true turns this error into a warning.`,
          ]),
    ].join("\n"),
  };
}

/** The verdict for the Nx installed in the repository at `workspaceRoot`, under `env`. */
export function nxVerdictFor(workspaceRoot: string, env: NodeJS.ProcessEnv): NxVerdict {
  return nxVerdict(installedNx(workspaceRoot), supportedNxMajors(), env);
}

/**
 * Stops the plugin from loading when the installed Nx is not supported and
 * {@link nxVerdict} gives an error, so that graph creation fails also where
 * Nx calls none of the plugin's hooks. Nx reads the plugin's `createNodes`
 * when it loads the plugin for an entry of `nx.json`, which calls this. A
 * warning is left to {@link checkNxForGraph}, which prints it once per graph
 * computation.
 *
 * The repository is found as Nx finds it from the folder it runs in.
 *
 * @throws {Error} With the message of the error.
 */
// @mara implements DES-DIAGNOSTICS
export function checkNxOnLoad(): void {
  const verdict = nxVerdictFor(nxWorkspaceRoot(process.cwd(), process.env), process.env);
  if (verdict.kind === "error") {
    throw new Error(verdict.message);
  }
}

const warnedComputations = new WeakSet<object>();

/**
 * Checks the installed Nx again for one graph computation, with the
 * environment as it is now: an Nx daemon keeps a loaded plugin when a
 * client's environment changes, and creates the graph again under the new
 * values, so the check made on load does not cover a changed
 * `NX_RUST_ALLOW_UNSUPPORTED_NX`. A warning is printed once per
 * `computation`, which every entry of the plugin in this process shares.
 *
 * @param computation An object that stands for the graph computation.
 * @throws {Error} With the message of an error.
 */
// @mara implements DES-DIAGNOSTICS
export function checkNxForGraph(workspaceRoot: string, computation: object): void {
  const verdict = nxVerdictFor(workspaceRoot, process.env);
  if (verdict.kind === "error") {
    throw new Error(verdict.message);
  }
  if (verdict.kind === "warning" && !warnedComputations.has(computation)) {
    warnedComputations.add(computation);
    console.warn(verdict.message);
  }
}

/**
 * The repository root as Nx 24 finds it from `folder`
 * (`workspaceRootInner` in `nx/src/utils/workspace-root`):
 * `NX_WORKSPACE_ROOT_PATH` when set, otherwise the nearest folder upwards
 * with `nx.json`, `nx` or `nx.bat`, otherwise the topmost folder with an
 * installed `nx` below the first one that has none, otherwise `folder`.
 */
export function nxWorkspaceRoot(folder: string, env: NodeJS.ProcessEnv): string {
  if (env.NX_WORKSPACE_ROOT_PATH) {
    return env.NX_WORKSPACE_ROOT_PATH;
  }
  let candidate = folder;
  for (let dir = folder; ; dir = dirname(dir)) {
    if (["nx.json", "nx", "nx.bat"].some((name) => existsSync(join(dir, name)))) {
      return dir;
    }
    if (existsSync(join(dir, "node_modules", "nx", "package.json"))) {
      candidate = dir;
    }
    if (dirname(dir) === dir) {
      return candidate;
    }
  }
}

function brokenPackage(problem: string): Error {
  return new Error(
    `${packageName} cannot tell which Nx versions it supports: ${problem}. Reinstall the package, and if that does not help, please report this at https://github.com/convesoft/nx-rust/issues.`,
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
