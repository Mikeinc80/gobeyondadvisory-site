#!/usr/bin/env python3
"""Bundle one built site into a single review document.

Deliberately plain: no JavaScript, no iframes, no CSS scoping tricks. Every page
is stacked in document order inside one HTML file, each behind a labelled
divider, with anchor links for navigation. It renders anywhere an HTML file
renders — a browser, a preview pane, a phone, an email client.

One file per site, so each carries only its own stylesheet and there is no
chance of the two design systems colliding.

    python3 tools/preview-static.py
"""
from __future__ import annotations

import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "preview"

SITES = {
    "ekorails": {
        "label": "EKORails.com",
        "host": "ekorails.com",
        "other_host": "ekoinfrastructure.com",
        "other_file": "ekoinfrastructure-review.html",
        "order": ["/", "/platform", "/use-cases", "/pilot-and-regulatory-pathway", "/corridors",
                  "/compliance-and-risk", "/technology", "/partners", "/leadership", "/news",
                  "/contact", "/privacy-policy", "/terms-of-use", "/regulatory-disclaimer",
                  "/thank-you"],
    },
    "ekoinfrastructure": {
        "label": "EkoInfrastructure.com",
        "host": "ekoinfrastructure.com",
        "other_host": "ekorails.com",
        "other_file": "ekorails-review.html",
        "order": ["/", "/settlement-explained", "/corridor-intelligence", "/policy-and-regulation",
                  "/technology", "/glossary", "/data-and-sources", "/ekorails", "/about",
                  "/contact", "/search", "/research/clearing-versus-settlement",
                  "/research/what-papss-does", "/research/swift-is-a-messaging-network",
                  "/research/reading-a-trade-corridor", "/thank-you"],
    },
}

# Count what the reader actually sees: the design system marks every unresolved
# fact with class="placeholder", which renders as a dashed gold marker.
PLACEHOLDER_RE = re.compile(r'<span class="placeholder">')
SCRIPT_RE = re.compile(r"(?s)<script\b.*?</script>")
CONSENT_RE = re.compile(r'(?s)<div class="consent"[^>]*>.*?</div>\s*(?=<footer)')
BODY_RE = re.compile(r"(?s)<body[^>]*>(.*)</body>")
MAIN_RE = re.compile(r"(?s)<main[^>]*>(.*)</main>")
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)

# Overrides that make full pages behave when stacked in one document.
REVIEW_CSS = """
/* ---- review document chrome (not part of the site design) ---- */
.rvw-doc { background: #E6E2DA; }
.rvw-head {
  background: #08151F; color: #F3F1EC; padding: 22px var(--gutter, 24px) 26px;
  font-family: var(--font-ui);
}
.rvw-head h1 { color: #fff; font-size: 1.35rem; margin: 0 0 .35rem; font-family: var(--font-ui); font-weight: 600; }
.rvw-head p { color: #C2CDD5; font-size: .875rem; margin: 0; max-width: 78ch; }
.rvw-head a { color: #6FC3A2; }
.rvw-toc { margin-top: 18px; }
.rvw-toc summary {
  cursor: pointer; font: 600 .75rem/1 var(--font-mono); letter-spacing: .1em;
  text-transform: uppercase; color: #6FC3A2; padding: 8px 0;
}
.rvw-toc ol {
  list-style: none; padding: 12px 0 0; margin: 0;
  display: grid; gap: 6px 24px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
.rvw-toc a { color: #C2CDD5; text-decoration: none; font-size: .8125rem; display: block; padding: 3px 0; }
.rvw-toc a:hover { color: #fff; text-decoration: underline; }
.rvw-toc .n { font-family: var(--font-mono); color: #5C6B75; margin-right: 8px; }
.rvw-bar {
  position: relative; background: #0D2233; color: #C2CDD5;
  padding: 14px var(--gutter, 24px); display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline;
  font: 500 .75rem/1.5 var(--font-mono); letter-spacing: .04em;
  border-top: 3px solid #6FC3A2;
}
.rvw-bar b { color: #fff; font-weight: 600; }
.rvw-bar .todo {
  color: #E4D6B4; border: 1px dashed rgba(228,214,180,.5); border-radius: 3px; padding: 3px 7px;
}
.rvw-bar .top { margin-left: auto; color: #6FC3A2; text-decoration: none; }
.rvw-bar .top:hover { text-decoration: underline; }
.rvw-page { border-bottom: 24px solid #E6E2DA; }
/* Stacked full pages: sticky chrome would pile up, and the fixed consent bar
   would sit over every page at once. */
.site-header { position: static !important; }
.sticky-side { position: static !important; }
.consent { display: none !important; }
html { scroll-behavior: auto; }
:target { scroll-margin-top: 0; }
"""


def build(key: str) -> Path:
    meta = SITES[key]
    root = DIST / key
    css = (root / "assets/css/site.css").read_text(encoding="utf-8")

    def asset_uri(rel: str) -> str:
        f = root / rel.lstrip("/")
        if not f.exists():                      # only EKORails has portraits
            f = DIST / "ekorails" / rel.lstrip("/")
        data = f.read_bytes()
        mime = "image/svg+xml" if f.suffix == ".svg" else "image/png"
        return f"data:{mime};base64," + base64.b64encode(data).decode()

    portrait = asset_uri("/assets/img/person-placeholder.svg")

    def anchor(path: str) -> str:
        return "p" + (path.rstrip("/") or "/").replace("/", "-").strip("-") if path != "/" else "phome"

    pages, toc, counts = [], [], []
    for i, path in enumerate(meta["order"], 1):
        rel = "index.html" if path == "/" else path.lstrip("/") + ".html"
        f = root / rel
        if not f.exists():
            continue
        html = f.read_text(encoding="utf-8")
        title = TITLE_RE.search(html).group(1)
        # Count only page content: the footer's registration line carries a
        # placeholder on every page, and counting it would suggest work on pages
        # that need none.
        main = MAIN_RE.search(html)
        todo = len(PLACEHOLDER_RE.findall(main.group(1) if main else html))

        body = BODY_RE.search(html).group(1)
        body = SCRIPT_RE.sub("", body)
        body = CONSENT_RE.sub("", body)
        body = body.replace('src="/assets/img/person-placeholder.svg"', f'src="{portrait}"')

        # Rewrite links: same-site paths become in-document anchors; the other
        # site's links point at its companion file; mail and external links stay.
        def fix(m):
            href = m.group(1)
            if href.startswith("#") or href.startswith("mailto:"):
                return m.group(0)
            for host_key, target in ((meta["host"], None), (meta["other_host"], meta["other_file"])):
                for pre in (f"https://{host_key}", f"https://www.{host_key}"):
                    if href.startswith(pre):
                        rest = href[len(pre):] or "/"
                        p, _, frag = rest.partition("#")
                        p = p.rstrip("/") or "/"
                        if target:
                            return f'href="{target}#{anchor(p)}"'
                        return f'href="#{anchor(p)}"'
            if href.startswith("/"):
                p, _, frag = href.partition("#")
                p = p.split("?")[0].rstrip("/") or "/"
                if p in meta["order"]:
                    return f'href="#{anchor(p)}"'
                return f'href="#{anchor("/")}"'
            return m.group(0)

        body = re.sub(r'href="([^"]*)"', fix, body)

        aid = anchor(path)
        url = meta["host"] + (path if path != "/" else "/")
        todo_html = (
            f'<span class="todo">{todo} item{"s" if todo != 1 else ""} need'
            f'{"" if todo != 1 else "s"} your input</span>' if todo else ""
        )
        pages.append(
            f'<section class="rvw-page" id="{aid}">'
            f'<div class="rvw-bar"><span>{i:02d}</span><span><b>{url}</b></span>'
            f'<span>{title}</span>{todo_html}'
            f'<a class="top" href="#rvw-top">Back to page list &uarr;</a></div>'
            f"{body}</section>"
        )
        counts.append(todo)
        name = "Home" if path == "/" else title.split(" | ")[0]
        toc.append(
            f'<li><a href="#{aid}"><span class="n">{i:02d}</span>{name}'
            + (f" &middot; {todo}" if todo else "")
            + "</a></li>"
        )

    total = sum(counts)
    out = OUT / f"{key}-review.html"
    out.write_text(
        f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{meta['label']} — review copy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&amp;family=IBM+Plex+Mono:wght@400;500;600&amp;display=swap">
<style>
{css}
{REVIEW_CSS}
</style>
</head>
<body class="rvw-doc">
<div class="rvw-head" id="rvw-top">
  <h1>{meta['label']} — review copy</h1>
  <p>All {len(pages)} pages, in site order, one after another. No JavaScript, so nothing here can fail
     to load: scroll, or jump from the list below. {total} items across this site still need your input —
     they appear in the copy as dashed gold markers.
     The companion file <b>{meta['other_file']}</b> holds the other site; links between the two work if
     both files sit in the same folder.</p>
  <details class="rvw-toc" open>
    <summary>Pages</summary>
    <ol>{''.join(toc)}</ol>
  </details>
</div>
{''.join(pages)}
</body>
</html>
""",
        encoding="utf-8",
    )
    print(f"wrote {out.relative_to(ROOT)} — {len(pages)} pages, {total} items to confirm, {out.stat().st_size/1024:.0f} KB")
    return out


if __name__ == "__main__":
    for k in SITES:
        build(k)
