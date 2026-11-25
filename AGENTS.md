# Agent instructions

**IMPORTANT**: this project tracks its work with zban. If your instructions already
contain the zban workflow guide (it starts with `# zban workflow`), for example from
the zban MCP server, follow it and use the zban tools. Otherwise, before anything
else, run `zban prime` and follow its output.

Use the zban and Mara MCP servers when your client has them configured (pointed
at `@convesoft/mara` 0.4). In a worktree, pass `directory` (zban) and `project`
(Mara) on every MCP call, or start the session in that worktree. Without MCP,
use `zban` on your `PATH` (or `pnpm zban`) and `pnpm mara` (installed as a
devDependency; run `pnpm mara prime` for its workflow guide). The rules below
add to the guide.

## Project

nx-rust (`@convesoft/nx-rust`) is an Nx plugin that makes Cargo workspaces
first-class Nx projects while Cargo stays the build tool. It is written first
for Nx monorepos that mix JS/TS and Rust. The design is specified in Mara.
Milestones 0.1 to 0.5 are implemented on `main`, and 1.0 release candidates are
published on npm under the `next` dist-tag (`ADR-PUBLISHING-AT-1-0`); what is
left of v1 is real-repository validation in 1.0. v1 was delivered in 0.x
milestones, each of them an epic in zban, none published on its own.

The principles every change has to respect:

- Cargo is the source of truth. Projects, targets and dependencies come from
  `cargo metadata`, never from per-crate Nx files (`GOAL-CARGO-NATIVE`).
- Plain `cargo` and rust-analyzer behave as they would without the plugin
  (`REQ-CARGO-UNCHANGED`).
- Nx caches task results and final artifacts only, never Cargo's build
  directory (`ADR-RESULTS-ONLY-CACHE`).
- Cache correctness over cache ambition: running more than a cache key promises
  is fine, running less is not (`GOAL-TRUSTED-CACHE`).

## Where things live

| Path                     | Owns                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `nx-rust/`               | The plugin package, published as `@convesoft/nx-rust`                                                                                |
| `nx-rust/src/`           | The implementation                                                                                                                   |
| `nx-rust/docs/*.mara.md` | Goals, needs, terms, scenarios, requirements, design, decisions, risks, evidence and verification as Mara items, plus the user guide |
| `nx-rust-e2e/`           | End-to-end tests, which install the built plugin from a local registry                                                               |
| `tools/scripts/`         | The local registry scripts the end-to-end tests use                                                                                  |
| `.mara/`                 | Mara schema, rules and policies. Do not change these as a side effect of other work.                                                 |
| `.zban/`                 | This repository's backlog, in zban's issue format                                                                                    |

## Knowledge versus backlog

- Durable knowledge lives only in Mara: what nx-rust must do and why, how it is
  designed, and how that is checked.
- Issues in `.zban/` say what to do next and cite Mara IDs such as `DES-INPUTS` or
  `VER-CACHE-KEYS`. Never copy requirement or design text into an issue. An issue
  body holds only task-specific steps, notes and the result summary.
- If work reveals a new or changed product decision, update the Mara items first
  (in the same change), then cite them. Do not leave decisions only in an issue,
  a commit message or a PR.
- A spike ends in knowledge, not only in a closed issue: record what was found as
  an evidence item (`EVD-`) and update the risks, designs and decisions it
  concerns.
- Read a cited item with the Mara MCP `get` tool or `pnpm mara get <ID>`, and
  follow `relation list` (`pnpm mara relation list <ID>`) for its context.

## Working on an issue

The zban guide covers finding, starting, updating and closing issues. In this
repository, also:

- Read the Mara items an issue cites before writing code.
- Set an issue `done` only when its `Done when` checks actually pass, apart from
  CI on its own pull request (next rule), and name the checks you ran in
  `## Summary of Changes`.
- If the only check left is CI on the issue's own pull request, tick it, close
  the issue in that pull request and say in `## Summary of Changes` that CI on
  the pull request covers it. If CI fails, fix it in the same pull request.
- Create issues only with `zban create` or the `create_issue` tool, which
  generate an ID that is unused in `.zban/` and `.zban/archive/`. Never choose
  an ID yourself.
- Keep to one issue per pull request: file newly discovered work as a new issue
  with `--discovered-from` rather than widening the current one.

## Scope

`ADR-V1-SCOPE` and `ADR-SINGLE-MACHINE` list what v1 excludes: installing
toolchains or tools, hermetic or sandboxed builds, Windows hosts, writing Cargo
manifests outside generators and release, cross-compiling Node addons, wasm
tests, tests on triples other than the host, npm publishing, migration from
`@monodon/rust`, formatting Rust through `nx format` and distributed execution.
Do not add such capabilities, even when similar plugins have them.
If something seems necessary, propose a draft need and decision in Mara and ask
the user before implementing it.

## Mara

- Use the Mara MCP tools (when pointed at `@convesoft/mara` 0.4) or `pnpm mara`
  (run `pnpm mara prime` for the workflow guide) with the repository root as the
  project root. Inspect `pnpm mara schema get <name>` before choosing a type or
  relation.
- After changing knowledge, run `pnpm mara schema validate` and
  `pnpm mara project validate` and require 0 errors. The engineering invariants
  in `.mara/rules/knowledge.dl` require every accepted requirement to have an
  accepted basis and an accepted verification, every accepted design to have an
  accepted basis, and an accepted item to point only at accepted items through
  `Satisfies`, `Verifies`, `Mitigates`, `Threatens`, `Accepts` and similar
  relations.
- `Accepted` means agreed, not implemented or tested. Cite actual test runs as
  evidence of completion.
- `Draft` items are areas that are named but not designed. Each ends with its
  open questions. Settling one means rewriting the item, removing its `Open:`
  paragraph and accepting it together with whatever the policies then require,
  after the user has agreed to the answers.
- Never make up a MID, change one, or copy an anchor (`<a id="…"></a>`) to
  another item. Create items with `pnpm mara item create`, or write the item by
  hand separated by `---` and run `pnpm mara project fix`.
- Link implementing code with comment markers on their own comment line, for
  example `// @mara implements DES-DISCOVERY`. `.mara/config.toml` scans
  TypeScript sources for these markers under `[code.languages.typescript]`.
  Confirm the link with `pnpm mara relation list <ID>` or
  `pnpm mara query execute implemented --id <ID>`.

## Documentation layout

Each topic page in `nx-rust/docs/` serves users and engineering at once. It
opens with user-facing guidance (examples and tables) and then has
`## Requirements`, `## Design` and, where useful, `## Scenario` sections holding
the Mara items. The guidance explains and the items are normative; keep them
consistent and avoid restating item text at length. Goals, needs and terms
belong in `product.mara.md`; decisions, risks, evidence and sources in
`decisions.mara.md`; and checks in `verification.mara.md`. Add a page only for a
new user-visible topic, and list it in `nx-rust/docs/index.mara.md` and in the
root `README.md`. Remove a page's "not implemented yet" note once the feature
works.

`nx-rust/README.md` is what npm shows. Keep it short, and link to the docs with
absolute URLs. The root `README.md` is the repository's front page.

Markdown is formatted with oxfmt, which Nx runs: `pnpm nx format:write` formats
the files you changed. Validate with Mara again afterwards.

## TypeScript and Nx

- The workspace uses pnpm and Nx 24. The plugin is a CommonJS package built with
  `@nx/js:tsc`.
- The plugin supports Nx 24 and Cargo 1.91 and later, on Linux and macOS
  (`REQ-COMPATIBILITY`). A later Nx major counts as supported only once the
  end-to-end suite has passed on it. Check claims about Nx against the
  installed `nx` package, not from memory.
- CI runs on Linux only for the moment (`ADR-CI-LINUX-ONLY`). Do not add macOS
  jobs to a workflow until the user says the runners are usable again, and do
  not write code that assumes Linux.
- Before reporting work as done, run `pnpm nx run-many -t build lint test` and
  `pnpm nx format:check --all`. Run `pnpm nx e2e nx-rust-e2e` when behaviour of
  the built plugin changed. Run `pnpm mara schema validate`,
  `pnpm mara project validate` and `zban check` when knowledge or issues
  changed. Report which checks ran.
- Run Nx as `pnpm nx <command>`; `pnpm exec` is not needed. Formatting goes
  through Nx as well: `nx format:check` and `nx format:write` run oxfmt, and
  without `--all` they cover only the files you changed. Do not add package
  scripts that call oxfmt directly.
- Write tests for behaviour named by the cited `VER-` items. Prefer a real
  `cargo`, the real Nx hasher and fixture workspaces over mocks for those
  checks (`verification.mara.md`).

### Running checks

- Run the unit suite and the end-to-end suite one after the other, never both
  at once. Agents often share one machine, and two suites together can run it
  out of memory.
- To run the end-to-end suite on another Cargo version, such as the minimum
  1.91, use a private rustup home, and never run `rustup default`: other
  checkouts on the machine depend on it. The test harness drops
  `RUSTUP_TOOLCHAIN` but passes `RUSTUP_HOME` through:

  ```sh
  rh=$(mktemp -d "$TMPDIR/rustup-191.XXXX")
  mkdir "$rh/downloads" "$rh/tmp"
  ln -s ~/.rustup/toolchains "$rh/toolchains"
  ln -s ~/.rustup/update-hashes "$rh/update-hashes"
  printf 'version = "12"\ndefault_toolchain = "1.91.0-x86_64-unknown-linux-gnu"\n' \
    > "$rh/settings.toml"
  RUSTUP_HOME=$rh pnpm nx e2e nx-rust-e2e --skip-nx-cache
  rm -r "$rh"
  ```

  `--skip-nx-cache` is needed because the cache keys of the `test` and `e2e`
  targets name no toolchain.

- If you give an Nx command in a checkout its own `NX_CACHE_DIRECTORY`, set
  `NX_DAEMON=false` with it, or use the same value for every Nx command in that
  checkout. Otherwise the command and the daemon write to different task
  databases, and the run exits 1 with `FOREIGN KEY constraint failed` although
  every task succeeded. If that error appears once after successful tasks,
  rerun once.
- The test harness runs fixture commands as CI does. A test that sets `CI`,
  `GITHUB_ACTIONS` or AI-agent variables itself must also pass when run as CI
  runs it, before you report it done:
  `env -u CLAUDECODE -u CLAUDE_CODE -u AI_AGENT -u CODEX_THREAD_ID CI=true GITHUB_ACTIONS=true pnpm nx test nx-rust --testPathPatterns=<file>`.

## Commits

Use Conventional Commits without a scope (`<type>: <imperative summary>`), and add a
`Refs: nxr-xxxxxx` footer naming the issue(s) involved. Mark breaking changes
with `!`. Commit changed issue files, including moves into `.zban/archive/`,
together with the work they describe.

Pull requests are squash-merged, one issue per pull request, and only once CI
is green. The title follows the commit format above and becomes the commit
subject on `main`. The description becomes the commit body: fill in
`.github/pull_request_template.md`. Say what changed and why, tick only the
checks you actually ran, link follow-up issues under known limitations, and
complete the `Refs:` footer. Write each paragraph of the description on a
single line: GitHub wraps the squash commit body itself, and manual line breaks
leave it ragged.

GitHub enforces this on `main`, for administrators too: it takes only squash
merges of pull requests on which both required checks passed, and no direct
push. The required checks are the jobs named `Build, lint, test and format` and
`End-to-end tests` in `.github/workflows/ci.yml`, so renaming either, or adding
a job that must pass, means changing the branch protection as well. The
build/lint/format job and the sharded unit-test jobs run behind
`Build, lint, test and format`, and the end-to-end jobs for each toolchain run
behind `End-to-end tests`; none of those underlying jobs is a required check
itself.
