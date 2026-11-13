fn main() {
    println!("cargo::rustc-env=API_GENERATED_BY={}", codegen::name());
}
