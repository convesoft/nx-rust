---
title: Stop AGENTS.md from requiring zban prime when the MCP guide is present
status: done
type: bug
tags:
  - docs
created_at: 2026-11-12T19:25:42Z
closed_at: 2026-11-12T19:25:42Z
---

`AGENTS.md` opened with an unconditional instruction to run `zban prime` before anything else. The user reported on 2026-11-12 that an agent in another session therefore ran it although the zban MCP server had already sent the same guide as its server instructions.

- [x] Make `zban prime` conditional on the guide not being in the agent's context already
- [x] Prefer the MCP servers over the command line tools where a client has them

## Summary of Changes

The opening of `AGENTS.md` now says that the zban MCP server's instructions are the guide, that an agent with them must not run `zban prime` as well, and that `zban prime` is for sessions without the guide. `CLAUDE.md` is a symlink to `AGENTS.md`, so it carries the same text.

Checks run: `oxfmt --check` on `AGENTS.md` (clean), and a comparison of the section headings of `zban prime` with the MCP instructions, which match. Not checked: how a fresh agent session behaves with the new wording.
