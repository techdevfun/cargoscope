/**
 * recommend.ts — ranked, cheapest-first recommendations with exact config
 * snippets. The tool never applies anything; it reports. Gains are stated
 * as the class of gain with the conditions that make it apply — never as a
 * promise for your crate. Verify with `cargoscope compare`.
 */
import { BuildAnalysis } from "./analysis.js";

export interface Recommendation {
  id: string;
  title: string;
  /** cheapest-first rank */
  cost: "free" | "config" | "install" | "nightly";
  what: string;
  /** class of gain, with conditions — never a promise */
  gainClass: string;
  snippet: string;
  snippetKind: "toml" | "shell" | "none";
  requiresNightly: boolean;
}

const CHECK_SNIPPET = `# put this in .cargo/config.toml (or ~/.cargo/config.toml)
[alias]
checkfast = "check --all-targets"`;

const MOLD_SNIPPET = `# .cargo/config.toml — Linux only, needs mold + clang installed
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]`;

const LLD_SNIPPET = `# .cargo/config.toml — portable alternative to mold
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]`;

const SCCACHE_SNIPPET = `# shell — install sccache, then share the cache across builds/CI
#   cargo install sccache   (or: apt install sccache / brew install sccache)
export RUSTC_WRAPPER=sccache
export SCCACHE_DIR="$HOME/.cache/sccache"`;

const CRANELIFT_SNIPPET = `# NIGHTLY ONLY — dev profile. Faster codegen, slower runtime code.
# .cargo/config.toml
[build]
rustflags = ["-Z", "codegen-backend=cranelift"]
# needs: rustup toolchain install nightly + rustup component add rustc-codegen-cranelift-preview --toolchain nightly`;

const RERUN_SNIPPET = `# in your build.rs — tell cargo exactly what to watch
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/");
    // list ONLY the files/inputs the script reads; never rerun-if-changed=*
}`;

export function recommend(a: BuildAnalysis, nightlyOk: boolean, platform: string): Recommendation[] {
  const out: Recommendation[] = [];

  out.push({
    id: "cargo-check",
    title: "Use `cargo check` for the edit/compile loop",
    cost: "free",
    what: "Type checking catches most errors without running codegen or the linker at all.",
    gainClass:
      "Skips the entire codegen+link phase. On this crate that phase is part of the binary units; " +
      "the win is biggest when your loop is edit -> check -> test, and zero when you already do this.",
    snippet: CHECK_SNIPPET,
    snippetKind: "toml",
    requiresNightly: false,
  });

  if (a.rerunningBuildScripts > 0) {
    out.push({
      id: "rerun-if-changed",
      title: `Fix ${a.rerunningBuildScripts} build script(s) that re-run on every build`,
      cost: "free",
      what: "A build script with no rerun-if-changed directives re-runs on every single build, " +
        "invalidating everything downstream. Emit precise directives.",
      gainClass:
        "Removes the script's run time AND the recompile cascade it forces on every no-change build. " +
        "Measured on your crate by running measure twice.",
      snippet: RERUN_SNIPPET,
      snippetKind: "shell",
      requiresNightly: false,
    });
  }

  if (a.codegenLinkSeconds > 0 && platform === "linux") {
    out.push({
      id: "mold-linker",
      title: "Switch the linker to mold (Linux)",
      cost: "install",
      what: "mold/lld replace the default GNU ld link step. Only the link step changes; " +
        "compiled code is identical.",
      gainClass:
        "The final link is typically the single slowest step for large binaries. " +
        "Only helps if link dominates — check the codegen+link share in the measure output first.",
      snippet: MOLD_SNIPPET,
      snippetKind: "toml",
      requiresNightly: false,
    });
  }

  out.push({
    id: "sccache",
    title: "Share compilation with sccache",
    cost: "install",
    what: "A compiler cache: identical crates are reused across workspaces, branches and CI machines.",
    gainClass:
      "Near-zero on a single warm machine; large on CI and when switching branches. " +
      "Does not change what gets compiled, only skips repeats.",
    snippet: SCCACHE_SNIPPET,
    snippetKind: "shell",
    requiresNightly: false,
  });

  if (nightlyOk) {
    out.push({
      id: "cranelift",
      title: "Try the Cranelift codegen backend (nightly, dev profile)",
      cost: "nightly",
      what: "Cranelift trades runtime speed for compile speed. Dev-profile only; " +
        "switching codegen backends carries real risk — measure, don't assume.",
      gainClass:
        "Reduces the codegen portion of compile time. Nightly-only; verify with `cargoscope compare` " +
        "because the win depends on how codegen-bound your crates are.",
      snippet: CRANELIFT_SNIPPET,
      snippetKind: "toml",
      requiresNightly: true,
    });
  }

  const rank: Record<Recommendation["cost"], number> = { free: 0, config: 1, install: 2, nightly: 3 };
  return out
    .filter((r) => !r.requiresNightly || nightlyOk)
    .sort((x, y) => rank[x.cost] - rank[y.cost]);
}
