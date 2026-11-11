/**
 * cli.ts — argument parsing and command dispatch.
 * Invoked by cargo as: cargo-cargoscope cargoscope <args>
 */
import { writeFileSync, existsSync } from "node:fs";
import { platform } from "node:os";
import { timedBuild, parseZTime, CargoEnv } from "./cargo.js";
import { analyzeBuild, BuildAnalysis } from "./analysis.js";
import { recommend } from "./recommend.js";
import { renderMeasure, renderRecommend, buildManifest, writeManifest } from "./report.js";
import { loadManifest, compareManifests, renderCompare } from "./compare.js";

export const VERSION = "0.1.0";

interface GlobalOpts {
  jsonOut: string | null;
  profile: string;
  nightlyOk: boolean;
  from: string | null;
}

export function parseArgs(argv: string[]): { cmd: string; rest: string[]; opts: GlobalOpts } {
  // cargo calls us as `cargo-cargoscope cargoscope <args>` — strip the echo
  const args = argv[0] === "cargoscope" ? argv.slice(1) : argv;
  const opts: GlobalOpts = { jsonOut: null, profile: "dev", nightlyOk: false, from: null };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // cargo users habitually write --flag=value (cargo itself accepts
    // --profile=release); accept it for the value-taking flags.
    let name = a;
    let inline: string | null = null;
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    if (eq !== -1) {
      name = a.slice(0, eq);
      inline = a.slice(eq + 1);
    }
    if (name === "--json") opts.jsonOut = inline ?? args[++i] ?? null;
    else if (name === "--profile") opts.profile = inline ?? args[++i] ?? "dev";
    else if (name === "--nightly-ok" && inline === null) opts.nightlyOk = true;
    else if (name === "--from") opts.from = inline ?? args[++i] ?? null;
    else if (a === "--version" || a === "-V") return { cmd: "version", rest, opts };
    else if (a === "--help" || a === "-h") return { cmd: "help", rest, opts };
    else if (name.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else rest.push(a);
  }
  const cmd = rest.shift() ?? "help";
  return { cmd, rest, opts };
}

function printHelp(): void {
  console.log(`cargoscope ${VERSION} — measure where your Rust build time goes.

usage: cargo cargoscope <command> [options]

commands:
  measure [--profile dev|release] [--json out.json]
      Build with --timings, report where the time goes, detect build scripts
      that re-run on every build. Runs cargo twice (timed build + no-change
      rebuild) so re-run detection is measured, not guessed.
  recommend [--from manifest.json] [--nightly-ok]
      Ranked fixes, cheapest first, with exact config snippets. Changes nothing.
  compare <before.json> <after.json>
      Before/after delta between two measure manifests. Measured numbers only.
  --version, --help

The tool never changes your toolchain. Verify every fix with compare.`);
}

async function doMeasure(env: CargoEnv, opts: GlobalOpts): Promise<BuildAnalysis> {
  // CARGOSCOPE_BUILD_SEQ distinguishes the two builds for build scripts that
  // declare `cargo:rerun-if-env-changed=CARGOSCOPE_BUILD_SEQ` (used by the
  // fixture crate to deterministically exercise re-run detection; harmless
  // for real crates since no other script declares it).
  const env1: CargoEnv = { cwd: env.cwd, extraEnv: { ...env.extraEnv, CARGOSCOPE_BUILD_SEQ: "1" } };
  const env2: CargoEnv = { cwd: env.cwd, extraEnv: { ...env.extraEnv, CARGOSCOPE_BUILD_SEQ: "2" } };
  console.error("cargoscope: timed build (1/2) ...");
  const first = await timedBuild(env1, { command: "build", profile: opts.profile });
  if (first.exitCode !== 0) {
    console.error(first.stderr.split("\n").slice(-5).join("\n"));
    throw new Error(`cargo build failed (exit ${first.exitCode})`);
  }
  console.error("cargoscope: no-change rebuild (2/2) ...");
  const second = await timedBuild(env2, { command: "build", profile: opts.profile });
  if (second.exitCode !== 0) {
    console.error(second.stderr.split("\n").slice(-5).join("\n"));
    throw new Error(`cargo rebuild failed (exit ${second.exitCode})`);
  }

  const analysis = analyzeBuild(first, second);
  if (first.ztime) {
    const passes = parseZTime(first.stderr);
    const link = passes.get("linking");
    if (link !== undefined) analysis.linkSeconds = link;
  }
  return analysis;
}

function loadAnalysis(opts: GlobalOpts, env: CargoEnv): Promise<BuildAnalysis> {
  if (opts.from) {
    if (!existsSync(opts.from)) throw new Error(`manifest not found: ${opts.from}`);
    return Promise.resolve(loadManifest(opts.from).analysis as BuildAnalysis);
  }
  return doMeasure(env, opts);
}

export async function runCli(argv: string[]): Promise<number> {
  const { cmd, rest, opts } = parseArgs(argv);
  const env: CargoEnv = { cwd: process.cwd() };

  if (cmd === "version") {
    console.log(VERSION);
    return 0;
  }
  if (cmd === "help") {
    printHelp();
    return 0;
  }

  if (cmd === "measure") {
    const analysis = await doMeasure(env, opts);
    process.stdout.write(renderMeasure(analysis, opts.profile));
    if (opts.jsonOut) {
      writeManifest(opts.jsonOut, buildManifest(analysis, opts.profile));
      console.error(`cargoscope: manifest written to ${opts.jsonOut}`);
    }
    return 0;
  }

  if (cmd === "recommend") {
    const analysis = await loadAnalysis(opts, env);
    const recs = recommend(analysis, opts.nightlyOk, platform());
    process.stdout.write(renderRecommend(recs));
    return 0;
  }

  if (cmd === "compare") {
    if (rest.length < 2) throw new Error("usage: cargo cargoscope compare <before.json> <after.json>");
    const before = loadManifest(rest[0]);
    const after = loadManifest(rest[1]);
    process.stdout.write(renderCompare(compareManifests(before, after)));
    return 0;
  }

  throw new Error(`unknown command: ${cmd} (try --help)`);
}
