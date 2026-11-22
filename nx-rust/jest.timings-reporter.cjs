const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, posix, relative } = require("node:path");

/**
 * Minimal Jest reporter that writes per-suite wall-time durations in
 * milliseconds to the path in `NX_RUST_JEST_TIMINGS_OUTPUT` without altering
 * Jest's default console output. Keys are POSIX paths relative to Jest's
 * `rootDir` (matching `nx-rust/jest.sequencer.cjs`).
 */
class TimingsReporter {
  constructor(globalConfig) {
    this.rootDir = globalConfig?.rootDir ?? __dirname;
  }

  onRunComplete(_contexts, results) {
    const outputPath = process.env.NX_RUST_JEST_TIMINGS_OUTPUT;
    if (!outputPath || !results?.testResults) {
      return;
    }
    const entries = [];
    for (const suite of results.testResults) {
      if (!suite?.testFilePath || !suite.perfStats) {
        continue;
      }
      const rel = relative(this.rootDir, suite.testFilePath).split("\\").join(posix.sep);
      const raw =
        typeof suite.perfStats.end === "number" && typeof suite.perfStats.start === "number"
          ? suite.perfStats.end - suite.perfStats.start
          : suite.perfStats.runtime;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        entries.push([rel, Math.max(0, Math.round(raw))]);
      }
    }
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(Object.fromEntries(entries)));
  }
}

module.exports = TimingsReporter;
