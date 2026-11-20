const { basename } = require("node:path");
const Sequencer = require("@jest/test-sequencer").default;

/**
 * The spec files that compile the most, longest first. Without them first,
 * Jest's default order, by the durations of an earlier run or, on a fresh
 * checkout and in CI, by file size, can start one of them last, so that the
 * other workers wait idle for it at the end of the run.
 */
const heaviest = [
  "napi-build.spec.ts",
  "batch-runs.spec.ts",
  "build-input-check.spec.ts",
  "cache-keys.spec.ts",
  "target-defaults.spec.ts",
  "caching-runs.spec.ts",
  "workspace-build.spec.ts",
  "wasm-build.spec.ts",
  "affected-coverage.spec.ts",
];

/** Starts the files of {@link heaviest} first, in that order, and the rest in Jest's default order. */
class HeaviestFirst extends Sequencer {
  async sort(tests) {
    const rank = (test) => heaviest.indexOf(basename(test.path));
    const first = tests.filter((test) => rank(test) >= 0).sort((a, b) => rank(a) - rank(b));
    const rest = await super.sort(tests.filter((test) => rank(test) < 0));
    return [...first, ...rest];
  }
}

module.exports = HeaviestFirst;
