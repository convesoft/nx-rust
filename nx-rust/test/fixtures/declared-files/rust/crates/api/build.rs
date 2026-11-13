use std::{env, fs, path::Path};

fn main() {
    let proto = "../../../proto/greeting.proto";
    println!("cargo::rerun-if-changed={proto}");
    let messages = fs::read_to_string(proto)
        .expect("the shared protocol definition")
        .lines()
        .filter(|line| line.starts_with("message "))
        .count();
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("messages.rs");
    fs::write(out, format!("pub const MESSAGES: usize = {messages};\n")).unwrap();
}
