/**
 * report.ts — human-readable tables + JSON manifest for measure/compare.
 */
import { writeFileSync } from "node:fs";
import { BuildAnalysis } from "./analysis.js";
import { Recommendation } from "./recommend.js";

export interface Manifest {
  version: 1;
  tool: "cargoscope";
  measuredAt: string;
  profile: string;
  nightly: boolean;
  analysis: BuildAnalysis & { linkSeconds: number | null };
}

export function buildManifest(a: BuildAnalysis, profile: string): Manifest {
  return {
    version: 1,
    tool: "cargoscope",
    measuredAt: new Date().toISOString(),
    profile,
    nightly: a.nightly,
    analysis: { ...a },
  };
}

export function writeManifest(path: string, m: Manifest): void {
  writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
}

function bar(share: number, width = 20): string {
  const n = Math.max(0, Math.min(width, Math.round(share * width)));
  return "█".repeat(n) + "░".repeat(width - n);
}

function fmt(n: number): string {
  return n.toFixed(1);
}

export function renderMeasure(a: BuildAnalysis, profile: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`cargoscope measure — profile ${profile} (${a.nightly ? "nightly" : "stable"})`);
  lines.push(`  wall time:        ${fmt(a.wallSeconds)}s`);
  lines.push(`  units compiled:   ${a.units} (${a.recompiledUnits} did real work)`);
  lines.push(`  sum unit time:    ${fmt(a.sumUnitSeconds)}s (overlaps; parallel builds)`);
  lines.push("");

  lines.push("where the time goes (top crates):");
  for (const c of a.topCrates.slice(0, 10)) {
    const label = `${c.name} ${c.version} [${c.target}]`.slice(0, 44).padEnd(44);
    lines.push(`  ${label} ${fmt(c.duration).padStart(7)}s  ${(c.share * 100).toFixed(0).padStart(3)}% ${bar(c.share)}`);
  }
  lines.push("");

  if (a.codegenLinkSeconds > 0) {
    lines.push(`final binary (codegen+link): ${fmt(a.codegenLinkSeconds)}s`);
    if (a.linkSeconds !== null) {
      lines.push(`  link step alone (nightly -Ztime): ${fmt(a.linkSeconds)}s (${((a.linkSeconds / a.wallSeconds) * 100).toFixed(0)}% of wall)`);
    } else {
      lines.push("  link step not separable on stable — the bin unit's duration covers codegen+link together");
    }
    lines.push("");
  }

  if (a.buildScripts.length > 0) {
    lines.push("build scripts:");
    for (const s of a.buildScripts) {
      const flag = s.rerunsEveryBuild ? "  <-- RE-RUNS ON EVERY BUILD" : "";
      lines.push(
        `  ${s.crate}: compile ${fmt(s.compileSeconds)}s, run ${fmt(s.runSeconds)}s${flag}`
      );
    }
    lines.push("");
  }

  lines.push("run `cargoscope recommend` for ranked fixes, then `cargoscope compare` to verify.");
  lines.push("");
  return lines.join("\n");
}

export function renderRecommend(recs: Recommendation[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("recommendations (cheapest first — the tool changes nothing; you apply these):");
  lines.push("");
  recs.forEach((r, i) => {
    lines.push(`${i + 1}. [${r.cost}] ${r.title}`);
    lines.push(`   ${r.what}`);
    lines.push(`   gain: ${r.gainClass}`);
    if (r.snippetKind !== "none") {
      lines.push("   snippet:");
      for (const l of r.snippet.split("\n")) lines.push(`     ${l}`);
    }
    lines.push("");
  });
  lines.push("After applying: run `cargoscope measure --json after.json`, then `cargoscope compare before.json after.json`.");
  lines.push("");
  return lines.join("\n");
}
