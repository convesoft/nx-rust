import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const HeaviestFirst = require("../jest.sequencer.cjs") as {
  new (): {
    shard(tests: FakeTest[], options: { shardIndex: number; shardCount: number }): FakeTest[];
    sort(tests: FakeTest[]): Promise<FakeTest[]>;
  };
  heaviest: string[];
};

const TimingsReporter = require("../jest.timings-reporter.cjs") as {
  new (globalConfig: { rootDir: string }): {
    onRunComplete(
      contexts: unknown,
      results: {
        testResults: {
          testFilePath: string;
          perfStats: { start?: number; end?: number; runtime?: number };
        }[];
      },
    ): void;
  };
};

interface FakeTest {
  path: string;
  context: {
    config: { rootDir: string; cache: boolean; cacheDirectory: string; id: string };
    hasteFS: { getSize(filePath: string): number | null };
  };
}

const packageRoot = join(__dirname, "..");

function fakeTest(filePath: string, size: number | null = null): FakeTest {
  return {
    path: filePath,
    context: {
      config: {
        rootDir: packageRoot,
        cache: false,
        cacheDirectory: "/nonexistent",
        id: "test",
      },
      hasteFS: { getSize: () => size },
    },
  };
}

function allSpecTests(): FakeTest[] {
  return readdirSync(__dirname)
    .filter((name) => name.endsWith(".spec.ts"))
    .sort()
    .map((name) => fakeTest(join(__dirname, name)));
}

describe("HeaviestFirst Jest sequencer", () => {
  const sequencer = new HeaviestFirst();
  let tempDir: string;
  const savedTimingsFile = process.env.NX_RUST_JEST_TIMINGS_FILE;
  const savedTimingsOutput = process.env.NX_RUST_JEST_TIMINGS_OUTPUT;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nx-rust-sequencer-"));
    delete process.env.NX_RUST_JEST_TIMINGS_FILE;
    delete process.env.NX_RUST_JEST_TIMINGS_OUTPUT;
  });

  afterEach(() => {
    if (savedTimingsFile === undefined) {
      delete process.env.NX_RUST_JEST_TIMINGS_FILE;
    } else {
      process.env.NX_RUST_JEST_TIMINGS_FILE = savedTimingsFile;
    }
    if (savedTimingsOutput === undefined) {
      delete process.env.NX_RUST_JEST_TIMINGS_OUTPUT;
    } else {
      process.env.NX_RUST_JEST_TIMINGS_OUTPUT = savedTimingsOutput;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.each([1, 2, 3, 4, 5])(
    "partitions every spec file across %i shards with no duplicates or omissions on a cold cache",
    (shardCount) => {
      const tests = allSpecTests();
      const shards = Array.from({ length: shardCount }, (_, index) =>
        sequencer.shard(tests, { shardIndex: index + 1, shardCount }),
      );
      const combined = shards.flatMap((shard) => shard.map((test) => test.path));

      expect(combined.length).toBe(tests.length);
      expect([...new Set(combined)].sort()).toEqual(tests.map((test) => test.path).sort());
    },
  );

  it("spreads the fallback heaviest spec files across shards on a cold cache", () => {
    const tests = allSpecTests();
    const shards = [1, 2, 3, 4].map((shardIndex) =>
      sequencer.shard(tests, { shardIndex, shardCount: 4 }).map((test) => basename(test.path)),
    );

    // Top 4 heaviest each land on a distinct shard.
    const top4Shards = HeaviestFirst.heaviest
      .slice(0, 4)
      .map((name) => shards.findIndex((shard) => shard.includes(name)));
    expect(new Set(top4Shards).size).toBe(4);
  });

  it("bin-packs skewed CI durations with LPT and partitions all suites regardless of input order", () => {
    const durations: Record<string, number> = {
      "test/a.spec.ts": 100_000,
      "test/b.spec.ts": 80_000,
      "test/c.spec.ts": 70_000,
      "test/d.spec.ts": 60_000,
      "test/e.spec.ts": 40_000,
      "test/f.spec.ts": 30_000,
      "test/g.spec.ts": 20_000,
      "test/h.spec.ts": 10_000,
    };
    const timingsFile = join(tempDir, "timings.json");
    writeFileSync(timingsFile, JSON.stringify(durations));
    process.env.NX_RUST_JEST_TIMINGS_FILE = timingsFile;

    const tests = Object.keys(durations).map((rel) => fakeTest(join(packageRoot, rel)));
    const reversed = [...tests].reverse();
    const shards = [1, 2, 3, 4].map((shardIndex) =>
      sequencer.shard(tests, { shardIndex, shardCount: 4 }),
    );

    // Order independence across shards.
    for (let i = 1; i <= 4; i++) {
      expect(
        sequencer.shard(reversed, { shardIndex: i, shardCount: 4 }).map((test) => test.path),
      ).toEqual(shards[i - 1].map((test) => test.path));
    }

    // Complete partition.
    const combined = shards.flatMap((shard) => shard.map((test) => test.path));
    expect(combined.sort()).toEqual(tests.map((test) => test.path).sort());

    // LPT balances [100+10=110, 80+20=100, 70+30=100, 60+40=100].
    const totals = shards
      .map((shard) =>
        shard.reduce((sum, test) => sum + durations[`test/${basename(test.path)}`], 0),
      )
      .sort((a, b) => a - b);
    expect(totals).toEqual([100_000, 100_000, 100_000, 110_000]);
  });

  it("assigns newly added specs not in the timing profile cleanly using the median duration", () => {
    const timingsFile = join(tempDir, "timings.json");
    writeFileSync(
      timingsFile,
      JSON.stringify({ "test/a.spec.ts": 60_000, "test/b.spec.ts": 20_000 }),
    );
    process.env.NX_RUST_JEST_TIMINGS_FILE = timingsFile;

    const tests = ["test/a.spec.ts", "test/b.spec.ts", "test/brand-new.spec.ts"].map((rel) =>
      fakeTest(join(packageRoot, rel)),
    );
    const shards = [1, 2].map((shardIndex) =>
      sequencer.shard(tests, { shardIndex, shardCount: 2 }).map((test) => basename(test.path)),
    );

    expect(shards.flat().sort()).toEqual(["a.spec.ts", "b.spec.ts", "brand-new.spec.ts"]);
    // a (60s) on shard 1; brand-new (median 40s) + b (20s) = 60s on shard 2.
    expect(shards[0]).toEqual(["a.spec.ts"]);
    expect(shards[1]).toEqual(["brand-new.spec.ts", "b.spec.ts"]);
  });

  it("falls back cleanly when the timings file is missing or malformed", () => {
    const broken = join(tempDir, "broken.json");
    writeFileSync(broken, "{ not json");
    process.env.NX_RUST_JEST_TIMINGS_FILE = broken;

    const tests = ["z.spec.ts", "a.spec.ts", "m.spec.ts", "b.spec.ts"].map((name) =>
      fakeTest(join(packageRoot, "virtual", name)),
    );
    const all = [1, 2].flatMap((shardIndex) =>
      sequencer.shard(tests, { shardIndex, shardCount: 2 }).map((test) => test.path),
    );
    expect(all.sort()).toEqual(tests.map((test) => test.path).sort());
  });

  it("sorts by descending recorded duration when a timing profile is provided", async () => {
    const timingsFile = join(tempDir, "timings.json");
    writeFileSync(
      timingsFile,
      JSON.stringify({
        "test/split-words.spec.ts": 50_000,
        "test/batch-runs.spec.ts": 5_000,
      }),
    );
    process.env.NX_RUST_JEST_TIMINGS_FILE = timingsFile;

    const subset = [
      fakeTest(join(__dirname, "batch-runs.spec.ts")),
      fakeTest(join(__dirname, "split-words.spec.ts")),
      fakeTest(join(__dirname, "version-req.spec.ts")),
    ];

    const sorted = (await sequencer.sort(subset)).map((test) => basename(test.path));
    expect(sorted).toEqual(["split-words.spec.ts", "batch-runs.spec.ts", "version-req.spec.ts"]);
  });

  it("starts fallback heaviest files first when sorting without a timing profile", async () => {
    const subset = [
      fakeTest(join(__dirname, "split-words.spec.ts")),
      fakeTest(join(__dirname, "cache-keys.spec.ts")),
      fakeTest(join(__dirname, "batch-runs.spec.ts")),
      fakeTest(join(__dirname, "version-req.spec.ts")),
    ];

    const sorted = (await sequencer.sort(subset)).map((test) => basename(test.path));
    expect(sorted.slice(0, 2)).toEqual(["batch-runs.spec.ts", "cache-keys.spec.ts"]);
    expect(sorted.slice(2).sort()).toEqual(["split-words.spec.ts", "version-req.spec.ts"]);
  });

  it("records suite durations to NX_RUST_JEST_TIMINGS_OUTPUT via TimingsReporter", () => {
    const outputFile = join(tempDir, "nested", "shard-timings.json");
    process.env.NX_RUST_JEST_TIMINGS_OUTPUT = outputFile;
    const reporter = new TimingsReporter({ rootDir: packageRoot });

    reporter.onRunComplete(null, {
      testResults: [
        {
          testFilePath: join(packageRoot, "test", "z.spec.ts"),
          perfStats: { start: 1000, end: 2345.6 },
        },
        {
          testFilePath: join(packageRoot, "test", "a.spec.ts"),
          perfStats: { runtime: 789.2 },
        },
      ],
    });

    expect(JSON.parse(readFileSync(outputFile, "utf8"))).toEqual({
      "test/a.spec.ts": 789,
      "test/z.spec.ts": 1346,
    });
  });
});
