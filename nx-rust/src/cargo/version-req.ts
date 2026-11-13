/**
 * Whether `version` satisfies the Cargo version requirement `req`, as the
 * `cargo metadata` report writes it, or `undefined` when the plugin cannot
 * tell.
 *
 * Supported: comparators joined by commas, each with no operator (a caret
 * requirement), `^`, `~`, `=`, `>`, `>=`, `<` or `<=` and a version of one,
 * two or three numbers, and the wildcards `*`, `1.*` and `1.2.*` without an
 * operator. Build metadata on `version` is ignored, as Cargo ignores it. A
 * pre-release, on either side, and every other form give `undefined`.
 */
// @mara implements DES-PROJECT-GRAPH
export function satisfies(req: string, version: string): boolean | undefined {
  const parsed = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!parsed) {
    return undefined;
  }
  const v: Triple = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  const comparators = req.split(",").map((part) => part.trim());
  let result = true;
  for (const comparator of comparators) {
    const range = rangeOf(comparator);
    if (range === undefined) {
      return undefined;
    }
    result &&= compare(v, range.min) >= 0 && (range.max === undefined || compare(v, range.max) < 0);
  }
  return result;
}

type Triple = [number, number, number];

/** The versions a comparator accepts: at least `min` and, where set, below `max`. */
interface Range {
  min: Triple;
  max?: Triple;
}

const wildcard = /^[*xX]$/;

function rangeOf(comparator: string): Range | undefined {
  const match = /^(\^|~|=|>=|<=|>|<)?\s*([^\s]+)$/.exec(comparator);
  if (!match) {
    return undefined;
  }
  const [, op = "", text] = match;
  const parts = text.split(".");
  if (parts.length > 3) {
    return undefined;
  }
  // The leading numbers before the first wildcard, if any.
  const numbers: number[] = [];
  let wild = false;
  for (const part of parts) {
    if (wildcard.test(part)) {
      wild = true;
    } else if (/^\d+$/.test(part) && !wild) {
      numbers.push(Number(part));
    } else {
      return undefined;
    }
  }
  if (wild) {
    // Cargo reads `*`, `1.*` and `1.2.*` like `=` with fewer numbers.
    return op === "" ? partialRange("=", numbers) : undefined;
  }
  return partialRange(op === "" ? "^" : op, numbers);
}

// The range of an operator with one to three numbers, or none for `=`.
function partialRange(op: string, n: number[]): Range | undefined {
  const [major = 0, minor = 0, patch = 0] = n;
  const exact: Triple = [major, minor, patch];
  switch (op) {
    case "^":
      if (n.length === 0) {
        return undefined;
      }
      if (major > 0 || n.length === 1) {
        return { min: exact, max: [major + 1, 0, 0] };
      }
      if (minor > 0 || n.length === 2) {
        return { min: exact, max: [0, minor + 1, 0] };
      }
      return { min: exact, max: [0, 0, patch + 1] };
    case "~":
      if (n.length === 0) {
        return undefined;
      }
      return n.length === 1
        ? { min: exact, max: [major + 1, 0, 0] }
        : { min: exact, max: [major, minor + 1, 0] };
    case "=":
      return n.length === 0
        ? { min: [0, 0, 0] }
        : n.length === 1
          ? { min: exact, max: [major + 1, 0, 0] }
          : n.length === 2
            ? { min: exact, max: [major, minor + 1, 0] }
            : { min: exact, max: [major, minor, patch + 1] };
    case ">":
      return n.length === 1
        ? { min: [major + 1, 0, 0] }
        : n.length === 2
          ? { min: [major, minor + 1, 0] }
          : n.length === 3
            ? { min: [major, minor, patch + 1] }
            : undefined;
    case ">=":
      return n.length === 0 ? undefined : { min: exact };
    case "<":
      return n.length === 0 ? undefined : { min: [0, 0, 0], max: exact };
    case "<=":
      return n.length === 1
        ? { min: [0, 0, 0], max: [major + 1, 0, 0] }
        : n.length === 2
          ? { min: [0, 0, 0], max: [major, minor + 1, 0] }
          : n.length === 3
            ? { min: [0, 0, 0], max: [major, minor, patch + 1] }
            : undefined;
    default:
      return undefined;
  }
}

function compare(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
