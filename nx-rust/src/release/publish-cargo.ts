import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CargoInvocation } from "../executors/cargo-invocation";

/**
 * A registry that cargo publishes to or looks a version up in: crates.io, or
 * a registry by the name that the Cargo configuration gives it.
 */
export type Registry = { kind: "crates-io" } | { kind: "named"; name: string };

/** crates.io. */
export const cratesIo: Registry = { kind: "crates-io" };

/**
 * The index that a lookup on crates.io names, in place of `--registry`,
 * because `cargo info` without either describes a workspace's own crate of
 * that name on Cargo 1.100, and `--registry crates-io` is never passed
 * (`DES-RELEASE`, "Lookups").
 */
export const cratesIoIndexArgument = "sparse+https://index.crates.io/";

/** The index URLs by which `cargo metadata` names crates.io for a dependency (`EVD-CARGO-PUBLISH-REGISTRIES`). */
const cratesIoIndexUrls = new Set([
  "https://github.com/rust-lang/crates.io-index",
  "sparse+https://index.crates.io/",
]);

/** The registry that a name in a `publish` list or in `CARGO_REGISTRY_DEFAULT` gives. */
export function registryNamed(name: string): Registry {
  return name === "crates-io" ? cratesIo : { kind: "named", name };
}

/** Whether the index URL that the report gives a dependency is crates.io's; `null` counts as crates.io. */
export function isCratesIoIndex(url: string | null | undefined): boolean {
  return url === null || url === undefined || cratesIoIndexUrls.has(url);
}

/** Whether two registries are the same by kind and name. */
export function sameRegistry(a: Registry, b: Registry): boolean {
  return a.kind === b.kind && (a.kind === "crates-io" || a.name === (b as { name: string }).name);
}

/** How a message names a registry: crates.io, or `` the registry `<name>` ``. */
export function registryLabel(registry: Registry): string {
  return registry.kind === "crates-io" ? "crates.io" : `the registry \`${registry.name}\``;
}

/** A stable key of a registry, for maps. */
export function registryKey(registry: Registry): string {
  return registry.kind === "crates-io" ? "crates-io" : `named:${registry.name}`;
}

/** What a cargo command that the executor ran printed, and how it ended. */
export interface CapturedCargo {
  /** The arguments after `cargo`. */
  args: string[];
  /** The exit status, `null` where a signal stopped it or it did not start. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Standard output and error in the order in which they arrived. */
  output: string;
}

/**
 * Runs cargo with `args` in `cwd` with `env`, without a terminal, and
 * collects what it prints (`DES-INVOCATION`: the task's environment, passed
 * on unchanged apart from what the invocation sets).
 */
export function runCapturedCargo(
  invocation: CargoInvocation,
  env: NodeJS.ProcessEnv,
): Promise<CapturedCargo> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let output = "";
    const child = spawn("cargo", invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env === undefined ? env : { ...env, ...invocation.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      output += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      const message =
        error.code === "ENOENT"
          ? `cargo was not found on PATH (${error.message})`
          : `cargo could not be started: ${error.message}`;
      resolve({
        args: invocation.args,
        status: null,
        stdout,
        stderr: `${stderr}${message}\n`,
        output: `${output}${message}\n`,
      });
    });
    child.on("close", (status, signal) => {
      const stopped = signal === null ? "" : `cargo was stopped by ${signal}\n`;
      resolve({
        args: invocation.args,
        status,
        stdout,
        stderr: `${stderr}${stopped}`,
        output: `${output}${stopped}`,
      });
    });
  });
}

/**
 * What the first line of cargo's output that starts with `Updating` shows
 * about the registry that cargo asked: ``Updating `<name>` index``, a named
 * registry or source; `Updating crates.io index`; another text; or no such
 * line (`EVD-CARGO-PUBLISH-REGISTRIES`, "The first line").
 */
export type ShownRegistry =
  | { kind: "crates-io" }
  | { kind: "named"; name: string }
  | { kind: "other"; line: string }
  | { kind: "none" };

/** What the first `Updating` line of `stderr`, where cargo writes its status lines, shows. */
// @mara implements DES-RELEASE
export function shownRegistry(stderr: string): ShownRegistry {
  const line = stderr
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => /^Updating\b/.test(candidate));
  if (line === undefined) {
    return { kind: "none" };
  }
  if (line === "Updating crates.io index") {
    return { kind: "crates-io" };
  }
  const named = /^Updating `([^`]+)` index$/.exec(line);
  return named === null ? { kind: "other", line } : { kind: "named", name: named[1] };
}

/** How a message names what cargo showed in place of a registry. */
export function shownLabel(shown: ShownRegistry): string {
  switch (shown.kind) {
    case "crates-io":
      return "crates.io";
    case "named":
      return `\`${shown.name}\``;
    case "other":
      return `"${shown.line}"`;
    case "none":
      return "no line that starts with Updating";
  }
}

/** Whether what cargo showed names `registry` exactly as the executor passed it. */
export function showsRegistry(shown: ShownRegistry, registry: Registry): boolean {
  return registry.kind === "crates-io"
    ? shown.kind === "crates-io"
    : shown.kind === "named" && shown.name === registry.name;
}

/**
 * The registry that the executor names to cargo for a crate with the
 * `publish` list `list`, after the probe showed `shown` (`DES-RELEASE`,
 * "Target registry"): for a one-entry list its entry, which cargo has
 * accepted once the line appears; for a list of several entries the entry
 * that the line names literally, `crates-io` for crates.io; without a list
 * the registry that the line shows. `undefined` where none of these holds,
 * so that the crate fails.
 */
// @mara implements DES-RELEASE
export function registryFromProbe(
  list: readonly string[] | null,
  shown: ShownRegistry,
): Registry | undefined {
  if (list !== null && list.length === 1) {
    return registryNamed(list[0]);
  }
  if (list !== null && list.length > 1) {
    const entry = list.find((candidate) => showsRegistry(shown, registryNamed(candidate)));
    return entry === undefined ? undefined : registryNamed(entry);
  }
  if (shown.kind === "crates-io") {
    return cratesIo;
  }
  return shown.kind === "named" ? registryNamed(shown.name) : undefined;
}

/** The outcome of a lookup of a crate's version in a registry (`DES-RELEASE`, "Lookups"). */
export type Lookup =
  | { kind: "found" }
  | { kind: "missing" }
  /** The lookup's output does not establish that it asked the registry as passed. */
  | { kind: "unestablished"; shown: string; command: string; output: string }
  /** Cargo failed otherwise, such as on an unreachable registry. */
  | { kind: "failed"; command: string; output: string };

/**
 * The arguments of the lookup of `crate@version` in `registry`:
 * `cargo info <crate>@<version> --registry <name> --locked`, or with
 * `--index sparse+https://index.crates.io/` for crates.io, never with
 * `--offline` (`DES-RELEASE`, "Lookups").
 */
export function lookupArguments(crate: string, version: string, registry: Registry): string[] {
  return [
    "info",
    `${crate}@${version}`,
    ...(registry.kind === "crates-io"
      ? ["--index", cratesIoIndexArgument]
      : ["--registry", registry.name]),
    "--locked",
  ];
}

/**
 * Reads a lookup's outcome from what cargo printed: the source is
 * established only where the first `Updating` line names the registry as
 * passed and, for a version found in a named registry, the `version:` line
 * says ``from registry `<name>` `` with the same name. Then exit status 0
 * means found, 101 with "could not find `<crate>@<version>`" missing, and
 * anything else a failure with cargo's message (`DES-RELEASE`, "Lookups").
 */
// @mara implements DES-RELEASE
export function readLookup(
  crate: string,
  version: string,
  registry: Registry,
  run: Pick<CapturedCargo, "status" | "stdout" | "stderr" | "output">,
): Lookup {
  const command = `cargo ${lookupArguments(crate, version, registry).join(" ")}`;
  const shown = shownRegistry(run.stderr);
  if (!showsRegistry(shown, registry)) {
    // What cargo printed in place of the registry.
    return { kind: "unestablished", shown: shownLabel(shown), command, output: run.output };
  }
  if (run.status === 0) {
    if (registry.kind === "named") {
      const line = run.stdout
        .split("\n")
        .map((candidate) => candidate.trim())
        .find((candidate) => candidate.startsWith("version:"));
      const from = line === undefined ? null : /\(from registry `([^`]+)`\)/.exec(line);
      if (from === null || from[1] !== registry.name) {
        return {
          kind: "unestablished",
          shown: from === null ? `"${line ?? "no version: line"}"` : `\`${from[1]}\``,
          command,
          output: run.output,
        };
      }
    }
    return { kind: "found" };
  }
  if (run.status === 101 && run.output.includes(`could not find \`${crate}@${version}\``)) {
    return { kind: "missing" };
  }
  return { kind: "failed", command, output: run.output };
}

/** Looks `crate@version` up in `registry`, started in `cwd`, the root of the crate's Cargo workspace. */
export async function lookUp(
  crate: string,
  version: string,
  registry: Registry,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Lookup> {
  const run = await runCapturedCargo({ args: lookupArguments(crate, version, registry), cwd }, env);
  return readLookup(crate, version, registry, run);
}

/** The outcome of the probe that asks cargo which registry it would publish a crate to. */
export type Probe =
  | { kind: "shown"; shown: ShownRegistry; output: string }
  | { kind: "failed"; output: string };

/** The arguments of the probe for `crate` (`DES-RELEASE`, "Target registry"). */
export function probeArguments(crate: string): string[] {
  return ["publish", "--dry-run", "--no-verify", "--locked", "-p", crate];
}

/**
 * Asks cargo which registry it would publish `crate` to, with
 * `cargo publish --dry-run --no-verify --locked -p <crate>` started in the
 * workspace root `cwd`, with `CARGO_TARGET_DIR` and `CARGO_BUILD_BUILD_DIR`
 * naming a new folder of the plugin's own in the system's folder for
 * temporary files, which it removes afterwards: cargo writes the packaged
 * crate into its build directory and overwrites what lies there, files that
 * the repository tracks included (`DES-RELEASE`, "Target registry";
 * `EVD-CARGO-PUBLISH-REGISTRIES`). The first `Updating` line shows the
 * registry, also where cargo goes on to fail; without one, cargo could not
 * choose, and its output says why.
 */
// @mara implements DES-RELEASE
export async function probeRegistry(
  crate: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Probe> {
  const folder = mkdtempSync(join(tmpdir(), "nx-rust-probe-"));
  try {
    const run = await runCapturedCargo(
      {
        args: probeArguments(crate),
        cwd,
        env: { CARGO_TARGET_DIR: folder, CARGO_BUILD_BUILD_DIR: folder },
      },
      env,
    );
    const shown = shownRegistry(run.stderr);
    return shown.kind === "none"
      ? { kind: "failed", output: run.output }
      : { kind: "shown", shown, output: run.output };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * The arguments of one publish call: `cargo publish --locked` with
 * `--dry-run` for a dry run, `--registry <name>` for a named registry and
 * none for crates.io, never `--registry crates-io`, no token and no
 * `--allow-dirty`, and a `-p` with the real package name of each crate
 * (`DES-RELEASE`, "Batch", "Target registry", "Tracked files").
 */
export function publishArguments(
  crates: readonly string[],
  registry: Registry,
  dryRun: boolean,
): string[] {
  return [
    "publish",
    ...(dryRun ? ["--dry-run"] : []),
    "--locked",
    ...(registry.kind === "named" ? ["--registry", registry.name] : []),
    ...crates.flatMap((crate) => ["-p", crate]),
  ];
}

/** A crate as {@link uploadedCrates} and {@link verifiedCrates} key it: `<name>@<version>`. */
export function crateKey(name: string, version: string): string {
  return `${name}@${version}`;
}

/** The crates whose upload cargo's output shows, ``Uploaded <name> v<version> to …``, by {@link crateKey}. */
export function uploadedCrates(output: string): Set<string> {
  const uploaded = new Set<string>();
  for (const match of output.matchAll(/^\s*Uploaded (\S+) v(\S+) to /gm)) {
    uploaded.add(crateKey(match[1], match[2]));
  }
  return uploaded;
}

/**
 * The crates whose verification cargo's output shows complete, by
 * {@link crateKey} (`DES-RELEASE`, "Batch": a task passes only where cargo's
 * output shows that its crate passed): a `Verifying <name> v<version>` line
 * followed, before the next `Verifying` line, by a `Finished` line, which
 * cargo prints once the crate's verification build has succeeded; and a
 * crate whose `Uploading <name> v<version>` line cargo reached, which it does
 * only after it has verified every crate of the call. Where verification
 * fails, cargo prints its errors and no `Finished` line for that crate, and
 * stops before the crates after it.
 */
// @mara implements DES-RELEASE
export function verifiedCrates(output: string): Set<string> {
  const verified = new Set<string>();
  let current: string | undefined;
  for (const line of output.split("\n")) {
    const verifying = /^\s*Verifying (\S+) v(\S+)/.exec(line);
    if (verifying !== null) {
      current = crateKey(verifying[1], verifying[2]);
      continue;
    }
    if (current !== undefined && /^\s*Finished /.test(line)) {
      verified.add(current);
      current = undefined;
      continue;
    }
    const uploading = /^\s*Uploading (\S+) v(\S+)/.exec(line);
    if (uploading !== null) {
      verified.add(crateKey(uploading[1], uploading[2]));
    }
  }
  return verified;
}

/** Whether cargo refused to update a stale `Cargo.lock` under `--locked`, in the wording of 1.91 and of later versions. */
export function refusedStaleLockfile(output: string): boolean {
  return (
    output.includes("because --locked was passed to prevent this") ||
    output.includes("but --locked was passed to prevent this")
  );
}

/** Whether cargo refused to publish uncommitted changes. */
export function refusedUncommittedChanges(output: string): boolean {
  return /contain changes that were not yet committed into git/.test(output);
}

/**
 * Whether cargo refused a crate because the registry that it would publish
 * to is not in the crate's `publish` list, as where `registry.default` in a
 * configuration file wins over the list (`EVD-CARGO-PUBLISH-REGISTRIES`).
 */
export function refusedPublishList(output: string): boolean {
  return /is not listed in the `package\.publish` value/.test(output);
}

/** Whether cargo refused to choose crates.io because the configuration replaces it. */
export function refusedReplacedCratesIo(output: string): boolean {
  return /crates-io is replaced with/.test(output);
}
