pub fn name() -> &'static str {
    "model"
}

#[cfg(test)]
mod tests {
    #[test]
    fn checks_itself_with_the_test_kit() {
        assert_eq!(testkit::describe(), "testkit for model");
    }
}
