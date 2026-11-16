import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The napi CLI that a crate's `napi-build` uses. */
export interface InstalledNapiCli {
  /** The absolute path of the package's `package.json`. */
  manifest: string;
  /** The package's version, such as `3.10.12`. */
  version: string;
}

/**
 * The package `@napi-rs/cli` as Node resolves it from `folder`, the crate's
 * folder, through the `node_modules` folders from there up to the file
 * system's root, as the workspace's package manager installs it for the
 * crate's own `package.json` or for the repository; `undefined` where
 * none is installed or its `package.json` names no version.
 */
export function installedNapiCli(folder: string): InstalledNapiCli | undefined {
  let manifest: string;
  try {
    manifest = createRequire(join(folder, "package.json")).resolve("@napi-rs/cli/package.json");
  } catch {
    return undefined;
  }
  try {
    const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version;
    return typeof version === "string" && version !== "" ? { manifest, version } : undefined;
  } catch {
    return undefined;
  }
}

/** The CLI's exported functions that `napi-build` calls (`DES-NAPI`, `EVD-NAPI-POSTPROCESS`). */
export interface NapiCliFunctions {
  readNapiConfig(
    path: string,
    configPath?: string,
  ): Promise<{
    binaryName: string;
    packageName: string;
    dtsHeader?: string;
    dtsHeaderFile?: string;
    constEnum?: boolean;
    runtimeStringEnum?: boolean;
    targets: { platform: string; platformArchABI: string; triple: string }[];
    packageJson: { version: string };
  }>;
  parseTriple(triple: string): { platformArchABI: string; platform: string };
  generateTypeDef(options: {
    typeDefDir: string;
    cwd: string;
    configDtsHeader?: string;
    configDtsHeaderFile?: string;
    constEnum?: boolean;
    runtimeStringEnum?: boolean;
    declareBindingTarget?: (exports: readonly string[]) => boolean;
  }): Promise<{ exports: string[]; dts: string }>;
  writeJsBinding(options: {
    platform: boolean;
    idents: string[];
    binaryName: string;
    packageName: string;
    version: string;
    outputDir: string;
    wasiFlavors?: string[];
  }): Promise<unknown>;
}

/**
 * Loads the CLI's CommonJS entry point, which every release from 3.4.0 has,
 * and returns its functions, or throws where one is missing.
 */
export function loadNapiCli(cli: InstalledNapiCli): NapiCliFunctions {
  const loaded = createRequire(cli.manifest)(dirname(cli.manifest)) as Partial<NapiCliFunctions>;
  for (const name of [
    "readNapiConfig",
    "parseTriple",
    "generateTypeDef",
    "writeJsBinding",
  ] as const) {
    if (typeof loaded[name] !== "function") {
      throw new Error(`@napi-rs/cli ${cli.version} exports no function ${name}`);
    }
  }
  return loaded as NapiCliFunctions;
}

/**
 * Whether `napi-build` supports a version of `@napi-rs/cli`: major 3, from
 * 3.4.0, the first release that exports every function it calls
 * (`ADR-NAPI-RS-3`).
 */
export function supportedNapiCli(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match === null) {
    return false;
  }
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major === 3 && minor >= 4;
}
