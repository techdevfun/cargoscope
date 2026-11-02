#!/usr/bin/env node
/**
 * cargoscope — measure where your Rust build time goes, rank the cheapest
 * fixes first, and verify the delta on your own crate.
 *
 * A local, non-invasive CLI. It never changes your toolchain; it reports
 * and generates config snippets. You apply them.
 */
import { runCli } from "./cli.js";

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`cargoscope: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
);
