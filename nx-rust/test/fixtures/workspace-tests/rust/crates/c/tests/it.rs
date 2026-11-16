#[test]
fn c_integration_test() {
    c::mark("c-integration-test-ran");
    if std::env::var_os("NX_RUST_FIXTURE_FAIL").is_some() {
        std::thread::sleep(std::time::Duration::from_secs(600));
        panic!("c's integration test fails");
    }
}
