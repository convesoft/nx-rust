import type { NxJsonConfiguration } from "@nx/devkit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CargoProject } from "./projects";
import {
  appliedElements,
  type AppliedEntry,
  canonical,
  compare,
  includes,
  isInferred,
  isRecord,
  loadTargetDefaultsInternals,
  otherSourcePlugins,
  pluginEntryNameIn,
  rebuild,
  rebuildLayers,
  spread,
  type TargetDefaultsContext,
  type TargetDefaultsInternals,
} from "./target-defaults-layers";

/**
 * What the `targetDefaults` of `nx.json` add to the `dependsOn` of each
 * project's inferred targets, as far as `createNodes` can see it: the
 * cause of the warning of `DES-TARGET-DEFAULT-GUARD` for an entry that adds
 * dependencies on other projects' tasks, which the digest of the project's
 * warnings covers (`DES-DIAGNOSTICS`, "Warnings where they are seen").
 * `createDependencies` finds the warning itself, once Nx has merged the
 * projects of every plugin, too late to change a key.
 *
 * The inferred targets are rebuilt as `findTargetDefaultChanges`
 * rebuilds them, from the layers that `createNodes` sees: the projects of
 * this entry, the elements of `targetDefaults` that Nx's synthesis lays over
 * them, once for each plugin that may be the source of the targets, which
 * `createNodes` cannot see either ({@link otherSourcePlugins}), and what
 * Nx's default plugins make of the `package.json` and `project.json` on disk
 * in each project's folder. A `dependsOn` entry counts where a rebuild with
 * the `targetDefaults` layer has it and the rebuild without it does not,
 * unless its form shows that it reaches only the project's own tasks
 * ({@link reachesOnlyOwnTasks}). An element whose filter names a tag, which
 * `createNodes` cannot decide, counts wherever its key can reach the target
 * ({@link undecidedCauses}). A target whose executor the folder's files
 * replace is left out, as the check leaves it, and so is an extra target.
 * Nothing is loaded without an entry that sets `dependsOn`; where Nx lacks
 * the internal parts, nothing counts, and `createDependencies` fails graph
 * creation where such an entry changes a target of the plugin.
 *
 * @returns By project root, one line for each target that entries add such
 *   dependencies to, naming the target, the entry and what it adds.
 */
// @mara implements DES-TARGET-DEFAULT-GUARD
export async function targetDefaultCauses(
  projects: readonly CargoProject[],
  nxJson: NxJsonConfiguration | undefined,
  workspaceRoot: string,
  loadInternals: () => TargetDefaultsInternals = () => loadTargetDefaultsInternals(workspaceRoot),
): Promise<Map<string, string[]>> {
  const causes = new Map<string, string[]>();
  const targetDefaults: unknown = nxJson?.targetDefaults;
  if (
    projects.length === 0 ||
    !isRecord(targetDefaults) ||
    !Object.values(targetDefaults).some(setsDependsOn)
  ) {
    return causes;
  }
  let nx: TargetDefaultsInternals;
  try {
    nx = loadInternals();
  } catch {
    return causes;
  }
  const roots = projects.map(({ root }) => root);
  const files = [
    ...new Set([
      ...roots.flatMap((root) =>
        ["package.json", "project.json"].map((name) => (root === "." ? name : `${root}/${name}`)),
      ),
      "package.json",
    ]),
  ].filter((file) => existsSync(join(workspaceRoot, file)));
  const context: TargetDefaultsContext = {
    projects: {},
    nxJsonConfiguration: nxJson ?? {},
    workspaceRoot,
    fileMap: { projectFileMap: {}, nonProjectFiles: files.map((file) => ({ file, hash: "" })) },
  };
  const plugin = pluginEntryNameIn(nxJson, workspaceRoot);
  const layers = await rebuildLayers(nx, projects, plugin, context, roots, {
    otherSources: otherSourcePlugins(targetDefaults, plugin, nxJson ?? {}, workspaceRoot),
  });
  const applied = layers.mayApply.map((results) => appliedElements(results, targetDefaults));
  for (const project of projects) {
    const withoutDefaults = rebuild(nx, layers, project.root, undefined);
    // For each plugin that may be the source of the project's targets.
    const sources = layers.mayApply.map((results, index) => ({
      rebuilt: rebuild(nx, layers, project.root, results),
      byTarget: applied[index].get(project.root),
    }));
    const [primary] = sources;
    const names = [
      project.name,
      ...(primary.rebuilt.name === undefined ? [] : [primary.rebuilt.name]),
    ];
    const lines = new Set<string>();
    for (const [name, inferred] of Object.entries(project.targets).sort(([a], [b]) =>
      compare(a, b),
    )) {
      if (!isInferred(inferred)) {
        continue;
      }
      for (const { rebuilt, byTarget } of sources) {
        const target = rebuilt.targets?.[name];
        if (target === undefined || target.executor !== inferred.executor) {
          continue;
        }
        const entry = byTarget?.get(name);
        if (entry !== undefined) {
          const without = withoutDefaults.targets?.[name] ?? {};
          const added = (target.dependsOn ?? []).filter(
            (dependency) =>
              dependency !== spread &&
              !includes(without.dependsOn, dependency) &&
              !reachesOnlyOwnTasks(dependency, names),
          );
          if (added.length > 0) {
            lines.add(
              canonical({ target: name, key: entry.key, elements: entry.indices ?? null, added }),
            );
          }
        }
      }
      const target = primary.rebuilt.targets?.[name];
      if (target === undefined || target.executor !== inferred.executor) {
        continue;
      }
      for (const cause of undecidedCauses(
        targetDefaults,
        name,
        inferred.executor,
        primary.byTarget?.get(name),
        names,
        nx,
      )) {
        lines.add(canonical({ target: name, ...cause }));
      }
    }
    if (lines.size > 0) {
      causes.set(project.root, [...lines]);
    }
  }
  return causes;
}

/**
 * The elements of `targetDefaults` whose `filter` `createNodes` cannot
 * decide for a target, because its `projects` names a tag, which another
 * plugin may give the project, and that add dependencies which may reach
 * other projects' tasks: each counts as a cause for every target that its
 * key can reach, by the target's executor, its name or a glob, unless Nx's
 * synthesis applied it already. That errs towards a run without a warning,
 * never towards a cache hit that shows an earlier state of the warning
 * (`DES-TARGET-DEFAULT-GUARD`).
 *
 * @param applied The elements that Nx's synthesis laid over the target.
 */
function undecidedCauses(
  targetDefaults: Record<string, unknown>,
  target: string,
  executor: string | undefined,
  applied: AppliedEntry | undefined,
  names: readonly string[],
  nx: TargetDefaultsInternals,
): { key: string; elements: number[] | null; added: unknown[] }[] {
  const causes: { key: string; elements: number[] | null; added: unknown[] }[] = [];
  for (const [key, value] of Object.entries(targetDefaults)) {
    if (!nx.keyMayApply(key, target, executor)) {
      continue;
    }
    const elements: [unknown, number | undefined][] = Array.isArray(value)
      ? value.map((element, index) => [element, index])
      : [[value, undefined]];
    for (const [element, index] of elements) {
      if (!isRecord(element) || !namesTag(element.filter)) {
        continue;
      }
      const appliedAlready =
        applied?.key === key &&
        (index === undefined ? applied.indices === undefined : applied.indices?.includes(index));
      const dependsOn: unknown[] = Array.isArray(element.dependsOn) ? element.dependsOn : [];
      const added = dependsOn.filter(
        (dependency) => dependency !== spread && !reachesOnlyOwnTasks(dependency, names),
      );
      if (!appliedAlready && added.length > 0) {
        causes.push({ key, elements: index === undefined ? null : [index], added });
      }
    }
  }
  return causes;
}

// Whether an entry's filter selects projects by a tag, also through `!`,
// which `createNodes` cannot decide: another plugin may add the tag.
function namesTag(filter: unknown): boolean {
  if (!isRecord(filter) || filter.projects === undefined) {
    return false;
  }
  const patterns: unknown[] = Array.isArray(filter.projects) ? filter.projects : [filter.projects];
  return patterns.some((pattern) => typeof pattern === "string" && /^!?tag:/.test(pattern));
}

// Whether a value of targetDefaults, an entry or a list of entries, sets dependsOn.
function setsDependsOn(value: unknown): boolean {
  return Array.isArray(value)
    ? value.some((element) => isRecord(element) && "dependsOn" in element)
    : isRecord(value) && "dependsOn" in value;
}

/**
 * Whether a `dependsOn` entry reaches only tasks of the project itself, as
 * far as its form shows without the names of other plugins' projects: a
 * target name without `^` and without another project before a colon, or
 * an object without `dependencies: true` whose `projects` is absent,
 * `"self"`, or only the project's own names.
 *
 * @param names The project's names: the one the plugin gives it, and the
 *   one that a file in its folder gives it.
 */
function reachesOnlyOwnTasks(dependency: unknown, names: readonly string[]): boolean {
  if (typeof dependency === "string") {
    if (dependency.startsWith("^")) {
      return false;
    }
    const colon = dependency.indexOf(":");
    return colon === -1 || names.includes(dependency.slice(0, colon));
  }
  if (!isRecord(dependency) || dependency.dependencies === true) {
    return false;
  }
  const projects = dependency.projects;
  if (projects === undefined) {
    return true;
  }
  const listed = typeof projects === "string" ? [projects] : projects;
  return (
    Array.isArray(listed) &&
    listed.every((name) => name === "self" || (typeof name === "string" && names.includes(name)))
  );
}
