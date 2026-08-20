#!/usr/bin/env python3
"""Rasterize an SVG to PNG using the local headless Chromium.

Used to generate Open Graph images and touch icons from the SVG sources in
src/<site>/assets/img so the brand only ever has one editable master.

    python3 tools/rasterize.py src/ekorails/assets/img/og-default.svg 1200 630
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME = os.environ.get("CHROME_BIN", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")


def rasterize(svg: Path, width: int, height: int, out: Path | None = None) -> Path:
    out = out or svg.with_suffix(".png")
    html = (
        "<html><head><meta charset='utf-8'><style>html,body{margin:0;padding:0;"
        f"width:{width}px;height:{height}px;overflow:hidden}}"
        f"svg{{width:{width}px;height:{height}px;display:block}}</style></head><body>"
        + svg.read_text(encoding="utf-8")
        + "</body></html>"
    )
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "page.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
             f"--window-size={width},{height}", f"--screenshot={out}", f"file://{page}"],
            check=True, capture_output=True,
        )
    return out


if __name__ == "__main__":
    svg = Path(sys.argv[1])
    w, h = int(sys.argv[2]), int(sys.argv[3])
    print("wrote", rasterize(svg, w, h))
