import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Writes into `directory` a copy of the `nx` package of this repository
 * whose `package.json` gives `version`, and returns the copy's folder.
 *
 * A test links a workspace's `node_modules/nx` to it to see what the plugin
 * does with an Nx release that is not installed: the plugin reads the
 * version of the installed Nx from that `package.json`, and so does Nx
 * itself. Both the Nx that runs and the Nx that the workspace has installed
 * then report `version`, as after a real upgrade, so that Nx keeps its
 * daemon, which it turns off when the two differ. Everything else is the
 * real Nx.
 *
 * The copy finds what the real package finds: the `node_modules` folder
 * beside it holds a link to each package that Node.js resolves from the
 * real package's folder, nearest folder first, such as Nx's dependencies
 * and the `typescript` of this repository. Its files are hard links to the
 * real ones where the file system allows it, and copies elsewhere.
 */
export function fakeNxPackage(directory: string, version: string): string {
  const real = realpathSync(dirname(require.resolve("nx/package.json")));
  const modules = join(directory, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const folder of lookupFolders(real)) {
    linkPackages(folder, modules, ["nx"]);
  }
  const copy = join(modules, "nx");
  linkTree(real, copy);
  const packageJson = join(copy, "package.json");
  const content = JSON.parse(readFileSync(packageJson, "utf8"));
  // A hard link: writing through it would change the real package.
  unlinkSync(packageJson);
  writeFileSync(packageJson, `${JSON.stringify({ ...content, version }, null, 2)}\n`);
  return copy;
}

// The `node_modules` folders in which Node.js looks for a package required
// from a module in `packageFolder`, nearest first, apart from the package's
// own.
function lookupFolders(packageFolder: string): string[] {
  const folders: string[] = [];
  for (let dir = dirname(packageFolder); dirname(dir) !== dir; dir = dirname(dir)) {
    if (basename(dir) !== "node_modules") {
      folders.push(join(dir, "node_modules"));
    }
  }
  return folders.filter((folder) => existsSync(folder));
}

// Links each package in `source` into `destination` that `destination` does
// not have yet, scoped packages one by one, so that the nearest folder wins
// as it does for Node.js. Entries that are no package, such as `.bin`, and
// those named in `skip` stay out.
function linkPackages(source: string, destination: string, skip: string[] = []): void {
  for (const entry of readdirSync(source)) {
    if (entry.startsWith(".") || skip.includes(entry)) {
      continue;
    }
    if (entry.startsWith("@")) {
      mkdirSync(join(destination, entry), { recursive: true });
      linkPackages(join(source, entry), join(destination, entry));
    } else if (!lstatSync(join(destination, entry), { throwIfNoEntry: false })) {
      symlinkSync(join(source, entry), join(destination, entry));
    }
  }
}

// Recreates the tree at `source` in `destination`: folders as folders,
// symbolic links as the same links, files as hard links or copies.
function linkTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      linkTree(from, to);
    } else if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to);
    } else {
      try {
        linkSync(from, to);
      } catch {
        copyFileSync(from, to);
      }
    }
  }
}
