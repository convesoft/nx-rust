import type { CreateDependenciesContext } from "@nx/devkit";
import { isDeepStrictEqual } from "node:util";
import { pluginVersionOption } from "../executors/command";
import type { CargoGraph } from "./projects";
import {
  entryName,
  loadTargetDefaultsInternals,
  type OptionOrigin,
  type OptionPlace,
  optionOrigins,
  pluginEntryName,
  type TargetDefaultsContext,
  type TargetDefaultsInternals,
} from "./target-defaults";
import { targetCargoMetadataKey } from "./targets";

/** A `pluginVersion` on an inferred target that the plugin did not give it. */
export interface StrayPluginVersion extends OptionPlace {
  /** The project's name in the merged graph. */
  projectName: string;
}

/**
 * The places where, once Nx has merged `targetDefaults`, `project.json` and
 * `package.json` over the plugin's projects, an inferred target that still
 * runs the plugin's executor holds a `pluginVersion` that the plugin did not
 * give it (`DES-PLUGIN-OPTIONS`): among its options a value other than the
 * plugin's, also where the plugin set none because Nx has a node for its
 * package, and any value in one of its configurations.
 *
 * @param projects The merged projects that `createDependencies` receives.
 */
function strayPluginVersions(
  graph: CargoGraph,
  projects: CreateDependenciesContext["projects"],
): StrayPluginVersion[] {
  const byRoot = new Map(
    Object.entries(projects).map(([name, project]) => [project.root, { name, project }]),
  );
  const stray: StrayPluginVersion[] = [];
  for (const own of graph.projects) {
    const merged = byRoot.get(own.root);
    if (merged === undefined) {
      continue;
    }
    for (const [target, inferred] of Object.entries(own.targets)) {
      const configuration = merged.project.targets?.[target];
      if (
        configuration === undefined ||
        inferred.metadata?.[targetCargoMetadataKey] === undefined ||
        configuration.executor !== inferred.executor
      ) {
        continue;
      }
      const place = { project: own, projectName: merged.name, target, option: pluginVersionOption };
      if (differs(configuration.options, inferred.options)) {
        stray.push(place);
      }
      for (const [name, values] of Object.entries(configuration.configurations ?? {})) {
        if (differs(values, inferred.configurations?.[name])) {
          stray.push({ ...place, configuration: name });
        }
      }
    }
  }
  return stray;
}

/**
 * Fails graph creation where {@link strayPluginVersions} finds a value, with
 * one paragraph per place it comes from: the `project.json` or `package.json`
 * in the project's folder or the `targetDefaults` entry, where the layers
 * that the plugin rebuilds with Nx's own code show it ({@link optionOrigins}),
 * and otherwise the command that shows Nx's own record.
 *
 * @param plugin Nx's copy of the plugin for the entry, whose `name` Nx set
 *   to the name it knows the entry by.
 * @param loadInternals Loads Nx's internal parts, only when a value is found.
 * @throws {Error} Naming each place, target and project.
 */
// @mara implements DES-PLUGIN-OPTIONS
export async function failOnPluginVersionOption(
  graph: CargoGraph,
  context: TargetDefaultsContext,
  plugin: unknown,
  loadInternals: () => TargetDefaultsInternals = () =>
    loadTargetDefaultsInternals(context.workspaceRoot),
): Promise<void> {
  const stray = strayPluginVersions(graph, context.projects);
  if (stray.length === 0) {
    return;
  }
  const origins = await optionOrigins(stray, context, pluginEntryName(plugin), loadInternals());
  throw new Error(describeStrayPluginVersions(stray, origins));
}

const reason =
  "Only nx-rust sets this option: it carries the plugin's version into the cache key, and another value would take its place, so that Nx could restore results of another version of the plugin.";

/**
 * The message for {@link failOnPluginVersionOption}: one paragraph per
 * origin, listing the targets it reaches by project, and one paragraph for
 * the targets whose origin the plugin cannot tell.
 *
 * @param origins The origin of each value, in the order of `stray`.
 */
function describeStrayPluginVersions(
  stray: readonly StrayPluginVersion[],
  origins: readonly (OptionOrigin | undefined)[],
): string {
  const groups = new Map<string, { origin?: OptionOrigin; places: StrayPluginVersion[] }>();
  stray.forEach((place, index) => {
    const origin = origins[index];
    const id = origin === undefined ? "" : JSON.stringify(origin);
    const group = groups.get(id) ?? { origin, places: [] };
    group.places.push(place);
    groups.set(id, group);
  });
  const known = [...groups.values()]
    .filter((group): group is { origin: OptionOrigin; places: StrayPluginVersion[] } =>
      Boolean(group.origin),
    )
    .map(({ origin, places }) => ({ name: originName(origin), places }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, places }) =>
      [
        `${name} sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:`,
        ...byProject(places),
      ].join("\n"),
    );
  const unknown = groups.get("")?.places ?? [];
  return [
    ...known,
    ...(unknown.length === 0
      ? []
      : [
          [
            `These targets that nx-rust infers have the option "pluginVersion", and nx-rust cannot tell which configuration sets it, such as another plugin listed in nx.json. ${reason} For each, run the command given, look under "sourceMap" for the file and entry, and remove it there:`,
            ...unknown.map(
              (place) =>
                `  - ${targetName(place)} of ${projectName(place)}: \`nx show target ${place.projectName}:${place.target} --json\``,
            ),
          ].join("\n"),
        ]),
  ].join("\n\n");
}

// Whether `merged` holds a pluginVersion other than the one in `own`, which
// is what the plugin set at that place, if anything.
function differs(
  merged: Record<string, unknown> | undefined,
  own: Record<string, unknown> | undefined,
): boolean {
  return (
    merged !== undefined &&
    merged !== null &&
    Object.prototype.hasOwnProperty.call(merged, pluginVersionOption) &&
    !isDeepStrictEqual(merged[pluginVersionOption], own?.[pluginVersionOption])
  );
}

function originName(origin: OptionOrigin): string {
  if ("file" in origin) {
    return `The file ${origin.file}`;
  }
  const name = entryName(origin);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

// `"test"`, or `"test" (configuration "ci")`.
function targetName({ target, configuration }: StrayPluginVersion): string {
  return configuration === undefined
    ? `"${target}"`
    : `"${target}" (configuration "${configuration}")`;
}

// `api (rust/crates/api/Cargo.toml)`
function projectName({ projectName, project }: StrayPluginVersion): string {
  return `${projectName} (${project.manifest})`;
}

// One line per project, in the order found, that names its targets.
function byProject(places: readonly StrayPluginVersion[]): string[] {
  const projects = new Map<string, string[]>();
  for (const place of places) {
    const id = projectName(place);
    projects.set(id, [...(projects.get(id) ?? []), targetName(place)]);
  }
  return [...projects].map(([project, targets]) => `  - ${project}: ${list(targets)}`);
}

// "a", "a and b", "a, b and c"
function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
