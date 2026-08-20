# 18 — Reconciliation procedures

Reconciliation is the control that catches what every other control missed. It runs daily, compares
six things, and opens a break for anything that does not agree.

The single most important rule: **a difference is never resolved by overwriting one side.** Both
records stay as they are. What closes a break is an explanation.

---

## 1. The six comparisons

| # | Compares | Catches |
|---|---|---|
| 1 | Every transaction against its ledger journals | A payment that progressed without the accounting following it |
| 2 | Funding received against settlement instructed | Money that arrived and was never used, or was used twice |
| 3 | Fees charged against fees posted | Charges recognised at quote acceptance that never became a real posting |
| 4 | Currency position across `fx_clearing` | Half a conversion — a leg posted without its matching leg |
| 5 | Ledger against each partner's statement | The difference between what we think a partner holds and what they say |
| 6 | (per settlement partner) as above, per currency | The same, isolated so a break names the partner |

Comparison 5 is the one that catches the failure nobody wants: a payment the partner made that we
have no record of.

## 2. Result types and what each one means

| Result | What it means | Priority | Who investigates |
|---|---|---|---|
| `matched` | Both sides agree on reference and amount | — | — |
| `amount_difference` | Both have the record; the amounts differ | High | Finance |
| `missing_partner_record` | We have it, they do not | Normal | Finance, with the partner |
| `missing_internal_record` | **They have it, we do not** | **Critical** | Finance, immediately |
| `duplicate` | The same item twice on one side | **Critical** | Finance and Treasury together |
| `unmatched` | Nothing on the other side corresponds | Normal | Finance |

`missing_internal_record` and `duplicate` are critical for the same reason: both mean money may have
moved in a way this system does not know about.

## 3. The daily procedure

Run by a Finance and Reconciliation Analyst. Requires `recon.run`.

1. **Run it.** Finance console → Reconciliation → Run reconciliation, for the business date.
   Or `POST /api/reconciliation/run?business_date=YYYY-MM-DD`.

2. **Read the trial balance first.** If it does not net to zero in every currency, stop. An
   unbalanced ledger is a critical incident, not a reconciliation item, and investigating breaks on
   top of one wastes the time it takes to find out that was the cause.

3. **Work the breaks in priority order.** Critical first, and critical means today, not this week.

4. **For each break, establish what actually happened before deciding what to do about it.** The
   sources, in the order they are useful:
   - `integration_event` for the transaction: every exchange with the partner, its idempotency key,
     its outcome, its latency.
   - The transaction's transitions: who did what, when, and why.
   - The journals: what the accounting recorded and when.
   - The partner's own statement.

5. **Write a note as you go.** Notes are permanent and cannot be edited. A break with no notes is a
   break nobody investigated, whatever the resolution says.

6. **Propose a resolution.** It has to explain the difference, not describe the action. "Adjusted to
   match the partner" is not a resolution. "The partner's file included a payment we instructed on
   the 14th and dated on the 15th; both records are correct and the difference is a cut-off
   difference" is.

7. **Above the four-eyes threshold, a different person approves the closure.** The server refuses
   self-approval. It is not a matter of policy.

## 4. What to do about each break type

### `amount_difference`

Establish which figure is right by going back to the instruction, not to either record. If ours is
wrong, the correction is a **reversal and a re-posting**, never an edit. If theirs is wrong, it is a
partner query and the break stays open until they correct their file.

### `missing_partner_record`

Two ordinary causes: their file is late, or the instruction never reached them. `integration_event`
distinguishes these. If the instruction did not reach them, do **not** re-instruct without
establishing the true position first — see `under_investigation` in the state machine.

### `missing_internal_record`

Treat as critical. A payment exists that this system has no record of instructing.

1. Do not adopt the partner's figure into our ledger.
2. Establish from `integration_event` whether anything left this system for that reference.
3. If nothing did, the question is how the partner came to act, and that is a partner incident under
   `15-incident-response-plan.md`.
4. If something did and our record was lost, that is a data-integrity incident and the same plan
   applies.

### `duplicate`

Treat as a possible double payment until proven otherwise.

1. Compare idempotency keys. If two instructions carry the same key, the second should have been
   ignored and the fact that it was not is the incident.
2. If they carry different keys, two instructions were genuinely produced, and the question is what
   produced them.
3. Only after the above: recover, as a return, recorded as its own event.

### `unmatched`

Usually a timing difference across a cut-off. Confirm against the previous and following business
dates before treating it as anything else.

## 5. What must never happen

- **A break closed with no explanation.** The resolution field has a minimum length, and a
  resolution that meets it without explaining anything is worse than an open break, because it looks
  settled.
- **A ledger entry edited to make a break go away.** There is no `UPDATE` grant. Anyone attempting
  this has already gone outside the system.
- **A transaction completed with an open break against it.** The state machine refuses it.
- **A shortfall written off silently.** It goes to `settlement_suspense`, where it has an owner and
  appears on a screen, until somebody explains it.
- **The same person investigating and approving**, above the threshold. Refused by the server.

## 6. Month end

There is **no accounting period close** in this system. No period is opened or closed and there is
no cut-off procedure. What exists is:

- The daily runs, each stamped with its business date.
- A reconciliation report over any date range.
- The trial balance, always current, always derived.

If a period close is required — and for a regulated entity it eventually will be — it has to be
designed. Pretending the daily run is a close would be the kind of gap that only appears at an
audit.

## 7. Evidence a reconciliation produces

Each run writes, permanently:

- A `reconciliation_run` row: the comparison, the business date, the counts, the unexplained amount.
- A `reconciliation_item` per compared item, with both sides and the result.
- An `exception_case` per break, with an owner and a service target.
- Notes, resolutions and approvals, each attributed and unable to be edited.
- Audit events for every one of the above.

A supervisor asking "show me that you reconcile" can be shown the runs. A supervisor asking "show me
what you did about the one that did not match on the 14th" can be shown the break, who looked at it,
what they found, what they concluded and who agreed.
