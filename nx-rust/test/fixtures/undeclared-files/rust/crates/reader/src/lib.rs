include!(concat!(env!("OUT_DIR"), "/lines.rs"));

pub fn banner() -> &'static str {
    include_str!("../../../../shared/banner.txt").trim_end()
}

pub fn base() -> u8 {
    base::base()
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_the_shared_files() {
        assert_eq!(super::banner(), "banner");
        assert_eq!(super::LINES, 1);
        assert_eq!(super::base(), 1);
    }
}
