use std::{env, fs, path::Path};

fn main() {
    let proto = "../../../shared/proto.txt";
    println!("cargo::rerun-if-changed={proto}");
    println!("cargo::rerun-if-changed=../../../shared/assets");
    println!("cargo::rerun-if-changed=build.rs");
    let lines = fs::read_to_string(proto)
        .expect("the shared definition")
        .lines()
        .count();
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("lines.rs");
    fs::write(out, format!("pub const LINES: usize = {lines};\n")).unwrap();
}
