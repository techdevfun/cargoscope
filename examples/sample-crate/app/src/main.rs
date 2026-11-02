fn main() {
    let v: Vec<u64> = (0..1000).collect();
    println!("sum={} magic={}", corelib::compute(v.iter().sum()), slowdep::MAGIC);
}
