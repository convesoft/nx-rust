# nx-rust documentation

These pages are both the user guide and the engineering specification of
`@convesoft/nx-rust`, an Nx plugin that makes Cargo workspaces first-class Nx
projects while Cargo stays the build tool. Each topic page opens with guidance
for users, followed by the requirements and design that govern that topic.

> **Status:** milestone 0.1, the project graph, inferred targets and caching,
> is implemented on `main` and not published to npm yet. A page whose feature
> is not implemented, or only in part, says so at the top.

## For users

| Page                                          | What it covers                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [What nx-rust is](product.mara.md)            | Purpose, audience, principles, roadmap, what the plugin deliberately does not do, goals and vocabulary |
| [Setup and compatibility](setup.mara.md)      | Supported versions, tools you need, adding the plugin, generators and error messages                   |
| [Workspaces and projects](workspaces.mara.md) | How Cargo workspaces and crates become Nx projects, project names and the dependency graph             |
| [Configuration](configuration.mara.md)        | Overrides in `Cargo.toml`, plugin options and target names                                             |
| [Targets](targets.mara.md)                    | The targets of crates and workspaces, and why crates have no `^build`                                  |
| [Caching](caching.mara.md)                    | What goes into a cache key, what is stored, and Cargo's two directories                                |
| [Batching and features](execution.mara.md)    | One cargo call per group, and feature unification                                                      |
| [Testing](testing.mara.md)                    | Test runners, affected tests and how the cache stays honest                                            |
| [napi and wasm artifacts](artifacts.mara.md)  | Node addons and wasm packages for JS consumers                                                         |
| [Releasing](release.mara.md)                  | Versioning and publishing crates with Nx release                                                       |
| [Continuous integration](ci.mara.md)          | What to cache where, the coverage baseline, and distributed runs later                                 |

## For contributors

| Page                                     | What it covers                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| [Decisions and risks](decisions.mara.md) | Why nx-rust is shaped the way it is, the risks it carries, the evidence and the sources |
| [Verification](verification.mara.md)     | How the plugin is tested and how each requirement and goal is checked                   |

## How to read the specification

The `:::mara` blocks are [Mara](https://github.com/convesoft/mara) items: goals
(`GOAL-`), needs (`NEED-`), terms (`TERM-`), scenarios (`SCN-`), requirements
(`REQ-`), designs (`DES-`), decisions (`ADR-`), risks (`RISK-`), evidence
(`EVD-`), verifications (`VER-`) and validations (`VAL-`). Lines such as
`:satisfies: NEED-…` connect items to each other. `[[ID]]` mentions another
item.

`status: accepted` means the knowledge is agreed. It does not mean the feature
is implemented or tested. `draft` marks open proposals: areas that are named
but not designed yet, each with its open questions. `retired` marks history
that no longer applies.

The work to build nx-rust is tracked in [`.zban/`](../../.zban/) with
[zban](https://github.com/convesoft/zban). Issues refer to these items by ID
instead of repeating them.
