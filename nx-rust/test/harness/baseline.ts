import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

// cargo-affected's database for the tests of the test mode (DES-TEST-MODE),
// written with Node's SQLite and the schema of cargo-affected 0.4.1
// (src/db.rs), so that no test needs cargo-affected.

/** The schema of cargo-affected 0.4.1's database, as `Db::open` creates it. */
const cargoAffectedSchema = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS test_regions (
    binary_id TEXT NOT NULL,
    test_name TEXT NOT NULL,
    source_file TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    env_fingerprint TEXT NOT NULL,
    collect_sha TEXT NOT NULL,
    PRIMARY KEY (binary_id, test_name, source_file, line_start, line_end, env_fingerprint, collect_sha)
);
CREATE INDEX IF NOT EXISTS idx_test_regions_lookup
    ON test_regions(source_file, env_fingerprint, collect_sha, line_start, line_end);
CREATE TABLE IF NOT EXISTS fingerprints (fingerprint TEXT PRIMARY KEY, last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fingerprint_components (
    env_fingerprint TEXT NOT NULL,
    label TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    PRIMARY KEY (env_fingerprint, label)
);
`;

/** Opens (or creates) the database of cargo-affected in `workspaceRoot`, in WAL mode. */
export function openBaseline(workspaceRoot: string): DatabaseSync {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const file = join(workspaceRoot, "target", "affected", "coverage.db");
  mkdirSync(dirname(file), { recursive: true });
  const connection = new DatabaseSync(file);
  connection.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  connection.exec(cargoAffectedSchema);
  return connection;
}

/** Adds a row of coverage for each commit, under `fingerprint`. */
export function addCoverage(
  connection: DatabaseSync,
  commits: readonly string[],
  fingerprint = "fp1",
) {
  const insert = connection.prepare(
    "INSERT OR IGNORE INTO test_regions VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  commits.forEach((commit, index) =>
    insert.run("a", `t${index}`, "src/lib.rs", 1, 3, fingerprint, commit),
  );
}

/**
 * Writes cargo-affected's database in `workspaceRoot` with coverage for
 * `commits`, closed as cargo-affected leaves it, without `-wal` and `-shm`.
 */
export function writeBaseline(workspaceRoot: string, commits: readonly string[]): void {
  const connection = openBaseline(workspaceRoot);
  addCoverage(connection, commits);
  connection.close();
}
