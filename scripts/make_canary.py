#!/usr/bin/env python3
"""Generate the canary sample video with FFmpeg.

The canary check needs a tiny clip that is a real video with a non-silent audio
track, so a broken model can be told apart from a healthy one (section 15.2).
Run this once; it is committed to the repo as canary/sample_en_10s.mp4.

    python scripts/make_canary.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "canary" / "sample_en_10s.mp4"


def main() -> int:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("ffmpeg not found; cannot generate the canary sample.", file=sys.stderr)
        print("Install FFmpeg, or drop any 10-second video at:", OUT)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg, "-y",
        "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=10",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "64k",
        "-shortest",
        str(OUT),
    ]
    print(" ".join(command))
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr[-2000:], file=sys.stderr)
        return result.returncode

    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())