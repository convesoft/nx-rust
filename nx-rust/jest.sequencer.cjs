const { readFileSync, statSync } = require("node:fs");
const { basename, posix, relative } = require("node:path");
const Sequencer = require("@jest/test-sequencer").default;

/**
 * Fallback ordering for cold runs that have no recorded CI timing profile yet
 * (for example a fresh local checkout before Jest writes its perf cache, or
 * the very first CI run before `jest-timings.json` is cached). When a timing
 * profile is provided through `NX_RUST_JEST_TIMINGS_FILE`, its measured
 * durations govern both sharding and sorting instead.
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

/**
 * Loads a `{ "<relative posix path>": durationMs }` timing profile from
 * `NX_RUST_JEST_TIMINGS_FILE` when set and valid; returns an empty map
 * otherwise so a missing or corrupt cache never breaks a run.
 */
function loadTimings() {
  const filePath = process.env.NX_RUST_JEST_TIMINGS_FILE;
  if (!filePath) {
    return new Map();
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    const timings = new Map();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        timings.set(key.split("\\").join(posix.sep), value);
      }
    }
    return timings;
  } catch {
    return new Map();
  }
}

function median(values) {
  if (values.length === 0) {
    return 1000;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Shards suites using deterministic Longest Processing Time first (LPT)
 * bin-packing from `NX_RUST_JEST_TIMINGS_FILE` when available (falling back to
 * {@link heaviest} and file size on a cold cache), and sorts each run longest
 * first so workers finish together.
 */
class HeaviestFirst extends Sequencer {
  shard(tests, { shardIndex, shardCount }) {
    const timings = loadTimings();
    const hasTimings = timings.size > 0;
    const defaultDuration = hasTimings ? median([...timings.values()]) : 0;

    // On a cold cache without measured durations, assign synthetic weights
    // above file sizes so `heaviest` specs still spread across distinct shards.
    const maxFileSize = hasTimings ? 0 : Math.max(1, ...tests.map((test) => fileSize(test)));

    const weighted = tests.map((test) => {
      const relPath = normalizedRelativePath(test);
      let weight;
      if (hasTimings) {
        weight = timings.has(relPath) ? timings.get(relPath) : defaultDuration;
      } else {
        const rank = heaviest.indexOf(basename(test.path));
        weight = rank >= 0 ? maxFileSize * (heaviest.length - rank + 1) : fileSize(test);
      }
      return { test, relPath, weight };
    });

    weighted.sort((a, b) => {
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }
      return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
    });

    const loads = Array(shardCount).fill(0);
    const counts = Array(shardCount).fill(0);
    const buckets = Array.from({ length: shardCount }, () => []);

    for (const entry of weighted) {
      let target = 0;
      for (let i = 1; i < shardCount; i++) {
        if (
          loads[i] < loads[target] ||
          (loads[i] === loads[target] && counts[i] < counts[target])
        ) {
          target = i;
        }
      }
      buckets[target].push(entry.test);
      loads[target] += entry.weight;
      counts[target] += 1;
    }

    return buckets[shardIndex - 1] ?? [];
  }

  async sort(tests) {
    const timings = loadTimings();
    if (timings.size > 0) {
      const known = [];
      const unknown = [];
      for (const test of tests) {
        const relPath = normalizedRelativePath(test);
        if (timings.has(relPath)) {
          known.push({ test, relPath, ms: timings.get(relPath) });
        } else {
          unknown.push(test);
        }
      }
      known.sort((a, b) => {
        if (b.ms !== a.ms) {
          return b.ms - a.ms;
        }
        return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
      });
      const rest = await super.sort(unknown);
      return [...known.map((entry) => entry.test), ...rest];
    }

    const rank = (test) => heaviest.indexOf(basename(test.path));
    const first = tests.filter((test) => rank(test) >= 0).sort((a, b) => rank(a) - rank(b));
    const rest = await super.sort(tests.filter((test) => rank(test) < 0));
    return [...first, ...rest];
  }
}

HeaviestFirst.heaviest = heaviest;

module.exports = HeaviestFirst;
