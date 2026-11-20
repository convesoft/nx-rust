/**
 * Cargo's settings in a task's environment, as the publish executor compares
 * them between the task of a crate and the task of a crate that it depends
 * on (`DES-RELEASE`, "A dependency's environment").
 */

/** Credentials, which say how cargo authenticates to a registry, not which registry a name stands for. */
const credential =
  /^CARGO_(REGISTRY|REGISTRIES_[A-Za-z0-9_]+)_(TOKEN|CREDENTIAL_PROVIDER)$|^CARGO_REGISTRY_GLOBAL_CREDENTIAL_PROVIDERS$/;

/**
 * Whether a variable is one of Cargo's settings: a name that starts with
 * `CARGO` or `RUSTUP_`, which cargo and rustup read, or `HOME` and `PATH`,
 * which locate Cargo's home and choose the cargo that runs; credentials
 * apart.
 */
// @mara implements DES-RELEASE
export function isCargoSetting(name: string): boolean {
  return (
    (name.startsWith("CARGO") ||
      name.startsWith("__CARGO") ||
      name.startsWith("RUSTUP_") ||
      name === "HOME" ||
      name === "PATH") &&
    !credential.test(name)
  );
}

/**
 * The names of Cargo's settings whose values differ between two
 * environments, in a fixed order, apart from those in `ignored`.
 */
// @mara implements DES-RELEASE
export function settingDifferences(
  a: NodeJS.ProcessEnv,
  b: NodeJS.ProcessEnv,
  ignored: readonly string[] = [],
): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((name) => isCargoSetting(name) && !ignored.includes(name) && a[name] !== b[name])
    .sort();
}

/**
 * What a task's dotenv files say about Cargo's settings, from the values as
 * dotenv reads them before Nx expands references: the Cargo settings that
 * they define, or every variable that they define where one of those values
 * refers to another variable, whose value then counts as well.
 */
// @mara implements DES-RELEASE
export function dotenvSettings(raw: Readonly<Record<string, string>>): Record<string, string> {
  const settings = Object.entries(raw).filter(([name]) => isCargoSetting(name));
  return Object.fromEntries(
    settings.some(([, value]) => value.includes("$")) ? Object.entries(raw) : settings,
  );
}

/** The names whose values differ between two maps of {@link dotenvSettings}, in a fixed order. */
export function dotenvDifferences(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((name) => a[name] !== b[name])
    .sort();
}
