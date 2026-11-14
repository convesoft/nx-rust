import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { parsePackageSpec } from "../src/release/manifests";
import { requirementChange } from "../src/release/requirements";
import { elementKey, replaceStrings, scanStrings, TomlEditError } from "../src/release/toml-edit";

// Checks how the version actions edit a manifest and what they make of a
// requirement (VER-RELEASE, group 3, "Requirements" in DES-RELEASE), without
// Nx: release-version.spec.ts runs them through `nx release version`.

/** Every `Cargo.toml` of the fixtures, by path relative to the fixtures folder. */
function fixtureManifests(): [string, string][] {
  const root = join(__dirname, "fixtures");
  const manifests: [string, string][] = [];
  const visit = (folder: string) => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== "target") {
        visit(path);
      } else if (entry.name === "Cargo.toml") {
        manifests.push([path, readFileSync(join(root, path), "utf8")]);
      }
    }
  };
  visit("");
  return manifests;
}

// Layouts that a TOML writer would change, each with every string kind and
// place that the scanner has to get past.
const unusual: [string, string][] = [
  [
    "comments, CRLF and no final newline",
    [
      "﻿# A comment # with hashes",
      "[package] # after a header",
      'name = "a" # "not a string"',
      "version = '0.1.0'",
      "authors = [ # comment",
      '  "x <x@example.com>", # ] in a comment',
      "  'y',",
      "]",
      "",
      "[dependencies]",
      'b = { path = "../b", version = "^0.1", features = ["x", "y]"] }',
      "c.path = '../c'",
      'c.version = """0.1.0"""',
    ].join("\r\n"),
  ],
  [
    "tables, quoted and dotted keys",
    [
      "[ package ]",
      'name = "a"',
      'version = "0.1.0"',
      "",
      "[target.'cfg(unix)'.dependencies.d]",
      "path = '../d'",
      'version = "=0.1.0"',
      "",
      '[target."x86_64-unknown-linux-gnu".dev-dependencies]',
      'e = { path = "../e" , version = "~0.1"}',
      "",
      "[[bin]]",
      'name = "tool"',
      'path = "src/main.rs"',
      "",
      "[[bin]]",
      'name = "other"',
    ].join("\n"),
  ],
  [
    "escapes, multi-line strings and other values",
    [
      "[package]",
      'name = "a\\u0062"',
      'version = "0.1.0"',
      'description = """',
      'A crate with ""quotes"" \\',
      '    and a line ending backslash"""""',
      "license = '''",
      "MIT OR Apache-2.0'''",
      "publish = false",
      'rust-version = "1.91"',
      "",
      "[package.metadata.x]",
      "date = 1979-05-27 07:32:00Z",
      "number = +1_000",
      "float = 6.626e-34",
      "inline = { a = { b = 'c' }, d = [1, [2, 3]] }",
    ].join("\n"),
  ],
];

/** The strings that smol-toml reads outside arrays, by path. */
function stringsOutsideArrays(document: unknown, path: string[] = []): Map<string, string> {
  const strings = new Map<string, string>();
  if (typeof document === "string") {
    strings.set(JSON.stringify(path), document);
  } else if (
    typeof document === "object" &&
    document !== null &&
    !Array.isArray(document) &&
    !(document instanceof Date)
  ) {
    for (const [key, value] of Object.entries(document)) {
      for (const [inner, string] of stringsOutsideArrays(value, [...path, key])) {
        strings.set(inner, string);
      }
    }
  }
  return strings;
}

describe("scanning a manifest for its strings", () => {
  it.each([...fixtureManifests(), ...unusual])(
    "finds in %s every string that TOML reads outside arrays, at its place",
    (_name, text) => {
      const scanned = scanStrings(text);
      const found = new Map(
        scanned
          .filter((string) => !string.path.includes(elementKey))
          .map((string) => [JSON.stringify(string.path), string.value]),
      );

      expect(found).toEqual(stringsOutsideArrays(parse(text)));
      for (const string of scanned) {
        expect(text.slice(string.start, string.start + string.delimiter.length)).toBe(
          string.delimiter,
        );
        expect(text.slice(string.end - string.delimiter.length, string.end)).toBe(string.delimiter);
      }
    },
  );
});

describe("replacing strings in a manifest", () => {
  it("changes only the characters of the strings, and keeps their quotes", () => {
    const [, text] = unusual[0];

    const edited = replaceStrings(text, [
      { path: ["package", "version"], value: "0.2.0" },
      { path: ["dependencies", "b", "version"], value: "^0.2.0" },
      { path: ["dependencies", "c", "version"], value: "0.2.0" },
    ]);

    expect(edited).toBe(
      text
        .replace("version = '0.1.0'", "version = '0.2.0'")
        .replace('version = "^0.1"', 'version = "^0.2.0"')
        .replace('c.version = """0.1.0"""', 'c.version = """0.2.0"""'),
    );
  });

  it("finds a string through quoted keys, table headers with spaces and target tables", () => {
    const [, text] = unusual[1];

    const edited = replaceStrings(text, [
      { path: ["package", "version"], value: "0.2.0" },
      { path: ["target", "cfg(unix)", "dependencies", "d", "version"], value: "=0.2.0" },
      {
        path: ["target", "x86_64-unknown-linux-gnu", "dev-dependencies", "e", "version"],
        value: "~0.2.0",
      },
    ]);

    expect(edited).toBe(
      text
        .replace('version = "0.1.0"', 'version = "0.2.0"')
        .replace('version = "=0.1.0"', 'version = "=0.2.0"')
        .replace('version = "~0.1"', 'version = "~0.2.0"'),
    );
  });

  it("refuses a path that holds no string and a value that the string's quotes cannot hold", () => {
    const [, text] = unusual[0];

    expect(() => replaceStrings(text, [{ path: ["package", "edition"], value: "2024" }])).toThrow(
      new TomlEditError("there is no single string at package.edition"),
    );
    expect(() => replaceStrings(text, [{ path: ["package", "version"], value: "0.2'0" }])).toThrow(
      TomlEditError,
    );
  });

  it("escapes what a basic string cannot hold as it is", () => {
    expect(replaceStrings('a = "x" # c\n', [{ path: ["a"], value: 'y"\\\u0001' }])).toBe(
      'a = "y\\"\\\\\\u0001" # c\n',
    );
  });

  it("leaves a text without edits as it is", () => {
    expect(replaceStrings("not = [toml", [])).toBe("not = [toml");
  });
});

describe("what becomes of a requirement on a crate whose version changes", () => {
  // The table of DES-RELEASE, and the cases around it.
  it.each([
    ["0.1.0", "0.1.4", true, { kind: "keep" }],
    ["^0.1", "0.1.4", true, { kind: "keep" }],
    ["0.1.0", "0.2.0", true, { kind: "rewrite", requirement: "0.2.0" }],
    ["^0.1", "0.2.0", true, { kind: "rewrite", requirement: "^0.2.0" }],
    ["~0.1.0", "0.2.0", true, { kind: "rewrite", requirement: "~0.2.0" }],
    ["=0.1.0", "0.1.4", true, { kind: "rewrite", requirement: "=0.1.4" }],
    [">=0.1, <0.2", "0.1.4", true, { kind: "keep-other" }],
    ["0.1.*", "0.1.4", true, { kind: "keep-other" }],
    [">=0.1, <0.2", "0.2.0", true, { kind: "fail", leaves: true }],
    ["0.1.*", "0.2.0", true, { kind: "fail", leaves: true }],
    ["0.1.0", "0.1.4", false, { kind: "rewrite", requirement: "0.1.4" }],
    ["^0.1", "0.1.4", false, { kind: "rewrite", requirement: "^0.1.4" }],
    ["~0.1.0", "0.1.4", false, { kind: "rewrite", requirement: "~0.1.4" }],
    ["^0.1.4", "0.1.4", false, { kind: "keep" }],
    [">=0.1, <0.2", "0.1.4", false, { kind: "keep-other" }],
    ["0.1.*", "0.1.4", false, { kind: "keep-other" }],
    ["*", "0.2.0", true, { kind: "keep-other" }],
    ["^ 1", "1.4.0", false, { kind: "rewrite", requirement: "^1.4.0" }],
    ["0.1.0", "0.2.0-rc.1", true, { kind: "rewrite", requirement: "0.2.0-rc.1" }],
    [">=0.1", "0.2.0-rc.1", true, { kind: "fail", leaves: false }],
  ])(
    "%s with the new version %s, preserving matching requirements %s",
    (requirement, newVersion, preserve, change) => {
      expect(requirementChange(requirement, newVersion, preserve)).toEqual(change);
    },
  );
});

describe("reading a package ID specification", () => {
  it.each([
    ["base", { name: "base" }],
    ["base:0.1.0", { name: "base", version: "0.1.0" }],
    ["base@0.1", { name: "base", version: "0.1" }],
    [
      "https://github.com/rust-lang/crates.io-index#base@0.1.0",
      { url: "https://github.com/rust-lang/crates.io-index", name: "base", version: "0.1.0" },
    ],
    [
      "path+file:///repo/crates/base#0.1.0",
      { url: "path+file:///repo/crates/base", name: "base", version: "0.1.0" },
    ],
    ["*", undefined],
  ])("%s", (spec, parts) => {
    expect(parsePackageSpec(spec)).toEqual(parts);
  });
});
