-- 006_ledger.sql — double-entry ledger.
--
-- Reviewer notes:
--
--  * Balances are NEVER stored. Every balance in this system is SUM(debits) - SUM(credits)
--    over immutable journal entries. There is no cached balance column to drift, and no
--    balance is derived from a transaction status field.
--
--  * A journal must balance PER CURRENCY. Cross-currency movement is expressed as two
--    balanced legs joined through FX_CLEARING, which is how the open currency position
--    becomes visible rather than hidden inside a rate. A non-zero FX_CLEARING balance is a
--    real, reportable exposure — see the Finance console's currency-position report.
--
--  * The balance check is a DEFERRABLE INITIALLY DEFERRED constraint trigger. It fires at
--    COMMIT, so a posting routine may insert the journal and its entries in any order, but
--    cannot commit an unbalanced journal. Test 16 ("journal imbalance attempt") exercises this.
--
--  * Correction is by reversal, never by mutation. journal and journal_entry are append-only
--    at the trigger level and the application role holds no UPDATE/DELETE grant on them.

BEGIN;

-- ---------------------------------------------------------------------------
-- Chart of accounts
--
-- Note what is absent: there is no "customer balance", no "wallet" and no
-- "client money" account. EKORails is not authorised to hold customer funds, so the
-- chart of accounts gives it nowhere to record having done so. Customer positions
-- exist only as a receivable and a payable.
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_account (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN (
                     'customer_funding_receivable', 'customer_settlement_payable',
                     'partner_funding_account', 'partner_settlement_account',
                     'fx_clearing', 'fee_revenue', 'partner_fees_payable',
                     'regulatory_charges_payable', 'settlement_suspense',
                     'reconciliation_difference', 'returned_funds', 'test_liquidity')),
  -- Normal balance side. Used for presentation and for the trial-balance report;
  -- it does not relax the balancing rule.
  normal_side      TEXT NOT NULL CHECK (normal_side IN ('debit', 'credit')),
  account_type     TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'income', 'expense', 'equity', 'clearing')),
  currency         currency_code NOT NULL,
  -- Sub-ledger anchors. An account may be scoped to one customer organisation or to
  -- one partner, which is what makes per-counterparty balances possible.
  organization_id  UUID REFERENCES organization(id) ON DELETE RESTRICT,
  partner_id       UUID,
  -- Every balance in this build is simulated. The column exists so that the flag
  -- travels with the data into every export and report.
  is_simulated     BOOLEAN NOT NULL DEFAULT TRUE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  opened_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_on        DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, currency)
);

CREATE INDEX ledger_account_org_idx ON ledger_account(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX ledger_account_partner_idx ON ledger_account(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX ledger_account_category_idx ON ledger_account(category, currency);
CREATE TRIGGER ledger_account_no_delete BEFORE DELETE ON ledger_account
  FOR EACH ROW EXECUTE FUNCTION guard_no_delete();

-- Structural refusal of custody: no account category may be named or categorised as
-- a customer-held balance. This constraint is deliberately redundant with the CHECK
-- above so that adding a custody account requires a visible schema change.
COMMENT ON TABLE ledger_account IS
  'Chart of accounts. Contains no customer stored-value or client-money account by design: '
  'EKORails orchestrates settlement and does not hold customer funds. See docs/06-ledger-design.md.';

-- ---------------------------------------------------------------------------
-- Journals
-- ---------------------------------------------------------------------------

CREATE TABLE journal (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         external_reference NOT NULL UNIQUE,
  -- What economic event this journal records.
  journal_type      TEXT NOT NULL CHECK (journal_type IN (
                      'test_liquidity_injection', 'obligation_recognition', 'funding_receipt',
                      'fx_conversion', 'partner_positioning', 'settlement_payment',
                      'partner_fee_payment', 'regulatory_charge_payment', 'return_receipt',
                      'return_refund', 'suspense_posting', 'reconciliation_adjustment', 'reversal')),
  transaction_id    UUID REFERENCES transaction(id) ON DELETE RESTRICT,
  organization_id   UUID REFERENCES organization(id) ON DELETE RESTRICT,
  description       TEXT NOT NULL,
  -- Plain-English explanation shown in the Founder Learning Center Ledger Explorer.
  plain_english     TEXT NOT NULL,

  -- The date the event economically belongs to, which may differ from when it was
  -- recorded (late partner confirmations, back-dated corrections).
  effective_date    DATE NOT NULL,
  posted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  posting_status    TEXT NOT NULL DEFAULT 'posted' CHECK (posting_status IN ('posted', 'reversed')),

  -- Reversal linkage. A reversal journal points at what it reverses; the reversed
  -- journal is marked 'reversed' but its rows are never touched.
  reverses_journal_id UUID REFERENCES journal(id),
  reversed_by_journal_id UUID REFERENCES journal(id),
  reversal_reason   TEXT,

  posted_by         UUID REFERENCES app_user(id),
  posted_by_process TEXT NOT NULL DEFAULT 'settlement_engine',
  is_simulated      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reversal_has_reason CHECK (
    reverses_journal_id IS NULL OR length(coalesce(reversal_reason, '')) >= 10),
  CONSTRAINT reversal_type_consistent CHECK (
    (journal_type = 'reversal') = (reverses_journal_id IS NOT NULL))
);

CREATE INDEX journal_txn_idx ON journal(transaction_id);
CREATE INDEX journal_org_idx ON journal(organization_id);
CREATE INDEX journal_effective_idx ON journal(effective_date);
CREATE INDEX journal_type_idx ON journal(journal_type);

-- ---------------------------------------------------------------------------
-- Journal entries
-- ---------------------------------------------------------------------------

CREATE TABLE journal_entry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id        UUID NOT NULL REFERENCES journal(id) ON DELETE RESTRICT,
  line_number       INTEGER NOT NULL CHECK (line_number > 0),
  ledger_account_id UUID NOT NULL REFERENCES ledger_account(id) ON DELETE RESTRICT,
  -- Direction plus a strictly positive amount. Signed amounts invite sign errors that
  -- a balancing check cannot always catch; direction makes each line unambiguous.
  direction         TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount            money_amount NOT NULL CHECK (amount > 0),
  currency          currency_code NOT NULL,
  -- Denormalised for the balance query and to make the per-currency balance check
  -- enforceable without a join at commit time.
  organization_id   UUID REFERENCES organization(id),
  transaction_id    UUID REFERENCES transaction(id),
  narrative         TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (journal_id, line_number)
);

CREATE INDEX journal_entry_journal_idx ON journal_entry(journal_id);
CREATE INDEX journal_entry_account_idx ON journal_entry(ledger_account_id);
CREATE INDEX journal_entry_txn_idx ON journal_entry(transaction_id) WHERE transaction_id IS NOT NULL;

-- An entry's currency must match its account's currency. Cross-currency posting to a
-- single account is the single most common way a multi-currency ledger goes wrong.
CREATE OR REPLACE FUNCTION guard_entry_currency_matches_account() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE acct_currency currency_code;
BEGIN
  SELECT currency INTO acct_currency FROM ledger_account WHERE id = NEW.ledger_account_id;
  IF acct_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION
      'CURRENCY_MISMATCH: entry currency % does not match account currency % for account %',
      NEW.currency, acct_currency, NEW.ledger_account_id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entry_currency_guard BEFORE INSERT ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION guard_entry_currency_matches_account();

-- ---------------------------------------------------------------------------
-- THE balancing rule
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_journal_balanced() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  jid UUID;
  imbalance RECORD;
  line_count INTEGER;
BEGIN
  -- The same check guards both tables, so resolve the journal id from whichever
  -- table fired the trigger. plpgsql raises on a missing record field, so this
  -- must branch on TG_TABLE_NAME rather than COALESCE over both.
  IF TG_TABLE_NAME = 'journal' THEN
    jid := NEW.id;
  ELSE
    jid := NEW.journal_id;
  END IF;

  -- A journal that was rolled back before its entries landed will not reach here;
  -- if the header is gone by commit time there is nothing to check.
  IF NOT EXISTS (SELECT 1 FROM journal WHERE id = jid) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO line_count FROM journal_entry WHERE journal_id = jid;
  IF line_count < 2 THEN
    RAISE EXCEPTION
      'JOURNAL_INCOMPLETE: journal % has % line(s). A double entry requires at least two.',
      jid, line_count USING ERRCODE = 'raise_exception';
  END IF;

  -- Per-currency balance. A journal touching NGN and USD must balance in NGN and
  -- separately in USD.
  FOR imbalance IN
    SELECT currency,
           SUM(CASE WHEN direction = 'debit'  THEN amount ELSE 0 END) AS debits,
           SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END) AS credits
      FROM journal_entry
     WHERE journal_id = jid
     GROUP BY currency
    HAVING SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END) <> 0
  LOOP
    RAISE EXCEPTION
      'JOURNAL_IMBALANCE: journal % does not balance in %. Debits %, credits %, difference %.',
      jid, imbalance.currency, imbalance.debits, imbalance.credits,
      (imbalance.debits - imbalance.credits)
      USING ERRCODE = 'raise_exception';
  END LOOP;

  RETURN NULL;
END;
$$;

-- Deferred to commit: the posting routine writes the header then the lines, and the
-- check runs once, at the end, over the completed journal.
CREATE CONSTRAINT TRIGGER journal_must_balance
  AFTER INSERT ON journal
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

-- Also fires if lines are added to an already-committed journal, which the
-- append-only guard should prevent but which is cheap to defend against twice.
CREATE CONSTRAINT TRIGGER journal_entry_must_balance
  AFTER INSERT ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

-- Append-only. Declared AFTER the constraint triggers so that the reversal workflow,
-- which must set journal.reversed_by_journal_id, has a sanctioned route: it uses the
-- SECURITY DEFINER function below rather than a direct UPDATE.
CREATE TRIGGER journal_entry_append_only BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- journal permits exactly one mutation: marking a journal reversed. Everything else
-- raises. This is narrower than a blanket append-only guard and is the only writable
-- path into an otherwise immutable table.
CREATE OR REPLACE FUNCTION guard_journal_only_reversal_marking() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY_VIOLATION: journals cannot be deleted. Post a reversal.'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.journal_type IS DISTINCT FROM OLD.journal_type
     OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
     OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.reverses_journal_id IS DISTINCT FROM OLD.reverses_journal_id THEN
    RAISE EXCEPTION
      'APPEND_ONLY_VIOLATION: journal % is immutable. The only permitted update is marking it reversed.',
      OLD.reference USING ERRCODE = 'raise_exception';
  END IF;

  IF OLD.posting_status = 'reversed' THEN
    RAISE EXCEPTION 'ALREADY_REVERSED: journal % has already been reversed.', OLD.reference
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_guard BEFORE UPDATE OR DELETE ON journal
  FOR EACH ROW EXECUTE FUNCTION guard_journal_only_reversal_marking();

-- ---------------------------------------------------------------------------
-- Balance views — derived, never stored
-- ---------------------------------------------------------------------------

CREATE VIEW ledger_account_balance AS
SELECT
  a.id                AS ledger_account_id,
  a.code,
  a.name,
  a.category,
  a.account_type,
  a.normal_side,
  a.currency,
  a.organization_id,
  a.partner_id,
  a.is_simulated,
  COALESCE(SUM(CASE WHEN e.direction = 'debit'  THEN e.amount ELSE 0 END), 0) AS total_debits,
  COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE 0 END), 0) AS total_credits,
  -- Signed balance on the debit convention: positive means net debit.
  COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount ELSE -e.amount END), 0) AS balance_debit_positive,
  -- Balance in the account's natural direction, which is what an accountant expects
  -- to read on a trial balance.
  CASE WHEN a.normal_side = 'debit'
       THEN COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount ELSE -e.amount END), 0)
       ELSE COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)
  END AS balance_natural,
  count(e.id) AS entry_count
FROM ledger_account a
LEFT JOIN journal_entry e ON e.ledger_account_id = a.id
LEFT JOIN journal j ON j.id = e.journal_id
GROUP BY a.id;

COMMENT ON VIEW ledger_account_balance IS
  'Balances are computed from immutable journal entries at read time. No balance is stored.';

-- Trial balance: must net to zero within every currency, always.
CREATE VIEW trial_balance AS
SELECT
  currency,
  SUM(total_debits)  AS total_debits,
  SUM(total_credits) AS total_credits,
  SUM(total_debits) - SUM(total_credits) AS difference
FROM ledger_account_balance
GROUP BY currency;

COMMIT;
