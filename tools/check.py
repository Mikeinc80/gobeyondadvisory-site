#!/usr/bin/env python3
"""Pre-flight checks over the built sites.

Validates internal links, image alt text, form labelling, heading order,
duplicate element ids, metadata completeness and the presence of the required
regulatory disclaimer on every page.
"""
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "dist"
DISCLAIMER = "does not constitute financial, investment, legal or payment-services advice"

problems: list[str] = []


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.ids, self.headings = [], [], []
        self.imgs, self.labels, self.controls = [], [], []
        self.title_len = 0
        self._in_title = False
        self._in_head = False
        self._in_svg = False
        self._in_h = None
        self._h_text = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "a" and "href" in a:
            self.links.append(a["href"])
        if tag == "img":
            self.imgs.append(a)
        if tag == "label" and "for" not in a:
            self._wrapping_label = True
        if tag == "label":
            self.labels.append(a.get("for"))
        if tag in ("input", "select", "textarea"):
            if a.get("type") not in ("hidden", "submit", "button"):
                self.controls.append(a)
        if tag == "head":
            self._in_head = True
        if tag == "svg":
            self._in_svg = True
        if tag == "title" and self._in_head and not self._in_svg:
            self._in_title = True
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._in_h, self._h_text = int(tag[1]), ""

    def handle_endtag(self, tag):
        if tag == "head":
            self._in_head = False
        if tag == "svg":
            self._in_svg = False
        if tag == "title":
            self._in_title = False
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self._in_h:
            self.headings.append((self._in_h, self._h_text.strip()))
            self._in_h = None

    def handle_data(self, data):
        if self._in_title:
            self.title_len += len(data)
        if self._in_h:
            self._h_text += data


def check_site(site: str):
    root = DIST / site
    files = [f for f in sorted(root.rglob("*.html")) if "/admin/" not in f.as_posix()]
    have = {("/" + f.relative_to(root).as_posix()) for f in files}
    have |= {p[:-5] for p in have if p.endswith(".html")}
    have |= {"/"} if (root / "index.html").exists() else set()
    have |= {p[: -len("index.html")] for p in have if p.endswith("/index.html")}

    for f in files:
        rel = f.relative_to(root).as_posix()
        where = f"{site}/{rel}"
        html = f.read_text(encoding="utf-8")
        p = Page()
        p.feed(html)

        # metadata
        if not 15 <= p.title_len <= 70:
            problems.append(f"[title-length] {where}: <title> is {p.title_len} chars (target 15-70)")
        m = re.search(r'<meta name="description" content="([^"]*)"', html)
        if not m:
            problems.append(f"[meta] {where}: missing description")
        elif not 70 <= len(m.group(1)) <= 320:
            problems.append(f"[meta-length] {where}: description {len(m.group(1))} chars")
        if '<link rel="canonical"' not in html:
            problems.append(f"[meta] {where}: missing canonical")
        if DISCLAIMER not in html:
            problems.append(f"[disclaimer] {where}: footer disclaimer text missing")

        # headings
        h1s = [h for h in p.headings if h[0] == 1]
        if len(h1s) != 1:
            problems.append(f"[headings] {where}: {len(h1s)} h1 elements")
        last = 0
        for level, text in p.headings:
            if last and level > last + 1:
                problems.append(f"[headings] {where}: h{last} -> h{level} skips a level ({text[:40]!r})")
            last = level

        # ids
        dupes = {i for i in p.ids if p.ids.count(i) > 1}
        if dupes:
            problems.append(f"[ids] {where}: duplicate ids {sorted(dupes)}")

        # images
        for img in p.imgs:
            if "alt" not in img:
                problems.append(f"[a11y] {where}: <img> without alt ({img.get('src')})")

        # form controls
        label_targets = {l for l in p.labels if l}
        for c in p.controls:
            cid = c.get("id")
            if not cid:
                problems.append(f"[a11y] {where}: control without id ({c.get('name')})")
            elif cid not in label_targets and "aria-label" not in c:
                problems.append(f"[a11y] {where}: control #{cid} has no label")

        # links
        for href in p.links:
            if href.startswith(("http://", "https://", "mailto:", "tel:", "#")):
                continue
            path, _, frag = href.partition("#")
            path = path.split("?")[0]
            if not path:
                continue
            if path not in have:
                problems.append(f"[link] {where}: internal link not found -> {href}")

    print(f"  {site}: {len(files)} pages checked")


for site in sys.argv[1:] or ["ekorails", "ekoinfrastructure"]:
    check_site(site)

if problems:
    print(f"\n{len(problems)} issue(s):")
    for pr in problems:
        print("  -", pr)
    sys.exit(1)
print("\nAll checks passed.")
