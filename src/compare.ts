/**
 * compare.ts — before/after delta between two measure manifests.
 * Only MEASURED numbers are printed; nothing is promised.
 */
import { readFileSync } from "node:fs";
import { BuildAnalysis } from "./analysis.js";
import { Manifest } from "./report.js";

export interface UnitDelta {
  key: string;
  name: string;
  target: string;
  before: number;
  after: number;
  delta: number;
}

export interface CompareResult {
  beforeWall: number;
  afterWall: number;
  wallDelta: number;
  wallDeltaPct: number;
  beforeUnits: number;
  afterUnits: number;
  beforeLinkSeconds: number | null;
  afterLinkSeconds: number | null;
  biggestWins: UnitDelta[];
  biggestLosses: UnitDelta[];
  verdict: string;
}

export function loadManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

export function compareManifests(before: Manifest, after: Manifest): CompareResult {
  const a = before.analysis;
  const b = after.analysis;

  const beforeMap = new Map(a.topCrates.map((c) => [c.key, c]));
  const deltas: UnitDelta[] = [];
  const seen = new Set<string>();
  for (const c of b.topCrates) {
    const prev = beforeMap.get(c.key);
    deltas.push({
      key: c.key,
      name: c.name,
      target: c.target,
      before: prev?.duration ?? 0,
      after: c.duration,
      delta: c.duration - (prev?.duration ?? 0),
    });
    seen.add(c.key);
  }
  for (const c of a.topCrates) {
    if (!seen.has(c.key)) {
      deltas.push({ key: c.key, name: c.name, target: c.target, before: c.duration, after: 0, delta: -c.duration });
    }
  }

  const wallDelta = b.wallSeconds - a.wallSeconds;
  const wallDeltaPct = a.wallSeconds > 0 ? (wallDelta / a.wallSeconds) * 100 : 0;

  const biggestWins = deltas.filter((d) => d.delta < 0).sort((x, y) => x.delta - y.delta).slice(0, 5);
  const biggestLosses = deltas.filter((d) => d.delta > 0).sort((x, y) => y.delta - x.delta).slice(0, 5);

  const dir = wallDeltaPct < -1 ? "faster" : wallDeltaPct > 1 ? "slower" : "about the same";
  const linkPart =
    a.linkSeconds !== null && b.linkSeconds !== null
      ? `, link ${fmt(a.linkSeconds)}s -> ${fmt(b.linkSeconds)}s`
      : "";
  const verdict = `${fmtPct(wallDeltaPct)} wall time ${dir} (${fmt(a.wallSeconds)}s -> ${fmt(b.wallSeconds)}s${linkPart})`;

  return {
    beforeWall: a.wallSeconds,
    afterWall: b.wallSeconds,
    wallDelta,
    wallDeltaPct,
    beforeUnits: a.units,
    afterUnits: b.units,
    beforeLinkSeconds: a.linkSeconds,
    afterLinkSeconds: b.linkSeconds,
    biggestWins,
    biggestLosses,
    verdict,
  };
}

function fmt(n: number): string {
  return n.toFixed(1);
}
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function renderCompare(c: CompareResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("before/after");
  lines.push(`  wall:   ${fmt(c.beforeWall)}s -> ${fmt(c.afterWall)}s  (${fmtPct(c.wallDeltaPct)})`);
  lines.push(`  units:  ${c.beforeUnits} -> ${c.afterUnits}`);
  if (c.beforeLinkSeconds !== null && c.afterLinkSeconds !== null) {
    lines.push(`  link:   ${fmt(c.beforeLinkSeconds)}s -> ${fmt(c.afterLinkSeconds)}s (nightly -Ztime)`);
  }
  lines.push("");
  lines.push("biggest wins (seconds saved):");
  if (c.biggestWins.length === 0) lines.push("  (none)");
  for (const d of c.biggestWins.slice(0, 5)) {
    lines.push(`  -${fmt(-d.delta).padStart(6)}s  ${d.name} (${d.target})`);
  }
  if (c.biggestLosses.length > 0) {
    lines.push("");
    lines.push("biggest losses (seconds added):");
    for (const d of c.biggestLosses.slice(0, 5)) {
      lines.push(`  +${fmt(d.delta).padStart(6)}s  ${d.name} (${d.target})`);
    }
  }
  lines.push("");
  lines.push(`verdict: ${c.verdict}`);
  lines.push("");
  return lines.join("\n");
}
