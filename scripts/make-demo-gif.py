#!/usr/bin/env python3
"""Build examples/demo.gif + examples/demo-transcript.txt from REAL cargoscope runs.

Demo story (all outputs verbatim from the built CLI):
  1. cargo cargoscope --version
  2. cargo cargoscope measure --json before.json   (fixture: build script re-runs every build)
  3. cargo cargoscope recommend --from before.json (ranked fixes, cheapest first)
  4. apply the #2 fix: give the build script proper rerun-if-changed directives
  5. cargo cargoscope measure --json after.json
  6. cargo cargoscope compare before.json after.json  (measured delta)

Only the typing animation and hold frames are added; outputs are verbatim.
"""

import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, "dist", "index.js")
SAMPLE = os.path.join(ROOT, "examples", "sample-crate")
OUT_GIF = os.path.join(ROOT, "examples", "demo.gif")
OUT_TXT = os.path.join(ROOT, "examples", "demo-transcript.txt")

BG = (30, 30, 30)
FG = (212, 212, 212)
PROMPT = (126, 231, 135)
CMD = (255, 255, 255)

FPS = 12
FONT_SIZE = 18
LINE_H = 24
PAD = 16

# The honest fix for the fixture's re-running build script: declare exactly
# what the script reads, and stop rewriting its own watched input.
FIXED_BUILD_RS = """\
// Fixed: precise rerun-if-changed directives, no self-rewriting inputs.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rustc-cfg=feature=\\"demo_native\\"");
}
"""


def sh(cmd, cwd, env):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)
    return r.returncode, r.stdout, r.stderr


def main():
    if not os.path.exists(CLI):
        sys.exit("build first: npm run build (dist/index.js missing)")
    tmp = tempfile.mkdtemp(prefix="cargoscope-demo-")
    try:
        crate = os.path.join(tmp, "crate")
        shutil.copytree(SAMPLE, crate)
        # the demo builds run cargo for real; keep the fixture pristine
        bindir = os.path.join(tmp, "bin")
        os.makedirs(bindir)
        with open(os.path.join(bindir, "cargo-cargoscope"), "w") as f:
            f.write('#!/bin/sh\nexec node "%s" "$@"\n' % CLI)
        os.chmod(os.path.join(bindir, "cargo-cargoscope"), 0o755)
        env = dict(os.environ)
        env["PATH"] = bindir + os.pathsep + env.get("PATH", "")

        steps = []

        def run(cmd, hold):
            code, out, err = sh(cmd.split(), crate, env)
            text = out + err
            steps.append((cmd, code, text, hold))

        run("cargo cargoscope --version", 10)
        run("cargo cargoscope measure --json before.json", 40)
        run("cargo cargoscope recommend --from before.json", 40)

        # apply the fix (this is the human step the tool recommends)
        with open(os.path.join(crate, "corelib", "build.rs"), "w") as f:
            f.write(FIXED_BUILD_RS)
        steps.append(("# fix applied: build.rs now declares rerun-if-changed", 0, "", 14))

        run("cargo cargoscope measure --json after.json", 40)
        run("cargo cargoscope compare before.json after.json", 60)

        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", FONT_SIZE
        )
        probe = Image.new("RGB", (8, 8))
        d0 = ImageDraw.Draw(probe)
        char_w = d0.textlength("0123456789" * 10, font=font) / 100

        with open(OUT_TXT, "w") as f:
            for cmd, code, text, _ in steps:
                prefix = "# " if cmd.startswith("# ") else "$ "
                shown = cmd[2:] if cmd.startswith("# ") else cmd
                f.write(prefix + shown + "\n")
                f.write(text)
                if text and not text.endswith("\n"):
                    f.write("\n")
                if code != 0:
                    f.write("(exit code %d)\n" % code)

        lines = []
        for cmd, _, text, _ in steps:
            lines.append(("$ " + cmd, True))
            for ln in text.split("\n"):
                if ln == "" and text.endswith("\n"):
                    continue
                lines.append((ln, False))
        max_len = max(len(t) for t, _ in lines)
        width = max(960, min(1600, int(max_len * char_w) + PAD * 2))
        visible = 26
        height = visible * LINE_H + PAD * 2

        frames = []
        cur = []
        for cmd, _code, text, hold in steps:
            if cmd.startswith("# "):
                cur.append(("$ " + cmd, False))
                frames.append(draw_frame(cur, None, width, height, font, char_w, visible))
                continue
            for n in range(1, len(cmd) + 1, 3):
                cur_typed = ("$ " + cmd[:n], True)
                frames.append(draw_frame(cur, cur_typed, width, height, font, char_w, visible))
            cur.append(("$ " + cmd, False))
            for _ in range(4):
                frames.append(draw_frame(cur, None, width, height, font, char_w, visible))
            out_lines = [ln for ln in text.split("\n") if not (ln == "" and text.endswith("\n"))]
            # trim very long outputs to their informative head+tail for the GIF
            # (transcript keeps everything verbatim)
            shown_lines = out_lines
            if len(out_lines) > 34:
                shown_lines = out_lines[:20] + ["  ... (%d more lines — full output in demo-transcript.txt)" % (len(out_lines) - 28)] + out_lines[-8:]
            for ln in shown_lines:
                cur.append((ln, False))
            frames.append(draw_frame(cur, None, width, height, font, char_w, visible))
            for _ in range(hold):
                frames.append(draw_frame(cur, None, width, height, font, char_w, visible))
        for _ in range(12):
            frames.append(draw_frame(cur, None, width, height, font, char_w, visible))

        frames[0].save(
            OUT_GIF, save_all=True, append_images=frames[1:],
            duration=int(1000 / FPS), loop=0,
        )
        print("wrote %s (%d frames, %d bytes)" % (OUT_GIF, len(frames), os.path.getsize(OUT_GIF)))
        print("wrote %s" % OUT_TXT)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def draw_frame(done_lines, typing, width, height, font, char_w, visible):
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    items = list(done_lines)
    if typing is not None:
        items.append(typing)
    start = max(0, len(items) - visible)
    y = PAD
    for text, _is_cmd in items[start:]:
        if text.startswith("$ "):
            d.text((PAD, y), "$ ", font=font, fill=PROMPT)
            d.text((PAD + 2 * char_w, y), text[2:], font=font, fill=CMD)
        else:
            d.text((PAD, y), text, font=font, fill=FG)
        y += LINE_H
    return img


if __name__ == "__main__":
    main()
