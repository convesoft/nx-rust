import { join } from "node:path";
import { CargoMetadata, requestMetadata } from "../cargo/metadata";

/**
 * The `cargo metadata` reports of one graph computation, shared by the
 * entries of the plugin in `nx.json` that Nx runs in this process.
 *
 * A report requested for one manifest is reused for another manifest only
 * when it lists that manifest as its root manifest or as one of its
 * packages: `cargo metadata` would then report the same workspace for it.
 * What each entry discovers therefore does not depend on whether Nx runs the
 * entries in one process or in several. Before it looks, a request waits
 * for the requests in flight, so that a workspace whose manifests two entries
 * receive is reported once, whichever entry gets there first.
 */
// @mara implements DES-METADATA-REPORT
export class ComputationReports {
  private readonly settled: CargoMetadata[] = [];
  private readonly inFlight = new Set<Promise<CargoMetadata>>();

  /**
   * The report for `manifest`: one requested earlier in this computation
   * that covers it, or a new one requested in `cwd`.
   *
   * @param manifest The absolute path of a `Cargo.toml`.
   * @throws Whatever {@link requestMetadata} throws.
   */
  async request(manifest: string, cwd: string): Promise<CargoMetadata> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled(this.inFlight);
    }
    const known = this.settled.find((report) => covers(report, manifest));
    if (known !== undefined) {
      return known;
    }
    const requesting = requestMetadata(manifest, cwd);
    this.inFlight.add(requesting);
    try {
      const report = await requesting;
      this.settled.push(report);
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

function covers(report: CargoMetadata, manifest: string): boolean {
  return (
    join(report.workspace_root, "Cargo.toml") === manifest ||
    report.packages.some((pkg) => pkg.manifest_path === manifest)
  );
}
