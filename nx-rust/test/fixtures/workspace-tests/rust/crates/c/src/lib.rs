/// Fails where `NX_RUST_FIXTURE_FAIL` is set.
///
/// ```
/// assert!(std::env::var_os("NX_RUST_FIXTURE_FAIL").is_none(), "c's doctest fails");
/// ```
pub fn c() -> u32 {
    3
}

/// Writes a file named `name` beside the workspace's `Cargo.toml`, so that
/// a test can see that one of `c`'s tests ran.
pub fn mark(name: &str) {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::write(folder.join(name), "ran\n").unwrap();
}

#[cfg(test)]
mod tests {
    #[test]
    fn c_unit_test() {
        super::mark("c-unit-test-ran");
        assert!(
            std::env::var_os("NX_RUST_FIXTURE_FAIL").is_none(),
            "c's unit test fails"
        );
    }
}
