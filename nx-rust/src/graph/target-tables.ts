import type { CreateDependenciesContext, TargetConfiguration } from "@nx/devkit";
import { nxGraphInternals } from "./nx-internals";
import type { CargoGraph } from "./projects";
import { ProjectSettings, TargetTable, targetHeader } from "./settings";
import type { TargetNames } from "./options";
import { cargoExecutor, inferredTargetNames, targetCargoMetadataKey } from "./targets";

/** What laying the target tables over a project's targets needs to know about the project. */
export interface TableSubject {
  settings: ProjectSettings;
}

/**
 * Lays the `targets.<name>` tables of each project's metadata tables over
 * its inferred targets, which already have the names that `targetNames`
 * gives them, in the order of precedence: the workspace table's, then the
 * crate's own. Each table is merged by Nx's own rule for laying one
 * configuration of a target over another, as Nx lays a `project.json` over a
 * plugin's target. A table under a name that no inferred target of the
 * project has defines an extra target, apart from one in the workspace table
 * under the final name of a target that the plugin infers for some projects
 * (`inferredTargetNames`, after `targetNames`): that table applies only to
 * the members that have the inferred target and creates nothing on the
 * others, so that a workspace's `bench` table gives a crate without benches
 * no target.
 *
 * Every table is checked against the target it lays itself over by
 * {@link tableProblems} first.
 *
 * @param workspaceRoot The repository root, from which Nx's merge is loaded.
 * @param targetNames The names that the plugin options give the inferred targets.
 * @returns Each project's targets, in the order of `projects`.
 * @throws {Error} Naming every manifest, target and field that breaks a rule.
 */
// @mara implements DES-PLUGIN-OPTIONS
// @mara implements DES-METADATA-TABLES
export function applyTargetTables(
  projects: readonly { project: TableSubject; targets: Record<string, TargetConfiguration> }[],
  workspaceRoot: string,
  targetNames: TargetNames,
): Record<string, TargetConfiguration>[] {
  if (projects.every(({ project }) => project.settings.targets.length === 0)) {
    return projects.map(({ targets }) => targets);
  }
  const { mergeTargetConfigurations } = nxGraphInternals(workspaceRoot);
  const inferredNames = new Set<string>(
    inferredTargetNames.map((name) => targetNames[name] ?? name),
  );
  // One message per problem, also for a workspace table that every member has.
  const problems = new Set<string>();
  const merged = projects.map(({ project, targets }) => {
    const result = { ...targets };
    for (const table of project.settings.targets) {
      const inferred = targets[table.name];
      if (
        inferred === undefined &&
        table.table === "[workspace.metadata.nx]" &&
        inferredNames.has(table.name)
      ) {
        continue;
      }
      for (const problem of tableProblems(table, inferred, project.settings)) {
        problems.add(problem);
      }
      // A copy for each project, so that no two projects share an object Nx may change.
      result[table.name] = mergeTargetConfigurations(
        structuredClone(table.target),
        result[table.name],
        undefined,
        undefined,
        undefined,
        false,
      );
    }
    return result;
  });
  if (problems.size > 0) {
    throw new Error([...problems].join("\n"));
  }
  return merged;
}

/**
 * What is wrong with one target table, each problem a message that names
 * the manifest and the table. This is the one place where a table is checked
 * against the target it addresses, before it is merged.
 *
 * On an inferred target, a table may not set `inputs` without `"..."`, a
 * different `executor` or a `command`, and `affectedTests = true` among the
 * options or in a configuration of `test` requires a workspace that uses
 * the selection of affected tests. A table under a name that the project
 * has no inferred target for defines an extra target, which may run
 * anything; one that names an executor of the plugin fails when its task
 * starts (`DES-TARGETS`).
 *
 * The check of the keys under `options` and `configurations` against the
 * `properties` of the executor's schema (`REQ-UNKNOWN-METADATA-OPTIONS`,
 * nxr-95kg91) belongs here as well.
 *
 * @param inferred The inferred target under the table's name, if the project has one.
 */
function tableProblems(
  table: TargetTable,
  inferred: TargetConfiguration | undefined,
  settings: ProjectSettings,
): string[] {
  if (inferred === undefined) {
    return [];
  }
  const { target, manifest, name } = table;
  const header = targetHeader(table.table, name);
  const problems: string[] = [];
  if (
    target.inputs !== undefined &&
    !(Array.isArray(target.inputs) && target.inputs.includes("..."))
  ) {
    problems.push(
      `${manifest}: ${header} sets "inputs" without "..." on the inferred target "${name}". The list would replace the inferred inputs, and the cache key would lose the toolchain, the environment and the files of the crate's dependencies. Put "..." where the inferred inputs belong, such as inputs = ["...", { env = "DATABASE_URL" }].`,
    );
  }
  if (target.executor !== undefined && target.executor !== inferred.executor) {
    problems.push(
      `${manifest}: ${header} sets "executor" to ${JSON.stringify(target.executor)} on the inferred target "${name}", which runs ${JSON.stringify(inferred.executor)}. Nx would use the table in place of the inferred target. To run something else, define a target under a name of its own.`,
    );
  }
  if (target.command !== undefined) {
    problems.push(
      `${manifest}: ${header} sets "command" on the inferred target "${name}". Nx would run the command in place of the inferred target. To run another command, define a target under a name of its own.`,
    );
  }
  if (isInferredTest(inferred) && !settings.workspace.affectedTests) {
    const places = [
      ...(target.options?.affectedTests === true
        ? [targetHeader(table.table, name, "options")]
        : []),
      ...Object.entries(target.configurations ?? {})
        .filter(([, configuration]) => configuration?.affectedTests === true)
        .map(([configuration]) => targetHeader(table.table, name, "configurations", configuration)),
    ];
    for (const place of places) {
      problems.push(
        `${manifest}: ${place} sets "affectedTests" to true, but the Cargo workspace in ${settings.workspace.rootManifest} does not use the selection of affected tests, so the option can only turn it off. Remove it, or turn selection on with affectedTests = true under [workspace.metadata.nx] in ${settings.workspace.rootManifest}.`,
      );
    }
  }
  return problems;
}

/**
 * Fails when, once Nx has merged `targetDefaults`, `project.json` and
 * `package.json` over the plugin's targets, the `test` target of a crate
 * sets `affectedTests` to true, among its options or in a configuration,
 * in a workspace that does not use the selection of affected tests. The
 * metadata tables are checked before, where the projects are created.
 *
 * @param projects The merged projects that `createDependencies` receives.
 * @throws {Error} Naming each project and target concerned.
 */
// @mara implements DES-PLUGIN-OPTIONS
export function failOnAffectedTestsOption(
  graph: CargoGraph,
  projects: CreateDependenciesContext["projects"],
): void {
  const byRoot = new Map(
    Object.entries(projects).map(([name, project]) => [project.root, { name, project }]),
  );
  const problems: string[] = [];
  for (const own of graph.projects) {
    const merged = byRoot.get(own.root);
    if (own.pkg === undefined || merged === undefined || own.settings.workspace.affectedTests) {
      continue;
    }
    for (const [target, configuration] of Object.entries(merged.project.targets ?? {})) {
      if (!isInferredTest(configuration)) {
        continue;
      }
      const where = [
        ...(configuration.options?.affectedTests === true ? ["among its options"] : []),
        ...Object.entries(configuration.configurations ?? {})
          .filter(([, values]) => values?.affectedTests === true)
          .map(([name]) => `in its configuration "${name}"`),
      ];
      if (where.length > 0) {
        const workspace = own.settings.workspace.rootManifest;
        problems.push(
          `The target "${target}" of the project "${merged.name}" (${own.manifest}) sets "affectedTests" to true ${where.join(" and ")}, but the Cargo workspace in ${workspace} does not use the selection of affected tests, so the option can only turn it off. The value comes from a targetDefaults entry in nx.json, or from a project.json or package.json in ${own.root}: run \`nx show target ${merged.name}:${target} --json\` and look under sourceMap for the file. Remove it there, or turn selection on with affectedTests = true under [workspace.metadata.nx] in ${workspace}.`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}

// The inferred `test` target, under whatever name, while it still runs the plugin's executor.
function isInferredTest(target: TargetConfiguration): boolean {
  return (
    target.executor === cargoExecutor &&
    target.metadata?.[targetCargoMetadataKey]?.target === "test"
  );
}
