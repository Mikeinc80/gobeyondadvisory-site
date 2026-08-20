#!/usr/bin/env python3
"""Screenshot a page at an arbitrary CSS width using the local headless Chromium.

Chromium refuses window widths below 500px, so narrow (mobile) captures are taken
by loading the page inside a fixed-width iframe on a wrapper document.

    python3 tools/shoot.py http://127.0.0.1:8811/index.html 390 1600 out.png
"""
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


def shoot(url: str, width: int, height: int, out: str) -> None:
    win_w = max(width, 500)
    with tempfile.TemporaryDirectory() as tmp:
        target = url
        if width < 500:
            wrapper = Path(tmp) / "wrap.html"
            wrapper.write_text(
                "<!doctype html><meta charset='utf-8'>"
                "<style>html,body{margin:0;background:#888}"
                f"iframe{{width:{width}px;height:{height}px;border:0;display:block}}</style>"
                f"<iframe src='{url}'></iframe>",
                encoding="utf-8",
            )
            target = "file://" + str(wrapper)
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
             f"--window-size={win_w},{height}", "--virtual-time-budget=4000",
             f"--screenshot={out}", target],
            check=True, capture_output=True,
        )
    print("wrote", out)


if __name__ == "__main__":
    shoot(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
