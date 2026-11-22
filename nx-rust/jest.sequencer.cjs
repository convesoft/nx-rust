const { statSync } = require("node:fs");
const { basename, posix, relative } = require("node:path");
const Sequencer = require("@jest/test-sequencer").default;

/**
 * The heaviest spec files, longest first. Starting them first avoids tail
 * latency on local and CI workers, and snake-drafting them across shards keeps
 * every CI shard balanced instead of letting Jest's default path-hash sharding
 * cluster slow suites together.
 */
const heaviest = [
  "batch-runs.spec.ts",
  "cache-keys.spec.ts",
  "declared-files.spec.ts",
  "build-input-check.spec.ts",
  "lockfile-runs.spec.ts",
  "warnings.spec.ts",
  "napi-build.spec.ts",
  "caching-runs.spec.ts",
  "affected-coverage.spec.ts",
  "wasm-build.spec.ts",
  "batch-builds.spec.ts",
  "workspace-build.spec.ts",
  "executors.spec.ts",
  "redirections.spec.ts",
  "unknown-options.spec.ts",
  "artifact-folders.spec.ts",
  "target-defaults.spec.ts",
  "coverage-baseline.spec.ts",
  "affected-runs.spec.ts",
  "nextest-runs.spec.ts",
  "test-after-build.spec.ts",
  "lockfile-keys.spec.ts",
  "verbose-command.spec.ts",
  "shared-executables.spec.ts",
  "configuration.spec.ts",
];

function normalizedRelativePath(test) {
  const rootDir = test.context?.config?.rootDir;
  const raw = rootDir ? relative(rootDir, test.path) : test.path;
  return raw.split("\\").join(posix.sep);
}

function fileSize(test) {
  const fromHaste = test.context?.hasteFS?.getSize?.(test.path);
  if (typeof fromHaste === "number") {
    return fromHaste;
  }
  try {
    return statSync(test.path).size;
  } catch {
    return 0;
  }
}

function compareForSharding(a, b) {
  const rankA = heaviest.indexOf(basename(a.path));
  const rankB = heaviest.indexOf(basename(b.path));
  if (rankA >= 0 || rankB >= 0) {
    if (rankA < 0) return 1;
    if (rankB < 0) return -1;
    if (rankA !== rankB) return rankA - rankB;
  }
  const sizeDiff = fileSize(b) - fileSize(a);
  if (sizeDiff !== 0) return sizeDiff;
  const pathA = normalizedRelativePath(a);
  const pathB = normalizedRelativePath(b);
  return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
}

/**
 * Shards suites in deterministic snake-draft order over {@link heaviest} and
 * descending file size, and sorts each run with {@link heaviest} first.
 */
class HeaviestFirst extends Sequencer {
  shard(tests, { shardIndex, shardCount }) {
    const ordered = [...tests].sort(compareForSharding);
    return ordered.filter((_test, index) => {
      const row = Math.floor(index / shardCount);
      const offset = index % shardCount;
      const bucket = row % 2 === 0 ? offset : shardCount - 1 - offset;
      return bucket === shardIndex - 1;
    });
  }

  async sort(tests) {
    const rank = (test) => heaviest.indexOf(basename(test.path));
    const first = tests.filter((test) => rank(test) >= 0).sort((a, b) => rank(a) - rank(b));
    const rest = await super.sort(tests.filter((test) => rank(test) < 0));
    return [...first, ...rest];
  }
}

HeaviestFirst.heaviest = heaviest;

module.exports = HeaviestFirst;
