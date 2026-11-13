fn main() {
    println!(
        "{} {}",
        cola::name(),
        include_str!("../../../../shared/cli.txt").trim_end()
    );
}
