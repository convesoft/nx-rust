import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

const HeaviestFirst = require("../jest.sequencer.cjs") as {
  new (): {
    shard(tests: FakeTest[], options: { shardIndex: number; shardCount: number }): FakeTest[];
    sort(tests: FakeTest[]): Promise<FakeTest[]>;
  };
  heaviest: string[];
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

  it.each([1, 2, 3, 4, 5])(
    "partitions every spec file across %i shards with no duplicates or omissions",
    (shardCount) => {
      const tests = allSpecTests();
      const shards = Array.from({ length: shardCount }, (_, index) =>
        sequencer.shard(tests, { shardIndex: index + 1, shardCount }),
      );
      const combined = shards.flatMap((shard) => shard.map((test) => test.path));

      expect(combined.length).toBe(tests.length);
      expect([...new Set(combined)].sort()).toEqual(tests.map((test) => test.path).sort());
      // Every shard gets within 1 suite of the others.
      const sizes = shards.map((shard) => shard.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    },
  );

  it("produces identical shards regardless of input order", () => {
    const tests = allSpecTests();
    const reversed = [...tests].reverse();

    for (let shardIndex = 1; shardIndex <= 4; shardIndex++) {
      expect(
        sequencer.shard(reversed, { shardIndex, shardCount: 4 }).map((test) => test.path),
      ).toEqual(sequencer.shard(tests, { shardIndex, shardCount: 4 }).map((test) => test.path));
    }
  });

  it("spreads the heaviest spec files across shards in snake-draft order", () => {
    const tests = allSpecTests();
    const shards = [1, 2, 3, 4].map((shardIndex) =>
      sequencer.shard(tests, { shardIndex, shardCount: 4 }).map((test) => basename(test.path)),
    );

    // Top 4 heaviest each go to a distinct shard (0, 1, 2, 3).
    for (let i = 0; i < 4; i++) {
      expect(shards[i]).toContain(HeaviestFirst.heaviest[i]);
    }
    // Next 4 heaviest go in reverse order (3, 2, 1, 0) to balance the top pair.
    for (let i = 0; i < 4; i++) {
      expect(shards[3 - i]).toContain(HeaviestFirst.heaviest[4 + i]);
    }
  });

  it("handles synthetic paths that do not exist on disk deterministically", () => {
    const synthetic = ["z.spec.ts", "a.spec.ts", "m.spec.ts", "b.spec.ts"].map((name) =>
      fakeTest(join(packageRoot, "virtual", name)),
    );
    const all = [1, 2].flatMap((shardIndex) =>
      sequencer.shard(synthetic, { shardIndex, shardCount: 2 }).map((test) => test.path),
    );

    expect(all.sort()).toEqual(synthetic.map((test) => test.path).sort());
  });

  it("starts heaviest files first in declared order when sorting", async () => {
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
});
