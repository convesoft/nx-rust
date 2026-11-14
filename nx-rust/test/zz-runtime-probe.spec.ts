import { compareCacheKeys, HARNESS_TIMEOUT } from "./harness";

const probe = (runtime: string) =>
  JSON.stringify({
    targets: {
      probe: { executor: "nx:run-commands", options: { command: "true" }, cache: true, inputs: [{ runtime }] },
    },
  });

it(
  "probe: does the command text of a runtime input reach the key",
  async () => {
    const outcomes = await compareCacheKeys({
      change: "command text",
      fixture: "crate-shapes",
      before: { files: { "rust/crates/cli/project.json": probe("echo same") } },
      after: { files: { "rust/crates/cli/project.json": probe("echo other") } },
      keys: { "cli:probe": "must differ" },
    });
    console.log("PROBE", JSON.stringify(outcomes.map((o) => ({ before: o.before.value, after: o.after.value, keys: Object.keys(o.before.details), d: JSON.stringify(o.before.details).slice(0, 400) }))));
  },
  HARNESS_TIMEOUT,
);
