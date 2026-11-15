pub fn devuser() -> u32 {
    4
}

#[cfg(test)]
mod tests {
    #[test]
    fn matches_breakable() {
        assert_eq!(super::devuser(), breakable::breakable());
    }
}
