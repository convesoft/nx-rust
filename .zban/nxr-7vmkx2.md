---
title: Warn about Cargo directories inside the repository that Nx does not ignore
status: in-progress
type: feature
parent: nxr-w9qa5f
discovered_from: nxr-eg9s2w
created_at: 2026-11-13T14:23:27Z
---

Goal: graph creation warns when a workspace's build or artifact directory lies inside the repository and Nx does not ignore it, as the row of `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) says. Checked by the last paragraph of `VER-SETUP`.

Context: no issue owned this row. nxr-q6cxt3 implements the errors of `DES-DIAGNOSTICS`, and nxr-fy4t4k the warning for a path dependency that Nx cannot see. `init` (nxr-eg9s2w) runs the plugin's `createNodes` through Nx's project-configuration step (`nx-rust/src/generators/init/graph-check.ts`), so a warning that `createNodes` prints reaches `init`'s output without further code. `init`'s report already names each workspace whose build directory lies inside the repository, together with the suggested `build.build-dir` setting. This warning is about what Nx hashes, which is a different matter.

- [ ] The warning when the graph is created, naming the directory and advising `.gitignore`; none when only `.nxignore` excludes the directory, or when it lies under a folder that Nx always ignores (`EVD-NX-24-SETUP`)
- [ ] A test that `init` prints it
- [ ] The warning again from the executor at the start of a task of the workspace concerned ("Warnings where they are seen" in `DES-DIAGNOSTICS`), once the executor of nxr-kmdpgj exists

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
