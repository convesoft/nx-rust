pub fn dep() -> u32 {
    base::base() + 1
}

#[cfg(test)]
mod tests {
    #[test]
    fn dep_is_two() {
        assert_eq!(super::dep(), 2);
    }
}
