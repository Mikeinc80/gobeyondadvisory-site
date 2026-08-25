# Submission pack

Six documents, prepared 24–25 August 2026. Each is written for a specific reader and none of them
overstates the position — the same build-time checks that police the product's language police
these.

| | For | Use it when |
|---|---|---|
| `S1-cbn-technical-annex.md` | The Central Bank of Nigeria | Attach to the Regulatory Sandbox application as the technical and control description |
| `S2-bank-partner-pack.md` | A bank's partnership or commercial team | Send before the meeting. Covers the ask, the division of activity, and where we honestly are |
| `S3-adapter-specification.md` | A bank's engineering team | Hand over when their engineers join the conversation. Idempotency and timeout handling are the two terms to settle |
| `S4-corporate-and-controls-sheet.md` | A bank's onboarding or compliance team | Their due diligence on EKORails as a customer and counterparty |
| `S5-interface-evidence-annex.pdf` | The Central Bank of Nigeria | Attach alongside S1. Twenty screens captured from the running application, each captioned with what it is evidence of |
| `S6-evaluator-instructions.md` | Whoever at the CBN wants to check rather than read | Offer it to an evaluator who would rather stand the system up and test the claims directly |

`S5-interface-evidence-annex.md` is the markdown source the PDF is built from; send the PDF.

## Regenerating S5

The screenshots are captured from the running application, not drawn:

```
node scripts/capture-evidence.mjs        # 20 screens, 6 roles → docs/submission/evidence/
node scripts/generate-docs.mjs           # manifest → S5-interface-evidence-annex.md
python3 scripts/build-evidence-pdf.py    # markdown + captures → S5-interface-evidence-annex.pdf
```

The capture script asserts the environment banner in every frame and refuses to save an image in
which it is absent, so a screenshot that has lost the sandbox warning cannot reach the annex.

## What these documents assume

- EKORails is **applying** to the CBN Regulatory Sandbox and is **not admitted**.
- **No partner is contracted.** Every partner in the software is a simulator, named generically.
- Entity particulars are those on the Certificate of Incorporation, and are described as
  documented rather than independently verified.
- Nine release gates stand between the build and live money. None is met.

If any of those changes, these documents need revisiting before they are sent again.

## What is deliberately not in here

No projections, no market sizing and no timeline commitments. Those belong in a commercial deck,
and mixing them into a regulatory annex or a compliance sheet weakens both.
