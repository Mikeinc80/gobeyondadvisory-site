#!/usr/bin/env python3
"""Bundle both built sites into one self-contained preview page.

Produces a single HTML file that carries every built page as an inline document
and renders the selected one in an iframe at a chosen viewport width. Internal
links are intercepted so the whole site — including cross-links between the two
domains — is browsable without a server.

    python3 tools/preview.py                 # -> preview/ekorails-preview.html
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "preview" / "ekorails-preview.html"

SITES = {
    "eko": {"key": "ekorails", "label": "EKORails.com", "host": "ekorails.com"},
    "inf": {"key": "ekoinfrastructure", "label": "EkoInfrastructure.com", "host": "ekoinfrastructure.com"},
}

# Nav order for the page list, by path stem. Anything unlisted is appended.
ORDER = {
    "eko": ["/", "/platform", "/use-cases", "/pilot-and-regulatory-pathway", "/corridors",
            "/compliance-and-risk", "/technology", "/partners", "/leadership", "/news",
            "/contact", "/privacy-policy", "/terms-of-use", "/regulatory-disclaimer", "/thank-you"],
    "inf": ["/", "/settlement-explained", "/corridor-intelligence", "/policy-and-regulation",
            "/technology", "/glossary", "/data-and-sources", "/ekorails", "/about", "/contact",
            "/search", "/research/clearing-versus-settlement", "/research/what-papss-does",
            "/research/swift-is-a-messaging-network", "/research/reading-a-trade-corridor",
            "/thank-you"],
}

STRIP = [
    re.compile(r'<link rel="icon"[^>]*>'),
    re.compile(r'<link rel="apple-touch-icon"[^>]*>'),
    re.compile(r'<link rel="manifest"[^>]*>'),
    re.compile(r'<script src="/assets/js/[^"]*" defer></script>'),
    re.compile(r'(?s)<script type="application/ld\+json">.*?</script>\s*'),
]

# A trimmed stand-in for site.js: the interactions a reviewer will actually try.
INJECT = """
<script>
(function(){
  var t=document.querySelector('[data-nav-toggle]'),p=document.querySelector('[data-mobile-nav]');
  if(t&&p){t.addEventListener('click',function(){var o=t.getAttribute('aria-expanded')==='true';
    t.setAttribute('aria-expanded',String(!o));p.hidden=o;});}
  var c=document.querySelector('[data-consent]');
  if(c){c.hidden=false;c.addEventListener('click',function(e){
    if(e.target.closest('[data-consent-choice]')) c.hidden=true;});}
  document.addEventListener('click',function(e){
    var a=e.target.closest('a'); if(!a) return;
    var h=a.getAttribute('href')||'';
    if(h.charAt(0)==='#') return;
    e.preventDefault();
    parent.postMessage({eko:'nav',href:h,host:a.hostname||''},'*');
  });
})();
</script>
"""


def collect():
    pages, css = {}, {}
    placeholder = (DIST / "ekorails/assets/img/person-placeholder.svg").read_text(encoding="utf-8")
    portrait = "data:image/svg+xml;base64," + base64.b64encode(placeholder.encode()).decode()

    for sid, meta in SITES.items():
        root = DIST / meta["key"]
        css[sid] = (root / "assets/css/site.css").read_text(encoding="utf-8")
        found = {}
        for f in sorted(root.rglob("*.html")):
            if "/admin/" in f.as_posix():
                continue
            rel = f.relative_to(root).as_posix()
            path = "/" if rel == "index.html" else "/" + rel[:-5]
            html = f.read_text(encoding="utf-8")
            title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
            for pat in STRIP:
                html = pat.sub("", html)
            html = html.replace('<link rel="stylesheet" href="/assets/css/site.css">', "__CSS__")
            html = html.replace('src="/assets/img/person-placeholder.svg"', 'src="%s"' % portrait)
            html = html.replace("</body>", INJECT + "</body>")
            found[path] = {"t": title, "h": html}
        ordered = [p for p in ORDER[sid] if p in found] + [p for p in found if p not in ORDER[sid]]
        pages[sid] = {"order": ordered, "docs": found}
    return pages, css


def main():
    pages, css = collect()
    OUT.parent.mkdir(exist_ok=True)
    total = sum(len(p["docs"]) for p in pages.values())
    # The page HTML contains literal </script> (the injected helper), which would
    # otherwise terminate the host <script> block early.
    def embed(obj):
        return json.dumps(obj, separators=(",", ":")).replace("</", "<\\/")

    data = embed(pages)
    cssdata = embed(css)
    tpl = (ROOT / "tools" / "preview-shell.html").read_text(encoding="utf-8")
    OUT.write_text(
        tpl.replace("/*__PAGES__*/null", data).replace("/*__CSS__*/null", cssdata),
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} — {total} pages, {OUT.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
