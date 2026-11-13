import { dirname, join } from "node:path";
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
 * whether Nx runs the entries in one process or in several. Before it
 * looks, a request waits for the requests in flight, so that a workspace
 * whose manifests two entries receive is reported once, whichever entry
 * gets there first.
 */
// @mara implements DES-METADATA-REPORT
export class ComputationReports {
  private readonly settled: { report: CargoMetadata; cwd: string }[] = [];
  private readonly inFlight = new Set<Promise<CargoMetadata>>();

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
    while (this.inFlight.size > 0) {
      await Promise.allSettled(this.inFlight);
    }
    const known = this.settled.find((entry) => covers(entry.report, manifest) && reusable(entry));
    if (known !== undefined) {
      return known.report;
    }
    const requesting = requestMetadata(manifest, cwd);
    this.inFlight.add(requesting);
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
