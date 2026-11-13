pub fn describe() -> String {
    format!("{} on {}", napi_addon::name(), env!("CLI_ENGINE"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn uses_the_plain_crate() {
        assert_eq!(plain::name(), "plain");
    }
}
