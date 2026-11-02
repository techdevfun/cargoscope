/**
 * cargo.ts — run cargo with --timings and capture the newest timing JSON.
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TimingUnit, parseTimingsHtml } from "./timings.js";

export interface CargoEnv {
  cwd: string;
  extraEnv?: Record<string, string>;
}

export interface TimedBuild {
  /** wall seconds for the cargo invocation */
  wallSeconds: number;
  units: TimingUnit[];
  timingsPath: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  nightly: boolean;
}

function timingsDir(cwd: string): string {
  return join(cwd, "target", "cargo-timings");
}

export function newestTimingsFile(cwd: string): string | null {
  const dir = timingsDir(cwd);
  if (!existsSync(dir)) return null;
  // timestamped HTML reports; the bare cargo-timing.html is a copy — prefer newest
  const files = readdirSync(dir).filter((f) => /^cargo-timing-.*\.html$/.test(f) && f !== "cargo-timing.html");
  if (files.length === 0) return null;
  let best = files[0];
  let bestMtime = 0;
  for (const f of files) {
    const m = statSync(join(dir, f)).mtimeMs;
    if (m > bestMtime) {
      bestMtime = m;
      best = f;
    }
  }
  return join(dir, best);
}

function runProc(
  cmd: string,
  args: string[],
  env: CargoEnv,
  rustflags: string | null
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const childEnv: Record<string, string | undefined> = { ...process.env, ...env.extraEnv };
    if (rustflags !== null) childEnv["RUSTFLAGS"] = rustflags;
    const child = spawn(cmd, args, { cwd: env.cwd, env: childEnv as NodeJS.ProcessEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function rustcIsNightly(cwd: string): Promise<boolean> {
  try {
    const r = await runProc("rustc", ["-Vv"], { cwd }, null);
    return r.stdout.includes("nightly");
  } catch {
    return false;
  }
}

/**
 * Run `cargo <cmd> --timings`, then load the newest timing JSON it produced.
 * On nightly we also pass -Ztime so the stderr carries per-pass timings
 * (including the link step); on stable the link time is not separable from
 * the binary unit's codegen+link duration — we say so instead of guessing.
 */
export async function timedBuild(
  env: CargoEnv,
  opts: { command?: "build" | "check"; profile?: string; extraArgs?: string[] } = {}
): Promise<TimedBuild> {
  const command = opts.command ?? "build";
  const args = [command, "--timings"];
  if (opts.profile && opts.profile !== "dev") args.push("--profile", opts.profile);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  const nightly = await rustcIsNightly(env.cwd);
  const rustflags = nightly ? "-Ztime" : null;

  const before = Date.now();
  const r = await runProc("cargo", args, env, rustflags);
  const wallSeconds = (Date.now() - before) / 1000;

  const path = newestTimingsFile(env.cwd);
  if (!path) {
    throw new Error(
      "cargo did not write a timings report (expected target/cargo-timings/cargo-timing-*.html)"
    );
  }
  const units = parseTimingsHtml(readFileSync(path, "utf8"));
  return {
    wallSeconds,
    units,
    timingsPath: path,
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.code,
    nightly,
  };
}

/**
 * Parse `-Ztime` stderr lines ("time:  0.123s  linking") into a map of
 * pass name -> seconds, summed across crates. Only meaningful on nightly.
 */
export function parseZTime(stderr: string): Map<string, number> {
  const totals = new Map<string, number>();
  const re = /^time:\s+([\d.]+)s\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const secs = Number(m[1]);
    const pass = m[2].trim().split(/\s+/).slice(-1)[0]; // last token, e.g. "linking"
    if (!Number.isFinite(secs) || !pass) continue;
    totals.set(pass, (totals.get(pass) ?? 0) + secs);
  }
  return totals;
}
