use std::process::Command;

// cargo test builds the executable with the dev-dependency's feature.
#[test]
fn runs_the_executable_that_cargo_test_built() {
    let output = Command::new(env!("CARGO_BIN_EXE_app")).output().unwrap();
    assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "extra");
}
