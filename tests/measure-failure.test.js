/**
 * measure-failure: `measure` must fail loudly when the no-change rebuild
 * fails, instead of silently reusing the first build's timings report.
 *
 * Regression test: before this fix, a failing second `cargo build` was
 * never checked, so measure exited 0 and compared the first build against
 * its own stale report — flagging every build script as
 * "RE-RUNS ON EVERY BUILD". Uses a fake cargo/rustc on PATH; no real
 * toolchain needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "index.js");

const TIMINGS_HTML = `<!DOCTYPE html><html><body><script>
const UNIT_DATA = [
{"i":0,"name":"corelib","version":"0.1.0","target":"","start":0.0,"duration":0.5},
{"i":1,"name":"corelib","version":"0.1.0","target":" build-script","start":0.0,"duration":0.2},
{"i":2,"name":"corelib","version":"0.1.0","target":" build-script (run)","start":0.2,"duration":0.4},
{"i":3,"name":"app","version":"0.1.0","target":" app \\"bin\\"","start":0.5,"duration":1.0}
];
</script></body></html>
`;

test("measure fails loudly when the no-change rebuild fails", { timeout: 60000 }, async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "cargoscope-rebuild-fail-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const bindir = join(tmp, "bin");
  const crate = join(tmp, "crate");
  mkdirSync(bindir, { recursive: true });
  mkdirSync(crate, { recursive: true });

  // stable rustc stand-in (never nightly, so no -Ztime probe)
  writeFileSync(join(bindir, "rustc"), "#!/bin/sh\necho 'rustc 1.90.0 (stable)'\nexit 0\n");
  chmodSync(join(bindir, "rustc"), 0o755);

  // fake cargo: 1st call succeeds and writes a timings report (with a
  // build-script-run unit); 2nd call fails and writes nothing.
  const fakeCargo = `#!/bin/sh
CTR="${join(tmp, "counter")}"
N=$(cat "$CTR" 2>/dev/null || echo 0)
N=$((N + 1))
echo "$N" > "$CTR"
if [ "$N" -eq 1 ]; then
  mkdir -p target/cargo-timings
  cat > target/cargo-timings/cargo-timing-20261111-000000.html <<'HTML'
${TIMINGS_HTML}HTML
  echo "    Finished dev profile" >&2
  exit 0
else
  echo "error: could not compile corelib (simulated rebuild failure)" >&2
  echo "error: build failed" >&2
  exit 1
fi
`;
  writeFileSync(join(bindir, "cargo"), fakeCargo);
  chmodSync(join(bindir, "cargo"), 0o755);

  const manifest = join(tmp, "out.json");
  const env = { ...process.env, PATH: `${bindir}:${process.env.PATH}` };
  let err = null;
  try {
    await run("node", [CLI, "measure", "--json", manifest], { cwd: crate, env, timeout: 30000 });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "measure should exit non-zero when the rebuild fails");
  assert.match(String(err.stderr ?? err.message), /cargo rebuild failed \(exit 1\)/);
  assert.equal(existsSync(manifest), false, "no manifest may be written from a failed measure");
});
