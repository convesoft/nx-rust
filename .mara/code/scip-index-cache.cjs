"use strict";
// Caching wrapper for the SCIP indexer that Mara runs for this repository
// (`command` of the `typescript` entry in `.mara/project.toml`).
//
//   node .mara/code/scip-index-cache.cjs {output} <indexer command…>
//
// Mara replaces `{output}` with the file it reads the index from, and accepts
// exactly one `{output}`, so the indexer command names that file `@OUTPUT@`.
// Mara 0.4 keeps no index between calls and runs the indexer for every read,
// edit and validation. This script runs it only when the cache key changed,
// and otherwise copies the index it stored for that key.
//
// The promise: a cached index is the index a fresh run would write, as long
// as all of these are unchanged (the key covers each of them):
// - every file of the checkout that git does not ignore, as far as the
//   indexer can read it: the path and content of each tracked file, and each
//   untracked file outside `.gitignore`, that ends in `.ts`, `.mts`, `.cts`,
//   `.tsx`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.json` or `.svelte`. A deleted,
//   added or renamed file changes the key;
// - every configuration file that the `extends` and `references` chains of
//   the indexer's tsconfig files reach, wherever it lies, even where git
//   ignores it or outside the checkout. The chains start at `tsconfig.json`
//   at the root and in each folder that the command names;
// - the installed state as pnpm records it (`node_modules/.modules.yaml` and
//   `node_modules/.pnpm/lock.yaml`), the `version` of the installed
//   `@sourcegraph/scip-typescript`, of the `typescript` that the checkout and
//   the indexer resolve, and of Node;
// - the command, the checkout's absolute path (the index records it as its
//   project root) and this script.
// Outside the promise: files that git ignores, such as build output in
// `dist`, even where a source imports them; hand edits inside `node_modules`
// that pnpm's record does not show; and whether the indexer can still start,
// since a hit does not run it (with `pnpm` missing from `PATH` or a broken
// installation, a hit still succeeds, and the next miss fails). When in
// doubt, set SCIP_INDEX_CACHE=0.
//
// The script runs the indexer without the cache when git cannot list the
// files, a link in a tsconfig chain is missing or unreadable, or the
// installed packages or pnpm's record cannot be read. In a checkout without
// `node_modules` it does the same, and caching starts with the next call
// (pnpm installs the dependencies before it runs the indexer).
//
// The cache is `node_modules/.cache/mara-scip-index/` of the checkout, which
// git and Mara ignore, and it keeps the last few indexes used. A failed
// indexer run stores nothing, and the script exits with the indexer's status.
// An index is stored only if the key is the same after the run as before it.
// Entries are written to a temporary file and renamed, and carry the SHA-256
// of their content in their name: an empty, corrupt or unreadable entry is
// deleted and counts as a miss. A lock lets one process index while
// concurrent calls wait for its entry; it only saves memory and time, since
// two runs for one key store the same bytes.
//
// Set SCIP_INDEX_CACHE=0 in the environment Mara runs in (the shell, or the
// Mara MCP server) to bypass the cache: the script then always runs the
// indexer and neither reads nor writes the cache.
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OUTPUT = "@OUTPUT@";
const MAX_ENTRIES = 4;
const WAIT_MS = 100;
// A lock older than this is stale even if its process seems to be alive
// (its PID may have been reused); the indexer takes seconds here.
const LOCK_MAX_AGE_MS = 10 * 60 * 1000;
// The files the indexer can read; it indexes Svelte components too.
const READABLE = /\.(?:[cm]?[jt]s|[jt]sx|json|svelte)$/;
const PNPM_RECORD = [".modules.yaml", ".pnpm/lock.yaml"];
const INDEXER_PACKAGE = "@sourcegraph/scip-typescript";

function main() {
  const [output, ...command] = process.argv.slice(2);
  if (!output || command.length === 0 || command.filter((arg) => arg === OUTPUT).length !== 1) {
    process.stderr.write(
      `usage: scip-index-cache.cjs <output> <command…> with one ${OUTPUT} argument\n`,
    );
    return 2;
  }
  const root = process.cwd();
  const modules = path.join(root, "node_modules");
  if (disabled(process.env.SCIP_INDEX_CACHE) || !isDirectory(modules)) {
    return exitCode(index(output, command));
  }
  const cache = path.join(modules, ".cache", "mara-scip-index");
  let run;
  try {
    fs.mkdirSync(cache, { recursive: true });
    const key = cacheKey(root, command);
    const lock = path.join(cache, `${key}.lock`);
    for (;;) {
      if (copyEntry(cache, key, output)) {
        return 0;
      }
      if (takeLock(lock)) {
        try {
          // Another process may have stored the entry since the check above.
          if (copyEntry(cache, key, output)) {
            return 0;
          }
          run = index(output, command);
          if (run.status === 0) {
            store(cache, key, root, command, output);
          }
        } finally {
          fs.rmSync(lock, { force: true });
        }
        return exitCode(run);
      }
      if (staleLock(lock)) {
        fs.rmSync(lock, { force: true });
      } else {
        sleep(WAIT_MS);
      }
    }
  } catch (error) {
    if (run) {
      warn("could not release the lock", error);
      return exitCode(run);
    }
    warn("not caching", error);
    return exitCode(index(output, command));
  }
}

function disabled(value) {
  return value !== undefined && ["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function index(output, command) {
  const args = command.slice(1).map((arg) => (arg === OUTPUT ? output : arg));
  return spawnSync(command[0], args, { stdio: "inherit" });
}

function exitCode(run) {
  if (run.error) {
    warn(`could not start ${run.spawnfile}`, run.error);
    return 1;
  }
  if (run.signal) {
    return 128 + (os.constants.signals[run.signal] ?? 0);
  }
  return run.status;
}

// Throws when a part of the key cannot be established; the caller then runs
// the indexer without the cache.
function cacheKey(root, command) {
  const hash = createHash("sha256");
  const field = (value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  };
  field(root);
  field(JSON.stringify(command));
  field(fs.readFileSync(__filename));
  field(`node ${process.version}`);
  const prefix = Buffer.from(`${root}/`);
  for (const name of gitFiles(root)) {
    field("file");
    field(name);
    fileState(Buffer.concat([prefix, name]), field);
  }
  for (const file of tsconfigChains(root, command)) {
    field("config");
    field(file);
    field(fs.readFileSync(file));
  }
  const modules = path.join(root, "node_modules");
  for (const name of PNPM_RECORD) {
    field(`pnpm ${name}`);
    field(fs.readFileSync(path.join(modules, name)));
  }
  const indexer = packageDirectory(root, INDEXER_PACKAGE);
  field(`${INDEXER_PACKAGE} ${packageVersion(indexer)}`);
  field(`typescript ${packageVersion(packageDirectory(root, "typescript"))}`);
  field(`indexer's typescript ${packageVersion(packageDirectory(indexer, "typescript"))}`);
  return hash.digest("hex");
}

// The tracked files and the untracked ones that git does not ignore, as raw
// names (`-z`, so any byte but NUL may occur), sorted, that the indexer can
// read. A tracked file deleted from the working tree is still listed.
function gitFiles(root) {
  const run = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) {
    throw run.error;
  }
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${run.stderr.toString().trim()}`);
  }
  const names = [];
  let start = 0;
  for (let index = run.stdout.indexOf(0); index !== -1; index = run.stdout.indexOf(0, start)) {
    const name = run.stdout.subarray(start, index);
    if (READABLE.test(name.toString("latin1"))) {
      names.push(name);
    }
    start = index + 1;
  }
  names.sort(Buffer.compare);
  // An unmerged file is listed once per stage.
  return names.filter((name, index) => index === 0 || !name.equals(names[index - 1]));
}

function fileState(file, field) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    field("missing");
    return;
  }
  if (stat.isSymbolicLink()) {
    field("link");
    field(fs.readlinkSync(file, { encoding: "buffer" }));
    if (!isFile(file)) {
      field("not a file");
      return;
    }
  } else if (!stat.isFile()) {
    field("not a file");
    return;
  }
  field("content");
  field(fs.readFileSync(file));
}

// The configuration files that the indexer reads: the tsconfig.json at the
// root and in each folder the command names (or a .json file it names), and
// whatever their `extends` and `references` reach, as TypeScript resolves
// them. A missing start is no link; a missing or unreadable link throws.
function tsconfigChains(root, command) {
  const starts = [path.join(root, "tsconfig.json")];
  for (const argument of command) {
    const candidate = path.resolve(root, argument);
    if (isDirectory(candidate)) {
      starts.push(path.join(candidate, "tsconfig.json"));
    } else if (candidate.endsWith(".json") && isFile(candidate)) {
      starts.push(candidate);
    }
  }
  const reached = new Set();
  const visit = (file, link) => {
    if (reached.has(file)) {
      return;
    }
    if (!isFile(file)) {
      if (link) {
        throw new Error(`tsconfig chain names a missing file: ${file}`);
      }
      return;
    }
    reached.add(file);
    const config = parseJsonc(fs.readFileSync(file, "utf8"), file);
    const directory = path.dirname(file);
    const bases = config.extends === undefined ? [] : [config.extends].flat();
    for (const base of bases) {
      if (typeof base !== "string") {
        throw new Error(`unreadable extends in ${file}`);
      }
      visit(extendedConfig(base, directory), true);
    }
    for (const reference of config.references ?? []) {
      if (typeof reference?.path !== "string") {
        throw new Error(`unreadable references in ${file}`);
      }
      const target = path.resolve(directory, reference.path);
      visit(target.endsWith(".json") ? target : path.join(target, "tsconfig.json"), true);
    }
  };
  for (const start of starts) {
    visit(start, false);
  }
  return [...reached].sort();
}

// As TypeScript does: a relative or absolute path, with `.json` added when
// the file without it does not exist, or else a package's file found in the
// `node_modules` folders upwards.
function extendedConfig(base, directory) {
  if (path.isAbsolute(base) || base.startsWith("./") || base.startsWith("../")) {
    const file = path.resolve(directory, base);
    return isFile(file) || file.endsWith(".json") ? file : `${file}.json`;
  }
  for (const folder of nodeModulesFolders(directory)) {
    const file = path.join(folder, base);
    for (const candidate of [file, `${file}.json`, path.join(file, "tsconfig.json")]) {
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error(`cannot resolve extends "${base}" from ${directory}`);
}

// Comments and trailing commas are allowed in a tsconfig file: the first pass
// drops the comments, the second the commas before a closing bracket.
function parseJsonc(text, file) {
  let uncommented = "";
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < text.length) {
    if (text[index] === '"') {
      const end = stringEnd(text, index, file);
      uncommented += text.slice(index, end);
      index = end;
    } else if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) {
        throw new Error(`unterminated comment in ${file}`);
      }
      uncommented += " ";
      index = end + 2;
    } else {
      uncommented += text[index];
      index += 1;
    }
  }
  let plain = "";
  for (index = 0; index < uncommented.length;) {
    if (uncommented[index] === '"') {
      const end = stringEnd(uncommented, index, file);
      plain += uncommented.slice(index, end);
      index = end;
      continue;
    }
    if (uncommented[index] === ",") {
      let next = index + 1;
      while (/\s/.test(uncommented[next] ?? "")) {
        next += 1;
      }
      if (uncommented[next] === "}" || uncommented[next] === "]") {
        index += 1;
        continue;
      }
    }
    plain += uncommented[index];
    index += 1;
  }
  try {
    return JSON.parse(plain);
  } catch (error) {
    throw new Error(`cannot parse ${file}: ${error.message}`);
  }
}

function stringEnd(text, start, file) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === '"') {
      return index + 1;
    }
  }
  throw new Error(`unterminated string in ${file}`);
}

// The folder of a package as Node resolves it from `from`, with symbolic
// links resolved, so that a package's own dependencies resolve from it.
function packageDirectory(from, name) {
  for (const folder of nodeModulesFolders(from)) {
    const directory = path.join(folder, name);
    if (isFile(path.join(directory, "package.json"))) {
      return fs.realpathSync(directory);
    }
  }
  throw new Error(`cannot find the installed ${name} from ${from}`);
}

function packageVersion(directory) {
  const { version } = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  if (typeof version !== "string") {
    throw new Error(`no version in ${directory}/package.json`);
  }
  return version;
}

function nodeModulesFolders(from) {
  const folders = [];
  for (let current = path.resolve(from); ; current = path.dirname(current)) {
    if (path.basename(current) !== "node_modules") {
      folders.push(path.join(current, "node_modules"));
    }
    if (path.dirname(current) === current) {
      return folders;
    }
  }
}

// Entries are named `<key>.<sha256 of the content>.scip`.
function entries(cache) {
  return fs.readdirSync(cache).filter((name) => /^[0-9a-f]{64}\.[0-9a-f]{64}\.scip$/.test(name));
}

function copyEntry(cache, key, output) {
  for (const name of entries(cache).filter((name) => name.startsWith(`${key}.`))) {
    const file = path.join(cache, name);
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (bytes.length === 0 || sha256(bytes) !== name.slice(65, 129)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    fs.writeFileSync(output, bytes);
    touch(file);
    return true;
  }
  return false;
}

function store(cache, key, root, command, output) {
  try {
    const bytes = fs.readFileSync(output);
    // An index built while a source changed belongs to neither key.
    if (bytes.length === 0 || cacheKey(root, command) !== key) {
      return;
    }
    const temporary = path.join(cache, `.tmp-${process.pid}-${Date.now()}`);
    const descriptor = fs.openSync(temporary, "w");
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, path.join(cache, `${key}.${sha256(bytes)}.scip`));
    prune(cache);
  } catch (error) {
    warn("could not store the index", error);
  }
}

// Keeps the MAX_ENTRIES most recently used entries, and removes temporary
// files and locks that crashed runs left behind.
function prune(cache) {
  const now = Date.now();
  const stated = [];
  for (const name of fs.readdirSync(cache)) {
    try {
      stated.push({ name, mtime: fs.statSync(path.join(cache, name)).mtimeMs });
    } catch {
      // Removed by a concurrent prune.
    }
  }
  const kept = new Set(
    stated
      .filter(({ name }) => name.endsWith(".scip"))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_ENTRIES)
      .map(({ name }) => name),
  );
  for (const { name, mtime } of stated) {
    const leftOver =
      (name.startsWith(".tmp-") || name.endsWith(".lock")) && now - mtime > LOCK_MAX_AGE_MS;
    if ((name.endsWith(".scip") && !kept.has(name)) || leftOver) {
      fs.rmSync(path.join(cache, name), { force: true });
    }
  }
}

function takeLock(lock) {
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
  try {
    fs.writeSync(descriptor, String(process.pid));
  } finally {
    fs.closeSync(descriptor);
  }
  return true;
}

function staleLock(lock) {
  let age;
  let owner;
  try {
    age = Date.now() - fs.statSync(lock).mtimeMs;
    owner = Number(fs.readFileSync(lock, "utf8"));
  } catch {
    // Released meanwhile: try again at once.
    return false;
  }
  if (age > LOCK_MAX_AGE_MS) {
    return true;
  }
  if (!Number.isInteger(owner) || owner <= 0) {
    // The owner writes its PID right after creating the lock.
    return age > 10_000;
  }
  try {
    process.kill(owner, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function touch(file) {
  try {
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch {
    // Only affects which entries a prune keeps.
  }
}

function isDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function warn(message, error) {
  process.stderr.write(`scip-index-cache: ${message}: ${error.message}\n`);
}

if (require.main === module) {
  process.exitCode = main();
} else {
  // For checks of the key: require() the script and compare keys.
  module.exports = { cacheKey, tsconfigChains };
}
