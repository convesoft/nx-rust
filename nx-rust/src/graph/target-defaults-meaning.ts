import type { NxJsonConfiguration, ProjectConfiguration, TargetConfiguration } from "@nx/devkit";
import type { CargoProject } from "./projects";
import { canonical, isGlobPattern, isRecord } from "./target-defaults-layers";

/** The lists among the checked target fields, whose meaning another layer must not narrow. */
export const listFields = ["inputs", "outputs", "dependsOn"] as const;
export type ListField = (typeof listFields)[number];

/**
 * An inferred target whose `inputs`, `outputs` or `dependsOn` mean less
 * than the plugin declared, by a lost entry, an added negated pattern or a
 * named input defined anew, where neither a `targetDefaults` entry nor the
 * `project.json` or `package.json` in the project's folder did it, as
 * another plugin can (`DES-TARGET-DEFAULT-GUARD`, "Other layers").
 */
export interface OtherLayerLoss {
  target: string;
  project: string;
  manifest: string;
  /** The project's folder, relative to the repository root. */
  root: string;
  /** By field, the declared entries that the merged target lacks. */
  lost: Partial<Record<ListField, unknown[]>>;
  /** By field, the entries that another layer added and that leave files out, such as `!` patterns. */
  leavesOut?: Partial<Record<"inputs" | "outputs", unknown[]>>;
  /** The named inputs that the target reads and that another layer defines anew, so that they mean less. */
  namedInputs?: RedefinedInput[];
}

/** A named input of a project that another layer defines anew, so that it means less. */
export interface RedefinedInput {
  name: string;
  /** Its definition in the merged project. */
  definition: unknown;
  /** What its expansion lacks against the definition that the plugin and the project's own files give. */
  lost: unknown[];
  /** The negated patterns that its expansion holds and that definition does not. */
  leavesOut: unknown[];
}

/** A target with the named inputs of its project, as Nx's task hasher reads them. */
export interface TargetMeaning {
  target: TargetConfiguration;
  named: Record<string, unknown[]>;
}

/** What one list of a merged target lacks or leaves out against what is expected of it. */
export interface Weakening {
  /** Entries of the expected list, `inputs` expanded, that the merged one lacks. */
  lost: unknown[];
  /** Negated patterns of the merged list, `inputs` expanded, that the expected one lacks. */
  leavesOut: unknown[];
}

/** The inputs of a target without `inputs` (`DEFAULT_INPUTS` in Nx's task hasher). */
const defaultInputs: unknown[] = [{ input: "default" }, { dependencies: true, input: "default" }];

/**
 * A project's named inputs as Nx's task hasher reads them (`getNamedInputs`
 * in `nx/src/hasher/task-hasher.js`): Nx's built-in `default`, replaced by
 * a definition in `nx.json`, replaced by the project's own.
 */
export function namedInputsOf(
  nxJson: NxJsonConfiguration,
  project: Record<string, unknown> | undefined,
): Record<string, unknown[]> {
  const named: Record<string, unknown[]> = { default: [{ fileset: "{projectRoot}/**/*" }] };
  for (const definitions of [nxJson.namedInputs, project]) {
    for (const [name, definition] of Object.entries(isRecord(definitions) ? definitions : {})) {
      if (Array.isArray(definition)) {
        named[name] = definition;
      }
    }
  }
  return named;
}

/**
 * Inputs expanded as Nx's task hasher expands a project's own inputs
 * (`splitInputsIntoSelfAndDependencies` and `expandSingleProjectInputs`): a
 * name of a named input, as a string or as `{ "input": name }`, stands for
 * its definition, recursively, and any other string for a file set; an entry
 * for the dependencies or other projects, such as `^default`, which means
 * what those projects define, and every other object stay as written.
 */
function expandInputs(
  inputs: readonly unknown[],
  named: Record<string, unknown[]>,
  chain: readonly string[] = [],
): unknown[] {
  const expanded: unknown[] = [];
  const expand = (name: string, written: unknown) => {
    const definition = named[name];
    if (definition !== undefined && !chain.includes(name)) {
      expanded.push(...expandInputs(definition, named, [...chain, name]));
    } else {
      expanded.push(written);
    }
  };
  for (const input of inputs) {
    if (typeof input === "string") {
      if (input.startsWith("^")) {
        expanded.push(input);
      } else if (named[input] !== undefined) {
        expand(input, input);
      } else {
        expanded.push({ fileset: input });
      }
    } else if (
      isRecord(input) &&
      typeof input.input === "string" &&
      input.dependencies === undefined &&
      input.projects === undefined &&
      input.fileset === undefined
    ) {
      expand(input.input, input);
    } else {
      expanded.push(input);
    }
  }
  return expanded;
}

/** The names of the named inputs that inputs read, directly or through other named inputs. */
function namesRead(inputs: readonly unknown[], named: Record<string, unknown[]>): string[] {
  const names = new Set<string>();
  const walk = (list: readonly unknown[]) => {
    for (const input of list) {
      const name =
        typeof input === "string" && !input.startsWith("^")
          ? input
          : isRecord(input) &&
              typeof input.input === "string" &&
              input.dependencies === undefined &&
              input.projects === undefined
            ? input.input
            : undefined;
      if (name !== undefined && named[name] !== undefined && !names.has(name)) {
        names.add(name);
        walk(named[name]);
      }
    }
  };
  walk(inputs);
  return [...names];
}

// Whether an entry leaves files out: a pattern that starts with `!`, in a
// file set of the project's own or of its dependencies, or among outputs.
function leavesOut(field: "inputs" | "outputs", entry: unknown): boolean {
  if (field === "outputs") {
    return typeof entry === "string" && entry.startsWith("!");
  }
  if (typeof entry === "string") {
    return entry.startsWith("^!");
  }
  return isRecord(entry) && typeof entry.fileset === "string" && entry.fileset.startsWith("!");
}

/**
 * What one list of the merged target means less than the expected one
 * (`DES-TARGET-DEFAULT-GUARD`, "Other layers"): the entries of the expected
 * list that the merged one lacks, and the negated patterns of the merged
 * list that the expected one lacks, `inputs` compared after Nx's expansion
 * with each side's named inputs. An added entry that is no negated pattern
 * only widens: an input only adds to what the key hashes, an output to what
 * Nx stores and restores, and a dependency to the tasks that run first.
 */
export function weakening(
  field: ListField,
  merged: TargetMeaning,
  expected: TargetMeaning,
): Weakening {
  const list = (meaning: TargetMeaning): unknown[] =>
    field === "inputs"
      ? expandInputs(meaning.target.inputs ?? defaultInputs, meaning.named)
      : (meaning.target[field] ?? []);
  const mergedList = list(merged);
  const expectedList = list(expected);
  const inMerged = new Set(mergedList.map(canonical));
  const inExpected = new Set(expectedList.map(canonical));
  return {
    lost: expectedList.filter((entry) => !inMerged.has(canonical(entry))),
    leavesOut:
      field === "dependsOn"
        ? []
        : mergedList.filter(
            (entry) => leavesOut(field, entry) && !inExpected.has(canonical(entry)),
          ),
  };
}

export function isEmptyWeakening({ lost, leavesOut }: Weakening): boolean {
  return lost.length === 0 && leavesOut.length === 0;
}

export function weakeningSize({ lost, leavesOut }: Weakening): number {
  return lost.length + leavesOut.length;
}

/**
 * Adds to `loss` how one list of the merged target means less than the
 * expected one, in the terms in which the layers wrote it: the expected
 * entries whose meaning the merged list lacks, the entries that the merged
 * list adds and that leave files out, and, for `inputs`, the named inputs
 * that the target reads and that the merged project defines so that they
 * mean less. What none of these shows is added as Nx expands it.
 */
export function describeWeakening(
  field: ListField,
  merged: TargetMeaning,
  expected: TargetMeaning,
  loss: Omit<OtherLayerLoss, "target" | "project" | "manifest" | "root">,
): void {
  const whole = weakening(field, merged, expected);
  if (field !== "inputs") {
    if (whole.lost.length > 0) {
      loss.lost[field] = whole.lost;
    }
    if (field === "outputs" && whole.leavesOut.length > 0) {
      loss.leavesOut = { ...loss.leavesOut, outputs: whole.leavesOut };
    }
    return;
  }
  const mergedTop = merged.target.inputs ?? defaultInputs;
  const expectedTop = expected.target.inputs ?? defaultInputs;
  const mergedAll = new Set(expandInputs(mergedTop, merged.named).map(canonical));
  const expectedAll = new Set(expandInputs(expectedTop, expected.named).map(canonical));
  const writtenMerged = new Set(mergedTop.map(canonical));
  const writtenExpected = new Set(expectedTop.map(canonical));
  const lost = expectedTop.filter(
    (entry) =>
      !writtenMerged.has(canonical(entry)) &&
      expandInputs([entry], expected.named).some((part) => !mergedAll.has(canonical(part))),
  );
  const added = mergedTop.filter(
    (entry) =>
      !writtenExpected.has(canonical(entry)) &&
      expandInputs([entry], merged.named).some(
        (part) => leavesOut("inputs", part) && !expectedAll.has(canonical(part)),
      ),
  );
  const redefined: RedefinedInput[] = [];
  for (const name of new Set([
    ...namesRead(mergedTop, merged.named),
    ...namesRead(expectedTop, expected.named),
  ])) {
    if (canonical(merged.named[name]) === canonical(expected.named[name])) {
      continue;
    }
    const meaning = (named: Record<string, unknown[]>): TargetMeaning => ({
      target: { inputs: (named[name] ?? []) as TargetConfiguration["inputs"] },
      named,
    });
    const part = weakening("inputs", meaning(merged.named), meaning(expected.named));
    if (!isEmptyWeakening(part)) {
      redefined.push({
        name,
        definition: merged.named[name] ?? null,
        lost: part.lost,
        leavesOut: part.leavesOut,
      });
    }
  }
  if (lost.length > 0) {
    loss.lost.inputs = lost;
  }
  if (added.length > 0) {
    loss.leavesOut = { ...loss.leavesOut, inputs: added };
  }
  if (redefined.length > 0) {
    loss.namedInputs = [...(loss.namedInputs ?? []), ...redefined];
  }
  if (lost.length === 0 && added.length === 0 && redefined.length === 0) {
    loss.lost.inputs = whole.lost;
    if (whole.leavesOut.length > 0) {
      loss.leavesOut = { ...loss.leavesOut, inputs: whole.leavesOut };
    }
  }
}

/**
 * The project references in the `dependsOn` and `inputs` of a target that
 * the plugin declares, with the names that Nx's merge gives them where that
 * is certain (`EVD-NX-24-PLUGIN-NODES`). Nx replaces each reference with
 * the project that had its name when the plugin's projects were merged,
 * and writes the final name of that project in its place once every layer
 * is merged. A name that the plugin gave one of the projects of this entry
 * had that project then, so it becomes the name under which the merged
 * graph knows the project at that root. Only the forms that Nx renames are
 * renamed: a `projects` string other than `*`, `self` and `dependencies`
 * (`self` and `dependencies` in `inputs`), each element of a `projects`
 * list that is no glob pattern, and a `<project>:<target>` string in
 * `dependsOn` with exactly one colon, for which Nx can find no other
 * reading: neither the string nor its first part names a target of the
 * project itself, and the string names no project. Every other name stays
 * as written, so that a reference that Nx renamed in a way that the plugin
 * cannot prove remains a difference.
 *
 * @param merged The projects as Nx merged them, by name.
 */
export function nxNames(
  projects: readonly CargoProject[],
  merged: Record<string, ProjectConfiguration>,
): (project: CargoProject, target: TargetConfiguration) => TargetConfiguration {
  const byRoot = new Map(Object.values(merged).map((project) => [project.root, project]));
  const finalNames = new Map<string, string>();
  for (const project of projects) {
    const name = byRoot.get(project.root)?.name;
    if (name !== undefined) {
      finalNames.set(project.name, name);
    }
  }
  if ([...finalNames].every(([name, final]) => name === final)) {
    return (_project, target) => target;
  }
  const projectNames = new Set([...Object.keys(merged), ...finalNames.keys()]);
  const renamed = (name: string) => finalNames.get(name) ?? name;
  const listed = (projects: unknown[]) =>
    projects.map((name) =>
      typeof name === "string" && !isGlobPattern(name) ? renamed(name) : name,
    );
  const withProjects = (reference: unknown, kept: readonly string[]): unknown => {
    if (!isRecord(reference) || !("projects" in reference)) {
      return reference;
    }
    const { projects } = reference;
    if (typeof projects === "string") {
      return kept.includes(projects) ? reference : { ...reference, projects: renamed(projects) };
    }
    return Array.isArray(projects) ? { ...reference, projects: listed(projects) } : reference;
  };
  return (project, target) => {
    const ownTargets = new Set([
      ...Object.keys(project.targets),
      ...Object.keys(byRoot.get(project.root)?.targets ?? {}),
    ]);
    const projectTarget = (dependency: string): string => {
      const colon = dependency.indexOf(":");
      if (
        dependency.startsWith("^") ||
        dependency.includes('"') ||
        ownTargets.has(dependency) ||
        colon <= 0 ||
        colon === dependency.length - 1 ||
        dependency.indexOf(":", colon + 1) !== -1 ||
        ownTargets.has(dependency.slice(0, colon)) ||
        projectNames.has(dependency)
      ) {
        return dependency;
      }
      const final = finalNames.get(dependency.slice(0, colon));
      return final === undefined ? dependency : `${final}${dependency.slice(colon)}`;
    };
    return {
      ...target,
      ...(target.dependsOn === undefined
        ? {}
        : {
            dependsOn: target.dependsOn.map((dependency) =>
              typeof dependency === "string"
                ? projectTarget(dependency)
                : (withProjects(dependency, ["*", "self", "dependencies"]) as typeof dependency),
            ),
          }),
      ...(target.inputs === undefined
        ? {}
        : {
            inputs: target.inputs.map(
              (input) => withProjects(input, ["self", "dependencies"]) as typeof input,
            ),
          }),
    };
  };
}
