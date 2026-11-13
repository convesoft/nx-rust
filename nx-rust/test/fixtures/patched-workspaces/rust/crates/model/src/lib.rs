pub fn name() -> String {
    format!("model with {}", util::name())
}

#[cfg(test)]
mod tests {
    #[test]
    fn checks() {
        assert!(harness::check(&super::name()));
    }
}
