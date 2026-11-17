use std::process::Command;

#[test]
fn prints_four() {
    let output = Command::new(env!("CARGO_BIN_EXE_runner")).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "4");
}
