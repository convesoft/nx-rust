use std::path::Path;

#[test]
fn expected_text() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(dir.join("tests/expected.txt")).unwrap();
    assert_eq!(text.trim(), "ok");
}

#[test]
fn shared_data() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(dir.join("../../../shared/data.txt")).unwrap();
    assert_eq!(text.trim(), "ok");
}
