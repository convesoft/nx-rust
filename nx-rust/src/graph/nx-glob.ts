import { join } from "node:path";

/**
 * Whether one segment of a glob matches the name of a folder, as a folder
 * that more of the glob follows. `true` where it cannot tell, which can only
 * add files to a key or keep an error.
 */
export type SegmentMatcher = (segment: string, name: string) => boolean;

const matchers = new Map<string, SegmentMatcher>();

/**
 * Nx's own glob matching for one segment of a fileset, as the hasher and
 * `nx affected` apply it (`EVD-NX-24-FILESET-SCOPE`): `matchGlobPaths` of
 * Nx's native module runs the engine that builds the globs of filesets
 * (`build_glob_set` in Nx's `native/glob.rs`), with its conversion of
 * extended groups such as `@(a|b)`, `!(a)` and `*(a)`, of classes and of
 * escapes. The segment is matched followed by one more segment, so that a
 * group gets the reading that Nx gives a segment that is not the last.
 *
 * Where the installed Nx lacks the function, the plugin's own reading
 * applies ({@link globSegmentMatches}).
 *
 * @param workspaceRoot The repository root, from which Nx is resolved as Nx resolves itself.
 */
// @mara implements DES-INPUTS
export function nxSegmentMatcher(workspaceRoot: string): SegmentMatcher {
  let matcher = matchers.get(workspaceRoot);
  if (matcher === undefined) {
    const match = nativeMatch(workspaceRoot);
    matcher =
      match === undefined
        ? globSegmentMatches
        : (segment, name) => {
            try {
              return match([`${segment}/x`], [`${name}/x`])[0] !== false;
            } catch {
              return true;
            }
          };
    matchers.set(workspaceRoot, matcher);
  }
  return matcher;
}

type MatchGlobPaths = (globs: string[], paths: string[]) => boolean[];

// `matchGlobPaths` of the Nx that resolves from the repository, as the
// version check and the build input check resolve it; else of the plugin's.
function nativeMatch(workspaceRoot: string): MatchGlobPaths | undefined {
  for (const paths of [[join(workspaceRoot, ".nx", "installation"), workspaceRoot], undefined]) {
    try {
      const native = require(require.resolve("nx/src/native", paths && { paths }));
      if (typeof native?.matchGlobPaths === "function") {
        return native.matchGlobPaths as MatchGlobPaths;
      }
    } catch {
      // Not there; try the next.
    }
  }
  return undefined;
}

/**
 * The plugin's own reading of a segment, where Nx's is not at hand: `*` and
 * `?` stand for any characters but `/`, a `[...]` class for one of its
 * characters, and a backslash makes the next character literal. A segment
 * with a group or a brace is taken to match.
 */
export function globSegmentMatches(segment: string, name: string): boolean {
  if (/[(){}]/.test(segment)) {
    return true;
  }
  let source = "";
  for (let index = 0; index < segment.length; index++) {
    const character = segment[index];
    if (character === "\\" && index + 1 < segment.length) {
      source += escapeRegExp(segment[++index]);
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else if (character === "[") {
      const end = classEnd(segment, index);
      if (end === undefined) {
        source += "\\[";
      } else {
        const body = segment.slice(index + 1, end);
        const negated = body.startsWith("!") || body.startsWith("^");
        const members = (negated ? body.slice(1) : body).replace(/[\]\\^[]/g, (c) => `\\${c}`);
        source += `[${negated ? "^" : ""}${members}]`;
        index = end;
      }
    } else {
      source += escapeRegExp(character);
    }
  }
  try {
    return new RegExp(`^${source}$`).test(name);
  } catch {
    return true;
  }
}

/**
 * The name that a segment of a fileset stands for where Nx reads it as a
 * name and not as a pattern, its escapes resolved; `undefined` for a
 * pattern. As Nx's `literal_segment`: `*`, `?`, a class, a brace or a group
 * make a pattern, while `!`, `+` and `@` count as characters unless a `(`
 * follows (`EVD-NX-24-FILESET-SCOPE`).
 */
export function literalSegment(segment: string): string | undefined {
  if (segment === "" || !/[*?[\]{}()!+@\\]/.test(segment)) {
    return segment === "" ? undefined : segment;
  }
  let name = "";
  for (let index = 0; index < segment.length; index++) {
    const character = segment[index];
    if (character === "\\") {
      if (index + 1 >= segment.length) {
        return undefined;
      }
      name += segment[++index];
    } else if ("!+@".includes(character) && segment[index + 1] !== "(") {
      name += character;
    } else if ("*?[]{}()!+@".includes(character)) {
      return undefined;
    } else {
      name += character;
    }
  }
  return name === "." || name === ".." ? undefined : name;
}

/** The index of the `]` that closes the class opened at `open`, if any. */
function classEnd(segment: string, open: number): number | undefined {
  let index = open + 1;
  if (segment[index] === "!" || segment[index] === "^") {
    index++;
  }
  if (segment[index] === "]") {
    index++;
  }
  for (; index < segment.length; index++) {
    if (segment[index] === "\\") {
      index++;
    } else if (segment[index] === "]") {
      return index;
    }
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, (character) => `\\${character}`);
}
