pub fn six() -> i32 {
    basics::double(3)
}

pub fn answer() -> i32 {
    macros::answer!()
}

#[cfg(test)]
mod tests {
    #[test]
    fn six_works() {
        assert_eq!(super::six(), 6);
    }

    #[test]
    fn answer_works() {
        assert_eq!(super::answer(), 42);
    }
}
