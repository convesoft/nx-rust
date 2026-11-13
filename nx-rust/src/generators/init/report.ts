import { isAbsolute, relative } from "node:path";
import type { CargoWorkspace } from "../../graph/discovery";
import {
  describeFolder,
  missingToolMessage,
  OptionalTool,
  optionalTools,
  ToolContext,
} from "../../tools/optional-tools";
import type { GraphCheck } from "./graph-check";

/** What `init` prints after the check, by severity. */
export interface InitReport {
  warnings: string[];
  info: string[];
}

/** The `build.build-dir` setting that the caching guidance suggests. */
export const suggestedBuildDirSetting = [
  "[build]",
  'build-dir = "{cargo-cache-home}/build/{workspace-path-hash}"',
];

const cachingGuide =
  "https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/caching.mara.md#cargos-two-directories";

/**
 * The report of step 3 of `init`: the tools of the table that are missing,
 * as warnings where the configuration needs them and on one line otherwise,
 * the workspaces whose build directory lies inside the repository, and how
 * to create a crate where there is none. The warnings that graph creation
 * gives are printed by the check itself.
 *
 * @param env The environment whose `PATH` and `CARGO_HOME` say where tools are installed.
 */
// @mara implements DES-GENERATORS
export function initReport(
  check: GraphCheck,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  tools: readonly OptionalTool[] = optionalTools,
): InitReport {
  const report: InitReport = { warnings: [], info: [] };
  const context: ToolContext = { workspaceRoot, workspaces: check.workspaces, env };
  const notNeeded: string[] = [];
  for (const tool of tools) {
    if (tool.installed(context)) {
      continue;
    }
    const neededBy = tool.neededBy(context);
    if (neededBy.length === 0) {
      notNeeded.push(tool.name);
    } else {
      report.warnings.push(missingToolMessage(tool, neededBy));
    }
  }
  if (notNeeded.length > 0) {
    report.info.push(
      `Not installed and not needed by your settings: ${notNeeded.join(", ")}. A task that runs one of them fails and says how to get it.`,
    );
  }
  const inside = check.workspaces.flatMap((workspace) => {
    const buildDirectory = buildDirectoryInside(workspace, workspaceRoot);
    return buildDirectory === undefined
      ? []
      : [`  ${describeFolder(workspace.root)}: ${buildDirectory}`];
  });
  if (inside.length > 0) {
    report.info.push(
      [
        "Cargo keeps the build directory of these Cargo workspaces inside the repository:",
        ...inside,
        `To keep it outside, as ${cachingGuide} suggests, set build.build-dir in .cargo/config.toml at the repository root or in the workspace's folder:`,
        ...suggestedBuildDirSetting.map((line) => `  ${line}`),
        "nx-rust does not write this setting.",
      ].join("\n"),
    );
  }
  if (check.manifests.length === 0) {
    report.info.push(
      [
        "The repository has no Cargo.toml yet. Create your first crate with",
        "  nx g @convesoft/nx-rust:library <directory>",
        "or with `cargo new --vcs none <directory>`: nx-rust finds every crate that Cargo knows.",
      ].join("\n"),
    );
  }
  return report;
}

// The build directory relative to the repository root, if it lies inside.
// Cargo reports it from 1.91 on.
function buildDirectoryInside(
  workspace: CargoWorkspace,
  workspaceRoot: string,
): string | undefined {
  const directory = workspace.report.build_directory;
  if (typeof directory !== "string") {
    return undefined;
  }
  const path = relative(workspaceRoot, directory);
  return path === ".." || path.startsWith("../") || isAbsolute(path) ? undefined : path || ".";
}
