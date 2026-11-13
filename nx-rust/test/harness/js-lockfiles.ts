/**
 * A pnpm lockfile, in the format of pnpm 9 and later, in which the
 * repository root depends on `left-pad` and, unless `version` is `null`, on
 * the plugin at that version, which depends on `tslib`. Nx's JS plugin makes
 * an npm node of each package it lists. `integrity` replaces the integrity
 * of `tslib` or `left-pad`, as an update of that package would.
 */
export function pnpmLockfile(
  version: string | null,
  integrity: { tslib?: string; leftPad?: string } = {},
): string {
  const tslib =
    integrity.tslib ??
    "sha512-1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111==";
  const leftPad =
    integrity.leftPad ??
    "sha512-2222222222222222222222222222222222222222222222222222222222222222222222222222222222222222==";
  const plugin = version === null ? [] : [`'@convesoft/nx-rust@${version}'`];
  return [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "",
    "importers:",
    "",
    "  .:",
    "    devDependencies:",
    ...(version === null
      ? []
      : [
          "      '@convesoft/nx-rust':",
          `        specifier: ${version}`,
          `        version: ${version}`,
        ]),
    "      left-pad:",
    "        specifier: 1.3.0",
    "        version: 1.3.0",
    "",
    "packages:",
    "",
    ...plugin.flatMap((key) => [
      `  ${key}:`,
      "    resolution: {integrity: sha512-3333333333333333333333333333333333333333333333333333333333333333333333333333333333333333==}",
      "",
    ]),
    "  left-pad@1.3.0:",
    `    resolution: {integrity: ${leftPad}}`,
    "",
    "  tslib@2.9.1:",
    `    resolution: {integrity: ${tslib}}`,
    "",
    "snapshots:",
    "",
    ...plugin.flatMap((key) => [`  ${key}:`, "    dependencies:", "      tslib: 2.9.1", ""]),
    "  left-pad@1.3.0: {}",
    "",
    "  tslib@2.9.1: {}",
    "",
  ].join("\n");
}
