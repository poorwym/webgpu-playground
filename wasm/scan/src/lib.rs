pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }
}

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn scan(input: Vec<u32>) -> Vec<u32> {
    let mut result = Vec::with_capacity(input.len());
    result.push(0);
    for &item in input.iter() {
        let last = *result.last().unwrap();
        result.push(last + item);
    }
    result.pop(); // Remove the last element which is the total sum
    result
}
