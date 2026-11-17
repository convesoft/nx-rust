mod math;

pub use math::{double, quadruple, triple};

#[cfg(feature = "extra")]
pub fn extra() -> i32 {
    7
}

#[cfg(test)]
mod tests {
    #[test]
    fn double_works() {
        assert_eq!(super::double(2), 4);
    }

    #[test]
    fn triple_works() {
        assert_eq!(super::triple(2), 6);
    }

    #[cfg(feature = "extra")]
    #[test]
    fn extra_works() {
        assert_eq!(super::extra(), 7);
    }
}
