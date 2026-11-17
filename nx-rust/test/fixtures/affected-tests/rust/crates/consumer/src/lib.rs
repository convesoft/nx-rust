pub fn ready() -> bool {
    true
}

#[cfg(test)]
mod tests {
    #[test]
    fn ready_works() {
        assert!(super::ready());
    }
}
