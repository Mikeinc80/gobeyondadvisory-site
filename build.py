#!/usr/bin/env python3
"""
EKORails LTD — static site generator.

Builds two independent, deployable static sites from shared page fragments:

    src/ekorails/           -> dist/ekorails/            (EKORails.com)
    src/ekoinfrastructure/  -> dist/ekoinfrastructure/   (EkoInfrastructure.com)

No third-party dependencies. Python 3.9+.

Each page is an HTML fragment in <site>/pages/*.html that starts with a JSON
front-matter block:

    <!--meta
    { "path": "platform.html", "title": "...", ... }
    -->

Site-wide chrome, metadata, JSON-LD, sitemap and robots.txt are generated here so
that regulatory language and navigation stay identical across every page.
"""

from __future__ import annotations

import base64
import hashlib
import tomllib
import json
import os
import re
import shutil
import sys
from datetime import date
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
CONTENT = ROOT / "content"
BUILD_DATE = os.environ.get("BUILD_DATE", date.today().isoformat())

META_RE = re.compile(r"^\s*<!--meta\s*(\{.*?\})\s*-->", re.S)


# ---------------------------------------------------------------- helpers

def read_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def load_fragment(path: Path):
    raw = path.read_text(encoding="utf-8")
    match = META_RE.match(raw)
    if not match:
        raise SystemExit(f"{path}: missing <!--meta { ... } --> front matter")
    try:
        meta = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON front matter — {exc}") from exc
    body = raw[match.end():].strip()
    return meta, body


def canonical(site, path):
    base = site["base_url"].rstrip("/")
    if path in ("index.html", ""):
        return base + "/"
    return f"{base}/{path[:-5]}" if path.endswith(".html") else f"{base}/{path}"


def href(path):
    """Extensionless internal URLs (Netlify/most hosts serve pretty URLs)."""
    if path in ("index.html", "", "/"):
        return "/"
    return "/" + path[:-5] if path.endswith(".html") else "/" + path


# ---------------------------------------------------------------- chrome

def build_nav(site, current):
    items = []
    for entry in site["nav"]:
        active = ' aria-current="page"' if entry["path"] == current else ""
        cls = ' class="is-active"' if entry["path"] == current else ""
        items.append(
            f'<li><a{cls}{active} href="{href(entry["path"])}">{escape(entry["label"])}</a></li>'
        )
    cta = site["nav_cta"]
    return f"""
<a class="skip-link" href="#main">Skip to main content</a>
<header class="site-header" data-header>
  <div class="shell header-inner">
    <a class="wordmark" href="/" aria-label="{escape(site['name'])} — home">
      {site['wordmark_svg']}
    </a>
    <nav class="primary-nav" aria-label="Primary">
      <ul>{''.join(items)}</ul>
    </nav>
    <div class="header-actions">
      <a class="btn btn-sm btn-solid" href="{href(cta['path'])}">{escape(cta['label'])}</a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="mobile-nav"
              data-nav-toggle><span class="nav-toggle-bars" aria-hidden="true"></span>
        <span class="sr-only">Open menu</span></button>
    </div>
  </div>
  <div class="mobile-nav" id="mobile-nav" data-mobile-nav hidden>
    <ul>{''.join(items)}</ul>
    <a class="btn btn-solid btn-block" href="{href(cta['path'])}">{escape(cta['label'])}</a>
    <p class="mobile-nav-note">{escape(site['status_line'])}</p>
  </div>
</header>""".strip()


def build_footer(site):
    cols = []
    for col in site["footer_columns"]:
        parts = []
        for l in col["links"]:
            rel = ' rel="noopener"' if l["href"].startswith("http") else ""
            parts.append(
                '<li><a href="%s"%s>%s</a></li>' % (l["href"], rel, escape(l["label"]))
            )
        links = "".join(parts)
        cols.append(
            f'<div class="footer-col"><h2 class="footer-h">{escape(col["title"])}</h2><ul>{links}</ul></div>'
        )
    consent = """
<div class="consent" data-consent role="region" aria-label="Cookie choices" hidden>
  <div class="shell consent-inner">
    <p>We use a privacy-preserving measurement tool to understand which pages institutional visitors
      read. No advertising cookies, no cross-site tracking and no sale of data. Read the
      <a href="%s">privacy policy</a>.</p>
    <div class="consent-actions">
      <button class="btn btn-sm btn-ghost" type="button" data-consent-choice="denied">Essential only</button>
      <button class="btn btn-sm btn-solid" type="button" data-consent-choice="granted">Allow measurement</button>
    </div>
  </div>
</div>""" % site["privacy_path"]

    return f"""{consent}
<footer class="site-footer" id="footer">
  <div class="shell">
    <div class="footer-top">
      <div class="footer-brand">
        {site['wordmark_footer_svg']}
        <p class="footer-tag">{escape(site['tagline'])}</p>
        <p class="footer-sub">{escape(site['supporting_line'])}</p>
      </div>
      <div class="footer-cols">{''.join(cols)}</div>
    </div>
    <div class="footer-status" role="note">
      <p><strong>Regulatory status.</strong> {site['regulatory_status_html']}</p>
    </div>
    <div class="footer-legal">
      <p class="disclaimer">{escape(site['disclaimer'])}</p>
      <p class="colophon">&copy; {BUILD_DATE[:4]} {escape(site['legal_name'])}. {escape(site['registration_line'])}</p>
    </div>
  </div>
</footer>""".strip()


# ---------------------------------------------------------------- schema

def jsonld_blocks(site, meta, page_path):
    blocks = []
    org = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": site["base_url"] + "/#organization",
        "name": site["legal_name"],
        "alternateName": site["name"],
        "url": site["base_url"] + "/",
        "logo": site["base_url"] + site["logo_path"],
        "description": site["org_description"],
        "slogan": site["tagline"],
        "email": site["primary_email"],
        "sameAs": site.get("same_as", []),
        "contactPoint": [
            {
                "@type": "ContactPoint",
                "contactType": c["type"],
                "email": c["email"],
                "availableLanguage": ["en"],
            }
            for c in site["contact_points"]
        ],
    }
    if site.get("parent_organization"):
        org["parentOrganization"] = site["parent_organization"]
    blocks.append(org)

    web = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": site["base_url"] + "/#website",
        "url": site["base_url"] + "/",
        "name": site["name"],
        "publisher": {"@id": site["base_url"] + "/#organization"},
        "inLanguage": "en",
    }
    if site.get("search_path"):
        web["potentialAction"] = {
            "@type": "SearchAction",
            "target": {
                "@type": "EntryPoint",
                "urlTemplate": site["base_url"] + site["search_path"] + "?q={search_term_string}",
            },
            "query-input": "required name=search_term_string",
        }
    blocks.append(web)

    crumbs = meta.get("breadcrumbs")
    if crumbs:
        blocks.append({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": i + 1,
                    "name": c["name"],
                    "item": canonical(site, c["path"]),
                }
                for i, c in enumerate(crumbs)
            ],
        })

    faqs = meta.get("faq")
    if faqs:
        blocks.append({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": f["q"],
                    "acceptedAnswer": {"@type": "Answer", "text": f["a"]},
                }
                for f in faqs
            ],
        })

    art = meta.get("article")
    if art:
        blocks.append({
            "@context": "https://schema.org",
            "@type": art.get("type", "Article"),
            "headline": meta["h1"] if "h1" in meta else meta["title"],
            "description": meta["description"],
            "datePublished": art["published"],
            "dateModified": art.get("updated", art["published"]),
            "author": {"@type": "Person", "name": art["author"]},
            "publisher": {"@id": site["base_url"] + "/#organization"},
            "mainEntityOfPage": canonical(site, page_path),
            "isAccessibleForFree": True,
            "citation": art.get("citations", []),
        })
    return blocks


# ---------------------------------------------------------------- page shell

def render_page(site, meta, body):
    path = meta["path"]
    url = canonical(site, path)
    title = meta["title"]
    desc = meta["description"]
    og_image = site["base_url"] + meta.get("og_image", site["og_image"])
    robots = meta.get("robots", "index,follow,max-image-preview:large")
    nav = build_nav(site, path)
    footer = build_footer(site)
    schema_bodies = [json.dumps(b, ensure_ascii=False) for b in jsonld_blocks(site, meta, path)]
    schema = "\n".join(
        f'<script type="application/ld+json">{body}</script>' for body in schema_bodies
    )
    # CSP hashes: inline JSON-LD is subject to script-src, so each block is hashed
    # and the digest emitted into _headers rather than weakening the policy.
    meta["_csp_hashes"] = [
        "'sha256-" + base64.b64encode(hashlib.sha256(b.encode("utf-8")).digest()).decode() + "'"
        for b in schema_bodies
    ]
    extra_head = meta.get("head", "")
    extra_body = meta.get("scripts", "")
    body_class = meta.get("body_class", "")

    return f"""<!DOCTYPE html>
<html lang="en" class="{site['html_class']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{escape(title)}</title>
<meta name="description" content="{escape(desc)}">
<meta name="robots" content="{robots}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="{site['theme_color']}">
<meta name="color-scheme" content="light">
<meta property="og:type" content="{meta.get('og_type', 'website')}">
<meta property="og:site_name" content="{escape(site['name'])}">
<meta property="og:title" content="{escape(meta.get('og_title', title))}">
<meta property="og:description" content="{escape(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:alt" content="{escape(site['og_image_alt'])}">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(meta.get('og_title', title))}">
<meta name="twitter:description" content="{escape(desc)}">
<meta name="twitter:image" content="{og_image}">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{site['font_css']}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="{site['font_css']}"></noscript>
<link rel="stylesheet" href="{site['css_path']}">
{extra_head}
{schema}
</head>
<body class="{body_class}">
{nav}
<main id="main" tabindex="-1">
{body}
</main>
{footer}
<script src="/assets/js/site.js" defer></script>
{extra_body}
</body>
</html>
"""


# ---------------------------------------------------------------- sitemap

CSP_TEMPLATE = (
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; "
    "object-src 'none'; script-src 'self' {hashes}; style-src 'self' 'unsafe-inline' "
    "https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; connect-src 'self'; manifest-src 'self'; upgrade-insecure-requests"
)


TAG_RE = re.compile(r"(?s)<(script|style|svg).*?</\1>|<[^>]+>")
WS_RE = re.compile(r"\s+")


def write_search_index(site, out: Path, entries):
    """Client-side search index for EkoInfrastructure.com.

    Body text is stripped of markup and truncated so the index stays small enough
    to fetch on demand without hurting Core Web Vitals on first load.
    """
    docs = []
    for meta, body in entries:
        if meta.get("noindex"):
            continue
        text = WS_RE.sub(" ", TAG_RE.sub(" ", body)).strip()
        docs.append({
            "u": href(meta["path"]),
            "t": meta.get("h1", meta["title"].split(" | ")[0]).rstrip("."),
            "d": meta["description"],
            "k": meta.get("topic", meta.get("section", "Reference")),
            "p": meta.get("article", {}).get("published", ""),
            "b": text[:3000],
        })
    (out / "search-index.json").write_text(
        json.dumps(docs, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


def write_redirects(src: Path, out: Path):
    """Translate [[redirects]] from netlify.toml into a publish-directory _redirects file.

    Netlify reads netlify.toml from the *base* directory, which differs between a
    manual folder deploy and a Git-linked build. _redirects and _headers are read
    from the publish directory in both cases, so emitting them here means the
    redirect map and security headers apply identically either way.
    """
    toml = src / "netlify.toml"
    if not toml.exists():
        return {}
    with toml.open("rb") as fh:
        conf = tomllib.load(fh)
    lines = ["# Generated by build.py from netlify.toml — do not edit by hand.", ""]
    for r in conf.get("redirects", []):
        status = str(r.get("status", 301)) + ("!" if r.get("force") else "")
        lines.append(f'{r["from"]}  {r["to"]}  {status}')
    (out / "_redirects").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return conf


def write_headers(out: Path, pages, conf=None):
    """Emit a Netlify _headers file: global security headers, then per-page CSP.

    The per-page rules come last so their Content-Security-Policy — which carries
    the SHA-256 hash of that page's inline JSON-LD — wins over anything global.
    """
    lines = []
    for h in (conf or {}).get("headers", []):
        lines.append(h["for"] + "\n")
        for k, v in h.get("values", {}).items():
            lines.append(f"  {k}: {v}\n")
        lines.append("\n")
    for meta in pages:
        url = href(meta["path"])
        csp = CSP_TEMPLATE.format(hashes=" ".join(meta.get("_csp_hashes", [])))
        lines.append(f"{url}\n  Content-Security-Policy: {csp}\n")
        if url != "/":
            lines.append(f"{meta['path']}\n  Content-Security-Policy: {csp}\n")
    # The editorial route is noindex and needs a slightly different policy: the
    # vendored CMS bundle uses inline styles and talks to the Identity/Git Gateway
    # endpoints on the same origin.
    lines.append(
        "/admin/*\n"
        "  X-Robots-Tag: noindex, nofollow\n"
        "  Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
        "object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; connect-src 'self'; form-action 'self'\n"
    )
    (out / "_headers").write_text("".join(lines), encoding="utf-8")


def write_sitemap(site, out: Path, pages):
    urls = []
    for meta in pages:
        if meta.get("noindex") or "noindex" in meta.get("robots", ""):
            continue
        urls.append(
            "  <url>\n"
            f"    <loc>{canonical(site, meta['path'])}</loc>\n"
            f"    <lastmod>{meta.get('lastmod', BUILD_DATE)}</lastmod>\n"
            f"    <changefreq>{meta.get('changefreq', 'monthly')}</changefreq>\n"
            f"    <priority>{meta.get('priority', '0.7')}</priority>\n"
            "  </url>"
        )
    (out / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n",
        encoding="utf-8",
    )
    (out / "robots.txt").write_text(
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /thank-you\n"
        "Disallow: /admin/\n\n"
        f"Sitemap: {site['base_url']}/sitemap.xml\n",
        encoding="utf-8",
    )
    (out / "site.webmanifest").write_text(
        json.dumps(
            {
                "name": site["legal_name"],
                "short_name": site["name"],
                "start_url": "/",
                "display": "standalone",
                "background_color": site["theme_color"],
                "theme_color": site["theme_color"],
                "icons": [
                    {"src": "/assets/img/favicon.svg", "sizes": "any", "type": "image/svg+xml"}
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


# ---------------------------------------------------------------- build

def build_site(key: str) -> int:
    src = SRC / key
    out = DIST / key
    site = read_json(src / "site.json")
    site["wordmark_svg"] = (src / "assets/img/wordmark.svg").read_text(encoding="utf-8").strip()
    site["wordmark_footer_svg"] = (
        (src / "assets/img/wordmark-footer.svg").read_text(encoding="utf-8").strip()
    )

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copytree(src / "assets", out / "assets")

    # Single render-blocking stylesheet per site: shared base + site skin.
    base_css = (SRC / "_shared" / "base.css").read_text(encoding="utf-8")
    skin_css = (src / "assets/css/skin.css").read_text(encoding="utf-8")
    (out / "assets/css/site.css").write_text(base_css + "\n" + skin_css, encoding="utf-8")
    (out / "assets/css/skin.css").unlink(missing_ok=True)
    for static in ("_headers", "_redirects"):
        f = src / static
        if f.exists():
            shutil.copy2(f, out / static)

    # The repo-level netlify.toml describes how to BUILD the site (base dir, build
    # command, publish dir). Inside dist/<site> that folder is already the publish
    # root, so the [build] block would be wrong — headers and redirects are what
    # matter there. Strip it, keeping the rest verbatim.
    toml = src / "netlify.toml"
    if toml.exists():
        text = toml.read_text(encoding="utf-8")
        kept, skip = [], False
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("["):
                skip = stripped.startswith("[build")
            if not skip:
                kept.append(line)
        (out / "netlify.toml").write_text(
            "# Generated by build.py — deploy-ready copy of src/%s/netlify.toml.\n"
            "# The [build] block is omitted because this folder is itself the publish root.\n\n"
            % key + "\n".join(kept).lstrip() + "\n",
            encoding="utf-8",
        )
    for extra in ("admin", "data"):
        d = src / extra
        if d.is_dir():
            shutil.copytree(d, out / extra)
    static = src / "static"
    if static.is_dir():
        shutil.copytree(static, out, dirs_exist_ok=True)

    metas, entries = [], []
    for frag in sorted((src / "pages").rglob("*.html")):
        meta, body = load_fragment(frag)
        html = render_page(site, meta, body)
        target = out / meta["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")
        metas.append(meta)
        entries.append((meta, body))

    write_sitemap(site, out, metas)
    conf = write_redirects(src, out)
    write_headers(out, metas, conf)
    if site.get("search_path"):
        write_search_index(site, out, entries)
    print(f"  {key}: {len(metas)} pages -> {out.relative_to(ROOT)}")
    return len(metas)


def main():
    keys = sys.argv[1:] or ["ekorails", "ekoinfrastructure"]
    DIST.mkdir(exist_ok=True)
    print("Building EKORails LTD sites…")
    total = sum(build_site(k) for k in keys)
    print(f"Done. {total} pages built on {BUILD_DATE}.")


if __name__ == "__main__":
    main()
