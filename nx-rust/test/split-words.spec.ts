import { splitWords } from "../src/executors/split-words";

// The splitting of the `args` option of `run` (DES-TARGET-COMMANDS, paragraph
// "run"). run-arguments.spec.ts runs a few values through Nx, to show that the
// words reach the binary as this function gives them.

describe("splitWords", () => {
  it.each<[string, string[]]>([
    ["", []],
    ["   ", []],
    ["--port 3000", ["--port", "3000"]],
    ["--port 3000 --log a,b", ["--port", "3000", "--log", "a,b"]],
    [" \ta\n b ", ["a", "b"]],
    ["a '' b", ["a", "", "b"]],
    ['""', [""]],
    ['a\\ b "c d" e', ["a b", "c d", "e"]],
    ["'a \"b\" \\c'", ['a "b" \\c']],
    ['"a \\" \\\\ \\$ \\` \\x"', ['a " \\ $ ` \\x']],
    ["x'y'\"z\"", ["xyz"]],
    ["\\'", ["'"]],
    ["a\\\nb", ["ab"]],
    ['"a\\\nb"', ["ab"]],
    ["a | b; c > d && e", ["a", "|", "b;", "c", ">", "d", "&&", "e"]],
    ["$HOME ~ *.rs #comment `cmd` $(cmd)", ["$HOME", "~", "*.rs", "#comment", "`cmd`", "$(cmd)"]],
    ["$HOME \"$PATH\" *.rs #x '\\n'", ["$HOME", "$PATH", "*.rs", "#x", "\\n"]],
  ])("splits %j into %j", (value, words) => {
    expect(splitWords(value)).toEqual(words);
  });

  it.each<[string, string]>([
    ["'open", "unterminated-quote"],
    ['say "hi', "unterminated-quote"],
    ['"a\\"', "unterminated-quote"],
    ["a\\", "trailing-backslash"],
  ])("rejects %j", (value, problem) => {
    expect(() => splitWords(value)).toThrow(
      expect.objectContaining({ name: "SplitError", problem }),
    );
  });
});
