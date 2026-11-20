import type { ProjectGraph } from "@nx/devkit";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import {
  loadHashPlanInspector,
  loadNxNative,
  loadTaskHasher,
  loadWorkspaceContext,
  type MatchGlobPaths,
  NxBridgeError,
  type NxHashPlanInspector,
  type NxTaskHasher,
} from "../compatibility/nx-bridge";
import { NxTaskFilesError, toTaskFilesError } from "./nx-task-files";

// Which `test` tasks have a path among their inputs (`DES-TEST-RUN`, step 2;
// `DES-INPUTS`), from the installed Nx: its `HashPlanInspector` lists the
// files of a task's key with Nx's own matching, dependency sources reached
// through `^` included. A path that no longer exists, a deleted file or the
// old path of a rename, is in no such list; it is placed with Nx's own
// expansion of the task's inputs and Nx's native glob matcher, which the
// plugin trusts only where that expansion gives every task exactly the
// files that the inspector lists.

/** The inputs of one task as far as step 2 and the context check need them. */
export interface TaskInputs {
  /** The files of the task's key, relative to the repository root. */
  files: ReadonlySet<string>;
  /** The environment variables of the task's key. */
  environment: readonly string[];
  /** The commands of the task's runtime inputs, as Nx runs them. */
  runtime: readonly string[];
}

/** What step 2 asks of the tasks' inputs. */
export interface InputPlacement {
  /** The inputs of each inspected project's `test`, by project name. */
  inputs: ReadonlyMap<string, TaskInputs>;
  /**
   * The projects whose `test` has `path`, relative to the repository root,
   * among its inputs, or `undefined` where the plugin cannot tell.
   */
  owners(path: string): string[] | undefined;
}

/**
 * The inputs of the `test` targets of `projects`, under the name `target`
 * that the plugin's options give them (`targetNames`), and how to place a path
 * among them, from the installed Nx, in this process and without the daemon.
 *
 * @throws {NxTaskFilesError} When the installed Nx lacks a part, or a part
 *   gives a result of another shape.
 */
// @mara implements DES-TEST-RUN
export async function inputPlacement(
  root: string,
  projectGraph: ProjectGraph,
  nxJson: unknown,
  projects: readonly string[],
  target: string,
): Promise<InputPlacement> {
  let Inspector: new (...args: unknown[]) => NxHashPlanInspector;
  try {
    Inspector = loadHashPlanInspector(root).HashPlanInspector;
  } catch (error) {
    if (error instanceof NxBridgeError) {
      throw toTaskFilesError(error);
    }
    throw error;
  }
  const inspector = new Inspector(projectGraph, root, nxJson);
  await inspector.init();
  const inputs = new Map<string, TaskInputs>();
  for (const project of projects) {
    let inspected: ReturnType<NxHashPlanInspector["inspectTaskInputs"]>;
    try {
      inspected = inspector.inspectTaskInputs({ project, target }, {}, {}, true);
    } catch (error) {
      throw new NxTaskFilesError(
        `HashPlanInspector of the installed Nx cannot inspect ${project}:${target} (${(error instanceof Error ? error.message : String(error)).split("\n")[0]})`,
      );
    }
    const entry = inspected?.[`${project}:${target}`] as
      | { files?: unknown; environment?: unknown; runtime?: unknown }
      | undefined;
    const files = entry?.files;
    const environment = entry?.environment ?? [];
    const runtime = entry?.runtime ?? [];
    if (!isStringList(files) || !isStringList(environment) || !isStringList(runtime)) {
      throw new NxTaskFilesError(
        `the inputs that HashPlanInspector of the installed Nx gives for ${project}:${target} hold no list of files, variables or commands`,
      );
    }
    inputs.set(project, { files: new Set(files), environment, runtime });
  }
  let globs: { placement: GlobPlacement | undefined } | undefined;
  return {
    inputs,
    owners(path) {
      if (existsOnDisk(join(root, path))) {
        return projects.filter((project) => inputs.get(project)?.files.has(path) === true);
      }
      globs ??= { placement: globPlacement(root, projectGraph, nxJson, projects, inputs, target) };
      return globs.placement?.owners(path);
    },
  };
}

function existsOnDisk(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return existsSync(path);
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The globs of each task's inputs, by the project whose files they match. */
interface GlobPlacement {
  owners(path: string): string[] | undefined;
}

/** A set of filesets that applies to one project's files, or to the workspace's. */
interface FilesetGroup {
  /** The project whose files `{projectRoot}` patterns match; `undefined` for workspace patterns. */
  project?: string;
  positive: string[];
  negative: string[];
}

/**
 * Places paths with Nx's own expansion of each task's inputs
 * (`getInputs`, `expandSingleProjectInputs` and `expandNamedInput` of its
 * task hasher) and its native glob matcher, where that expansion gives every
 * task exactly the files that `inspected` lists for it; `undefined`
 * otherwise, so that the group runs its full suite.
 */
function globPlacement(
  root: string,
  graph: ProjectGraph,
  nxJson: unknown,
  projects: readonly string[],
  inspected: ReadonlyMap<string, TaskInputs>,
  target: string,
): GlobPlacement | undefined {
  let hasher: NxTaskHasher;
  let match: MatchGlobPaths;
  let all: string[];
  try {
    hasher = loadTaskHasher(root);
    match = loadNxNative(root).matchGlobPaths;
    const { globWithWorkspaceContextSync: glob } = loadWorkspaceContext(root, [
      "globWithWorkspaceContextSync",
    ]);
    const files = glob(root, ["**/*"]);
    if (!isStringList(files)) {
      return undefined;
    }
    all = files;
  } catch {
    return undefined;
  }
  const roots = Object.entries(graph.nodes)
    .map(([name, node]) => ({ name, root: normalizeRoot(node.data.root) }))
    .sort((a, b) => b.root.length - a.root.length);
  const ownerOf = (path: string): string | undefined =>
    roots.find(({ root: folder }) => folder === "" || path.startsWith(`${folder}/`))?.name;
  const groups = new Map<string, FilesetGroup[]>();
  try {
    for (const project of projects) {
      const resolved = filesetGroups(project, graph, nxJson, hasher, target);
      if (resolved === undefined) {
        return undefined;
      }
      groups.set(project, resolved);
    }
  } catch {
    return undefined;
  }
  const matches = (group: FilesetGroup, paths: string[]): boolean[] => {
    const projectRoot =
      group.project === undefined ? "" : normalizeRoot(graph.nodes[group.project]?.data.root ?? "");
    const expand = (pattern: string) => expandPattern(pattern, projectRoot);
    const positive = group.positive.map(expand);
    const negative = group.negative.map(expand);
    const candidates = paths.map(
      (path) => group.project === undefined || ownerOf(path) === group.project,
    );
    const hit = positive.length === 0 ? paths.map(() => true) : match(positive, paths);
    const excluded = negative.length === 0 ? paths.map(() => false) : match(negative, paths);
    return paths.map((_, index) => candidates[index] && hit[index] && !excluded[index]);
  };
  // The expansion counts only where it gives each task the inspector's files.
  const everyFile = new Set(all);
  for (const project of projects) {
    const expected = inspected.get(project)?.files ?? new Set<string>();
    const found = new Set<string>();
    for (const group of groups.get(project) ?? []) {
      matches(group, all).forEach((hit, index) => {
        if (hit) {
          found.add(all[index]);
        }
      });
    }
    // Files that only an `includeIgnored` fileset adds are not among Nx's
    // own files; the group runs its full suite for such a file anyway. Nx
    // adds files of the repository root to every task, such as `nx.json`,
    // `.gitignore` and the root tsconfig, which no input names.
    const visible = [...expected].filter((file) => everyFile.has(file));
    if (
      ![...found].every((file) => expected.has(file)) ||
      !visible.every((file) => found.has(file) || !file.includes("/"))
    ) {
      return undefined;
    }
  }
  return {
    owners(path) {
      // A file of the repository root may be one that Nx adds to every task.
      if (!path.includes("/")) {
        return [...projects];
      }
      return projects.filter((project) =>
        (groups.get(project) ?? []).some((group) => matches(group, [path])[0]),
      );
    },
  };
}

/**
 * The filesets of a project's `test` inputs and of the dependencies that its
 * `^` inputs reach, transitively, as Nx expands them; `undefined` for an
 * input that names other projects, which the plugin does not resolve.
 */
function filesetGroups(
  project: string,
  graph: ProjectGraph,
  nxJson: unknown,
  hasher: NxTaskHasher,
  target: string,
): FilesetGroup[] | undefined {
  const node = graph.nodes[project];
  if (node === undefined) {
    return undefined;
  }
  const inputs = hasher.getInputs({ target: { project, target } }, graph, nxJson);
  if (inputs.projectInputs.length > 0) {
    return undefined;
  }
  const groups: FilesetGroup[] = [];
  const add = (owner: string, expanded: unknown[]): boolean => {
    const own: FilesetGroup = { project: owner, positive: [], negative: [] };
    const workspace: FilesetGroup = { positive: [], negative: [] };
    for (const entry of expanded) {
      const fileset =
        typeof entry === "string"
          ? entry
          : typeof entry === "object" && entry !== null && "fileset" in entry
            ? (entry as { fileset: unknown }).fileset
            : undefined;
      if (fileset === undefined) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          ["env", "runtime", "externalDependencies", "dependentTasksOutputFiles"].some(
            (key) => key in entry,
          )
        ) {
          continue;
        }
        return false;
      }
      if (typeof fileset !== "string") {
        return false;
      }
      const negated = fileset.startsWith("!");
      const pattern = negated ? fileset.slice(1) : fileset;
      const target = pattern.startsWith("{workspaceRoot}") ? workspace : own;
      (negated ? target.negative : target.positive).push(pattern);
    }
    for (const group of [own, workspace]) {
      if (group.positive.length > 0) {
        groups.push(group);
      }
    }
    return true;
  };
  const named = (name: string) => hasher.getNamedInputs(nxJson, graph.nodes[name]);
  if (!add(project, hasher.expandSingleProjectInputs(inputs.selfInputs, named(project)))) {
    return undefined;
  }
  for (const dependency of dependenciesOf(project, graph)) {
    for (const input of inputs.depsInputs) {
      const definitions = named(dependency);
      if (definitions[input.input] === undefined) {
        continue;
      }
      if (!add(dependency, hasher.expandNamedInput(input.input, definitions))) {
        return undefined;
      }
    }
    if (
      !add(
        dependency,
        inputs.depsFilesets.map((entry) => ({ fileset: entry.fileset })),
      )
    ) {
      return undefined;
    }
  }
  return groups;
}

// The projects that `project` depends on in the project graph, transitively,
// without external nodes.
function dependenciesOf(project: string, graph: ProjectGraph): string[] {
  const seen = new Set<string>();
  const visit = (name: string) => {
    for (const edge of graph.dependencies[name] ?? []) {
      if (
        graph.nodes[edge.target] !== undefined &&
        !seen.has(edge.target) &&
        edge.target !== project
      ) {
        seen.add(edge.target);
        visit(edge.target);
      }
    }
  };
  visit(project);
  return [...seen];
}

function normalizeRoot(root: string): string {
  return root === "." ? "" : root.replace(/\/$/, "");
}

// A fileset's pattern with `{projectRoot}` and `{workspaceRoot}` replaced,
// relative to the repository root.
function expandPattern(pattern: string, projectRoot: string): string {
  return pattern
    .replace(/^\{workspaceRoot\}\/?/, "")
    .replace(/^\{projectRoot\}\/?/, projectRoot === "" ? "" : `${projectRoot}/`);
}
