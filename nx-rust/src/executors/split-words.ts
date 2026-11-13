/** Why a string cannot be split into words. */
export type SplitProblem = "unterminated-quote" | "trailing-backslash";

/** A string that cannot be split into words. */
export class SplitError extends Error {
  constructor(readonly problem: SplitProblem) {
    super(problem === "unterminated-quote" ? "a quote is not closed" : "it ends in a backslash");
    this.name = "SplitError";
  }
}

// The blanks that separate words outside quotes.
const blanks = new Set([" ", "\t", "\n"]);

// The characters that a backslash escapes inside double quotes, as in a POSIX
// shell; before any other character it stands for itself.
const escapedInDoubleQuotes = new Set(["$", "`", '"', "\\", "\n"]);

/**
 * Splits `value` into words as a POSIX shell splits a command line, without
 * expanding anything (`DES-TARGET-COMMANDS`, paragraph "run").
 *
 * Words are separated by blanks outside quotes. Single quotes keep every
 * character up to the next single quote. Double quotes keep every character
 * up to the next unescaped double quote; a backslash in them escapes `$`,
 * `` ` ``, `"`, `\` and a line break and stands for itself before anything
 * else. Outside quotes a backslash escapes the next character. A backslash
 * before a line break joins the lines, as in a shell. An empty pair of quotes
 * is an empty word. `|`, `;`, `>`, `&&`, `$`, `*` and `#` are ordinary
 * characters.
 *
 * @throws {SplitError} When a quote is not closed, or when `value` ends in a
 *   backslash that escapes nothing.
 */
// @mara implements DES-TARGET-COMMANDS
export function splitWords(value: string): string[] {
  const words: string[] = [];
  let word = "";
  // Whether a word has begun, which an empty pair of quotes also does.
  let inWord = false;
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (blanks.has(character)) {
      if (inWord) {
        words.push(word);
        word = "";
        inWord = false;
      }
      index++;
    } else if (character === "\\") {
      if (index + 1 >= value.length) {
        throw new SplitError("trailing-backslash");
      }
      const next = value[index + 1];
      if (next !== "\n") {
        word += next;
        inWord = true;
      }
      index += 2;
    } else if (character === "'") {
      const end = value.indexOf("'", index + 1);
      if (end === -1) {
        throw new SplitError("unterminated-quote");
      }
      word += value.slice(index + 1, end);
      inWord = true;
      index = end + 1;
    } else if (character === '"') {
      index++;
      let closed = false;
      while (index < value.length) {
        const inner = value[index];
        if (inner === '"') {
          closed = true;
          index++;
          break;
        }
        if (
          inner === "\\" &&
          index + 1 < value.length &&
          escapedInDoubleQuotes.has(value[index + 1])
        ) {
          if (value[index + 1] !== "\n") {
            word += value[index + 1];
          }
          index += 2;
        } else {
          word += inner;
          index++;
        }
      }
      if (!closed) {
        throw new SplitError("unterminated-quote");
      }
      inWord = true;
    } else {
      word += character;
      inWord = true;
      index++;
    }
  }
  if (inWord) {
    words.push(word);
  }
  return words;
}
