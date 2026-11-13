import { splitWords } from "../src/executors/split-words";

// The splitting of the `args` option of `run` (DES-TARGET-COMMANDS, paragraph
// "run"), beyond the cases that run-arguments.spec.ts runs through Nx.

describe("splitWords", () => {
  it.each<[string, string[]]>([
    ["", []],
    ["   ", []],
    ["--port 3000", ["--port", "3000"]],
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
