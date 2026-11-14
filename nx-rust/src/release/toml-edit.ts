import { parse } from "smol-toml";

/**
 * A string that a TOML document gives a key, with the place of its text.
 * Strings inside arrays are not listed, because no edit addresses them.
 */
export interface TomlString {
  /**
   * The keys from the document root to the value, decoded, through table
   * headers, dotted keys and inline tables. An array of tables contributes
   * {@link elementKey} after its own keys.
   */
  path: readonly string[];
  /** The offset of the opening delimiter in the text. */
  start: number;
  /** The offset just after the closing delimiter. */
  end: number;
  /** The quotes that open and close the string. */
  delimiter: '"' | "'" | '"""' | "'''";
  /** The string's value, with escapes decoded. */
  value: string;
}

/** A string value to put in place of the one at `path`. */
export interface StringEdit {
  path: readonly string[];
  value: string;
}

/** The text of a TOML document could not be edited as asked. */
export class TomlEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomlEditError";
  }
}

/**
 * The key that stands, in a {@link TomlString.path}, for the element of an
 * array of tables, such as `[[bin]]`. No TOML key can be written as it.
 */
export const elementKey = "\u0000[]";

/**
 * Puts each edit's value in place of the string at its path and changes no
 * other character of `text` (`DES-RELEASE`, "Requirements"): comments,
 * layout, the order of keys, the quotes around each string, line endings
 * and a missing final newline stay as they are. A string between `"` or
 * `"""` gets its value escaped where needed; one between `'` or `'''` takes
 * only a value that it can hold as it is.
 *
 * The places come from {@link scanStrings}, and both texts are parsed with
 * smol-toml afterwards: the edit is refused unless the new document is the
 * old one with exactly the edited values changed, so that a place found
 * wrongly can never change anything else.
 *
 * @throws {TomlEditError} When `text` is no TOML that smol-toml and the
 *   scanner read alike, when a path holds no single string, or when a value
 *   cannot be written between the string's quotes.
 */
// @mara implements DES-RELEASE
export function replaceStrings(text: string, edits: readonly StringEdit[]): string {
  if (edits.length === 0) {
    return text;
  }
  const before = parseDocument(text);
  const strings = scanStrings(text);
  const located = edits.map((edit) => {
    const matches = strings.filter((string) => samePath(string.path, edit.path));
    if (matches.length !== 1) {
      throw new TomlEditError(`there is no single string at ${dotted(edit.path)}`);
    }
    const [string] = matches;
    if (valueAt(before, edit.path) !== string.value) {
      throw new TomlEditError(`the string at ${dotted(edit.path)} was not read as TOML reads it`);
    }
    return { string, value: edit.value };
  });
  let result = text;
  for (const { string, value } of [...located].sort((a, b) => b.string.start - a.string.start)) {
    const token = `${string.delimiter}${quoted(value, string)}${string.delimiter}`;
    result = result.slice(0, string.start) + token + result.slice(string.end);
  }
  const expected = parseDocument(text);
  for (const edit of edits) {
    setValueAt(expected, edit.path, edit.value);
  }
  if (JSON.stringify(parseDocument(result)) !== JSON.stringify(expected)) {
    throw new TomlEditError("the edit would change more than the strings it was asked to");
  }
  return result;
}

/**
 * The strings that `text` gives keys, in the order in which they appear,
 * each with its place ({@link TomlString}).
 *
 * A scanner of its own, because smol-toml reports no places: it follows
 * TOML's syntax as far as finding the strings needs, with comments,
 * multi-line arrays and inline tables, dotted and quoted keys, the four
 * kinds of string, CRLF line endings and a byte order mark, and checks the
 * rest only as far as it has to in order not to lose its place.
 *
 * @throws {TomlEditError} Where the text is not TOML as the scanner reads it.
 */
export function scanStrings(text: string): TomlString[] {
  return new Scanner(text).document();
}

class Scanner {
  private pos = 0;
  private readonly strings: TomlString[] = [];

  constructor(private readonly text: string) {}

  document(): TomlString[] {
    if (this.text.charCodeAt(0) === 0xfeff) {
      this.pos = 1;
    }
    let table: string[] = [];
    for (;;) {
      this.skipBlank();
      if (this.pos >= this.text.length) {
        return this.strings;
      }
      if (this.text[this.pos] === "[") {
        const arrayOfTables = this.text.startsWith("[[", this.pos);
        this.pos += arrayOfTables ? 2 : 1;
        this.skipSpaces();
        const keys = this.key();
        this.skipSpaces();
        this.expect(arrayOfTables ? "]]" : "]");
        table = arrayOfTables ? [...keys, elementKey] : keys;
      } else {
        const keys = this.key();
        this.skipSpaces();
        this.expect("=");
        this.skipSpaces();
        this.value([...table, ...keys]);
      }
      this.endOfLine();
    }
  }

  // A value at `path`, which is undefined inside an array.
  private value(path: string[] | undefined): void {
    const start = this.pos;
    let delimiter: TomlString["delimiter"];
    let value: string;
    if (this.text.startsWith('"""', this.pos)) {
      delimiter = '"""';
      value = this.multiLineString('"""');
    } else if (this.text.startsWith("'''", this.pos)) {
      delimiter = "'''";
      value = this.multiLineString("'''");
    } else if (this.text[this.pos] === '"') {
      delimiter = '"';
      value = this.basicString();
    } else if (this.text[this.pos] === "'") {
      delimiter = "'";
      value = this.literalString();
    } else if (this.text[this.pos] === "[") {
      this.array();
      return;
    } else if (this.text[this.pos] === "{") {
      this.inlineTable(path);
      return;
    } else {
      this.scalar();
      return;
    }
    if (path !== undefined) {
      this.strings.push({ path, start, end: this.pos, delimiter, value });
    }
  }

  private array(): void {
    this.pos += 1;
    for (;;) {
      this.skipBlank();
      if (this.text[this.pos] === "]") {
        this.pos += 1;
        return;
      }
      this.value(undefined);
      this.skipBlank();
      if (this.text[this.pos] === ",") {
        this.pos += 1;
        continue;
      }
      this.expect("]");
      return;
    }
  }

  // Newlines and comments are allowed inside, as TOML 1.1 allows them.
  private inlineTable(path: string[] | undefined): void {
    this.pos += 1;
    for (;;) {
      this.skipBlank();
      if (this.text[this.pos] === "}") {
        this.pos += 1;
        return;
      }
      const keys = this.key();
      this.skipSpaces();
      this.expect("=");
      this.skipSpaces();
      this.value(path === undefined ? undefined : [...path, ...keys]);
      this.skipBlank();
      if (this.text[this.pos] === ",") {
        this.pos += 1;
        continue;
      }
      this.expect("}");
      return;
    }
  }

  // A number, boolean or date, which may hold a space between date and time.
  private scalar(): void {
    const start = this.pos;
    while (this.pos < this.text.length && !",]}#\r\n".includes(this.text[this.pos])) {
      this.pos += 1;
    }
    if (this.text.slice(start, this.pos).trim() === "") {
      this.fail("a value");
    }
  }

  private key(): string[] {
    const keys = [this.simpleKey()];
    for (;;) {
      const save = this.pos;
      this.skipSpaces();
      if (this.text[this.pos] !== ".") {
        this.pos = save;
        return keys;
      }
      this.pos += 1;
      this.skipSpaces();
      keys.push(this.simpleKey());
    }
  }

  private simpleKey(): string {
    if (this.text[this.pos] === '"') {
      return this.basicString();
    }
    if (this.text[this.pos] === "'") {
      return this.literalString();
    }
    const bare = /[A-Za-z0-9_-]+/y;
    bare.lastIndex = this.pos;
    const match = bare.exec(this.text);
    if (match === null) {
      this.fail("a key");
    }
    this.pos += match[0].length;
    return match[0];
  }

  private basicString(): string {
    this.pos += 1;
    let value = "";
    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined || char === "\n" || char === "\r") {
        this.fail('a closing "');
      }
      if (char === '"') {
        this.pos += 1;
        return value;
      }
      if (char === "\\") {
        value += this.escape();
      } else {
        value += char;
        this.pos += 1;
      }
    }
  }

  private literalString(): string {
    const end = this.text.indexOf("'", this.pos + 1);
    const newline = this.text.slice(this.pos + 1, end).search(/[\r\n]/);
    if (end < 0 || newline >= 0) {
      this.fail("a closing '");
    }
    const value = this.text.slice(this.pos + 1, end);
    this.pos = end + 1;
    return value;
  }

  private multiLineString(delimiter: '"""' | "'''"): string {
    this.pos += 3;
    // A newline right after the opening delimiter is not part of the value.
    if (this.text.startsWith("\r\n", this.pos)) {
      this.pos += 2;
    } else if (this.text[this.pos] === "\n") {
      this.pos += 1;
    }
    const quote = delimiter[0];
    let value = "";
    for (;;) {
      if (this.pos >= this.text.length) {
        this.fail(`a closing ${delimiter}`);
      }
      if (this.text.startsWith(delimiter, this.pos)) {
        // Up to two more quotes before the delimiter belong to the value.
        let quotes = 0;
        while (this.text[this.pos + quotes] === quote) {
          quotes += 1;
        }
        value += quote.repeat(Math.min(quotes - 3, 2));
        this.pos += quotes;
        return value;
      }
      const char = this.text[this.pos];
      if (char === "\\" && delimiter === '"""') {
        const lineEnding = /\\[ \t]*\r?\n[ \t\r\n]*/y;
        lineEnding.lastIndex = this.pos;
        const match = lineEnding.exec(this.text);
        if (match !== null) {
          this.pos += match[0].length;
        } else {
          value += this.escape();
        }
      } else {
        value += char;
        this.pos += 1;
      }
    }
  }

  // The escape sequence at the backslash at the current place, decoded.
  private escape(): string {
    const char = this.text[this.pos + 1];
    const simple: Record<string, string> = {
      b: "\b",
      t: "\t",
      n: "\n",
      f: "\f",
      r: "\r",
      e: "\u001b",
      '"': '"',
      "\\": "\\",
    };
    if (char !== undefined && char in simple) {
      this.pos += 2;
      return simple[char];
    }
    const digits = char === "x" ? 2 : char === "u" ? 4 : char === "U" ? 8 : 0;
    const hex = this.text.slice(this.pos + 2, this.pos + 2 + digits);
    if (digits === 0 || !new RegExp(`^[0-9A-Fa-f]{${digits}}$`).test(hex)) {
      this.fail("an escape sequence");
    }
    this.pos += 2 + digits;
    return String.fromCodePoint(Number.parseInt(hex, 16));
  }

  private skipSpaces(): void {
    while (this.text[this.pos] === " " || this.text[this.pos] === "\t") {
      this.pos += 1;
    }
  }

  // Spaces, line endings and comments.
  private skipBlank(): void {
    for (;;) {
      this.skipSpaces();
      if (this.text[this.pos] === "#") {
        this.skipComment();
      } else if (this.text[this.pos] === "\n") {
        this.pos += 1;
      } else if (this.text.startsWith("\r\n", this.pos)) {
        this.pos += 2;
      } else {
        return;
      }
    }
  }

  private skipComment(): void {
    while (this.pos < this.text.length && this.text[this.pos] !== "\n") {
      if (this.text.startsWith("\r\n", this.pos)) {
        return;
      }
      this.pos += 1;
    }
  }

  private endOfLine(): void {
    this.skipSpaces();
    if (this.text[this.pos] === "#") {
      this.skipComment();
    }
    if (this.pos >= this.text.length) {
      return;
    }
    if (this.text[this.pos] === "\n") {
      this.pos += 1;
    } else if (this.text.startsWith("\r\n", this.pos)) {
      this.pos += 2;
    } else {
      this.fail("the end of the line");
    }
  }

  private expect(token: string): void {
    if (!this.text.startsWith(token, this.pos)) {
      this.fail(`"${token}"`);
    }
    this.pos += token.length;
  }

  private fail(expected: string): never {
    const line = this.text.slice(0, this.pos).split("\n").length;
    throw new TomlEditError(`expected ${expected} on line ${line}`);
  }
}

function parseDocument(text: string): Record<string, unknown> {
  try {
    return parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new TomlEditError(
      `the text is no valid TOML (${(error as Error).message.split("\n")[0]})`,
    );
  }
}

function valueAt(document: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = document;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function setValueAt(
  document: Record<string, unknown>,
  path: readonly string[],
  value: string,
): void {
  const parent = valueAt(document, path.slice(0, -1));
  if (typeof parent !== "object" || parent === null || Array.isArray(parent)) {
    throw new TomlEditError(`there is no table at ${dotted(path.slice(0, -1))}`);
  }
  (parent as Record<string, unknown>)[path[path.length - 1]] = value;
}

// The value written so that it reads back as itself between the quotes of `string`.
function quoted(value: string, string: TomlString): string {
  const chars = [...value];
  if (string.delimiter === "'" || string.delimiter === "'''") {
    if (chars.some((char) => char === "'" || isControl(char))) {
      throw new TomlEditError(
        `the value ${JSON.stringify(value)} cannot be written between ${string.delimiter} at ${dotted(string.path)}`,
      );
    }
    return value;
  }
  return chars
    .map((char) =>
      char === "\\" || char === '"'
        ? `\\${char}`
        : isControl(char)
          ? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
          : char,
    )
    .join("");
}

// A control character, which a TOML string holds only escaped.
function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** A path written as TOML would write it in a table header, for messages. */
export function dotted(path: readonly string[]): string {
  return path
    .map((key) =>
      key === elementKey ? "[]" : /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key),
    )
    .join(".");
}
