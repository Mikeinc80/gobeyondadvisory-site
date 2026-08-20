# 17 — Disaster recovery plan

**Status: the procedure below has NEVER BEEN EXECUTED.**

Backups that have not been restored are not backups. No restoration of this system has been
performed, which means the procedure below is a hypothesis. `R-14` records this, it blocks a pilot,
and `EKORAILS_GATE_DR_TESTED` depends on it.

---

## 1. What has to survive

In order of how badly its loss would hurt:

| Data | Why it matters most | Reconstructable? |
|---|---|---|
| The audit trail | It is the evidence that everything else is true | **No.** Nothing else records who did what |
| The ledger | The financial record | **No** |
| Compliance decisions and evaluations | Regulatory obligation; each is self-contained | **No** |
| Transaction history and transitions | What happened to each payment | Partly, from partner statements, incompletely |
| Documents | Customer evidence | Re-collectable from customers, at cost and delay |
| Configuration | Rules, corridor, partners | Reconstructable from the repository |
| Sessions | Convenience | Not needed. Losing them signs everyone out |

The first three cannot be reconstructed from anything. They are why the recovery point objective is
15 minutes and not an hour.

## 2. Backup

```bash
# Run as ekorails_backup, NOT as the owner.
#
# Row-level security with FORCE applies to the table owner too, so a dump taken as
# ekorails_owner silently produces a schema with no rows in the protected tables. That is
# the worst possible failure mode: a backup that appears to succeed and restores nothing.
# ekorails_backup exists precisely for this — BYPASSRLS, SELECT only.
PGPASSWORD="$BACKUP_PASSWORD" pg_dump \
  --host "$DB_HOST" --username ekorails_backup --dbname ekorails \
  --format=custom --compress=9 \
  --file "ekorails-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

The test suite asserts both halves of this: that a dump taken as the owner fails or comes back
empty, and that a dump taken as `ekorails_backup` restores intact with its rows.

| | |
|---|---|
| Frequency | Continuous archiving plus a daily full dump. **Neither is configured today** |
| Encryption at rest | Required. Not configured |
| Off-site copy | Required, in a second region. Not configured — no region is selected (FD-008) |
| Retention | 35 days rolling, plus monthly for the compliance retention period (**FD-005, unresolved**) |
| Access | The backup credential is a high-value target. It should be held in a managed secret store, and there is not one |

## 3. Restoration procedure

Untested. Written so that the first person to test it has something to test.

```bash
# 1. Provision an empty database and the three roles.
./scripts/provision-roles.sh

# 2. Restore.
PGPASSWORD="$OWNER_PASSWORD" pg_restore \
  --host "$DB_HOST" --username ekorails_owner --dbname ekorails \
  --no-owner --role=ekorails_owner --exit-on-error \
  ekorails-<timestamp>.dump

# 3. VERIFY BEFORE SERVING ANY TRAFFIC.
```

Verification is the part that matters, and it is not optional:

```sql
-- Does the audit chain still verify end to end?
SELECT count(*) FROM verify_audit_chain(0);          -- must be 0

-- Does the ledger balance in every currency?
SELECT currency, difference FROM trial_balance;      -- every difference must be 0

-- Is the record contiguous? A gap means rows were lost, not that nothing happened.
SELECT max(seq) - min(seq) + 1 = count(*) AS contiguous FROM audit_event;

-- Does the transaction count match the last known figure?
SELECT count(*) FROM transaction;
```

The service performs the first two of these itself at start-up and refuses to start if either
fails. That is the backstop, and it should not be relied on as the check.

## 4. Recovery scenarios

### Database lost, backup intact

1. Provision, restore, verify as above.
2. Reconcile against every partner statement for the period between the backup and the failure.
   This is the step that finds what the backup did not have.
3. Any payment instructed in that window has to be established from the partner's record, not ours.
4. Resume.

Expected time: 2 hours. **Never measured.**

### Database lost, backup unusable

The scenario a restoration test exists to prevent.

1. The audit trail and the ledger are gone and cannot be reconstructed.
2. Transaction history can be partially rebuilt from partner statements — amounts, references and
   dates, but not who authorised what, or why a compliance decision went the way it did.
3. This is a reportable event to a supervisor under any regime, and it is a business-ending event
   for the regulatory position even if the business survives commercially.

There is no recovery from this. There is only prevention, and prevention is a tested restore.

### Region lost

No region has been selected (FD-008), so there is no second region and no cross-region strategy. A
region loss today would be indistinguishable from the previous scenario.

### Corrupted data discovered late

Distinct from loss: the data is there and it is wrong.

1. Establish when it became wrong, from the audit trail.
2. Do not restore over the current state. Restore to a **separate** database and compare.
3. Correct by posting reversals in the live system, not by replacing it with an older copy. A
   restore-over destroys everything that happened since, including the record of the corruption.

## 5. What must be true before a pilot

1. Automated backups configured, encrypted, off-site.
2. **A restoration performed and evidenced**, including the four verification queries above.
3. The restoration repeated on a schedule, because a restore that worked once and has not been
   repeated since is a restore that worked once.
4. A second region, once FD-008 resolves.
5. The backup credential in a managed secret store.

Items 1 and 2 are `EKORAILS_GATE_DR_TESTED`. Until item 2 is done, every recovery time in this
document is a guess, and it should be read as one.
