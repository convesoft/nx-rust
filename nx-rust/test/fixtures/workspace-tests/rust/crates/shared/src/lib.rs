/// Whether the feature `x` is on, which `b` turns on and `a` does not ask for.
///
/// ```
/// let _ = shared::x_on();
/// ```
pub fn x_on() -> bool {
    cfg!(feature = "x")
}
