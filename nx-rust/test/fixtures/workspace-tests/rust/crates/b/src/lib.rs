/// The value of `b`.
///
/// ```
/// assert_eq!(b::b(), 2);
/// ```
pub fn b() -> u32 {
    assert!(shared::x_on());
    2
}

#[cfg(test)]
mod tests {
    #[test]
    fn b_unit_test() {
        assert_eq!(super::b(), 2);
    }
}
