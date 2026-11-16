#[unsafe(no_mangle)]
pub extern "C" fn plain_double(value: i32) -> i32 {
    shared::double(value)
}
