pub const MAGIC: u64 = 0x9E3779B97F4A7C15;

pub fn table() -> [u64; 64] {
    let mut t = [0u64; 64];
    let mut x = MAGIC;
    let mut i = 0;
    while i < 64 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        t[i] = x;
        i += 1;
    }
    t
}
