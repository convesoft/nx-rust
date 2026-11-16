use napi_derive::napi;

#[napi]
pub fn sum_b(a: i32, b: i32) -> i32 {
    shared::double(a) + b
}

#[cfg(feature = "extra")]
#[napi]
pub fn extra_b() -> i32 {
    2
}
