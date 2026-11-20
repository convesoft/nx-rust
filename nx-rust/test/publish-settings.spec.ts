import {
  dotenvDifferences,
  dotenvSettings,
  isCargoSetting,
  settingDifferences,
} from "../src/release/publish-settings";

// Checks which variables count as Cargo's settings when the publish executor
// compares the environment of a crate's task with that of a dependency's
// task (`DES-RELEASE`, "A dependency's environment"), as group 9 of
// VER-RELEASE relies on.

describe("the Cargo settings that the publish executor compares", () => {
  it("counts Cargo's and rustup's variables, HOME and PATH, but not credentials", () => {
    for (const name of [
      "CARGO_HOME",
      "CARGO_REGISTRY_DEFAULT",
      "CARGO_REGISTRIES_ALPHA_INDEX",
      "CARGO_NET_OFFLINE",
      "RUSTUP_TOOLCHAIN",
      "HOME",
      "PATH",
    ]) {
      expect([name, isCargoSetting(name)]).toEqual([name, true]);
    }
    for (const name of [
      "CARGO_REGISTRY_TOKEN",
      "CARGO_REGISTRIES_ALPHA_TOKEN",
      "CARGO_REGISTRIES_MY_REG_CREDENTIAL_PROVIDER",
      "CARGO_REGISTRY_CREDENTIAL_PROVIDER",
      "CARGO_REGISTRY_GLOBAL_CREDENTIAL_PROVIDERS",
      "DATABASE_URL",
      "NX_TASK_HASH",
    ]) {
      expect([name, isCargoSetting(name)]).toEqual([name, false]);
    }
  });

  it("names the settings in which two environments differ, apart from those ignored", () => {
    const a = { CARGO_HOME: "/a", CARGO_REGISTRY_DEFAULT: "alpha", DATABASE_URL: "x" };
    const b = { CARGO_HOME: "/b", CARGO_REGISTRY_DEFAULT: "beta", CARGO_REGISTRY_TOKEN: "t" };

    expect(settingDifferences(a, b)).toEqual(["CARGO_HOME", "CARGO_REGISTRY_DEFAULT"]);
    expect(settingDifferences(a, b, ["CARGO_REGISTRY_DEFAULT"])).toEqual(["CARGO_HOME"]);
    expect(settingDifferences(a, { ...a, DATABASE_URL: "y" })).toEqual([]);
  });

  it("compares dotenv files by their Cargo settings, or by every variable where one refers to another", () => {
    const plain = dotenvSettings({ CARGO_REGISTRY_DEFAULT: "beta", DATABASE_URL: "x" });
    expect(plain).toEqual({ CARGO_REGISTRY_DEFAULT: "beta" });
    expect(dotenvDifferences(plain, dotenvSettings({ DATABASE_URL: "y" }))).toEqual([
      "CARGO_REGISTRY_DEFAULT",
    ]);
    expect(dotenvDifferences(dotenvSettings({ DATABASE_URL: "x" }), {})).toEqual([]);

    const referring = { CARGO_HOME: "${ROOT}/cargo", ROOT: "/one" };
    expect(dotenvSettings(referring)).toEqual(referring);
    expect(
      dotenvDifferences(dotenvSettings(referring), dotenvSettings({ ...referring, ROOT: "/two" })),
    ).toEqual(["ROOT"]);
  });
});
