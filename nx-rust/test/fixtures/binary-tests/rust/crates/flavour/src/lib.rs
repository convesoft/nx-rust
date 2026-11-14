/// `extra` where the feature is on, as the dev-dependencies of the binaries turn it on.
pub fn flavour() -> &'static str {
    if cfg!(feature = "extra") {
        "extra"
    } else {
        "plain"
    }
}
