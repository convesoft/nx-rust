import type { CargoInvocation } from "../executors/cargo-invocation";
import {
  lookupArguments,
  lookUp,
  type Lookup,
  probeRegistry,
  refusedPublishList,
  refusedReplacedCratesIo,
  type Registry,
  registryFromProbe,
  registryKey,
  registryNamed,
  shownLabel,
} from "./publish-cargo";
import { type Crate, folderLabel, relativePath, type Runner, type Target } from "./publish-crates";
import { dotenvOrigins, type DotenvStore, dotenvValue } from "./publish-environments";
import { replacedCratesIoAdvice } from "./publish-messages";

/** Cached target-registry probes and version lookups for one publish run. */
export interface RegistryStore {
  readonly root: string;
  readonly announce?: (tasks: string, invocation: CargoInvocation) => Promise<void>;
  readonly targets: Map<string, Promise<Target>>;
  readonly probes: Map<string, Promise<Target>>;
  /** Lookups that found their version, which a later call cannot take back. */
  readonly found: Set<string>;
}

export function createRegistryStore(
  root: string,
  announce?: (tasks: string, invocation: CargoInvocation) => Promise<void>,
): RegistryStore {
  return {
    root,
    ...(announce === undefined ? {} : { announce }),
    targets: new Map(),
    probes: new Map(),
    found: new Set(),
  };
}

/**
 * The target registry of `crate` for commands with `task`'s environment
 * (`DES-RELEASE`, "Target registry"): the name in `CARGO_REGISTRY_DEFAULT`,
 * without a probe, where it holds one; otherwise what the probe shows, as
 * the crate's `publish` list allows it.
 */
export function targetOf(
  store: RegistryStore,
  dotenvStore: DotenvStore,
  crate: Crate,
  task: Runner,
): Promise<Target> {
  const key = [crate.folder, task.envKey].join("\u0000");
  let target = store.targets.get(key);
  if (target === undefined) {
    target = findTarget(store, dotenvStore, crate, task);
    store.targets.set(key, target);
  }
  return target;
}

async function findTarget(
  store: RegistryStore,
  dotenvStore: DotenvStore,
  crate: Crate,
  task: Runner,
): Promise<Target> {
  const list = crate.publish;
  const listText = list === null ? "" : JSON.stringify(list);
  const named = task.env.CARGO_REGISTRY_DEFAULT;
  if (named !== undefined && named !== "") {
    if (list !== null && !list.includes(named)) {
      return {
        kind: "unknown",
        reason: `CARGO_REGISTRY_DEFAULT names the registry \`${named}\`, which the publish list of ${crate.name} in ${relativePath(store.root, crate.manifest)}, ${listText}, leaves out, so cargo would refuse to publish it, and in a call with other crates the whole call. Nothing was uploaded for ${crate.name}. Add "${named}" to the list, or publish ${crate.name} in a run with CARGO_REGISTRY_DEFAULT set to an entry of the list, or without it.`,
      };
    }
    const file = dotenvOrigins(dotenvStore, task.task).get("CARGO_REGISTRY_DEFAULT");
    const fromFile =
      file !== undefined && dotenvValue(dotenvStore, task.task, "CARGO_REGISTRY_DEFAULT") === named;
    return {
      kind: "registry",
      registry: registryNamed(named),
      source: `which CARGO_REGISTRY_DEFAULT chooses in the environment of ${task.label}${fromFile ? `, set by ${file}` : ""}`,
    };
  }
  // One probe per workspace, environment and publish value.
  const probeKey = [crate.workspaceRoot, task.envKey, listText].join("\u0000");
  let probePromise = store.probes.get(probeKey);
  if (probePromise === undefined) {
    probePromise = probe(store, crate, task);
    store.probes.set(probeKey, probePromise);
  }
  const result = await probePromise;
  return result.kind === "unknown"
    ? { kind: "unknown", reason: result.reason.split("{crate}").join(crate.name) }
    : result;
}

async function probe(store: RegistryStore, crate: Crate, task: Runner): Promise<Target> {
  const cwd = crate.workspaceRoot;
  const list = crate.publish;
  const announce = store.announce;
  if (announce !== undefined) {
    await announce(task.label, {
      args: ["publish", "--dry-run", "--no-verify", "--locked", "-p", crate.name],
      cwd,
    });
  }
  const result = await probeRegistry(crate.name, cwd, task.env);
  if (result.kind === "failed" || refusedPublishList(result.output)) {
    return {
      kind: "unknown",
      reason: [
        `cargo could not tell which registry it would publish {crate} to, so @convesoft/nx-rust does not publish it, and nothing was uploaded for it. \`cargo publish --dry-run --no-verify --locked -p ${crate.name}\`, run in ${folderLabel(store.root, cwd)}, printed:`,
        result.output.trimEnd(),
        refusedReplacedCratesIo(result.output)
          ? replacedCratesIoAdvice("{crate}")
          : `Choose the registry as for plain cargo publish: set \`publish = ["<name>"]\` in the crate's Cargo.toml, \`registry.default\` in .cargo/config.toml, or CARGO_REGISTRY_DEFAULT=<name> for one run.`,
      ].join("\n"),
    };
  }
  const shown = result.shown;
  const registry = registryFromProbe(list, shown);
  if (registry !== undefined) {
    return {
      kind: "registry",
      registry,
      source:
        list !== null && list.length === 1
          ? `which the publish list of ${crate.name} in ${relativePath(store.root, crate.manifest)} chooses`
          : `which cargo chooses for it in the folder ${relativePath(store.root, cwd)}, by registry.default in its Cargo configuration${list === null ? "" : ` from the publish list of ${crate.name}`}`,
    };
  }
  if (list !== null && list.length > 1) {
    return {
      kind: "unknown",
      reason: `the publish list of {crate} in ${relativePath(store.root, crate.manifest)}, ${JSON.stringify(list)}, holds several registries, and cargo showed ${shownLabel(shown)} for the registry it would publish to, which no entry of the list names, so @convesoft/nx-rust cannot tell which registry that is and publishes nothing for {crate}. Configure each registry under one name, the same in every Cargo workspace and without a source replacement, and choose the entry with registry.default in .cargo/config.toml or with CARGO_REGISTRY_DEFAULT.`,
    };
  }
  return {
    kind: "unknown",
    reason: `cargo showed ${shownLabel(shown)} for the registry it would publish {crate} to, which names no registry, so @convesoft/nx-rust publishes nothing for {crate}. Configure the registry under one name, without a source replacement, and publish online.`,
  };
}

/**
 * Looks `crate`'s version up in `registry`, started in the root of the
 * crate's Cargo workspace with `task`'s environment (`DES-RELEASE`,
 * "Lookups"). A version once found is not asked again.
 */
export async function lookupVersion(
  store: RegistryStore,
  crate: Crate,
  registry: Registry,
  task: Runner,
  label = task.label,
): Promise<Lookup> {
  const key = lookupKey(crate, registry, task.envKey);
  if (store.found.has(key)) {
    return { kind: "found" };
  }
  await store.announce?.(label, {
    args: lookupArguments(crate.name, crate.version, registry),
    cwd: crate.workspaceRoot,
  });
  const result = await lookUp(crate.name, crate.version, registry, crate.workspaceRoot, task.env);
  if (result.kind === "found") {
    store.found.add(key);
  }
  return result;
}

function lookupKey(crate: Crate, registry: Registry, envKey: string): string {
  return [crate.folder, crate.version, registryKey(registry), envKey].join("\u0000");
}
