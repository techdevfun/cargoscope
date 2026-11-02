/**
 * timings.ts — parse `cargo build --timings` output into per-unit records.
 *
 * Modern cargo writes the data embedded in the HTML report
 * (target/cargo-timings/cargo-timing-<timestamp>.html) as:
 *   const UNIT_DATA = [ { "i": 2, "name": "corelib", "version": "0.1.0",
 *     "target": " app \"bin\"", "start": 0.12, "duration": 0.18,
 *     "sections": [["frontend", {"start":0,"end":0.04}], ["codegen", ...]], ... } ]
 *
 * The `target` label is a human display string, not a stable enum:
 *   ""                 -> lib
 *   " build-script"    -> build script compile
 *   " build-script (run)" -> build script run
 *   ' name "bin"'      -> bin
 *   ' name "test"' / '"example"' / '"bench"' -> test/example/bench
 * Everything else falls back to the trimmed raw label. Unknown fields are
 * ignored; units missing name/start/duration are skipped. Tested against
 * the cargo version recorded in the build note.
 */

export interface TimingUnit {
  name: string;
  version: string;
  /** normalized: lib | bin | build-script-build | build-script-run | test | example | bench | <raw> */
  target: string;
  /** wall seconds for this unit */
  duration: number;
  /** metadata-only (rmeta) seconds; null — UNIT_DATA does not carry it */
  rmetaTime: number | null;
  start: number;
  end: number;
  /** per-phase sections when cargo reports them, e.g. [["frontend",{start,end}],["codegen",...]] */
  sections: Array<[string, { start: number; end: number }]> | null;
}

function normalizeTarget(raw: unknown): string {
  if (typeof raw !== "string") return "lib";
  const t = raw.trim();
  if (t.includes("build-script (run)")) return "build-script-run";
  if (t.includes("build-script")) return "build-script-build";
  if (t.includes('"bin"')) return "bin";
  if (t.includes('"test"')) return "test";
  if (t.includes('"example"')) return "example";
  if (t.includes('"bench"')) return "bench";
  if (t.includes('"lib"') || t === "") return "lib";
  return t || "lib";
}

function isSection(v: unknown): v is [string, { start: number; end: number }] {
  if (!Array.isArray(v) || v.length < 2) return false;
  const [name, span] = v;
  return (
    typeof name === "string" &&
    typeof span === "object" &&
    span !== null &&
    typeof (span as Record<string, unknown>)["start"] === "number" &&
    typeof (span as Record<string, unknown>)["end"] === "number"
  );
}

function toUnit(item: unknown): TimingUnit | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  if (typeof o["name"] !== "string") return null;
  if (typeof o["start"] !== "number") return null;
  if (typeof o["duration"] !== "number") return null;
  const start = o["start"] as number;
  const duration = o["duration"] as number;
  let sections: TimingUnit["sections"] = null;
  if (Array.isArray(o["sections"])) {
    const parsed = (o["sections"] as unknown[]).filter(isSection);
    sections = parsed.length > 0 ? parsed : null;
  }
  return {
    name: o["name"] as string,
    version: typeof o["version"] === "string" ? o["version"] : "",
    target: normalizeTarget(o["target"]),
    duration,
    rmetaTime: null,
    start,
    end: start + duration,
    sections,
  };
}

/**
 * Extract UNIT_DATA from a cargo-timings HTML report.
 * The array literal is JSON-compatible (double quotes), so we bracket-match
 * it out of the page instead of trusting a trailing semicolon position.
 */
export function parseTimingsHtml(html: string): TimingUnit[] {
  const marker = "const UNIT_DATA =";
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error("timings HTML has no UNIT_DATA block");
  const open = html.indexOf("[", idx + marker.length);
  if (open === -1) throw new Error("UNIT_DATA block has no array");
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("UNIT_DATA array is unterminated");
  let parsed: unknown;
  try {
    parsed = JSON.parse(html.slice(open, end + 1));
  } catch {
    throw new Error("UNIT_DATA is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("UNIT_DATA is not an array");
  const units: TimingUnit[] = [];
  for (const item of parsed) {
    const u = toUnit(item);
    if (u) units.push(u);
  }
  return units;
}

/** legacy JSON-file format (cargo < 1.??) — kept for compare/manifest compat */
export function parseTimingsJson(raw: string): TimingUnit[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("timings file is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("timings JSON is not an array of units");
  }
  const units: TimingUnit[] = [];
  for (const item of parsed) {
    const u = toUnit(item);
    if (u) units.push(u);
  }
  return units;
}

/** unit is a build-script compile/run step */
export function isBuildScriptUnit(u: TimingUnit): boolean {
  return (
    u.target === "build-script-build" ||
    u.target === "build-script-run" ||
    u.target === "custom-build"
  );
}

/** unit is a final binary artifact (codegen+link happens here) */
export function isBinUnit(u: TimingUnit): boolean {
  return u.target === "bin";
}

/** key that identifies a unit across two runs for delta math */
export function unitKey(u: TimingUnit): string {
  return `${u.name}@${u.version}#${u.target}`;
}
