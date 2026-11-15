/// The value that `dep` builds on.
///
/// ```
/// assert_eq!(base::base(), 1);
/// ```
pub fn base() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    #[test]
    fn base_is_one() {
        assert_eq!(super::base(), 1);
    }
}
