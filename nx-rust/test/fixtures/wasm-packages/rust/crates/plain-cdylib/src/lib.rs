#[unsafe(no_mangle)]
pub extern "C" fn plain(value: u32) -> u32 {
    shared::double(value)
}
