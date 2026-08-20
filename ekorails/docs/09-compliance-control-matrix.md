<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# 09 — Compliance control matrix

26 rules across 17 categories.

## How the engine records what it did

Every rule that APPLIES to a subject is evaluated against it, and the result is written
whether or not the rule fired. A rule that was checked and found nothing is evidence; a
rule that was never run is a gap. If only triggered rules were stored the two would be
indistinguishable a year later.

Each evaluation is self-contained: it stores the rule text, the parameter values in
force, the data the rule read, a hash of the inputs and a hash of the whole ruleset. It
is not read back from current configuration, so a later rule change cannot alter what a
past decision appears to have been based on.

## What this build cannot decide

The corridor is an unconfirmed placeholder, so `CORRIDOR_PLACEHOLDER_UNCONFIRMED` fires
on every transaction. No transaction in this build can clear compliance automatically.
That is intended behaviour for a system whose regulatory scope has not been confirmed,
not a defect in the engine, and it will stop being true when the corridor is confirmed
and the placeholder is replaced under maker-checker.

`HIGH_RISK_JURISDICTION` ships with an EMPTY jurisdiction list. A list of high-risk
countries is a regulatory fact, and none was available to this build, so none has been
invented. The rule is present and evaluates to "not triggered" against an empty list,
which is visible in every assessment rather than silently absent.

## Summary

| Rule | Category | Severity | On trigger | Applies to |
|---|---|---|---|---|
| `CUSTOMER_NOT_APPROVED` | customer_status | prohibited | reject | transaction |
| `CUSTOMER_SUSPENDED` | customer_status | prohibited | reject | transaction, organization |
| `BENEFICIARY_NOT_APPROVED` | beneficiary_status | high | reject | transaction, beneficiary |
| `INITIATOR_NOT_AUTHORISED` | authorisation | high | reject | transaction |
| `LIMIT_NOT_CONFIGURED` | limits | high | manual_review | transaction |
| `TXN_ABOVE_SINGLE_LIMIT` | limits | prohibited | reject | transaction |
| `VELOCITY_DAILY_LIMIT` | velocity | high | reject | transaction |
| `VELOCITY_MONTHLY_LIMIT` | velocity | high | reject | transaction |
| `STRUCTURING_INDICATOR` | behavioural | high | escalate | transaction |
| `CORRIDOR_PLACEHOLDER_UNCONFIRMED` | corridor | medium | manual_review | transaction, organization |
| `CORRIDOR_DISABLED` | corridor | prohibited | reject | transaction |
| `CURRENCY_NOT_PERMITTED` | currency | prohibited | reject | transaction |
| `SANCTIONS_MATCH` | sanctions | prohibited | suspend | transaction, organization, beneficiary |
| `PEP_EXPOSURE` | pep | high | enhanced_due_diligence | transaction, organization, beneficiary |
| `ADVERSE_MEDIA_FLAG` | adverse_media | medium | manual_review | transaction, organization, beneficiary |
| `HIGH_RISK_JURISDICTION` | jurisdiction | high | enhanced_due_diligence | transaction, organization, beneficiary |
| `HIGH_RISK_INDUSTRY` | industry | medium | enhanced_due_diligence | transaction, organization |
| `AMOUNT_INCONSISTENT_WITH_PROFILE` | behavioural | medium | manual_review | transaction |
| `UNUSUAL_AMOUNT_FOR_CUSTOMER` | behavioural | low | manual_review | transaction |
| `SOURCE_OF_FUNDS_INCOMPLETE` | documentation | high | manual_review | transaction |
| `TRADE_DOCUMENTS_INCOMPLETE` | documentation | medium | manual_review | transaction |
| `DUPLICATE_INVOICE` | documentation | high | manual_review | transaction |
| `REUSED_BANK_DETAILS` | fraud | high | escalate | transaction, beneficiary |
| `RAPID_BENEFICIARY_CHANGE` | fraud | medium | manual_review | transaction, beneficiary |
| `RELATED_PARTY_TRANSACTION` | related_party | medium | manual_review | transaction, beneficiary |
| `SUSPICIOUS_DEVICE_OR_IP` | device | medium | manual_review | transaction |

## Adverse media

### `ADVERSE_MEDIA_FLAG` — Adverse media flag

Version 1 · severity medium · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Publicly reported financial crime, fraud or regulatory action involving the customer or beneficiary that no list would capture. |
| **When it fires** | Adverse-media screening returns a flag. |
| **Evidence required** | The screening result and the analyst's assessment of the underlying reporting. |
| **What the system does** | The transaction is held for manual review. It is deliberately not rejected: adverse media is an input to judgement and frequently concerns a different person of the same name. |
| **What a person decides** | An analyst assesses relevance, recency and credibility, and records a reasoned disposition. |
| **How it can be wrong** | High. Adverse media matching frequently surfaces unrelated individuals of the same name, or reporting that is stale or unfounded. It is an input to judgement, never a decision. |
| **Policy basis** | Ongoing due diligence and reputational risk assessment. |
| **Parameters** | `{}` |

## Authorisation

### `INITIATOR_NOT_AUTHORISED` — Initiating user is not authorised to transact

Version 1 · severity high · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | An account with read access initiating payments. Privilege creep inside a customer organisation is a common insider-fraud route. |
| **When it fires** | The initiating user does not hold the transaction-initiation permission. |
| **Evidence required** | The user role grants in force at initiation. |
| **What the system does** | The transaction is refused at the API boundary and never reaches draft. |
| **What a person decides** | The customer administrator grants the appropriate role, which is itself audited. |
| **How it can be wrong** | None as a detection: the permission set is explicit and is read at the moment of initiation. The operational risk is a legitimate user whose role grant expired, which presents identically to an unauthorised one and is resolved by the customer administrator rather than by compliance. |
| **Policy basis** | Segregation of duties and least privilege. |
| **Parameters** | `{}` |

## Behavioural

### `STRUCTURING_INDICATOR` — Possible structuring

Version 1 · severity high · on trigger: escalate

| | |
|---|---|
| **Risk it addresses** | Deliberately breaking a payment into pieces that each sit just under a reporting or approval threshold. Structuring is an offence in its own right in most AML regimes, independently of the underlying funds. |
| **When it fires** | Three or more transactions in 24 hours each between 90% and 100% of the per-transaction limit. |
| **Evidence required** | The transaction amounts in the window and the limit in force at the time. |
| **What the system does** | Escalated to a Compliance Manager. Not auto-rejected, because the pattern needs judgement. |
| **What a person decides** | A manager assesses whether the pattern has a commercial explanation and, if not, whether a suspicious activity report is required. |
| **How it can be wrong** | Real. A business with a genuine invoice run near the cap looks identical to structuring. That is why the rule escalates for judgement rather than rejecting. |
| **Policy basis** | Structuring / smurfing detection. Reporting obligation and threshold UNCONFIRMED pending the filing. |
| **Parameters** | `{"windowHours":24,"minimumCount":3,"proximityFractionOfLimit":0.9}` |

### `AMOUNT_INCONSISTENT_WITH_PROFILE` — Amount inconsistent with the declared business profile

Version 1 · severity medium · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | A business transacting far outside what it told us to expect. The gap is either a KYB failure (the profile was wrong) or a red flag (the account is being used for something else). |
| **When it fires** | Send amount exceeds the declared expected transaction size by the configured multiple. |
| **Evidence required** | The declared expected size from the KYB profile and the transaction amount. |
| **What the system does** | The transaction is held for manual review, and the divergence from the declared profile is shown to the analyst alongside the profile figure it is being compared against. |
| **What a person decides** | An analyst either updates the customer profile with evidence, or treats the divergence as an alert. |
| **How it can be wrong** | High for growing businesses, and for customers who guessed when completing onboarding. This is a prompt to re-baseline the profile as often as it is a genuine alert. |
| **Policy basis** | Transaction monitoring against expected customer activity. |
| **Parameters** | `{"multipleOfDeclaredSize":3}` |

### `UNUSUAL_AMOUNT_FOR_CUSTOMER` — Unusual amount relative to this customer's own history

Version 1 · severity low · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | A sudden step change in a customer's transaction size, which can indicate account takeover or a change in the underlying business that due diligence has not caught up with. |
| **When it fires** | The amount exceeds the customer's largest recent transaction by the configured multiple, once there is enough history to make the comparison meaningful. |
| **Evidence required** | The customer's recent transaction amounts. |
| **What the system does** | The transaction is held for manual review, with the customer's recent maximum shown so the analyst can judge the step change rather than just the absolute figure. |
| **What a person decides** | An analyst checks the supporting trade documents against the amount. |
| **How it can be wrong** | High for new customers and for lumpy trade flows. Suppressed below the minimum history count for exactly that reason. |
| **Policy basis** | Behavioural transaction monitoring. |
| **Parameters** | `{"multipleOfRecentMaximum":5,"minimumHistoryCount":3}` |

## Beneficiary status

### `BENEFICIARY_NOT_APPROVED` — Beneficiary has not been approved

Version 1 · severity high · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | Paying an unverified beneficiary. Beneficiary substitution is one of the most common business-email-compromise outcomes, and it is invisible unless the beneficiary is separately approved. |
| **When it fires** | The beneficiary is in any status other than Approved, or is flagged for re-review. |
| **Evidence required** | Beneficiary record, screening result, supporting contract and verification status. |
| **What the system does** | The transaction cannot leave compliance review. |
| **What a person decides** | A Compliance Analyst reviews and approves the beneficiary before first use. |
| **How it can be wrong** | Moderate operationally: a beneficiary whose details were edited legitimately is forced back through review. That friction is deliberate. |
| **Policy basis** | Beneficiary verification prior to first payment. Standard payment-fraud control. |
| **Parameters** | `{}` |

## Corridor

### `CORRIDOR_PLACEHOLDER_UNCONFIRMED` — Corridor is an unconfirmed placeholder

Version 1 · severity medium · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Transacting on a corridor that has not been confirmed by the regulatory filing. Until the approved corridor is known, no transaction on it can be said to be in scope of the pilot. |
| **When it fires** | The corridor record is still carrying INSERT_APPROVED_* placeholder values. |
| **Evidence required** | The corridor configuration and founder decision FD-002. |
| **What the system does** | The transaction cannot auto-clear compliance. It is held for a named analyst to review and approve. |
| **What a person decides** | An analyst approves the individual transaction, accepting that the corridor is provisional. |
| **How it can be wrong** | None. This rule fires on every transaction until FD-002 is approved and the corridor is confirmed. That is the intended posture, and it means NO transaction in this build auto-clears compliance. |
| **Policy basis** | Sandbox scope is defined by the approved corridor. Corridor UNCONFIRMED pending the CBN filing (FD-002). |
| **Parameters** | `{}` |

### `CORRIDOR_DISABLED` — Corridor is disabled

Version 1 · severity prohibited · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | Transacting on a corridor that has been switched off for risk, regulatory or partner reasons. |
| **When it fires** | The corridor status is not "enabled". |
| **Evidence required** | The corridor configuration and the change record that disabled it. |
| **What the system does** | The transaction is rejected before a quote is issued, so the customer is not shown a price for a route that cannot currently be used. |
| **What a person decides** | Re-enabling a corridor is a maker-checker configuration change. |
| **How it can be wrong** | Effectively none: the rule reads an explicit configuration state. The risk worth watching is a corridor left disabled after an incident is resolved, which silently blocks a customer who has done nothing wrong. |
| **Policy basis** | Internal operational risk control. A corridor is disabled when a partner is unavailable, an incident is open, or a regulatory question is unresolved — and it must then actually stop traffic. |
| **Parameters** | `{}` |

## Currency

### `CURRENCY_NOT_PERMITTED` — Currency pair is outside the corridor definition

Version 1 · severity prohibited · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | Settling a currency pair the pilot was not approved for, and for which no liquidity or partner arrangement exists. |
| **When it fires** | Send or receive currency does not match the corridor definition. |
| **Evidence required** | The transaction currencies and the corridor definition. |
| **What the system does** | The transaction is rejected. No quote is issued, because there is no liquidity arrangement behind a pair the corridor does not cover. |
| **What a person decides** | None. A new currency pair is a new corridor. |
| **How it can be wrong** | Effectively none: the rule reads an explicit configuration state. The risk worth watching is a corridor left disabled after an incident is resolved, which silently blocks a customer who has done nothing wrong. |
| **Policy basis** | Approved corridor scope. Currencies UNCONFIRMED pending the filing (FD-002). |
| **Parameters** | `{}` |

## Customer status

### `CUSTOMER_NOT_APPROVED` — Customer is not an approved business

Version 1 · severity prohibited · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | Moving value for a business whose identity, ownership and legitimacy have not been established. This is the foundational AML failure — everything downstream assumes it did not happen. |
| **When it fires** | The originating organisation is in any onboarding status other than Approved. |
| **Evidence required** | The organisation record and its KYB decision history. |
| **What the system does** | The transaction is rejected before any quote is issued or funding requested. |
| **What a person decides** | None at this stage. The customer must complete onboarding; a compliance analyst then approves the organisation, not the individual transaction. |
| **How it can be wrong** | Low. The only realistic false positive is a race where approval completes between the check and the submission, which the customer resolves by resubmitting. |
| **Policy basis** | Customer due diligence before establishing a business relationship. Nigerian threshold and documentary specifics UNCONFIRMED pending the CBN filing. |
| **Parameters** | `{"approvedStatuses":["approved"]}` |

### `CUSTOMER_SUSPENDED` — Customer organisation is suspended

Version 1 · severity prohibited · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | A suspension is a live compliance or risk decision. Allowing a suspended customer to transact would make the suspension decorative. |
| **When it fires** | The organisation has a suspension timestamp set. |
| **Evidence required** | The suspension record, its reason and the deciding user. |
| **What the system does** | The transaction is rejected and the attempt is recorded against the suspension case. |
| **What a person decides** | A Compliance Manager must lift the suspension before the customer can transact. |
| **How it can be wrong** | Effectively none: the rule reads an explicit state rather than inferring anything, so it cannot be wrong about whether a suspension exists. The real risk is the opposite one — a suspension that should have been lifted and was not, which shows up as a customer unable to transact for reasons nobody is monitoring. Suspensions are therefore listed on the compliance dashboard with their age. |
| **Policy basis** | Internal risk-control policy; ability to restrict a relationship pending investigation. |
| **Parameters** | `{}` |

## Device

### `SUSPICIOUS_DEVICE_OR_IP` — Suspicious device or network activity

Version 1 · severity medium · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Account takeover. A payment instructed from an unfamiliar network, shortly after failed sign-in attempts, is the signature of a compromised credential being exercised. |
| **When it fires** | The instructing session is on a network never seen for this organisation, or the organisation has an unusual number of distinct networks or recent failed sign-ins. |
| **Evidence required** | Hashed network identifiers and the login-attempt history. Raw IP addresses are never stored. |
| **What the system does** | Held for manual review; a security alert is raised in parallel. |
| **What a person decides** | An analyst confirms the instruction with the customer through a known channel before release. |
| **How it can be wrong** | High. Travel, remote working and mobile networks all produce new addresses routinely. Treated as a contributing signal, never as a sole basis for a decision. |
| **Policy basis** | Fraud and account-takeover monitoring. |
| **Parameters** | `{"distinctIpThreshold":5,"failedLoginThreshold":3}` |

## Documentation

### `SOURCE_OF_FUNDS_INCOMPLETE` — Source-of-funds evidence is incomplete

Version 1 · severity high · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Settling funds whose origin has not been evidenced. Without it there is no defence to a later allegation that the platform handled criminal property. |
| **When it fires** | No source-of-funds document is linked, or the narrative is missing or too short to be meaningful. |
| **Evidence required** | A source-of-funds document and a substantive written narrative. |
| **What the system does** | The transaction cannot leave compliance review. |
| **What a person decides** | An analyst requests the evidence and re-reviews once supplied. |
| **How it can be wrong** | Low. The rule checks presence, not adequacy — adequacy is the analyst's judgement, which is why this holds for review rather than rejecting. |
| **Policy basis** | Source of funds evidence in customer due diligence. Documentary standard UNCONFIRMED pending the filing. |
| **Parameters** | `{"minimumNarrativeLength":20}` |

### `TRADE_DOCUMENTS_INCOMPLETE` — Trade documentation is incomplete

Version 1 · severity medium · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Paying against a trade transaction with no underlying commercial documentation. Trade-based money laundering depends on the absence, or the falsification, of exactly these documents. |
| **When it fires** | A required document role is not linked to the transaction. |
| **Evidence required** | The linked documents and their roles. |
| **What the system does** | The transaction is held for manual review and the specific missing document role is named, so the customer can be asked for exactly the right thing rather than for everything again. |
| **What a person decides** | An analyst requests the missing document and checks it against the transaction details. |
| **How it can be wrong** | Low mechanically, but note the rule checks that a document EXISTS, not that it is genuine. Document authenticity is a human judgement this system does not automate and does not claim to. |
| **Policy basis** | Trade documentation requirements for trade-related payments. Specific set UNCONFIRMED (FD-005). |
| **Parameters** | `{"requiredRoles":["primary_invoice"]}` |

### `DUPLICATE_INVOICE` — Duplicate invoice

Version 1 · severity high · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Paying the same invoice twice — through error, through internal fraud, or as a laundering technique that gives illegitimate funds a commercial-looking justification. |
| **When it fires** | Another transaction in the same organisation shares this invoice fingerprint (invoice number, beneficiary, amount and currency) and has not been cancelled or rejected. |
| **Evidence required** | The matching transaction references and their states. |
| **What the system does** | Held for manual review. Never auto-rejected: legitimate re-issues and part-payments exist. |
| **What a person decides** | An analyst confirms with the customer whether this is a genuine second payment. |
| **How it can be wrong** | Moderate. Instalment payments against one invoice, and re-submissions after a failed attempt, both look like duplicates. |
| **Policy basis** | Trade-based money laundering red flag; double-payment operational control. |
| **Parameters** | `{}` |

## Fraud

### `REUSED_BANK_DETAILS` — Bank details reused across organisations

Version 1 · severity high · on trigger: escalate

| | |
|---|---|
| **Risk it addresses** | One account collecting from several ostensibly unconnected customers — a classic mule and layering pattern, and also a signal of undisclosed common control. |
| **When it fires** | The beneficiary bank-account fingerprint appears under another organisation's beneficiary. |
| **Evidence required** | The account fingerprint match. Note the match is made on a keyed hash: the engine never decrypts an account number to perform this check. |
| **What the system does** | Escalated to a Compliance Manager. |
| **What a person decides** | A manager investigates the relationship between the organisations. |
| **How it can be wrong** | Real. Group companies, shared agents and common suppliers legitimately share accounts. The rule escalates for investigation rather than blocking. |
| **Policy basis** | Layering and mule-account detection. |
| **Parameters** | `{"escalateAtOrgCount":1}` |

### `RAPID_BENEFICIARY_CHANGE` — Beneficiary added and used unusually quickly

Version 1 · severity medium · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Business email compromise and account takeover, where an attacker adds a new beneficiary and pays it immediately, before anyone notices. |
| **When it fires** | The beneficiary is younger than the configured cooling-off period, or the organisation has added an unusual number of beneficiaries in the last week. |
| **Evidence required** | Beneficiary creation timestamp and the organisation's recent beneficiary additions. |
| **What the system does** | The transaction is held for manual review. The beneficiary is not blocked outright, because a genuinely new trading relationship looks identical and blocking it would cost the customer a trade. |
| **What a person decides** | An analyst confirms the beneficiary through a channel other than the one that requested it. |
| **How it can be wrong** | High for genuinely new trading relationships and for a customer onboarding several suppliers at once. The cost of the false positive is a delay; the cost of the false negative is a lost payment. |
| **Policy basis** | Payment-fraud control; new-payee cooling-off. |
| **Parameters** | `{"minimumAgeHours":24,"recentAdditionsThreshold":3}` |

## Industry

### `HIGH_RISK_INDUSTRY` — High-risk industry

Version 1 · severity medium · on trigger: enhanced_due_diligence

| | |
|---|---|
| **Risk it addresses** | Sectors with elevated inherent money-laundering or sanctions-evasion risk. |
| **When it fires** | The customer's declared industry code appears in the configured list. |
| **Evidence required** | The KYB profile industry field and supporting business-activity evidence. |
| **What the system does** | Routed to enhanced due diligence. |
| **What a person decides** | A manager decides on acceptance and on any additional monitoring. |
| **How it can be wrong** | Moderate. Self-declared industry codes are coarse and customers frequently pick the nearest match rather than the accurate one. |
| **Policy basis** | Business-wide risk assessment; sector risk. Sector list is an internal control, not a citation. |
| **Parameters** | `{"industries":["gambling","virtual_asset_service_provider","precious_metals_and_stones","arms_and_defence","money_service_business","unregulated_charity"]}` |

## Jurisdiction

### `HIGH_RISK_JURISDICTION` — High-risk jurisdiction involved

Version 1 · severity high · on trigger: enhanced_due_diligence

| | |
|---|---|
| **Risk it addresses** | Exposure to jurisdictions subject to call-for-action or increased-monitoring designations, or to a destination-market restriction. |
| **When it fires** | The customer jurisdiction, beneficiary country or beneficiary bank country appears in the configured high-risk list. |
| **Evidence required** | Jurisdiction fields and the list version in force at evaluation. |
| **What the system does** | Routed to enhanced due diligence. |
| **What a person decides** | A Compliance Manager decides whether the relationship may proceed and on what terms. |
| **How it can be wrong** | Low mechanically. The real risk is the opposite: an out-of-date list produces false NEGATIVES, which is why the list is a versioned rule parameter with an explicit review cadence. |
| **Policy basis** | Enhanced measures for higher-risk jurisdictions. THE LIST IS DELIBERATELY EMPTY IN THIS BUILD: naming jurisdictions would assert a regulatory fact the filing has not supplied (FD-005). |
| **Parameters** | `{"jurisdictions":[]}` |

## Limits

### `LIMIT_NOT_CONFIGURED` — No approved transaction limit is configured for this corridor

Version 1 · severity high · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Transacting outside a limit framework. A pilot without enforced limits is a pilot whose exposure is unbounded, which is precisely what a sandbox regime exists to prevent. |
| **When it fires** | The corridor has no per-transaction, daily or monthly limit set. |
| **Evidence required** | The corridor configuration and the source of its limits. |
| **What the system does** | A missing limit is treated as a block, never as "unlimited". The transaction is held for manual review and cannot auto-clear. |
| **What a person decides** | A Compliance Manager must either configure the approved limit from the filing or decline the transaction. |
| **How it can be wrong** | None — but note this rule fires on EVERY transaction until the CBN filing supplies the limits. That is the intended behaviour, not a defect. |
| **Policy basis** | Regulatory sandbox conditions ordinarily cap exposure per transaction, per customer and in aggregate. The specific caps are UNCONFIRMED pending the filing (see founder decision FD-003). |
| **Parameters** | `{}` |

### `TXN_ABOVE_SINGLE_LIMIT` — Transaction exceeds the per-transaction limit

Version 1 · severity prohibited · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | A single transaction breaching the exposure cap agreed for the pilot. A breach is a reportable event, not merely an internal exception. |
| **When it fires** | Send amount exceeds the corridor per-transaction limit, in the limit currency. |
| **Evidence required** | Transaction amount, corridor limit and the limit currency. |
| **What the system does** | Rejected. A pilot limit breach is not a reviewable judgement call. |
| **What a person decides** | None automatically. A limit increase requires a configuration change under maker-checker and, where the limit came from the filing, regulatory agreement. |
| **How it can be wrong** | Low, but note that a limit expressed in a currency other than the send currency requires a conversion; this rule refuses rather than guesses when the currencies differ. |
| **Policy basis** | Pilot transaction cap. Value UNCONFIRMED pending the CBN filing (FD-003). |
| **Parameters** | `{}` |

## Pep

### `PEP_EXPOSURE` — Politically exposed person identified

Version 1 · severity high · on trigger: enhanced_due_diligence

| | |
|---|---|
| **Risk it addresses** | Elevated corruption and proceeds-of-crime risk where a controller of the business, or the beneficiary, holds or held prominent public function. |
| **When it fires** | PEP screening or a self-declaration identifies a PEP among the screened parties. |
| **Evidence required** | The PEP screening result, the declaration, and source-of-wealth evidence. |
| **What the system does** | The case is routed to enhanced due diligence and cannot be cleared by an analyst alone. |
| **What a person decides** | A Compliance Manager approves or declines the relationship after enhanced due diligence, including source of wealth. |
| **How it can be wrong** | Moderate. PEP lists include family members and close associates, and name matching is imprecise. A PEP relationship is not prohibited — it requires senior approval and closer monitoring. |
| **Policy basis** | Enhanced due diligence for politically exposed persons. Nigerian definition and senior-approval requirement UNCONFIRMED pending the filing. |
| **Parameters** | `{}` |

## Related party

### `RELATED_PARTY_TRANSACTION` — Related-party transaction

Version 1 · severity medium · on trigger: manual_review

| | |
|---|---|
| **Risk it addresses** | Payments between entities under common control, which can move value with no genuine underlying trade and are a standard round-tripping technique. |
| **When it fires** | The beneficiary shares a director or ultimate beneficial owner with the sending organisation, or the declared relationship indicates common control. |
| **Evidence required** | The ownership and control registers for both parties, and the declared relationship. |
| **What the system does** | The transaction is held for manual review with the shared controller or declared relationship shown, so the analyst is assessing a stated fact rather than a suspicion. |
| **What a person decides** | An analyst confirms the commercial rationale and that the trade documentation reflects a real transaction. |
| **How it can be wrong** | Low as a detection, but note that related-party payments are frequently entirely legitimate — intra-group settlement is normal. The rule flags for context, not suspicion. |
| **Policy basis** | Related-party and round-tripping controls. |
| **Parameters** | `{}` |

## Sanctions

### `SANCTIONS_MATCH` — Sanctions screening produced a match

Version 1 · severity prohibited · on trigger: suspend

| | |
|---|---|
| **Risk it addresses** | Providing a service to a sanctioned party. This is a strict-liability exposure in most regimes and the single most serious control failure this system can have. |
| **When it fires** | The screening provider returns a potential or confirmed match against any screened party. |
| **Evidence required** | The screening case, the provider response, the matched list entry and the analyst disposition. |
| **What the system does** | The transaction is suspended immediately — not merely queued — and cannot proceed to funding or settlement. |
| **What a person decides** | A Compliance Analyst must dispose of the match as a true match or a false positive, with a written reason. A true match is escalated to a Compliance Manager for reporting. |
| **How it can be wrong** | High and unavoidable. Name-based screening produces many false positives, especially for common names and transliterations. The control is designed around that: it suspends rather than rejects, so a false positive is a delay rather than a lost customer. |
| **Policy basis** | Sanctions screening obligation. Applicable lists and the reporting route are UNCONFIRMED pending the filing; the MVP screens against a clearly labelled SIMULATED list only. |
| **Parameters** | `{"confirmedMatchThreshold":95,"potentialMatchThreshold":80}` |

## Velocity

### `VELOCITY_DAILY_LIMIT` — Daily aggregate limit would be exceeded

Version 1 · severity high · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | Splitting a large exposure across several transactions in one day to stay under the single-transaction cap. |
| **When it fires** | Today's settled and in-flight total plus this transaction exceeds the daily limit. |
| **Evidence required** | The velocity counter for the day and the corridor daily limit. |
| **What the system does** | The transaction is rejected. It is not queued, because the limit has already been reached and no amount of review changes that without a limit change. |
| **What a person decides** | A Compliance Manager may authorise an exception only where the filing permits one. |
| **How it can be wrong** | Moderate: a customer with genuine same-day volume hits this legitimately. The remedy is a documented limit review, not an override. |
| **Policy basis** | Aggregate daily cap. Value UNCONFIRMED pending the CBN filing (FD-003). |
| **Parameters** | `{}` |

### `VELOCITY_MONTHLY_LIMIT` — Monthly aggregate limit would be exceeded

Version 1 · severity high · on trigger: reject

| | |
|---|---|
| **Risk it addresses** | Exceeding the agreed monthly exposure for a single customer. |
| **When it fires** | Month-to-date total plus this transaction exceeds the monthly limit. |
| **Evidence required** | The monthly velocity counter and the corridor monthly limit. |
| **What the system does** | The transaction is rejected. The customer can still transact next month, or after a documented limit review, but not against this limit now. |
| **What a person decides** | Limit review under maker-checker. |
| **How it can be wrong** | Moderate, for the same reason as the daily rule. |
| **Policy basis** | Aggregate monthly cap. Value UNCONFIRMED pending the CBN filing (FD-003). |
| **Parameters** | `{}` |
