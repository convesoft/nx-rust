use napi_derive::napi;

#[napi]
pub fn core_fn(value: i32) -> i32 {
    value + 1
}
