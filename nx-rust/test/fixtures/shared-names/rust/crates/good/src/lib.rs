/// The version of `good` in the workspace, with the one it depends on.
///
/// ```
/// assert_eq!(good::versions(), (1, 2));
/// ```
pub fn versions() -> (u32, u32) {
    (1, old::version())
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions() {
        assert_eq!(super::versions(), (1, 2));
    }
}
