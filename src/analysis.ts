/**
 * analysis.ts — turn timing units into the numbers that matter:
 * top crates by compile time, build-script re-run detection, linker share,
 * and full-vs-incremental rebuild detection.
 */
import { TimingUnit, isBuildScriptUnit, isBinUnit, unitKey } from "./timings.js";
import { TimedBuild } from "./cargo.js";

/** seconds below which a unit counts as "did nothing" on a rebuild */
export const FRESH_THRESHOLD_S = 0.05;
/**
 * A build-script-run unit present with any real duration in the no-change
 * rebuild was EXECUTED again with no source changes — cargo omits
 * fresh-skipped script runs from UNIT_DATA, so presence itself is the
 * signal. Epsilon guards float noise, not "fast but real" runs.
 */
export const RERUN_EPSILON_S = 0.001;

export interface CrateStat {
  key: string;
  name: string;
  version: string;
  target: string;
  duration: number;
  rmetaTime: number | null;
  share: number; // fraction of wall time
}

export interface BuildScriptStat {
  crate: string;
  compileSeconds: number;
  runSeconds: number;
  /** true when the script re-ran on a no-change rebuild (freshness broken) */
  rerunsEveryBuild: boolean;
}

export interface BuildAnalysis {
  wallSeconds: number;
  units: number;
  /** sum of per-unit durations (parallel builds overlap, so this exceeds wall) */
  sumUnitSeconds: number;
  topCrates: CrateStat[];
  /** bin units: duration covers codegen+link together */
  codegenLinkSeconds: number;
  /** nightly-only: real link seconds parsed from -Ztime */
  linkSeconds: number | null;
  buildScripts: BuildScriptStat[];
  rerunningBuildScripts: number;
  /** fraction of units that recompiled (duration > threshold) in this build */
  recompiledUnits: number;
  nightly: boolean;
}

export function analyzeBuild(build: TimedBuild, baseline?: TimedBuild): BuildAnalysis {
  const { units, wallSeconds } = build;

  const sumUnitSeconds = units.reduce((a, u) => a + u.duration, 0);

  const perCrate = new Map<string, CrateStat>();
  for (const u of units) {
    if (isBuildScriptUnit(u)) continue;
    const key = unitKey(u);
    const prev = perCrate.get(key);
    if (prev) {
      prev.duration += u.duration;
    } else {
      perCrate.set(key, {
        key,
        name: u.name,
        version: u.version,
        target: u.target,
        duration: u.duration,
        rmetaTime: u.rmetaTime,
        share: 0,
      });
    }
  }
  const topCrates = [...perCrate.values()]
    .sort((a, b) => b.duration - a.duration)
    .map((c) => ({ ...c, share: wallSeconds > 0 ? c.duration / wallSeconds : 0 }));

  const codegenLinkSeconds = units
    .filter(isBinUnit)
    .reduce((a, u) => a + u.duration, 0);

  // build scripts: group compile (build-script-build/custom-build) vs run
  const scripts = new Map<string, { compile: number; run: number }>();
  for (const u of units) {
    if (!isBuildScriptUnit(u)) continue;
    const entry = scripts.get(u.name) ?? { compile: 0, run: 0 };
    if (u.target === "build-script-run") entry.run += u.duration;
    else entry.compile += u.duration;
    scripts.set(u.name, entry);
  }

  // re-run detection: a build-script-run unit that cargo executed on the
  // no-change rebuild (present in UNIT_DATA with real duration) has broken
  // freshness — it re-runs on every build even when nothing changed.
  const baselineRunDuration = new Map<string, number>();
  if (baseline) {
    for (const u of baseline.units) {
      if (u.target !== "build-script-run") continue;
      const k = unitKey(u);
      baselineRunDuration.set(k, Math.max(baselineRunDuration.get(k) ?? 0, u.duration));
    }
  }
  const buildScripts: BuildScriptStat[] = [...scripts.entries()].map(([crate, s]) => {
    let rerunsEveryBuild = false;
    if (baseline) {
      rerunsEveryBuild = [...baselineRunDuration.entries()].some(
        ([k, d]) => k.startsWith(`${crate}@`) && d > RERUN_EPSILON_S
      );
    }
    return {
      crate,
      compileSeconds: s.compile,
      runSeconds: s.run,
      rerunsEveryBuild,
    };
  });

  const recompiledUnits = units.filter((u) => u.duration > FRESH_THRESHOLD_S).length;

  return {
    wallSeconds,
    units: units.length,
    sumUnitSeconds,
    topCrates,
    codegenLinkSeconds,
    linkSeconds: null, // filled by cli from -Ztime when nightly
    buildScripts,
    rerunningBuildScripts: buildScripts.filter((s) => s.rerunsEveryBuild).length,
    recompiledUnits,
    nightly: build.nightly,
  };
}
