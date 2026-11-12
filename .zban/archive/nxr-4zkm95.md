---
title: Use zban's recommended line for the zban guide in AGENTS.md
status: done
type: task
tags:
  - docs
created_at: 2026-11-12T20:23:18Z
closed_at: 2026-11-12T20:23:38Z
---

`AGENTS.md` opens with wording of our own that tells an agent when to run `zban prime` (written for nxr-dbmnfq). zban has since fixed the same problem in its own repository and now recommends one line for a project's agent instructions, in the Setup section of its `docs/agents.mara.md` (zban commit be6b9eb, pull request #44). That line keys on the heading the guide starts with, `# zban workflow`, and zban checked it with fresh agent sessions with and without the MCP server. The user asked on 2026-11-12 to borrow it.

- [x] Replace the opening paragraph of `AGENTS.md` with zban's recommended line, word for word
- [x] Align the paragraph after it and the rule on creating issues with zban's own `AGENTS.md`, keeping what is specific to this repository (Mara, no `.mcp.json`)
- [x] `pnpm exec oxfmt --check AGENTS.md` passes and `CLAUDE.md` still points at `AGENTS.md`

## Summary of Changes

- `AGENTS.md` now opens with the line zban recommends for a project's agent instructions. A script confirmed that it equals the fenced block in zban's `docs/agents.mara.md` and the paragraph in zban's own `AGENTS.md`, word for word.
- The paragraph after it puts the MCP servers first and the command lines second, as zban's does, and still covers both zban and Mara. It names no `.mcp.json`, because this repository has none.
- The rule on creating issues names the `create_issue` tool.

Checks run: `oxfmt --check AGENTS.md` (clean), `zban check` (no findings), and `CLAUDE.md` is still a symlink to `AGENTS.md`. Not checked here: fresh agent sessions against this repository. zban's pull request #44 records such runs for the same line, with and without the MCP server. Nothing is committed.
