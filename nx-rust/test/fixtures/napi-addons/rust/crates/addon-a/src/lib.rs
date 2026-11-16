use napi_derive::napi;

pub use core_napi::*;

#[napi]
pub fn sum_a(a: i32, b: i32) -> i32 {
    shared::double(a) + b
}

#[cfg(feature = "extra")]
#[napi]
pub fn extra_a() -> i32 {
    1
}
