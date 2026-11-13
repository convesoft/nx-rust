fn main() {
    println!("cargo::rustc-env=CLI_ENGINE={}", engine::name());
}
