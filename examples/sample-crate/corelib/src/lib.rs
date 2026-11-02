pub fn compute(x: u64) -> u64 {
    x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407)
}
