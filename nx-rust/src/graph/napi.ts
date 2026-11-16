import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hostTriple } from "../cargo/host-triple";
import { type ArtifactSubject, producesArtifact, shellQuote } from "./artifact-kinds";
import type { CargoWorkspace } from "./discovery";

/** The npm package of the napi CLI, whose exported functions post-process an addon (`DES-NAPI`). */
export const napiCliPackage = "@napi-rs/cli";

/** The file that `napi-build` writes the JS loader to, as `napi build --platform` does. */
export const napiLoaderFile = "index.js";

/** The file that `napi-build` writes the type definitions to, as `napi build --platform` does. */
export const napiTypesFile = "index.d.ts";

/** What graph creation knows of a crate that produces a Node addon. */
export interface NapiAddon {
  /**
   * The addon's file, `<binaryName>.<platform>-<arch>[-<abi>].node`, in the
   * crate's folder; absent where rustc names no host triple, so that the
   * plugin cannot name it.
   */
  addon?: string;
  /** The host triple that the addon's file name comes from. */
  host?: string;
}

/** What the inference reads of a project to tell whether it produces a Node addon. */
export type NapiSubject = ArtifactSubject;

/**
 * Whether a crate produces a Node addon (`DES-ARTIFACT-STEPS`): its library
 * target has the crate type `cdylib` and it depends directly, through a
 * normal dependency, on the package `napi`, also one declared for one
 * platform only. An `artifacts` list in the crate's `[package.metadata.nx]`
 * replaces the inference.
 */
export function producesNodeAddon(subject: NapiSubject): boolean {
  return producesArtifact(subject, "napi");
}

/**
 * The `binaryName` of the crate's napi settings, as `readNapiConfig` of
 * `@napi-rs/cli` 3 reads it from the `package.json` in the crate's folder:
 * `napi.binaryName`, else the deprecated `napi.name`, else `index`, also
 * where the file is missing or no JSON (`DES-NAPI`).
 */
export function napiBinaryName(crateFolder: string): string {
  try {
    const json = JSON.parse(readFileSync(join(crateFolder, "package.json"), "utf8")) as {
      napi?: { binaryName?: unknown; name?: unknown };
    };
    const napi = json?.napi;
    if (typeof napi?.name === "string" && napi.name !== "") {
      return napi.name;
    }
    if (typeof napi?.binaryName === "string" && napi.binaryName !== "") {
      return napi.binaryName;
    }
  } catch {
    // The task fails with a message where it cannot read the settings.
  }
  return "index";
}

/**
 * The file that the crate's napi settings name as `napi.dtsHeaderFile` in its
 * `package.json`, which `generateTypeDef` of `@napi-rs/cli` 3 reads from the
 * crate's folder for the header of `index.d.ts`: relative to the repository
 * root where it lies inside it, absolute where it lies outside; `undefined`
 * where the settings name none (`DES-NAPI`).
 */
export function napiHeaderFile(crateFolder: string, repositoryRoot: string): string | undefined {
  let file: unknown;
  try {
    file = (
      JSON.parse(readFileSync(join(crateFolder, "package.json"), "utf8")) as {
        napi?: { dtsHeaderFile?: unknown };
      }
    )?.napi?.dtsHeaderFile;
  } catch {
    return undefined;
  }
  if (typeof file !== "string" || file === "") {
    return undefined;
  }
  const path = resolve(crateFolder, file);
  const inside = relative(repositoryRoot, path);
  return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)
    ? path
    : inside.split(sep).join("/");
}

/** The CPU names of `parseTriple` in `@napi-rs/cli` 3, by the first part of a triple. */
const nodeArchitectures: Readonly<Record<string, string>> = {
  x86_64: "x64",
  aarch64: "arm64",
  i686: "ia32",
  armv7: "arm",
  loongarch64: "loong64",
  riscv64gc: "riscv64",
  powerpc64le: "ppc64",
  powerpc64: "ppc64",
};

/** The platform names of `parseTriple` in `@napi-rs/cli` 3, by a triple's system. */
const nodePlatforms: Readonly<Record<string, string>> = {
  linux: "linux",
  freebsd: "freebsd",
  darwin: "darwin",
  windows: "win32",
  ohos: "openharmony",
};

/**
 * The `<platform>-<arch>[-<abi>]` part of an addon's file name for a triple,
 * as `parseTriple` of `@napi-rs/cli` 3 gives it, such as `linux-x64-gnu` for
 * `x86_64-unknown-linux-gnu` and `darwin-arm64` for `aarch64-apple-darwin`.
 * The executor compares it with what the installed CLI gives and fails a
 * task where they differ, so that Nx never stores the addon under a name
 * that the outputs do not declare.
 */
export function platformArchAbi(triple: string): string {
  const parts = (triple.endsWith("eabi") ? `${triple.slice(0, -4)}-eabi` : triple).split("-");
  let cpu: string;
  let sys: string;
  let abi: string | undefined;
  if (parts.length === 2) {
    [cpu, sys] = parts;
  } else {
    [cpu, , sys, abi] = parts;
  }
  if (abi === "android" || abi === "ohos") {
    sys = abi;
    abi = undefined;
  }
  const platform = nodePlatforms[sys] ?? sys;
  const arch = nodeArchitectures[cpu] ?? cpu;
  return abi === undefined || abi === "" ? `${platform}-${arch}` : `${platform}-${arch}-${abi}`;
}

/** The host triple of each workspace root, asked once per graph computation. */
const hosts = new WeakMap<object, Map<string, string | undefined>>();

/**
 * What graph creation knows of the crate's Node addon ({@link NapiAddon}):
 * the addon's file name from the crate's napi settings and the host triple
 * that `rustc -vV` names in the workspace root, where the compile runs.
 *
 * @param memo An object that lives as long as one graph computation, such as
 *   its cache context, under which the host triple of each workspace is asked
 *   once.
 */
export function napiAddon(
  subject: NapiSubject & { workspace: CargoWorkspace },
  memo: object,
): NapiAddon {
  const root = subject.workspace.report.workspace_root;
  let known = hosts.get(memo);
  if (known === undefined) {
    known = new Map();
    hosts.set(memo, known);
  }
  if (!known.has(root)) {
    known.set(root, hostTriple(root, process.env));
  }
  const host = known.get(root);
  if (host === undefined || subject.pkg === undefined) {
    return {};
  }
  const binaryName = napiBinaryName(dirname(subject.pkg.manifest_path));
  return { addon: `${binaryName}.${platformArchAbi(host)}.node`, host };
}

/**
 * The files that `napi-build` writes into the crate's folder, which are its
 * outputs and no input of the crate's targets (`DES-ARTIFACT-STEPS`): the
 * addon, the JS loader and the type definitions.
 */
export function napiOutputFiles(addon: NapiAddon): string[] {
  return [...(addon.addon === undefined ? [] : [addon.addon]), napiLoaderFile, napiTypesFile];
}

/**
 * The plugin's script that prints the napi CLI of a crate
 * (`print-napi-cli.ts`), compiled beside this module's folder.
 */
const napiCliScript = join(__dirname, "..", "tools", "print-napi-cli.js");

/**
 * The inputs that `napi-build` has beside those of `build` (`DES-INPUTS`,
 * `REQ-ARTIFACT-CACHE`):
 *
 * - a `runtime` input whose command runs the plugin's own script in the
 *   repository root with the crate's folder as its argument, which prints the
 *   version of the `@napi-rs/cli` that Node resolves from that folder, the one
 *   that the task post-processes with. The command names Node, the script and
 *   the folder by paths that reach no key, as the artifact folder input of
 *   `build` does. Where the script cannot run, as for a plugin that Nx loads
 *   from its TypeScript source, it prints a random value instead, new at each
 *   evaluation, so that no stored result is restored;
 * - `npm_new_version`, which the CLI's `napi build` writes into the loader in
 *   place of the version in `package.json`, as `napi-build` does;
 * - the file that the crate's napi settings name as `dtsHeaderFile`
 *   ({@link napiHeaderFile}), where it lies inside the repository, as a
 *   fileset that also covers an ignored file. One outside the repository,
 *   which Nx cannot hash, makes the task fail before cargo instead.
 *
 * Every other setting that shapes the three files is in the crate's
 * `package.json`, a crate file.
 *
 * The host triple, which names the addon's file, is in the key through the
 * toolchain input, which prints what `rustc -Vv` writes, `host:` included.
 *
 * @param root The crate's folder, relative to the repository root.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-ARTIFACT-CACHE
export function napiInputs(
  root: string,
  header?: string,
  script = napiCliScript,
): ({ runtime: string } | { env: string } | { fileset: string; includeIgnored: true })[] {
  const command = [
    `{ ${shellQuote(process.execPath)} ${shellQuote(script)} ${shellQuote(root)} 2>/dev/null || od -An -N16 -tx1 /dev/urandom; }`,
    "true",
  ].join("; ");
  return [
    { env: "npm_new_version" },
    { runtime: command },
    ...(header === undefined || isAbsolute(header)
      ? []
      : [{ fileset: `{workspaceRoot}/${header}`, includeIgnored: true as const }]),
  ];
}
