use proc_macro::TokenStream;

fn value() -> i32 {
    42
}

/// Expands to the answer.
#[proc_macro]
pub fn answer(_input: TokenStream) -> TokenStream {
    value().to_string().parse().unwrap()
}

#[cfg(test)]
mod tests {
    #[test]
    fn value_is_42() {
        assert_eq!(super::value(), 42);
    }
}
