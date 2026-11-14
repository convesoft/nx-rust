/// The version of `kit` in the workspace.
///
/// ```
/// assert_eq!(kit::version(), 1);
/// ```
pub fn version() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    #[test]
    fn version() {
        assert_eq!(super::version(), 1);
    }
}
