import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

// Checks the part of VER-SETUP by which no diagnostic carries an error code
// (ADR-NO-ERROR-CODES): no string in the plugin's sources, where every
// message the plugin prints is written, holds a code where a message would
// carry one. A word such as ISO8601 elsewhere in a string is no code.

const sources = join(__dirname, "..", "src");

/** Capital letters followed by at least three digits, with or without a dash, as in NXR001, E0001 or NXR-001. */
const token = String.raw`[A-Z]{1,5}-?\d{3,}`;

/** Such a token where a message carries a code. */
const codeInMessage = new RegExp(
  [
    // At the start, before a dash: "NXR001 - nx-rust could not …".
    String.raw`^\s*(${token})\s+[-–—]\s`,
    // Before a colon: "NXR001: nx-rust could not …".
    String.raw`\b(${token}):`,
    // In brackets: "[E0001] the crate …".
    String.raw`\[(${token})\]`,
    // After "error" or "warning": "error NXR001", "error[E0001]".
    String.raw`\b(?:[Ee]rror|ERROR|[Ww]arning|WARNING)\s*\[?(${token})\b`,
  ].join("|"),
  "g",
);

/** The error codes in `text`. */
function errorCodes(text: string): string[] {
  return [...text.matchAll(codeInMessage)].map(
    (match) => match.slice(1).find((group) => group !== undefined) ?? match[0],
  );
}

/** The text of every string and template literal in a TypeScript file, comments left out. */
function literals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      texts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
}

describe("the plugin's messages", () => {
  const files = readdirSync(sources, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts"))
    .map((path) => join(sources, path));

  it("carry no error code", () => {
    const found = files.flatMap((file) =>
      literals(file).flatMap((text) =>
        errorCodes(text).map((code) => `${relative(sources, file)}: ${code}`),
      ),
    );

    expect(found).toEqual([]);
  });

  // The positive controls: the scan reads the strings of a message, and the
  // pattern finds codes of the usual forms and nothing else.
  it("are read from the strings in the sources", () => {
    const texts = files.flatMap(literals);

    expect(
      texts.some((text) => text.includes("Install a Rust toolchain or put cargo on PATH")),
    ).toBe(true);
    expect(texts.some((text) => text.includes("nx-rust does not know the key "))).toBe(true);
  });

  it.each<[string, string]>([
    ["NXR001: nx-rust could not read rust/Cargo.toml", "NXR001"],
    ["nx-rust could not read rust/Cargo.toml (NXR-042: cargo failed)", "NXR-042"],
    ["[E0001] the crate api", "E0001"],
    ["error[E0001]: the crate api", "E0001"],
    ["error NXR001 in rust/Cargo.toml", "NXR001"],
    ["Warning NXR002: the build directory", "NXR002"],
    ["NXR003 - nx-rust could not read rust/Cargo.toml", "NXR003"],
  ])("would show the code in %j", (text, code) => {
    expect(errorCodes(text)).toEqual([code]);
  });

  it.each([
    "ISO8601",
    "UTF8",
    "SHA256",
    "a SHA-256, in hexadecimal, over the entries",
    "dates in ISO8601 form",
    "Cargo 1.91 on x86_64-unknown-linux-gnu",
    "Nx 24.0.6",
    "v1",
    "ES2022",
    "error: cargo exited with status 101",
  ])("would show no code in %j", (text) => {
    expect(errorCodes(text)).toEqual([]);
  });
});
