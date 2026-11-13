// A plugin for tests that stands in for the plugin in nx.json
// (`discoveryProbeEntry`) and behaves exactly like it, but also records what
// each entry's createDependencies sees: one JSON line per call, appended to
// the file that DISCOVERY_PROBE_LOG names. Nx loads it as it loads the
// plugin, in its own process or in a plugin worker.

import type { CreateDependenciesContext } from "@nx/devkit";
import { appendFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import plugin = require("../../src");
import { registrationOf } from "../../src/graph/registration";
import type { ProbeRecord } from "./fixtures";

const probe = {
  // Reads the plugin's getter, so that each entry still gets a registration of its own.
  get createNodes() {
    return plugin.createNodes;
  },
  createDependencies(this: unknown, options: unknown, context: CreateDependenciesContext) {
    const dependencies = plugin.createDependencies.call(this, options, context);
    const discovery = registrationOf(this).discoveryForDependencies(context.workspaceRoot);
    const root = context.workspaceRoot;
    const record: ProbeRecord = {
      workspaces: (discovery?.workspaces ?? []).map((workspace) => [
        workspace.root,
        workspace.members.map((member) => relative(root, dirname(member.manifest_path)) || "."),
      ]),
      pathDependencies: (discovery?.pathDependencyReports ?? []).map((report) => report.manifest),
    };
    appendFileSync(process.env.DISCOVERY_PROBE_LOG, `${JSON.stringify(record)}\n`);
    return dependencies;
  },
};

export = probe;
