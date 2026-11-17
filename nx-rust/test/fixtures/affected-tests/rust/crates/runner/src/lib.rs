pub fn name() -> &'static str {
    "runner"
}

#[cfg(test)]
mod tests {
    #[test]
    fn name_works() {
        assert_eq!(super::name(), "runner");
    }
}
