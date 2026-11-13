include!(concat!(env!("OUT_DIR"), "/messages.rs"));

pub fn banner() -> &'static str {
    include_str!("../../../../docs/banner.txt").trim_end()
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_the_files_outside_the_crate() {
        assert_eq!(super::banner(), "Built with nx-rust");
        assert_eq!(super::MESSAGES, 1);
    }
}
