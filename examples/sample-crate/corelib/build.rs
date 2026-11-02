// INTENTIONAL ANTI-PATTERN (for the cargoscope demo): this script rewrites
// the very file it declares as rerun-if-changed, so cargo re-runs it on
// EVERY build — even no-change rebuilds. cargoscope's `measure` runs cargo
// twice and flags exactly this: a build script that never stays fresh.
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    fs::write("src/stamp.txt", format!("{}\n", stamp)).unwrap();
    println!("cargo:rerun-if-changed=src/stamp.txt");
    println!("cargo:rustc-cfg=feature=\"demo_native\"");
}
