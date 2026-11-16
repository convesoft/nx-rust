/// The value of `a`.
///
/// ```
/// assert_eq!(a::a(), 1);
/// ```
pub fn a() -> u32 {
    let _ = shared::x_on();
    1
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_unit_test() {
        assert_eq!(super::a(), 1);
    }
}
