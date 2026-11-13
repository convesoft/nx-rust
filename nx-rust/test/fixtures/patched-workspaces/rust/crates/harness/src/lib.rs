pub fn check(name: &str) -> bool {
    !name.is_empty() && !types::name().is_empty()
}
