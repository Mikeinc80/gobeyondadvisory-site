#!/usr/bin/env python3
"""
Builds the interface evidence annex as a single PDF for the regulatory submission.

Reads the same manifest the markdown annex is generated from, so the two cannot disagree
about which screens exist or what each is offered as evidence of.

Two decisions worth stating:

  * Each screenshot gets its own page, scaled to fit rather than cropped. These are tall
    full-page captures, and cropping one would hide exactly the part a reviewer might want.
    A very tall capture is split across pages instead, with the continuation marked.

  * The caption comes BEFORE the image, so a reader knows what to look for rather than
    working it out afterwards.

Usage:  python3 scripts/build-evidence-pdf.py
Output: docs/submission/S5-interface-evidence-annex.pdf
"""

import json
import sys
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image as PDFImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "docs/submission/evidence"
MANIFEST = EVIDENCE / "manifest.json"
OUT = ROOT / "docs/submission/S5-interface-evidence-annex.pdf"

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

INK = colors.HexColor("#12241d")
MUTED = colors.HexColor("#5a6b64")
ACCENT = colors.HexColor("#0b3d2e")
RULE = colors.HexColor("#c9d6d0")
BANNER_BG = colors.HexColor("#7a1f16")

if not MANIFEST.exists():
    sys.exit("No capture manifest. Run: node scripts/capture-evidence.mjs")

captures = json.loads(MANIFEST.read_text())

styles = getSampleStyleSheet()


def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)


S_TITLE = style("t", fontName="Helvetica-Bold", fontSize=21, leading=25, textColor=ACCENT, spaceAfter=4)
S_SUB = style("s", fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=14)
S_H2 = style("h2", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=ACCENT, spaceBefore=16, spaceAfter=6)
S_H3 = style("h3", fontName="Helvetica-Bold", fontSize=11, leading=15, textColor=INK, spaceBefore=4, spaceAfter=3)
S_BODY = style("b", spaceAfter=8)
S_META = style("m", fontName="Courier", fontSize=8.5, leading=12, textColor=MUTED, spaceAfter=5)
S_EVID = style("e", fontSize=9.5, leading=14, textColor=INK, spaceAfter=8)
S_CELL = style("c", fontSize=8.5, leading=11.5)
S_CELLH = style("ch", fontName="Helvetica-Bold", fontSize=8.5, leading=11.5, textColor=colors.white)
S_FOOT = style("f", fontSize=8.5, leading=12, textColor=MUTED)


def banner_flowable():
    """The environment banner, reproduced so the PDF carries it as the screens do."""
    table = Table(
        [[Paragraph(
            '<font color="#ffffff"><b>SANDBOX ENVIRONMENT. NO LIVE FUNDS.</b>&nbsp;&nbsp;'
            'Every partner, rate and settlement is simulated. Balances are not real. '
            'Fictional demonstration data.</font>',
            style("bn", fontSize=9, leading=12.5, textColor=colors.white),
        )]],
        colWidths=[CONTENT_W],
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BANNER_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def page_furniture(canvas, doc):
    """Footer on every page: the entity, and the fact that no money moved."""
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 13 * mm, PAGE_W - MARGIN, 13 * mm)

    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 9 * mm, "EKORAILS LIMITED · RC 9490673 · Annex: the interface")
    canvas.drawRightString(PAGE_W - MARGIN, 9 * mm, f"Page {canvas.getPageNumber()}")
    canvas.drawCentredString(PAGE_W / 2, 9 * mm, "SANDBOX — no live funds")
    canvas.restoreState()


def image_flowables(path: Path, available_h: float):
    """
    Scales a capture to the content width, splitting it across pages when it is too tall.

    Cropping would be simpler and would hide part of the evidence, which defeats the point
    of including it.
    """
    with Image.open(path) as im:
        w, h = im.size
        scale = CONTENT_W / w
        full_h = h * scale

        if full_h <= available_h:
            return [PDFImage(str(path), width=CONTENT_W, height=full_h)]

        # Split into vertical slices, each a page's worth.
        slice_px = int(available_h / scale)
        parts = []
        top = 0
        index = 0
        while top < h:
            bottom = min(top + slice_px, h)
            crop = im.crop((0, top, w, bottom))
            out = path.parent / f".{path.stem}-part{index}.png"
            crop.save(out)
            parts.append((out, (bottom - top) * scale))
            top = bottom
            index += 1

        flowables = []
        for i, (part_path, part_h) in enumerate(parts):
            if i > 0:
                flowables.append(PageBreak())
                flowables.append(Paragraph(
                    f"<i>continued ({i + 1} of {len(parts)})</i>",
                    style("cont", fontSize=8.5, textColor=MUTED, spaceAfter=5),
                ))
            flowables.append(PDFImage(str(part_path), width=CONTENT_W, height=part_h))
        return flowables


story = []

# ---------------------------------------------------------------------------
# Cover
# ---------------------------------------------------------------------------

story.append(Paragraph("Annex — The interface", S_TITLE))
story.append(Paragraph(
    "<b>EKORAILS LIMITED</b> &nbsp;·&nbsp; RC 9490673 &nbsp;·&nbsp; "
    "Application to the CBN Regulatory Sandbox", S_SUB))
story.append(banner_flowable())
story.append(Spacer(1, 16))

story.append(Paragraph("What these images are", S_H2))
story.append(Paragraph(
    f"{len(captures)} screens, captured from the <b>working application</b> — signed in as the "
    "role named, reading the seeded database. None is a mockup, a wireframe or a design study.",
    S_BODY))
story.append(Paragraph(
    "The environment banner is visible in every frame, and the capture script refuses to save an "
    "image in which it is absent. Every business, person, document and account identifier shown "
    "is fictional; no real identity document or bank detail appears anywhere in this system.",
    S_BODY))

story.append(Paragraph("What each image is offered as evidence of", S_H2))
story.append(Paragraph(
    'A screenshot captioned "dashboard" proves nothing. Each caption states what the image is '
    "evidence <b>of</b>, so a reader can check the claim against the picture rather than take the "
    "caption on trust.",
    S_BODY))
story.append(Paragraph(
    "If you would rather not rely on our screenshots at all, the accompanying evaluator "
    "instructions set out how to run the whole system yourself in about five minutes and verify "
    "any of these claims directly.",
    S_BODY))

story.append(Paragraph("What these images do not show", S_H2))
for item in [
    "<b>No partner is real.</b> Every partner interaction shown is a simulator, labelled as one "
    "on the screen. No agreement with any institution has been executed.",
    "<b>No corridor is confirmed.</b> The corridor, its currencies and its limits are the facts "
    "this application seeks to establish, and they appear as explicit placeholders.",
    "<b>No money has moved.</b> Every balance is simulated, and the nine release gates that would "
    "permit live funds are all unmet.",
    "<b>This is not a deployment.</b> The system has run on a developer machine and in continuous "
    "integration. No region has been selected, and no claim of data residency in any jurisdiction "
    "is made.",
]:
    story.append(Paragraph(f"•&nbsp;&nbsp;{item}", S_BODY))

# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

story.append(PageBreak())
story.append(Paragraph("Index", S_H2))

rows = [[Paragraph("#", S_CELLH), Paragraph("Screen", S_CELLH),
         Paragraph("Signed in as", S_CELLH), Paragraph("Path", S_CELLH)]]
for i, capture in enumerate(captures, start=1):
    rows.append([
        Paragraph(str(i), S_CELL),
        Paragraph(capture["title"], S_CELL),
        Paragraph(capture["role"], S_CELL),
        Paragraph(f'<font face="Courier" size="7.5">{capture["path"]}</font>', S_CELL),
    ])

index_table = Table(rows, colWidths=[10 * mm, 58 * mm, 44 * mm, CONTENT_W - 112 * mm], repeatRows=1)
index_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("GRID", (0, 0), (-1, -1), 0.4, RULE),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f8f6")]),
]))
story.append(index_table)

# ---------------------------------------------------------------------------
# Plates
# ---------------------------------------------------------------------------

# Height available on a plate page once the caption block has been laid out. Measured
# generously so a caption of two or three lines never pushes the image off the page.
CAPTION_H = 46 * mm
PLATE_H = PAGE_H - 2 * MARGIN - CAPTION_H

for i, capture in enumerate(captures, start=1):
    story.append(PageBreak())
    story.append(Paragraph(f"{i}. {capture['title']}", S_H3))
    story.append(Paragraph(
        f"{capture['role']} &nbsp;·&nbsp; {capture['path']}", S_META))
    story.append(Paragraph(f"<b>Evidence of:</b> {capture['evidences']}", S_EVID))

    image_path = EVIDENCE / capture["file"]
    if not image_path.exists():
        story.append(Paragraph(f"<i>Missing capture: {capture['file']}</i>", S_FOOT))
        continue
    story.extend(image_flowables(image_path, PLATE_H))

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=20 * mm,
    title="EKORAILS LIMITED — Annex: the interface",
    author="EKORAILS LIMITED (RC 9490673)",
    subject="Interface evidence for the CBN Regulatory Sandbox application",
)
doc.build(story, onFirstPage=page_furniture, onLaterPages=page_furniture)

# Remove the slice files; they are a rendering artefact, not evidence.
for temp in EVIDENCE.glob(".*-part*.png"):
    temp.unlink()

size_mb = OUT.stat().st_size / (1024 * 1024)
print(f"Wrote {OUT.relative_to(ROOT)} ({size_mb:.1f} MB)")
