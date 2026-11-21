import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { hostTriple } from "../cargo/host-triple";
import { describeTriples, pickedTriples } from "../cargo/target-triples";
import { napiBinaryName, napiHeaderFile, napiLoaderFile, napiTypesFile } from "../graph/napi";
import type { TargetCargoMetadata } from "../graph/targets";
import {
  type InstalledNapiCli,
  installedNapiCli,
  loadNapiCli,
  supportedNapiCli,
} from "../tools/napi-cli";
import { missingToolMessage, optionalTools } from "../tools/optional-tools";
import { cargoEnvironment } from "./cargo-invocation";
import { describeList, reportedCdylibFiles } from "./cargo-output";
import { type GroupMember, type LiveOutput, type MemberResult, runGroup } from "./group-run";

/** What a `napi-build` task needs beyond a `build` task, from its checks before cargo. */
export interface NapiTask {
  /** The absolute path of the crate's folder, where the outputs go. */
  crateFolder: string;
  /** The napi CLI that Node resolves from the crate's folder. */
  cli: InstalledNapiCli;
  /** The host triple, for which the compile builds. */
  host: string;
  /** The addon's file name, `<binaryName>.<platform>-<arch>[-<abi>].node`. */
  addon: string;
}

/** Thrown by {@link prepareNapiTask} with the message with which the task fails before cargo. */
export class NapiTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NapiTaskError";
  }
}

/**
 * The checks of a `napi-build` task before cargo runs (`DES-NAPI`, "What
 * the step needs", "Library names"; `DES-DIAGNOSTICS`), in this order:
 *
 * - the crate's library has the file name of another crate's file, which
 *   graph creation records ({@link TargetCargoMetadata.sharedLibrary});
 * - the crate's folder has no `package.json`, from which the napi CLI reads
 *   the crate's `napi` settings;
 * - for a cached task, the settings' `dtsHeaderFile` lies outside the
 *   repository, where Nx cannot hash it, or is not the one that the graph's
 *   inputs hold;
 * - Node resolves no `@napi-rs/cli` from the crate's folder, or one of
 *   another major than 3 or older than 3.4.0 (`ADR-NAPI-RS-3`);
 * - `rustc -vV` names no host triple in the workspace root, or Cargo's
 *   configuration or `CARGO_BUILD_TARGET` picks another triple there:
 *   `napi-build` builds for the host only (`ADR-V1-SCOPE`);
 * - the installed CLI names the addon's file otherwise than the outputs that
 *   graph creation declared, where the target is cached.
 *
 * @param crateFolder The absolute path of the crate's folder.
 * @param cwd The absolute path of the workspace root, where cargo runs.
 * @param cached Whether Nx caches the task, so that its outputs must name the addon.
 * @throws {NapiTaskError} With the message of the first check that fails.
 */
// @mara implements DES-NAPI
// @mara implements DES-DIAGNOSTICS
export function prepareNapiTask(
  task: string,
  crate: string,
  metadata: TargetCargoMetadata,
  crateFolder: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  cached: boolean,
  repositoryRoot = cwd,
): NapiTask {
  if (metadata.sharedLibrary !== undefined) {
    throw new NapiTaskError(
      `${task}: the library of ${crate} has the file name of another crate's library: ${metadata.sharedLibrary}. Cargo builds one file for crates whose libraries share a file name, so that the addon could hold the other crate's functions. The task does not run, so that Nx stores no result for it. Give the crates different [lib] names in their Cargo.toml.`,
    );
  }
  if (!existsSync(join(crateFolder, "package.json"))) {
    throw new NapiTaskError(
      `${task}: the folder of ${crate} has no package.json, from which @napi-rs/cli reads the addon's napi settings, its binaryName among them, as napi build does. Add one, as the napi-rs templates have it, with the package's name and version.`,
    );
  }
  // The header of the type definitions, which the key holds only where it
  // lies inside the repository and the graph names it as the settings do now.
  const header = napiHeaderFile(crateFolder, repositoryRoot);
  if (cached && header !== undefined && isAbsolute(header)) {
    throw new NapiTaskError(
      `${task}: the napi settings in the package.json of ${crate} name the dtsHeaderFile ${header}, which lies outside the repository, so that Nx cannot hash it and could restore index.d.ts with an older header. The task does not run, so that Nx stores no result for it. Move the header file into the repository, or write the header into dtsHeader.`,
    );
  }
  if (cached && header !== metadata.napiHeaderFile) {
    throw new NapiTaskError(
      `${task}: the napi settings in the package.json of ${crate} name the dtsHeaderFile ${header ?? "none"}, but the inputs of the cached napi-build hold ${metadata.napiHeaderFile ?? "none"}, so that its key could miss the header of index.d.ts. The task does not run, so that Nx stores no result for it. Run \`nx reset\` so that Nx creates the project graph again.`,
    );
  }
  const cli = installedNapiCli(crateFolder);
  if (cli === undefined) {
    const tool = optionalTools.find((candidate) => candidate.id === "napi");
    throw new NapiTaskError(
      `${task}: ${tool === undefined ? "@napi-rs/cli is not installed." : missingToolMessage(tool, [`the napi-build target of the crate ${crate}`])}`,
    );
  }
  if (!supportedNapiCli(cli.version)) {
    throw new NapiTaskError(
      `${task}: the installed @napi-rs/cli is ${cli.version}, but napi-build post-processes Node addons with @napi-rs/cli 3, from 3.4.0, the first release that exports every function it calls. Install @napi-rs/cli 3.4.0 or a later 3.x release.`,
    );
  }
  const host = hostTriple(cwd, env);
  if (host === undefined) {
    throw new NapiTaskError(
      `${task}: \`rustc -vV\` names no host triple in the workspace root, and napi-build builds the addon for the host. Make sure that the toolchain that the workspace root selects is installed.`,
    );
  }
  const picked = pickedTriples(cwd, env);
  if (
    picked.kind === "unnamed" ||
    (picked.kind === "triples" && picked.triples.some((triple) => triple !== host))
  ) {
    throw new NapiTaskError(
      `${task}: napi-build builds Node addons for the host, ${host}, only, but Cargo's configuration or CARGO_BUILD_TARGET picks ${describeTriples(picked)} in the workspace root. Cross-compiling Node addons is not part of @convesoft/nx-rust 1; remove the setting for the workspace, or build the addon for other platforms with napi build outside Nx.`,
    );
  }
  let platform: string;
  try {
    platform = loadNapiCli(cli).parseTriple(host).platformArchABI;
  } catch (error) {
    throw new NapiTaskError(
      `${task}: @convesoft/nx-rust cannot load @napi-rs/cli ${cli.version} from ${cli.manifest}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  const addon = `${napiBinaryName(crateFolder)}.${platform}.node`;
  if (cached && metadata.napiAddon !== addon) {
    throw new NapiTaskError(
      `${task}: the installed @napi-rs/cli names the addon ${addon}, but the outputs of the cached napi-build name ${metadata.napiAddon ?? "no addon"}, so that Nx would not store the addon. The task does not run, so that Nx stores no result for it. Run \`nx reset\` so that Nx creates the project graph again.`,
    );
  }
  return { crateFolder, cli, host, addon };
}

/** The crates of a group's closure as `cargo tree` gives them, by their line without the depth. */
interface CrateNode {
  name: string;
  version: string;
  children: Set<string>;
}

/**
 * Runs a group of `napi-build` tasks (`DES-NAPI`): asks `cargo tree` for the
 * crates that the group's command compiles for each addon through normal
 * dependencies, with the group's selection and feature flags; fails the
 * tasks whose closure holds a crate that depends on `napi-derive` of
 * another major than 3; empties the type-definition folder of the group's
 * configuration in Cargo's build directory; runs the group's compile with
 * `NAPI_TYPE_DEF_TMP_FOLDER` set to that folder and `NAPI_FORCE_BUILD_<CRATE>`
 * set to a value of this compile's own for every crate of the closures that
 * depends on `napi-derive` ({@link runGroup}, which runs the checks after
 * cargo of `build`); then, for each task whose crate passed, checks that
 * every crate of its closure that the compile forced wrote its file, and
 * post-processes the library into the addon, its JS loader and its type
 * definitions with the functions of the installed `@napi-rs/cli`.
 *
 * Only this step sets those variables; `build`, `test`, `check` and `lint`
 * run without them, as plain cargo does (`REQ-CARGO-UNCHANGED`,
 * `ADR-NAPI-SHARED-BUILD-DIR`).
 *
 * @returns One result per member, in order.
 */
// @mara implements DES-NAPI
// @mara implements DES-ARTIFACT-STEPS
export async function runNapiGroup(
  members: readonly GroupMember[],
  verbose = false,
  live: LiveOutput = "none",
): Promise<MemberResult[]> {
  const [first] = members;
  if (first === undefined) {
    return [];
  }
  const { cwd } = first.invocation;
  const env = first.prepared.env;
  const results: (MemberResult | undefined)[] = members.map(() => undefined);
  const directories = first.invocation.directories;
  if (directories === undefined) {
    return members.map((member) => ({
      success: false,
      output: `${member.prepared.task}: @convesoft/nx-rust has no report of Cargo's directories for this napi-build group.`,
    }));
  }
  // The compile's arguments without a stage's flags, which change on every
  // run and are no part of the configuration (`DES-BATCH`, "Staged builds").
  const compile = first.invocation.unstagedArgs ?? first.invocation.args;
  const tree = cargoTree(compile, cwd, cargoEnvironment(first.invocation, env));
  if (typeof tree === "string") {
    return members.map((member) => ({
      success: false,
      output: `${member.prepared.task}: @convesoft/nx-rust could not ask cargo tree for the crates that the addon depends on, so it cannot tell which of them write type definitions. The task does not run, so that Nx stores no result for it.\n${tree}`,
    }));
  }
  // Each task's closure and the crates of it that use napi-derive.
  const closures = members.map((member) => {
    const root = [...tree.roots].find((key) => tree.nodes.get(key)?.name === member.prepared.crate);
    return root === undefined ? undefined : closure(tree.nodes, root);
  });
  // The hack crate of cargo-hakari can depend on napi-derive only to unify
  // its features, and has no #[napi] item (`DES-NAPI`).
  const napiCrates = closures.map((keys) =>
    (keys ?? [])
      .map((key) => tree.nodes.get(key) as CrateNode)
      .filter(
        (node) =>
          node.name !== first.prepared.hakariPackage &&
          [...node.children].some((child) => tree.nodes.get(child)?.name === "napi-derive"),
      ),
  );
  members.forEach((member, index) => {
    const keys = closures[index];
    if (keys === undefined) {
      results[index] = {
        success: false,
        output: `${member.prepared.task}: cargo tree does not list ${member.prepared.crate ?? "the crate"} among the crates of this napi-build group, so @convesoft/nx-rust cannot tell which crates write its type definitions. The task does not run, so that Nx stores no result for it.`,
      };
      return;
    }
    const other = napiCrates[index].flatMap((node) =>
      [...node.children]
        .map((child) => tree.nodes.get(child) as CrateNode)
        .filter((child) => child.name === "napi-derive" && !child.version.startsWith("v3."))
        .map((child) => `${node.name} depends on napi-derive ${child.version.slice(1)}`),
    );
    if (other.length > 0) {
      results[index] = {
        success: false,
        output: `${member.prepared.task}: ${describeList(other)}, but napi-build builds Node addons of napi-rs 3, whose crates use napi-derive 3. The task does not run, so that Nx stores no result for it. Upgrade the crates to napi-derive 3 and napi 3.`,
      };
    }
  });
  const running = members.flatMap((member, index) =>
    results[index] === undefined ? [{ member, index }] : [],
  );
  if (running.length > 0) {
    const configuration = join(
      directories.build,
      "nx-rust",
      "napi",
      createHash("sha256")
        .update(JSON.stringify([cwd, compile]))
        .digest("hex")
        .slice(0, 16),
    );
    const types = join(configuration, "types");
    rmSync(types, { recursive: true, force: true });
    mkdirSync(types, { recursive: true });
    const forced = new Set(
      running.flatMap(({ index }) => napiCrates[index].map((node) => node.name)),
    );
    const value = randomUUID();
    const variables: Record<string, string> = { NAPI_TYPE_DEF_TMP_FOLDER: types };
    for (const name of forced) {
      variables[`NAPI_FORCE_BUILD_${name.toUpperCase().replace(/-/g, "_")}`] = value;
    }
    // The compile's output, whose JSON messages report the libraries.
    let compileOutput = "";
    const compiled = await runGroup(
      running.map(({ member }) => ({
        ...member,
        invocation: { ...member.invocation, env: { ...member.invocation.env, ...variables } },
      })),
      verbose,
      live,
      (_step, output) => {
        compileOutput = output;
      },
    );
    const libraries = reportedLibraries(compileOutput);
    for (const [at, { member, index }] of running.entries()) {
      const result = compiled[at];
      if (!result.success) {
        results[index] = result;
        continue;
      }
      const missing = napiCrates[index]
        .map((node) => node.name)
        .filter((name) => !existsSync(join(types, name)));
      if (missing.length > 0) {
        results[index] = {
          success: false,
          output: [
            ...(result.output === "" ? [] : [result.output]),
            missingTypesMessage(member.prepared.task, missing),
          ].join("\n"),
        };
        continue;
      }
      const written = await postProcess(
        member,
        libraries.get(member.invocation.package?.id ?? "") ?? [],
        types,
        join(configuration, "tasks", member.prepared.crate ?? ""),
        napiCrates[index].map((node) => node.name),
      );
      results[index] = {
        success: written.success,
        output: [...(result.output === "" ? [] : [result.output]), written.output].join("\n"),
      };
    }
  }
  return results as MemberResult[];
}

/**
 * The message with which a `napi-build` task fails where crates that the
 * compile forced wrote no type information (`DES-NAPI`, "Every file
 * written"; `DES-DIAGNOSTICS`).
 */
// @mara implements DES-DIAGNOSTICS
function missingTypesMessage(task: string, crates: readonly string[]): string {
  const named = describeList(crates);
  const one = crates.length === 1;
  return `${task}: ${named}, which the addon is or depends on, ${one ? "uses" : "use"} napi-derive but wrote no type information while napi-build compiled ${one ? "it" : "them"}, so napi-build cannot tell which of ${one ? "its" : "their"} #[napi] items the addon has. Either the build script of ${named} does not run napi_build::setup(), which alone lets napi-build compile ${one ? "it" : "them"} again, or ${one ? "it has" : "they have"} no #[napi] item left and should drop ${one ? "its" : "their"} dependency on napi-derive. The task does not run, so that Nx stores no result for it.`;
}

/**
 * The crates of the group's compile by `cargo tree`, with the compile's
 * selection (`--workspace`, or `-p` for each crate under `hakari`, under
 * `cargo` and for a group of one crate), feature flags, the `--config` and
 * `-Z` flags of the `cargo` strategy and `--locked`, through normal
 * dependencies on the host, so that the closure is the one that cargo builds
 * (`DES-NAPI`, "Every napi crate forced"); or cargo's error.
 */
function cargoTree(
  compile: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { nodes: Map<string, CrateNode>; roots: Set<string> } | string {
  const args = ["tree", "-e", "normal", "--prefix", "depth", "-f", "{p}"];
  for (let at = 0; at < compile.length; at++) {
    const word = compile[at];
    if (word === "-p" || word === "--features" || word === "--config") {
      // `--config` carries the `cargo` strategy's feature unification.
      args.push(word, compile[at + 1]);
      at++;
    } else if (
      word.startsWith("-Z") ||
      word === "--workspace" ||
      word === "--all-features" ||
      word === "--no-default-features" ||
      word === "--locked"
    ) {
      args.push(word);
    }
  }
  const run = spawnSync("cargo", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) {
    return `cargo ${args.join(" ")} failed: ${(run.stderr ?? "").trim() || (run.error?.message ?? `status ${run.status}`)}`;
  }
  const nodes = new Map<string, CrateNode>();
  const roots = new Set<string>();
  const stack: string[] = [];
  for (const line of run.stdout.split("\n")) {
    const match = /^(\d+)(\S+) (v\S+)(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const depth = Number(match[1]);
    const key = `${match[2]} ${match[3]}${match[4].replace(/ \(\*\)$/, "").replace(/ \(proc-macro\)/, "")}`;
    if (!nodes.has(key)) {
      nodes.set(key, { name: match[2], version: match[3], children: new Set() });
    }
    stack[depth] = key;
    stack.length = depth + 1;
    if (depth === 0) {
      roots.add(key);
    } else {
      nodes.get(stack[depth - 1])?.children.add(key);
    }
  }
  return { nodes, roots };
}

// Every crate that `root` reaches, itself included, each once.
function closure(nodes: ReadonlyMap<string, CrateNode>, root: string): string[] {
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    for (const child of nodes.get(key)?.children ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

/**
 * The dynamic libraries that cargo's JSON messages report for each package's
 * `cdylib` target, by the package's ID ({@link reportedCdylibFiles}): the
 * files with the extension of a dynamic library, `.so`, `.dylib` or `.dll`.
 * Cargo reports the file where it puts it, in the folder of a triple where
 * one is selected, also the host's (`DES-NAPI`).
 */
export function reportedLibraries(output: string): Map<string, string[]> {
  return reportedCdylibFiles(output, /\.(so|dylib|dll)$/);
}

/**
 * Writes a task's outputs into the crate's folder, as `napi build
 * --platform` writes them (`DES-NAPI`, "Post-processing"): removes the
 * three outputs of an earlier run, copies the library that cargo reported
 * for the crate's `cdylib` in this compile ({@link reportedLibraries}) to the
 * addon's file, failing where it reported none or several, and writes `index.d.ts` and `index.js` with
 * `generateTypeDef` and `writeJsBinding` of the installed `@napi-rs/cli`,
 * with the crate's `napi` settings that `readNapiConfig` reads, from a
 * folder of the task's own that holds only the type information of the
 * crate and of the crates of its closure that use napi-derive.
 */
// @mara implements DES-NAPI
async function postProcess(
  member: GroupMember,
  reported: readonly string[],
  types: string,
  folder: string,
  crates: readonly string[],
): Promise<{ success: boolean; output: string }> {
  const { prepared, invocation } = member;
  const napi = prepared.napi as NapiTask;
  const task = prepared.task;
  const fail = (message: string) => ({
    success: false,
    output: `${task}: ${message} The task does not run, so that Nx stores no result for it.`,
  });
  try {
    const cli = loadNapiCli(napi.cli);
    const config = await cli.readNapiConfig(join(napi.crateFolder, "package.json"));
    const addon = `${config.binaryName}.${cli.parseTriple(napi.host).platformArchABI}.node`;
    if (addon !== napi.addon) {
      return fail(
        `@napi-rs/cli names the addon ${addon}, but napi-build expected ${napi.addon} from the crate's package.json.`,
      );
    }
    for (const file of [napi.addon, napiLoaderFile, napiTypesFile]) {
      rmSync(join(napi.crateFolder, file), { force: true });
    }
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    for (const crate of crates) {
      copyFileSync(join(types, crate), join(folder, crate));
    }
    // The file that cargo reports for the crate's cdylib in this compile,
    // wherever the triple and profile put it.
    if (reported.length !== 1) {
      return fail(
        reported.length === 0
          ? `cargo reported no cdylib library of ${prepared.crate ?? "the crate"} in this compile, so napi-build has no library to copy to the addon. Give the crate's [lib] table crate-type = ["cdylib"].`
          : `cargo reported ${reported.length} cdylib libraries of ${prepared.crate ?? "the crate"} in this compile, ${reported.map((file) => relative(invocation.cwd, file)).join(" and ")}, so napi-build cannot tell which one is the addon.`,
      );
    }
    copyFileSync(reported[0], join(napi.crateFolder, napi.addon));
    const typeDef = (invocation.package?.dependencies ?? []).some(
      (dependency) =>
        dependency.name === "napi-derive" &&
        (dependency.uses_default_features !== false ||
          (dependency.features ?? []).includes("type-def")),
    );
    // As `napi build` orders the WASI flavours of the crate's targets:
    // the threaded one first.
    const wasi = config.targets.filter((target) => target.platform === "wasi");
    const wasiFlavors = [
      ...new Set(
        [
          ...wasi.filter((target) => target.triple === "wasm32-wasip1-threads"),
          ...wasi.filter((target) => target.triple !== "wasm32-wasip1-threads"),
        ].map((target) => target.platformArchABI),
      ),
    ];
    let exports: string[] = [];
    if (typeDef) {
      const generated = await cli.generateTypeDef({
        typeDefDir: folder,
        configDtsHeader: config.dtsHeader,
        configDtsHeaderFile: config.dtsHeaderFile,
        constEnum: config.constEnum,
        runtimeStringEnum: config.runtimeStringEnum,
        cwd: napi.crateFolder,
        declareBindingTarget: (names) => wasiFlavors.length > 0 || names.length > 0,
      });
      writeFileSync(join(napi.crateFolder, napiTypesFile), generated.dts, "utf8");
      exports = generated.exports;
    }
    await cli.writeJsBinding({
      platform: true,
      idents: exports,
      binaryName: config.binaryName,
      packageName: config.packageName,
      version: prepared.env.npm_new_version ?? config.packageJson.version,
      outputDir: napi.crateFolder,
      wasiFlavors,
    });
    const written = [napi.addon, napiLoaderFile, napiTypesFile].filter((name) =>
      existsSync(join(napi.crateFolder, name)),
    );
    return { success: true, output: `${task}: wrote ${describeList(written)}.` };
  } catch (error) {
    return fail(
      `@napi-rs/cli ${napi.cli.version} could not write the addon's files: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}
