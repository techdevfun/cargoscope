// Fixture build script with TWO re-run triggers (for cargoscope's demo/e2e):
//
// 1. DETERMINISTIC: declares `cargo:rerun-if-env-changed=CARGOSCOPE_BUILD_SEQ`.
//    `cargoscope measure` runs cargo twice with CARGOSCOPE_BUILD_SEQ=1 then =2,
//    so this declared input always changes and cargo always re-runs the script
//    on the no-change rebuild — on any machine, with no mtime luck involved.
// 2. STORY: the real-world anti-pattern — rewrites its own `rerun-if-changed`
//    input (src/stamp.txt) on every run, which is what the demo narrative and
//    the `recommend` output talk about.
//
// The 20ms sleep keeps the re-run visible in timing data even on very fast
// machines (detection threshold is 1ms).
use std::fs;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn main() {
    println!("cargo:rerun-if-env-changed=CARGOSCOPE_BUILD_SEQ");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    fs::write("src/stamp.txt", format!("{}\n", stamp)).unwrap();
    println!("cargo:rerun-if-changed=src/stamp.txt");
    println!("cargo:rustc-cfg=feature=\"demo_native\"");
    thread::sleep(Duration::from_millis(20));
}
