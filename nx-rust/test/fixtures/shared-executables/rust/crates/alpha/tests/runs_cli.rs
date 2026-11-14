use std::process::Command;

// cargo test builds the executable and names it in CARGO_BIN_EXE_cli, the
// file that beta's binary is written to as well.
#[test]
fn runs_the_cli() {
    let output = Command::new(env!("CARGO_BIN_EXE_cli")).output().unwrap();
    assert!(output.status.success());
}
