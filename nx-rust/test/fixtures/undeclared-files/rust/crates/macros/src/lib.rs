use proc_macro::TokenStream;

/// Expands to the shared text as a string literal.
#[proc_macro]
pub fn shared_text(_input: TokenStream) -> TokenStream {
    let text = include_str!("../../../../shared/macro.txt").trim_end();
    format!("{text:?}").parse().unwrap()
}
