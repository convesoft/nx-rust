use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn encode(value: u32) -> u32 {
    shared::double(value) + 1
}

#[cfg(feature = "extra")]
#[wasm_bindgen]
pub fn encode_extra(value: u32) -> u32 {
    value + 100
}
