import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

// Checks the part of VER-SETUP by which no message of the plugin carries an
// error code (ADR-NO-ERROR-CODES): no string in the plugin's sources, where
// every message the plugin prints is written, has the form of one.

const sources = join(__dirname, "..", "src");

/** Letters followed by digits, with or without a dash, as in NXR001, E0001 or NXR-001. */
const errorCode = /\b[A-Z]{1,5}-?\d{3,}\b/g;

/** Strings of that form that name something else. */
const notCodes = new Set(["SHA-256"]);

/** The error codes in `text`. */
function errorCodes(text: string): string[] {
  return [...text.matchAll(errorCode)]
    .map(([match]) => match)
    .filter((match) => !notCodes.has(match));
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
  // pattern finds codes of the usual forms.
  it("are read from the strings in the sources", () => {
    const texts = files.flatMap(literals);

    expect(
      texts.some((text) => text.includes("Install a Rust toolchain or put cargo on PATH")),
    ).toBe(true);
    expect(texts.some((text) => text.includes("nx-rust does not know the key "))).toBe(true);
  });

  it("would show a code of the usual forms", () => {
    expect(errorCodes("NXR001: nx-rust could not read rust/Cargo.toml")).toEqual(["NXR001"]);
    expect(errorCodes("error[E0001]: the crate api")).toEqual(["E0001"]);
    expect(errorCodes("nx-rust (NXR-042) failed")).toEqual(["NXR-042"]);
    expect(errorCodes("a SHA-256 over Cargo 1.91 on x86_64")).toEqual([]);
  });
});
