import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";
import { CargoMetadata, requestMetadata } from "../cargo/metadata";
import { realPath } from "./real-path";

/**
 * The `cargo metadata` reports of one graph computation, shared by the
 * entries of the plugin in `nx.json` that Nx runs in this process.
 *
 * A report requested for one manifest is reused for another manifest only
 * when it lists that manifest as its root manifest or as one of its
 * packages: `cargo metadata` would then report the same workspace for it.
 * A workspace's own report, from which graph creation takes what Cargo's
 * configuration decides, must come from the workspace's root folder
 * ({@link requestFromRoot}), so a report requested in another folder is not
 * reused for that. What each entry discovers therefore does not depend on
 * whether Nx runs the entries in one process or in several.
 *
 * Before it looks, a request waits for the requests in flight whose
 * workspace may be its own ({@link possibleRoots}), so that a workspace
 * whose manifests two entries receive is reported once, whichever entry
 * gets there first. Requests that cannot report one workspace run at the
 * same time.
 */
// @mara implements DES-METADATA-REPORT
export class ComputationReports {
  private readonly settled: { report: CargoMetadata; cwd: string }[] = [];
  private readonly inFlight = new Map<Promise<CargoMetadata>, PossibleRoots>();

  /**
   * @param run Requests a report; tests pass one that counts the calls.
   */
  constructor(
    private readonly run: (
      manifest: string,
      cwd: string,
    ) => Promise<CargoMetadata> = requestMetadata,
  ) {}

  /**
   * The report for `manifest`: one requested earlier in this computation
   * that covers it, or a new one requested in `cwd`.
   *
   * @param manifest The absolute path of a `Cargo.toml`.
   * @throws Whatever {@link requestMetadata} throws.
   */
  request(manifest: string, cwd: string): Promise<CargoMetadata> {
    return this.find(manifest, cwd, () => true);
  }

  /**
   * The report of the workspace whose root manifest is `rootManifest`, as
   * cargo gives it in the workspace's root folder, where the workspace's
   * tasks run cargo: one requested there earlier in this computation, or a
   * new one requested there.
   *
   * @param rootManifest The absolute path of a workspace's root manifest.
   * @throws Whatever {@link requestMetadata} throws.
   */
  requestFromRoot(rootManifest: string): Promise<CargoMetadata> {
    return this.find(rootManifest, dirname(rootManifest), (entry) => startedInRoot(entry));
  }

  /**
   * Whether cargo started in the root folder of the reported workspace for
   * this report of the computation.
   */
  fromRoot(report: CargoMetadata): boolean {
    const entry = this.settled.find((settled) => settled.report === report);
    return entry !== undefined && startedInRoot(entry);
  }

  private async find(
    manifest: string,
    cwd: string,
    reusable: (entry: { report: CargoMetadata; cwd: string }) => boolean,
  ): Promise<CargoMetadata> {
    const roots = possibleRoots(manifest);
    for (;;) {
      const related = [...this.inFlight]
        .filter(([, others]) => mayShare(roots, others))
        .map(([requesting]) => requesting);
      if (related.length === 0) {
        break;
      }
      await Promise.allSettled(related);
    }
    // From here to the request's start nothing awaits, so a request that
    // checks next sees this one in flight.
    const known = this.settled.find((entry) => covers(entry.report, manifest) && reusable(entry));
    if (known !== undefined) {
      return known.report;
    }
    const requesting = this.run(manifest, cwd);
    this.inFlight.set(requesting, roots);
    try {
      const report = await requesting;
      this.settled.push({ report, cwd });
      return report;
    } finally {
      this.inFlight.delete(requesting);
    }
  }
}

let current: ComputationReports | undefined;

/**
 * The reports of the graph computation that the calling `createNodes`
 * belongs to. Call it before the first `await` of `createNodes`.
 *
 * Nx starts the `createNodes` calls of all plugin entries of one computation
 * in one synchronous loop. The calls made before the next microtask therefore
 * belong together, and a later call starts a new computation: reports are
 * never reused from an earlier computation. Should Nx start the entries'
 * calls apart, each gets reports of its own, which costs cargo calls but
 * changes no result.
 */
export function computationReports(): ComputationReports {
  if (current === undefined) {
    const reports = new ComputationReports();
    current = reports;
    queueMicrotask(() => {
      if (current === reports) {
        current = undefined;
      }
    });
  }
  return current;
}

// Whether cargo started in the reported workspace's root folder. rustup and
// Cargo find the toolchain and configuration files from the physical folder
// that a command starts in, so two spellings of one folder count as one.
function startedInRoot({ report, cwd }: { report: CargoMetadata; cwd: string }): boolean {
  return realPath(cwd) === realPath(report.workspace_root);
}

function covers(report: CargoMetadata, manifest: string): boolean {
  return (
    join(report.workspace_root, "Cargo.toml") === manifest ||
    report.packages.some((pkg) => pkg.manifest_path === manifest)
  );
}

/**
 * The root manifests, as real paths, that cargo may take for a manifest's
 * workspace, or `"any"` where nothing short of cargo can tell. Two requests
 * whose sets share no manifest report different workspaces, so neither can
 * reuse the other's report and neither waits for the other.
 *
 * Cargo takes a manifest with a `[workspace]` table as its own root, follows
 * `package.workspace` wherever it points, and otherwise looks for the root in
 * the folders above the manifest, where it follows the `package.workspace`
 * of a manifest above as well; a member outside its root's folder must name
 * the root in `package.workspace` or lie below a manifest that does. The set
 * is therefore the manifest itself where it has a `[workspace]` table, and
 * otherwise the manifest and every `Cargo.toml` in a folder above it,
 * whether or not that one is a workspace that lists it, along the path as
 * cargo normalises it and along its real path. Where the manifest or one
 * above it has `package.workspace`, or the `[project]` table's, or cannot be
 * read as TOML, the workspace may be any: `"any"`. Taking more than cargo
 * would only make a request wait longer than needed.
 *
 * @param given The absolute path of a `Cargo.toml`.
 */
// @mara implements DES-METADATA-REPORT
export function possibleRoots(given: string): PossibleRoots {
  // Cargo normalises the path it is given as text, before following links.
  const manifest = resolve(given);
  const own = readManifest(manifest);
  if (own === undefined || pointsToRoot(own)) {
    return "any";
  }
  const roots = new Set([realPath(manifest)]);
  if (own.workspace !== undefined) {
    return roots;
  }
  for (const start of [dirname(manifest), dirname(realPath(manifest))]) {
    for (let above = dirname(start); ; above = dirname(above)) {
      const candidate = join(above, "Cargo.toml");
      if (existsSync(candidate)) {
        const read = readManifest(candidate);
        if (read === undefined || pointsToRoot(read)) {
          return "any";
        }
        roots.add(realPath(candidate));
      }
      if (dirname(above) === above) {
        break;
      }
    }
  }
  return roots;
}

// A manifest's tables, or `undefined` where it cannot be read as TOML.
function readManifest(path: string): Record<string, unknown> | undefined {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// Whether a manifest names its workspace root with `package.workspace`, or
// with the key of the legacy `[project]` table.
function pointsToRoot(manifest: Record<string, unknown>): boolean {
  return namesWorkspace(manifest.package) || namesWorkspace(manifest.project);
}

/** What {@link possibleRoots} gives. */
export type PossibleRoots = ReadonlySet<string> | "any";

function namesWorkspace(table: unknown): boolean {
  return typeof table === "object" && table !== null && "workspace" in table;
}

// Whether two requests may report one workspace.
function mayShare(roots: PossibleRoots, others: PossibleRoots): boolean {
  if (roots === "any" || others === "any") {
    return true;
  }
  for (const root of roots) {
    if (others.has(root)) {
      return true;
    }
  }
  return false;
}
