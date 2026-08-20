/**
 * Founder Learning Center content, the decision log, the risk register and the build
 * journal.
 *
 * Everything here is written to be read by someone who is not a payments engineer and
 * who needs to be able to defend this system in a room with a regulator. Where something
 * is incomplete or simulated, it says so in the same sentence as the thing it describes.
 */
const MODULES = [
    {
        key: 'onboarding', ordinal: 1, title: 'Organisation onboarding (KYB)',
        whatItDoes: 'Collects everything we need to know about a business before it can move money: who it is ' +
            'legally, who owns and controls it, what it does, where its money comes from, and what it ' +
            'expects to transact. Then it runs screening and puts the case in front of a compliance analyst.',
        whyItExists: 'You cannot check whether a payment is suspicious if you do not know who is making it. Every ' +
            'other control in the system assumes this one worked.',
        whoUsesIt: 'A Business Initiator fills it in. A Compliance Analyst reviews it. A Compliance Manager ' +
            'approves it where the customer is high risk.',
        regulatorySignificance: 'Customer due diligence is the foundational AML obligation. A supervisor examining this ' +
            'business will ask to see the file for a specific customer and will expect to find the ' +
            'evidence, the screening result, the analyst\'s reasoning and the approver\'s name.',
        mainOperationalRisk: 'Approving a business without genuinely identifying its beneficial owners. Layered ownership ' +
            'structures exist precisely to make this hard, and a UBO register that sums to nothing is a ' +
            'register that has been gamed.',
        whatIfItFails: 'You end up moving money for someone you cannot identify. In the best case the relationship is ' +
            'unwound and the customer complains. In the worst case you have handled criminal property and ' +
            'the failure is yours, not the customer\'s.',
        stage: 'tested',
        simulatedParts: 'Identity verification and screening go to simulators. Documents are hashed, type-checked and ' +
            'basic-screened, but no antivirus service and no blob store are connected.',
        knownLimitations: 'Ownership is captured as declared, not verified against a company register. No corporate ' +
            'registry integration exists.',
        questions: [
            {
                question: 'Why must a beneficial owner be identified rather than just the company?',
                options: [
                    'Because the company register requires it for tax purposes',
                    'Because a company is a legal fiction — the risk sits with the real people who control it',
                    'Because banks refuse companies without named owners',
                    'Because it speeds up onboarding',
                ],
                correct: 1,
                explanation: 'The whole point of an ownership structure is that a company can be controlled by someone ' +
                    'whose name is nowhere on it. Identifying the natural persons behind it is what makes ' +
                    'sanctions and PEP screening meaningful at all.',
            },
            {
                question: 'A customer\'s KYB is approved. Six months later they change their bank details. What should happen?',
                options: [
                    'Nothing — they are already approved',
                    'The change is logged but approval stands',
                    'The change invalidates the approval of the affected record and forces re-review',
                    'The customer is suspended',
                ],
                correct: 2,
                explanation: 'Material changes after approval are exactly how business email compromise works. In this ' +
                    'system a change to a beneficiary\'s material fields automatically clears its approval and ' +
                    'flags it for re-review — there is no code path that edits bank details and keeps the ' +
                    'approved status.',
            },
            {
                question: 'Who can approve a HIGH-risk customer?',
                options: ['Any compliance analyst', 'Only a Compliance Manager', 'A system administrator', 'The customer\'s own approver'],
                correct: 1,
                explanation: 'High-risk approval is reserved to a Compliance Manager, enforced both in the permission ' +
                    'set and in the KYB decision code. An analyst attempting it gets a 403 and the attempt is audited.',
            },
            {
                question: 'The registered ownership percentages for a customer total 62%. Is that a problem?',
                options: [
                    'Yes — it must always total 100%',
                    'No — holdings below the disclosure threshold are not required to be listed',
                    'Yes — the customer must be rejected',
                    'It depends on the currency',
                ],
                correct: 1,
                explanation: 'A total under 100% is normal, because small holdings fall below the disclosure threshold. ' +
                    'A total OVER 100% is always an error, and the system reports it as one.',
            },
            {
                question: 'What does the system do if no beneficial owner has been registered at all?',
                options: [
                    'Approves with a warning',
                    'Refuses the submission',
                    'Escalates to a manager',
                    'Marks the customer high risk and continues',
                ],
                correct: 1,
                explanation: 'Submission is refused. A company with no identified beneficial owner cannot be approved, ' +
                    'so allowing the submission would just move the failure further down the process.',
            },
        ],
    },
    {
        key: 'compliance_engine', ordinal: 2, title: 'Compliance engine',
        whatItDoes: 'Runs every rule against every transaction and records the result of each one — including the ' +
            'rules that did not fire. Produces a risk outcome and a recommended action, and opens a case ' +
            'wherever a person must decide.',
        whyItExists: 'Consistency and evidence. A human reviewing every transaction from scratch will decide ' +
            'differently on a Friday afternoon than on a Monday morning, and will not be able to explain ' +
            'either decision two years later.',
        whoUsesIt: 'It runs automatically. Compliance Analysts act on what it produces; Compliance Managers ' +
            'configure it and approve the cases it escalates.',
        regulatorySignificance: 'This is the transaction monitoring system. A supervisor will ask what your rules are, when ' +
            'they last changed, how you tested them, and — for a specific past transaction — why it was allowed.',
        mainOperationalRisk: 'Alert fatigue. A rule set that fires on everything trains analysts to clear alerts without ' +
            'reading them, which is worse than having no rule at all because it produces a false record ' +
            'of diligence.',
        whatIfItFails: 'Either you miss a genuinely suspicious transaction, or you drown in false positives and stop ' +
            'looking properly at any of them. Both end in the same place.',
        stage: 'tested',
        simulatedParts: 'Sanctions, PEP and adverse-media screening use a clearly labelled FICTIONAL list. The names ' +
            'on it are invented and must never be replaced with real designated persons.',
        knownLimitations: 'The high-risk jurisdiction list is deliberately EMPTY: naming jurisdictions would assert a ' +
            'regulatory fact the CBN filing has not supplied. Nigerian AML thresholds are unconfirmed ' +
            '(FD-005). No machine-learning scoring — every rule is explicit and readable.',
        questions: [
            {
                question: 'The rule set is updated. What happens to a decision made under the old rules?',
                options: [
                    'It is recalculated under the new rules',
                    'It disappears from the record',
                    'It stays exactly as it was, with the old rule text and parameters stored alongside it',
                    'It is flagged for review',
                ],
                correct: 2,
                explanation: 'Each evaluation stores the rule text, the version, the parameter values in force and the ' +
                    'specific data the rule read. That is what makes a decision reproducible years later, and ' +
                    'it is why nothing is a foreign key to something that can change.',
            },
            {
                question: 'A sanctions screening hit is returned. What does the system do?',
                options: [
                    'Rejects the transaction automatically',
                    'Suspends the transaction and requires an analyst to dispose of the match with a written reason',
                    'Logs it and continues',
                    'Notifies the customer',
                ],
                correct: 1,
                explanation: 'It suspends rather than rejects, because name-based screening produces many false ' +
                    'positives. Suspension makes a false positive a delay instead of a lost customer, while ' +
                    'still stopping the payment until a person has looked.',
            },
            {
                question: 'Why does the engine record rules that did NOT trigger?',
                options: [
                    'For performance monitoring',
                    'So a reviewer can see what was checked, not just what fired',
                    'To fill the database',
                    'It does not — only triggers are recorded',
                ],
                correct: 1,
                explanation: 'Knowing that a rule was evaluated and found nothing is as important as knowing one fired. ' +
                    'Without it you cannot tell the difference between "we checked and it was clean" and "we ' +
                    'never checked".',
            },
            {
                question: 'A rule throws an error during evaluation. What happens?',
                options: [
                    'It is skipped',
                    'The transaction is approved',
                    'It is treated as TRIGGERED at its declared severity',
                    'The engine retries silently',
                ],
                correct: 2,
                explanation: 'Failing open would let a crash become an approval. A rule that errors is treated as ' +
                    'triggered, so an engine fault stops a payment rather than releasing one.',
            },
            {
                question: 'Why is the high-risk jurisdiction list empty in this build?',
                options: [
                    'It was forgotten',
                    'Because naming jurisdictions would assert a regulatory fact the CBN filing has not supplied',
                    'Because no jurisdiction is high risk',
                    'To improve performance',
                ],
                correct: 1,
                explanation: 'The filing was not available to this build. Rather than invent a list, the rule ships with ' +
                    'an empty one and says explicitly that it cannot fire until FD-005 supplies the real one. ' +
                    'An empty list is honest; an invented one is a fabricated regulatory claim.',
            },
        ],
    },
    {
        key: 'ledger', ordinal: 3, title: 'Double-entry ledger',
        whatItDoes: 'Records every financial movement as two or more entries that add up to zero within each ' +
            'currency. Balances are never stored — they are calculated from the entries every time.',
        whyItExists: 'It is the only way to know that the money is where you think it is. A system that tracks ' +
            'balances by updating a number has no way to detect when that number is wrong.',
        whoUsesIt: 'The settlement engine writes to it. Finance and Treasury read it. An auditor tests it.',
        regulatorySignificance: 'Your books are the evidence of what happened to whose money. An examiner or auditor will ' +
            'reconcile them and will not accept "the status field says settled" as an answer.',
        mainOperationalRisk: 'A transaction reaching a state with accounting consequences without its journal being posted. ' +
            'The daily transaction-to-ledger reconciliation exists specifically to catch this.',
        whatIfItFails: 'You cannot say how much you owe, to whom, or in which currency. Every downstream report is ' +
            'wrong, and you find out during an audit rather than beforehand.',
        stage: 'tested',
        simulatedParts: 'All balances are simulated. Partner accounts are opened with a "test liquidity" injection ' +
            'that exists only to make it obvious the money was invented for the demonstration.',
        knownLimitations: 'No period-end close, no accounting-system export, and no multi-entity consolidation. ' +
            'Sub-ledger accounts are created on demand rather than from a maintained chart.',
        questions: [
            {
                question: 'Why does EKORails\' chart of accounts have no "customer balance" account?',
                options: [
                    'It was not needed yet',
                    'Because EKORails is not authorised to hold customer funds, so the ledger has nowhere to record having done so',
                    'Because customers do not have balances',
                    'For performance reasons',
                ],
                correct: 1,
                explanation: 'A stored-value account implies custody, and custody requires authorisation EKORails does ' +
                    'not have. Customer positions exist only as a receivable and a payable. This is a ' +
                    'structural refusal, not a naming choice.',
            },
            {
                question: 'A journal converts NGN to USD. How can it balance?',
                options: [
                    'It cannot — cross-currency journals are impossible',
                    'By converting at the rate and treating both sides as one currency',
                    'As two balanced legs joined through an FX clearing account, so each currency balances separately',
                    'By rounding to the nearest unit',
                ],
                correct: 2,
                explanation: 'Each currency must balance on its own. The conversion is written as an NGN leg and a USD ' +
                    'leg joined through FX clearing. What is left in FX clearing IS the open currency position — ' +
                    'visible on the dashboard instead of buried inside a rate.',
            },
            {
                question: 'A journal was posted with the wrong amount. How is it corrected?',
                options: [
                    'Edit the entry',
                    'Delete it and post a new one',
                    'Post a reversal, then post the correct journal — both stay in the record',
                    'Ask an administrator to fix it',
                ],
                correct: 2,
                explanation: 'Neither editing nor deleting is possible: the database refuses both, and the application ' +
                    'role has no UPDATE or DELETE privilege on journal entries. A reader of the ledger sees ' +
                    'both the mistake and the correction, which is exactly what an auditor needs.',
            },
            {
                question: 'What does a non-zero FX clearing balance mean?',
                options: [
                    'A rounding error',
                    'An open currency position: an obligation was converted without matching liquidity behind it',
                    'Profit on the trade',
                    'Nothing — it always has a balance',
                ],
                correct: 1,
                explanation: 'It is a real exposure to rate movement. The conversion and the positioning together should ' +
                    'return FX clearing to zero; a persistent balance is reported by the currency-position ' +
                    'reconciliation run as a break.',
            },
            {
                question: 'Where do the balances shown on the finance dashboard come from?',
                options: [
                    'A balance column updated on each transaction',
                    'A nightly batch calculation',
                    'Summing the immutable journal entries at read time',
                    'The transaction status fields',
                ],
                correct: 2,
                explanation: 'Balances are always derived, never stored. There is no cached number to drift out of line ' +
                    'with the entries, and no way for a status field to influence a financial figure.',
            },
        ],
    },
    {
        key: 'settlement', ordinal: 4, title: 'Settlement orchestration',
        whatItDoes: 'Moves a transaction through its lifecycle: approval, compliance, quotation, funding, ' +
            'conversion, instruction, settlement and completion. Every move is a declared step with a ' +
            'named actor, a reason and an accounting consequence.',
        whyItExists: 'Payments fail in specific ways, and each way needs a different response. Without a state ' +
            'machine those responses become ad-hoc decisions made under pressure.',
        whoUsesIt: 'Treasury drives it. Partners report into it. Everyone else watches it.',
        regulatorySignificance: 'Demonstrating that a payment cannot skip a control is the core of a sandbox evaluation. ' +
            'A state that can be set directly is a control that can be bypassed.',
        mainOperationalRisk: 'Duplicate payment. Specifically: sending an instruction, not learning the outcome, and ' +
            'retrying. Every other failure is recoverable; paying twice usually is not.',
        whatIfItFails: 'Either money moves that should not have, or it does not move when it should and the customer ' +
            'loses a trade. Both are reportable; only one is recoverable.',
        stage: 'tested',
        simulatedParts: 'Every partner is a simulator. Eleven failure scenarios can be injected on demand: timeouts, ' +
            'insufficient liquidity, invalid beneficiary, partial settlement, returns and more.',
        knownLimitations: 'Settlement FINALITY is out of scope. "Settled" means a partner reported the payment as made; ' +
            'finality is conferred by a settlement system operator and nothing here can produce it.',
        questions: [
            {
                question: 'The partner does not respond to a settlement instruction. What does the system do?',
                options: [
                    'Retries automatically',
                    'Marks the payment failed',
                    'Marks the outcome UNKNOWN, parks the amount in suspense and refuses to retry until a person establishes the truth',
                    'Marks the payment settled',
                ],
                correct: 2,
                explanation: 'This is the most dangerous state in the system. Retrying blindly could pay twice; writing ' +
                    'it off could leave the beneficiary unpaid. Automatic retry is disabled and a critical ' +
                    'exception is raised for a human.',
            },
            {
                question: 'What stops the same settlement instruction being sent twice?',
                options: [
                    'A check on the transaction status',
                    'An idempotency key derived deterministically from the transaction reference',
                    'A daily reconciliation',
                    'Nothing — operators are careful',
                ],
                correct: 1,
                explanation: 'The key is derived from the transaction reference, so a crashed-and-restarted process ' +
                    'reconstructs the same key rather than minting a new one. A repeat returns a duplicate ' +
                    'marker instead of instructing a second payment.',
            },
            {
                question: 'Can an operator set a transaction directly to "settled"?',
                options: [
                    'Yes, with a reason',
                    'Yes, if they are an administrator',
                    'No — there is no set-state function; only declared transitions exist',
                    'Only in demo mode',
                ],
                correct: 2,
                explanation: 'There is no code path anywhere that assigns a state. If an edge is not declared in the ' +
                    'transition table it cannot happen, and every edge checks the actor, their permission, the ' +
                    'preconditions and (where relevant) their re-asserted second factor.',
            },
            {
                question: 'A partner settles less than instructed. Where does the shortfall go?',
                options: [
                    'It is written off',
                    'It is deducted from the fee',
                    'To settlement suspense, with an exception case and an owner',
                    'It is ignored until the customer complains',
                ],
                correct: 2,
                explanation: 'Suspense is deliberately uncomfortable: a balance sitting there is an open question, and ' +
                    'the finance dashboard reports its age. The alternative — quietly absorbing it — hides a ' +
                    'real loss.',
            },
            {
                question: 'What does "settled" mean in this system?',
                options: [
                    'The payment is legally final and irrevocable',
                    'The partner reported the payment as made',
                    'The customer has been charged',
                    'The beneficiary has confirmed receipt',
                ],
                correct: 1,
                explanation: 'Settlement finality is a legal property conferred by a settlement system operator. No ' +
                    'simulator can produce it, so this system never uses the word. "Settled" is a partner ' +
                    'report; "beneficiary confirmed" is a destination confirmation. Neither is finality.',
            },
        ],
    },
    {
        key: 'reconciliation', ordinal: 5, title: 'Reconciliation and exceptions',
        whatItDoes: 'Compares our records against themselves and against the partners\' records every day, and ' +
            'turns every disagreement into a break with an owner, an age and a required resolution.',
        whyItExists: 'Two systems that should agree eventually will not. Reconciliation is how you find out within ' +
            'a day instead of within an audit.',
        whoUsesIt: 'Finance owns it. Treasury and Compliance act on what it finds.',
        regulatorySignificance: 'Daily reconciliation is a standard supervisory expectation for anyone handling client money ' +
            'flows. A reconciliation that always matches is usually a reconciliation that is not really comparing.',
        mainOperationalRisk: 'Reconciling against yourself. If the "partner statement" is derived from your own ledger it ' +
            'will always match, and the control is theatre.',
        whatIfItFails: 'A duplicate payment, a missing payment or a systematic fee error goes unnoticed until the ' +
            'amounts are large enough to be someone else\'s problem.',
        stage: 'tested',
        simulatedParts: 'Partner statements come from the simulator\'s own record of what it did — deliberately NOT ' +
            'from our ledger, so the two views really can disagree. A scenario can make the partner ' +
            'genuinely wrong, and the run genuinely catches it.',
        knownLimitations: 'No file-based statement ingestion (MT940, CAMT.053) and no tolerance rules for expected ' +
            'rounding differences.',
        questions: [
            {
                question: 'Why is the partner statement built from integration events rather than the ledger?',
                options: [
                    'It is faster',
                    'So the two sides are genuinely independent and can actually disagree',
                    'Because the ledger is unreliable',
                    'To reduce database load',
                ],
                correct: 1,
                explanation: 'A reconciliation that compares a system against itself always matches. Building the ' +
                    'partner\'s view from the partner\'s own record is what makes the control real.',
            },
            {
                question: 'A break is found. Can the person who investigated it close it?',
                options: [
                    'Always',
                    'Never',
                    'Only below the four-eyes threshold; above it a second person must approve',
                    'Only with a manager present',
                ],
                correct: 2,
                explanation: 'Above the configured value a second approver is required, and the database refuses a ' +
                    'closure where the approver equals the investigator. Below it, the same person may close ' +
                    'it — proportionate, and still fully recorded.',
            },
            {
                question: 'Our ledger shows a settlement the partner\'s statement does not. How serious is that?',
                options: [
                    'Low — a timing difference',
                    'Medium — worth checking',
                    'Critical — it may mean a payment we think happened did not, or happened twice',
                    'It is normal',
                ],
                correct: 2,
                explanation: 'Both directions of mismatch are treated as critical. A payment on their statement we do ' +
                    'not recognise is exactly what a duplicate payment looks like, and one on ours they do not ' +
                    'have may mean the beneficiary was never paid.',
            },
            {
                question: 'How is a genuine difference between our records and a partner\'s resolved?',
                options: [
                    'By updating our ledger to match theirs',
                    'By asking the partner to correct their statement',
                    'By posting a reconciliation adjustment into a difference account, with an explanation and an owner',
                    'By ignoring differences under a threshold',
                ],
                correct: 2,
                explanation: 'Neither side is overwritten. The difference goes into an account whose whole purpose is to ' +
                    'say "this is unexplained", where it is aged and owned until it is genuinely resolved.',
            },
            {
                question: 'Which reconciliation run would detect a transaction marked "settled" with no settlement journal?',
                options: ['Fees', 'Currency position', 'Transaction-to-ledger', 'Funding'],
                correct: 2,
                explanation: 'The transaction-to-ledger run checks that every state with accounting consequences has ' +
                    'the journals that state declares. A settled transaction with no settlement journal is a ' +
                    'silent hole in the books and this run raises it as critical.',
            },
        ],
    },
    {
        key: 'access_control', ordinal: 6, title: 'Access control and audit',
        whatItDoes: 'Decides who can do what, keeps one customer\'s data away from another, and records every ' +
            'action in a log that cannot be edited.',
        whyItExists: 'Most financial-crime losses involve someone with legitimate access. Controls that only stop ' +
            'outsiders stop the minority of attacks.',
        whoUsesIt: 'Everyone, invisibly. Administrators configure it; auditors test it.',
        regulatorySignificance: 'Segregation of duties and audit trail integrity are examined directly. "The administrator ' +
            'could change it but would not" is not an answer a supervisor accepts.',
        mainOperationalRisk: 'Privilege creep. Roles accumulate permissions until someone can both initiate and approve, ' +
            'and nobody notices because nothing broke.',
        whatIfItFails: 'A single insider can move money and erase the evidence. That is the difference between a ' +
            'recoverable incident and an unprovable one.',
        stage: 'tested',
        simulatedParts: 'None. Access control and the audit trail are real, and their controls are enforced by the ' +
            'database rather than only by the application.',
        knownLimitations: 'No external identity provider is connected (the design is OIDC-compatible). No hardware ' +
            'security key support beyond TOTP. Break-glass exists but has not been exercised in a drill.',
        questions: [
            {
                question: 'A System Administrator wants to edit an audit record. What stops them?',
                options: [
                    'A confirmation dialog',
                    'An application permission check',
                    'The application\'s database role has no UPDATE or DELETE privilege on the audit table, and a trigger refuses it even for the table owner',
                    'Nothing — administrators can do anything',
                ],
                correct: 2,
                explanation: 'Two independent layers, both below the application. Someone holding every application ' +
                    'permission still has no SQL privilege with which to alter an audit record.',
            },
            {
                question: 'A business user requests a transaction belonging to another organisation. What do they get?',
                options: ['403 Forbidden', '404 Not Found', 'The transaction', 'An error page'],
                correct: 1,
                explanation: '404, deliberately. Telling someone "this exists but is not yours" is itself a disclosure. ' +
                    'Row-level security means the query returns nothing, so the answer is honest as well as safe.',
            },
            {
                question: 'What makes the audit trail tamper-evident rather than just append-only?',
                options: [
                    'Timestamps',
                    'A hash chain: each entry stores the hash of its predecessor and a hash of its own contents',
                    'Daily backups',
                    'Sequential IDs',
                ],
                correct: 1,
                explanation: 'Removing or altering a row in the middle breaks the chain, and the verification routine ' +
                    'reports the exact sequence number where it breaks. Verification runs in SQL, so it does ' +
                    'not depend on the application being honest.',
            },
            {
                question: 'What is "step-up" authentication for?',
                options: [
                    'Logging in',
                    'Re-asserting the second factor before a specific sensitive action, not just at sign-in',
                    'Password resets',
                    'Administrator access only',
                ],
                correct: 1,
                explanation: 'A session that authenticated hours ago may since have been hijacked. Releasing a ' +
                    'settlement or accepting a quote requires the second factor again, within a short window.',
            },
            {
                question: 'Super Administrator access works how?',
                options: [
                    'It is a standing role for the founder',
                    'Emergency only: a written reason, a different person\'s approval, a time limit and full audit',
                    'It is granted automatically to the first user',
                    'It cannot be used',
                ],
                correct: 1,
                explanation: 'There is no standing break-glass access. Each session needs a request with a substantial ' +
                    'written reason, approval from someone other than the requester, and an expiry — all of ' +
                    'which are recorded.',
            },
        ],
    },
    {
        key: 'regulatory_boundary', ordinal: 7, title: 'Regulatory boundary',
        whatItDoes: 'Keeps the product inside what EKORails is actually permitted to do, and keeps the software ' +
            'from claiming otherwise — in its screens, its API, its reports and its ledger.',
        whyItExists: 'The fastest way to end a regulatory relationship is to appear to be doing something you are ' +
            'not licensed for. That usually happens by accident, in a demo, in a sentence nobody reviewed.',
        whoUsesIt: 'Everyone. It is enforced in code rather than in a policy document.',
        regulatorySignificance: 'This is the first thing a supervisor tests: does the product hold itself out as something it ' +
            'is not?',
        mainOperationalRisk: 'Language drift. A phrase like "your EKORails balance" or "guaranteed rate" appears in a ' +
            'screen, then in a deck, then in a conversation with a bank.',
        whatIfItFails: 'At best, a correction and lost credibility. At worst, an enforcement question about ' +
            'unlicensed activity.',
        stage: 'tested',
        simulatedParts: 'Everything that would require a licence is simulated: funding, FX execution, settlement and ' +
            'the beneficiary credit.',
        knownLimitations: 'The claims lint checks user-facing strings in this repository. It cannot police a slide deck ' +
            'or a conversation.',
        questions: [
            {
                question: 'Why does the funding journal debit the PARTNER\'s account rather than an EKORails account?',
                options: [
                    'Accounting convention',
                    'Because the licensed partner holds the money — EKORails is not a deposit-taking institution',
                    'To simplify reconciliation',
                    'Because the partner asked for it',
                ],
                correct: 1,
                explanation: 'The ledger has to say where the money actually is. Recording it as arriving at EKORails ' +
                    'would be both untrue and a claim to an activity EKORails is not licensed for.',
            },
            {
                question: 'How is live money movement prevented?',
                options: [
                    'A setting in the admin screen',
                    'A database flag',
                    'Process environment configuration plus nine release gates, none settable through any interface',
                    'A code comment',
                ],
                correct: 2,
                explanation: 'The environment mode is read from the process environment at startup and frozen. No API ' +
                    'route, admin screen, feature flag or database row can change it, and PRODUCTION with any ' +
                    'gate unmet fails to start at all.',
            },
            {
                question: 'Which of these may the product say?',
                options: [
                    '"Guaranteed rate"',
                    '"CBN-approved"',
                    '"Indicative rate, simulated"',
                    '"Zero spread"',
                ],
                correct: 2,
                explanation: 'The first, second and fourth are all blocked by the claims lint, which fails the build. ' +
                    'A rate is indicative until accepted, and it can only be described as locked where a ' +
                    'partner has contractually locked it — which no simulator can do.',
            },
            {
                question: 'Does EKORails claim to be an admitted CBN sandbox participant?',
                options: [
                    'Yes',
                    'Only in the regulator view',
                    'No — the configuration defaults to not_confirmed and nothing may imply admission',
                    'It depends on the environment',
                ],
                correct: 2,
                explanation: 'The sandbox application was not available to this build, so admission is not asserted ' +
                    'anywhere. Founder decision FD-009 recommends saying nothing until an admission letter exists.',
            },
            {
                question: 'The company is African-owned. Can it claim African data residency?',
                options: [
                    'Yes',
                    'Yes, if the founders are resident',
                    'No — residency follows the deployment region and a completed assessment, not ownership',
                    'Only for customer data',
                ],
                correct: 2,
                explanation: 'Data residency is a property of where the data physically sits and what law reaches it. ' +
                    'The deployment region is an unresolved placeholder (FD-008) and the system makes no ' +
                    'residency claim.',
            },
        ],
    },
];
export async function seedLearningContent(db) {
    let modules = 0;
    let questions = 0;
    for (const m of MODULES) {
        const result = await db.query(`INSERT INTO learning_module (
         key, ordinal, title, what_it_does, why_it_exists, who_uses_it,
         regulatory_significance, main_operational_risk, what_if_it_fails,
         completion_stage, simulated_parts, known_limitations
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (key) DO UPDATE SET
         completion_stage = EXCLUDED.completion_stage,
         simulated_parts = EXCLUDED.simulated_parts,
         known_limitations = EXCLUDED.known_limitations`, [
            m.key, m.ordinal, m.title, m.whatItDoes, m.whyItExists, m.whoUsesIt,
            m.regulatorySignificance, m.mainOperationalRisk, m.whatIfItFails,
            m.stage, m.simulatedParts, m.knownLimitations,
        ]);
        modules += result.rowCount ?? 0;
        for (const [index, q] of m.questions.entries()) {
            const r = await db.query(`INSERT INTO learning_assessment_question (module_key, ordinal, question, options, correct_index, explanation)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)
         ON CONFLICT (module_key, ordinal) DO NOTHING`, [m.key, index + 1, q.question, JSON.stringify(q.options), q.correct, q.explanation]);
            questions += r.rowCount ?? 0;
        }
    }
    return { modules, questions };
}
const GLOSSARY = [
    ['Clearing',
        'Working out who owes what to whom before any money moves.',
        'Two banks send each other hundreds of payments a day. Clearing is the process of netting them ' +
            'down to a single figure so only that amount actually has to move.',
        'Clearing is not payment. A cleared position is an agreement about the amount; the money still ' +
            'has to be settled afterwards.',
        'People often say "cleared" when they mean "paid". They are different steps, and value can be ' +
            'lost between them.'],
    ['Settlement',
        'The actual transfer of value that discharges an obligation.',
        'This is the moment the money genuinely moves from one institution to another and the debt ' +
            'between them is extinguished.',
        'Until settlement happens, someone is carrying credit risk on someone else.',
        'A payment showing as "sent" in an app is not necessarily settled. It may only have been instructed.'],
    ['Settlement finality',
        'The point at which a settlement becomes legally irrevocable.',
        'After finality, the payment cannot be unwound even if a party becomes insolvent a minute later. ' +
            'It is conferred by the rules of a designated settlement system, not by any software.',
        'It determines who bears the loss if something goes wrong mid-flow. It is the single most ' +
            'important legal property in payments.',
        'EKORails cannot confer finality and this system never claims to. "Settled" here means a partner ' +
            'reported the payment as made.'],
    ['Correspondent banking',
        'One bank holding an account for another so it can reach a market it has no presence in.',
        'A Nigerian bank that needs to pay dollars holds an account with a US bank. The US bank makes ' +
            'the dollar payment on its behalf.',
        'It is how most cross-border payment actually works, and the relationships are scarce, expensive ' +
            'and can be withdrawn.',
        'The correspondent does its own compliance on your customers. Losing a correspondent ' +
            'relationship can end a corridor overnight.'],
    ['FX spread',
        'The difference between the rate you get and the mid-market rate.',
        'If mid-market is 1,600 and you are offered 1,570, the 30 is the spread. It is a charge, ' +
            'whether or not it is called one.',
        'A spread hidden inside a rate is still a fee. Showing it separately is what lets a customer ' +
            'compare providers honestly.',
        '"No fees" frequently means "the fee is in the rate". This system stores reference rate, ' +
            'provider rate and spread as separate fields for exactly that reason.'],
    ['Liquidity',
        'Having the right currency, in the right place, at the moment you need it.',
        'You can be owed a great deal of money and still be unable to make a payment this afternoon, ' +
            'because the money is not where the payment has to come from.',
        'Liquidity failures look like operational failures to a customer, and they are the most common ' +
            'reason a cross-border payment is late.',
        'Profitability and liquidity are different things. Companies fail with a full order book.'],
    ['Ledger',
        'The authoritative record of every financial movement.',
        'Not a report and not a dashboard: the actual list of entries from which every figure is derived.',
        'If the ledger is wrong, everything downstream is wrong and you will not know which parts.',
        'A "balance" column in a table is not a ledger. A ledger is the entries; the balance is a ' +
            'consequence of them.'],
    ['Double-entry accounting',
        'Recording every movement in at least two places so that the total always nets to zero.',
        'Money never appears or disappears — it moves from somewhere to somewhere. Writing both sides ' +
            'means an error cannot hide.',
        'It is what makes it possible to prove the books are internally consistent.',
        'It is a 500-year-old error-detection technique, not an accounting formality.'],
    ['Reconciliation',
        'Comparing two independent records of the same events and investigating every difference.',
        'Our ledger says we paid $10,000. The partner\'s statement says $9,999.50. Reconciliation finds ' +
            'that and turns it into work for a named person.',
        'It is how you discover a duplicate payment, a missing payment or a fee error within a day ' +
            'rather than within an audit.',
        'A reconciliation that always matches is usually comparing a system against itself.'],
    ['KYB',
        'Know Your Business: identifying and verifying a corporate customer.',
        'Establishing that the company exists, what it does, and who really owns and controls it.',
        'Every other control assumes KYB worked. If you do not know who the customer is, you cannot ' +
            'assess whether their payments are unusual.',
        'KYB is not a form. It is a decision, made by a named person, with evidence behind it.'],
    ['KYC',
        'Know Your Customer: the same idea applied to an individual.',
        'Verifying a person\'s identity and understanding their circumstances.',
        'Required for the individuals behind a business — directors, signatories and beneficial owners.',
        'EKORails serves businesses only. KYC here applies to the people who control them, not to retail customers.'],
    ['AML',
        'Anti-money laundering: stopping criminal proceeds being made to look legitimate.',
        'A set of obligations: know your customer, monitor their activity, report what is suspicious, ' +
            'and keep records that prove you did.',
        'These are legal duties on the institution and, in many regimes, personally on its officers.',
        'AML is not the same as fraud prevention. Fraud is about protecting the customer; AML is about ' +
            'not becoming the route criminal money takes.'],
    ['CFT',
        'Countering the financing of terrorism.',
        'Detecting and preventing funds reaching designated persons and organisations.',
        'It typically carries strict liability and heavier penalties than money laundering.',
        'Amounts are often small, so value-based thresholds are a poor detection method. Screening matters more.'],
    ['PEP',
        'Politically exposed person: someone who holds or held prominent public function.',
        'A minister, a senior official, a state company director — and their close family and associates.',
        'Elevated corruption risk means enhanced due diligence and senior sign-off.',
        'Being a PEP is not an allegation and is not prohibited. It requires more care, not refusal.'],
    ['Sanctions screening',
        'Checking parties against lists of persons and entities you must not deal with.',
        'Names, and often dates of birth and nationalities, are matched against published lists.',
        'Breaching sanctions is usually strict liability: intent does not help you.',
        'Name matching is inherently imprecise. Most hits are false positives, which is why disposition ' +
            'by a person is part of the control, not an afterthought.'],
    ['Beneficial owner',
        'The real person who ultimately owns or controls a company.',
        'Not the company on the share register, and not necessarily the director — the human being at ' +
            'the end of the ownership chain.',
        'Structures exist specifically to obscure this. Identifying it is the point of KYB.',
        'A registered ownership total under 100% is normal (small holdings need not be disclosed). ' +
            'Over 100% is always an error.'],
    ['Maker-checker',
        'One person creates, a different person approves.',
        'Also called four-eyes. The person who sets up a payment cannot be the person who releases it.',
        'It is the single most effective control against both error and insider fraud.',
        'It only works if it is enforced by the system. A policy that says "should be different people" ' +
            'is not a control; a database constraint is.'],
    ['Idempotency',
        'Doing the same thing twice has the same effect as doing it once.',
        'Each instruction carries a key. If the same key arrives again, the system returns the original ' +
            'result instead of acting a second time.',
        'Networks time out and processes crash. Without idempotency, a retry is a second payment.',
        'It only helps if the key is deterministic. A newly generated key on retry defeats the whole mechanism.'],
    ['Webhook',
        'A callback: instead of you asking repeatedly, the other system tells you when something happens.',
        'A partner posts to your URL when a payment settles.',
        'It makes the flow event-driven rather than poll-driven.',
        'A webhook can be replayed or forged. It must be signature-verified and idempotent, and it is ' +
            'never trusted on its own for a financial decision.'],
    ['API',
        'A defined way for two systems to talk to each other.',
        'A contract: send this shape of request, get that shape of response.',
        'It is what lets a customer\'s accounting system talk to EKORails without a person retyping anything.',
        'An API is a security boundary. Every endpoint needs authentication, authorisation and rate ' +
            'limiting, not just the ones that look sensitive.'],
    ['Stablecoin',
        'A digital token intended to hold a fixed value against a currency.',
        'Some cross-border providers use them to move value between markets quickly.',
        'They are a settlement mechanism with a distinct regulatory treatment, which varies sharply ' +
            'by jurisdiction.',
        'EKORails does not use stablecoins and is not a cryptocurrency exchange. This entry exists ' +
            'because the question is always asked.'],
    ['Custody',
        'Holding someone else\'s money or assets.',
        'If a customer\'s funds sit in your account, you have custody, and that almost always requires ' +
            'authorisation and client-money protections.',
        'It changes what you are, legally, and what happens to customers if you fail.',
        'EKORails does not have custody. The ledger has no customer stored-value account, so there is ' +
            'nowhere to record having it.'],
    ['Data residency',
        'Which country data physically sits in, and whose law can reach it.',
        'Where the servers are, where the backups are, and where support staff view the data from.',
        'Some regulators require certain data to stay in-country, and cross-border transfer usually ' +
            'needs a documented legal basis.',
        'Residency is not determined by where a company is incorporated or who owns it. An ' +
            'African-owned company running in a European region has European residency.'],
];
export async function seedGlossary(db) {
    let count = 0;
    for (const [term, short, plain, why, misunderstanding] of GLOSSARY) {
        const result = await db.query(`INSERT INTO learning_glossary (term, short_definition, plain_english, why_it_matters, common_misunderstanding)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (term) DO NOTHING`, [term, short, plain, why, misunderstanding]);
        count += result.rowCount ?? 0;
    }
    return count;
}
export async function seedDecisionLog(db) {
    const decisions = [
        {
            ref: 'FD-001', title: 'What legal entity particulars may the product display?',
            context: 'Receipts, the regulator view and customer-facing documents normally carry the registered ' +
                'name, company number, jurisdiction of incorporation and registered office. No incorporation ' +
                'document was supplied to this build.',
            options: [
                { option: 'Display only the registered name until documents are attached', consequence: 'Some documents look incomplete; nothing false is stated.' },
                { option: 'Display particulars the founder provides verbally', consequence: 'Fast, but an unverified company number on a regulatory document is a serious problem.' },
                { option: 'Omit entity details entirely', consequence: 'Receipts become less useful to customers and to their auditors.' },
            ],
            recommended: 'Display only the registered name until incorporation documents are attached to this repository.',
            risk: 'An incorrect company number or jurisdiction on a document that reaches a regulator or a bank ' +
                'is difficult to explain and undermines everything else in the file.',
            regulatory: 'Low if handled as recommended. High if particulars are invented.',
            cost: 'None.',
            reversibility: 'easily_reversible',
            blocks: 'Regulator view, transaction receipts, PDF report footers.',
        },
        {
            ref: 'FD-002', title: 'Which corridor and currency pair does the pilot run?',
            context: 'The controlling source for the corridor is the CBN Regulatory Sandbox application, which was ' +
                'not available. The corridor is seeded with INSERT_APPROVED_* placeholders and the ' +
                'demonstration data is denominated in NGN and USD purely so the engine can be exercised.',
            options: [
                { option: 'Choose the destination by settled partner availability', consequence: 'Slower to announce, but the corridor is real on day one.' },
                { option: 'Choose the destination by market size', consequence: 'Attractive commercially, but a corridor with no partner is not a corridor.' },
                { option: 'Run two corridors from the start', consequence: 'Doubles the compliance, partner and reconciliation surface during a pilot.' },
            ],
            recommended: 'One corridor. Nigeria as origin, with the destination chosen by which licensed settlement ' +
                'partner is contractually available — not by which market is largest.',
            risk: 'Announcing a corridor before a partner is contracted. Partner availability, not demand, is ' +
                'the binding constraint in cross-border settlement.',
            regulatory: 'HIGH. The corridor defines the scope of the sandbox permission. Operating outside it is ' +
                'operating without permission.',
            cost: 'Each additional corridor multiplies partner, compliance and reconciliation work.',
            reversibility: 'costly_to_reverse',
            blocks: 'Corridor configuration, FX pair, limits, every compliance evaluation.',
        },
        {
            ref: 'FD-003', title: 'What transaction and pilot limits apply?',
            context: 'Per-transaction, daily, monthly and pilot-aggregate limits, plus the participant cap, come ' +
                'from the filing. Provisional demonstration limits are configured and marked as such.',
            options: [
                { option: 'Adopt the filing\'s limits verbatim', consequence: 'No divergence between what was approved and what the system enforces.' },
                { option: 'Set internal limits below the filing\'s', consequence: 'More conservative; a customer hitting the internal limit may not understand why.' },
                { option: 'Set internal limits above the filing\'s', consequence: 'Unacceptable — a breach of the sandbox conditions.' },
            ],
            recommended: 'Adopt the filing\'s limits verbatim, and never set an internal limit above them. Below is a ' +
                'commercial choice; above is a breach.',
            risk: 'A limit breach is a reportable event, not an internal exception. Until the filing supplies ' +
                'the limits, the LIMIT_NOT_CONFIGURED rule holds every transaction for manual review, which ' +
                'is the intended behaviour rather than a defect.',
            regulatory: 'HIGH. Exceeding an agreed cap is the clearest possible breach of pilot conditions.',
            cost: 'Lower limits reduce revenue per customer during the pilot.',
            reversibility: 'easily_reversible',
            blocks: 'The limit and velocity rules; the pilot report\'s breach measures.',
        },
        {
            ref: 'FD-004', title: 'What is the settlement mechanism and who are the partners?',
            context: 'Everything in this build settles through simulators. The real mechanism — correspondent ' +
                'banking, a licensed PSP, or something else — is not asserted anywhere.',
            options: [
                { option: 'Correspondent-bank settlement through a licensed partner', consequence: 'Well understood by regulators and banks; slower and more expensive.' },
                { option: 'A licensed payment institution as settlement agent', consequence: 'Potentially faster; the partner\'s own permissions become a dependency.' },
                { option: 'Apply for EKORails\' own licence', consequence: 'Removes the dependency; adds years and substantial capital.' },
            ],
            recommended: 'Correspondent-bank settlement through a licensed partner, with EKORails orchestrating only. ' +
                'This keeps EKORails outside every licensed activity for the pilot.',
            risk: 'Partner concentration. A single settlement partner is a single point of failure for the ' +
                'entire product, and correspondent relationships are withdrawn with little notice.',
            regulatory: 'HIGH. This determines whether EKORails is performing a licensed activity. Get it wrong and ' +
                'the question becomes an enforcement one.',
            cost: 'Correspondent settlement carries higher per-transaction cost and requires pre-funding.',
            reversibility: 'effectively_irreversible',
            blocks: 'Partner adapters, custody posture, the ledger\'s partner account structure.',
        },
        {
            ref: 'FD-005', title: 'Which AML/CFT thresholds and lists apply?',
            context: 'Rules implement generally accepted controls, but Nigerian reporting thresholds and the ' +
                'applicable high-risk jurisdiction list are unconfirmed. The jurisdiction list ships EMPTY ' +
                'rather than invented.',
            options: [
                { option: 'Adopt the CBN AML/CFT Regulations thresholds once the filing cites them', consequence: 'Correct, but the rule cannot fire until then.' },
                { option: 'Use an international default list', consequence: 'Plausible but wrong — it would assert a regulatory fact nobody has given us.' },
                { option: 'Set no jurisdiction rule at all', consequence: 'Removes a control rather than deferring it.' },
            ],
            recommended: 'Adopt the thresholds and lists the filing cites. Until then the rule exists, is visible, and ' +
                'reports honestly that it cannot fire.',
            risk: 'An out-of-date list produces false NEGATIVES, which are invisible. The list must be a ' +
                'versioned rule parameter with a stated review cadence, not a code constant.',
            regulatory: 'HIGH. Screening against the wrong list is close to not screening.',
            cost: 'A maintained list service is a recurring subscription.',
            reversibility: 'easily_reversible',
            blocks: 'HIGH_RISK_JURISDICTION rule parameters; reporting thresholds.',
        },
        {
            ref: 'FD-006', title: 'What regulatory returns must be filed, in what form, and how often?',
            context: 'The report shapes are built and exportable in CSV, XLSX and PDF. No statutory form ' +
                'identifier is asserted, because inventing one would be inventing a regulatory fact.',
            options: [
                { option: 'Build to the filing\'s specified returns once supplied', consequence: 'Correct; a short mapping exercise per return.' },
                { option: 'Guess the likely forms now', consequence: 'A plausible-looking form identifier on a submitted return is worse than none.' },
            ],
            recommended: 'Build to the filing\'s returns. Do not invent form identifiers.',
            risk: 'A missed return is a supervisory failure in its own right, regardless of the underlying data.',
            regulatory: 'MEDIUM to HIGH depending on the cadence required.',
            cost: 'Low — the data already exists; only the presentation layer changes.',
            reversibility: 'easily_reversible',
            blocks: 'Report headers and the regulatory export route.',
        },
        {
            ref: 'FD-007', title: 'How long does the pilot run and what counts as success?',
            context: 'The pilot report computes participants, volumes, completion rate, cost, processing time, ' +
                'exceptions, complaints and incidents. No target thresholds are asserted.',
            options: [
                { option: 'Adopt the filing\'s duration and targets verbatim', consequence: 'What you are measured against is what you agreed.' },
                { option: 'Set internal stretch targets above the filing\'s', consequence: 'Motivating internally; risks appearing to have failed against your own numbers.' },
            ],
            recommended: 'Adopt the filing\'s duration and targets verbatim for external reporting. Keep any internal ' +
                'stretch targets internal.',
            risk: 'Reporting against targets you invented, and appearing to miss them, damages credibility ' +
                'more than the underlying performance would.',
            regulatory: 'MEDIUM. Success measures determine whether the pilot progresses.',
            cost: 'A longer pilot costs more to run but produces more evidence.',
            reversibility: 'easily_reversible',
            blocks: 'Pilot report targets and the readiness assessment.',
        },
        {
            ref: 'FD-008', title: 'Where is the system deployed, and what data residency is claimed?',
            context: 'The deployment region is a placeholder. The system makes NO residency claim. In particular ' +
                'it does not claim African residency on the basis of African ownership.',
            options: [
                { option: 'Complete a residency assessment, then choose a region', consequence: 'Slower; defensible.' },
                { option: 'Choose an African region and market it as African residency', consequence: 'Marketable, but a claim you cannot support if backups or support access sit elsewhere.' },
                { option: 'Choose the cheapest region', consequence: 'May place data outside what the regulator or customers will accept.' },
            ],
            recommended: 'Complete a data residency and cross-border transfer assessment first. Choose the region from ' +
                'that assessment, and describe residency only in terms of where data actually sits.',
            risk: 'Residency is about where data physically is and whose law reaches it — including backups, ' +
                'logs and support access. A claim that ignores any of those is false.',
            regulatory: 'HIGH. Data localisation requirements vary and are enforced.',
            cost: 'Regional pricing varies; some regions lack managed services.',
            reversibility: 'costly_to_reverse',
            blocks: 'Infrastructure deployment, the privacy impact assessment, customer contracts.',
        },
        {
            ref: 'FD-009', title: 'What may be said publicly about sandbox status?',
            context: 'Admission has not been confirmed to this build. The configuration defaults to not_confirmed ' +
                'and nothing in the product implies otherwise.',
            options: [
                { option: 'Say nothing until an admission letter exists', consequence: 'Less impressive in a pitch; entirely safe.' },
                { option: 'Say "engaged with the CBN sandbox process"', consequence: 'Ambiguous, and ambiguity is read generously by listeners and harshly by regulators.' },
                { option: 'Say "CBN sandbox participant"', consequence: 'Unacceptable unless and until it is true.' },
            ],
            recommended: 'Say nothing about sandbox status until an admission letter exists.',
            risk: 'Overstating regulatory status is one of the fastest ways to lose both a regulator\'s and a ' +
                'bank partner\'s confidence, and it is very hard to recover.',
            regulatory: 'HIGH. Misrepresenting regulatory status is itself a serious matter.',
            cost: 'None.',
            reversibility: 'easily_reversible',
            blocks: 'All external-facing copy, the pitch deck, the website.',
        },
        {
            ref: 'FD-010', title: 'Framework choice: minimal dependencies versus a conventional stack',
            context: 'The brief recommends Next.js and NestJS. This build uses TypeScript on Node with one runtime ' +
                'dependency (the PostgreSQL driver), a hand-written router, and a no-build web client. ' +
                'Spreadsheet, PDF and cryptographic functions are implemented directly.',
            options: [
                { option: 'Keep the minimal stack', consequence: 'Very small attack surface and no dependency advisories to triage; less familiar to new hires; more code owned in-house.' },
                { option: 'Migrate to Next.js and NestJS', consequence: 'Conventional and hireable; adds roughly a thousand transitive dependencies to a system that moves money.' },
                { option: 'Hybrid: NestJS API, minimal front end', consequence: 'Splits the difference and the drawbacks.' },
            ],
            recommended: 'Keep the minimal stack through the pilot, then reassess. The security and supply-chain ' +
                'argument is strongest exactly when the system is under regulatory scrutiny and the team is small.',
            risk: 'Hiring and onboarding are harder, and hand-written infrastructure carries bugs a mature ' +
                'framework would not. This is a genuine trade, not a free win.',
            regulatory: 'LOW directly, but dependency scanning findings are a standard security-review question.',
            cost: 'Lower running cost; higher cost to onboard an engineer unfamiliar with the codebase.',
            reversibility: 'costly_to_reverse',
            blocks: 'Nothing. Recorded because a technical due-diligence reviewer will ask why.',
        },
    ];
    let count = 0;
    for (const d of decisions) {
        const result = await db.query(`INSERT INTO decision_log (
         decision_ref, title, status, context, options_considered, recommended_option,
         main_risk, regulatory_impact, cost_impact, reversibility, blocks
       ) VALUES ($1,$2,'awaiting_approval',$3,$4::jsonb,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (decision_ref) DO NOTHING`, [
            d.ref, d.title, d.context, JSON.stringify(d.options), d.recommended,
            d.risk, d.regulatory, d.cost, d.reversibility, d.blocks,
        ]);
        count += result.rowCount ?? 0;
    }
    return count;
}
export async function seedRiskRegister(db) {
    const risks = [
        {
            ref: 'R-01', category: 'regulatory', title: 'Operating outside the approved sandbox scope',
            description: 'The corridor, currencies and limits come from a filing that was not available to this build. ' +
                'Transacting outside the approved scope would be operating without permission.',
            il: 'possible', ii: 'severe',
            controls: 'Corridor is held as an explicit placeholder; the CORRIDOR_PLACEHOLDER_UNCONFIRMED rule fires ' +
                'on every transaction so none can auto-clear compliance; a missing limit is treated as a block ' +
                'rather than as unlimited.',
            status: 'implemented_tested', rl: 'unlikely', ri: 'severe',
            owner: 'Founder / Compliance', treatment: 'mitigate',
            action: 'Obtain the filing and resolve FD-002 and FD-003 before any pilot activity.',
            blocks: true,
        },
        {
            ref: 'R-02', category: 'licensing', title: 'Appearing to perform a licensed activity',
            description: 'Software that appears to hold funds, execute FX or settle payments invites the question of ' +
                'whether EKORails is performing those activities without authorisation.',
            il: 'possible', ii: 'critical',
            controls: 'No customer stored-value account in the chart of accounts; funding is recorded at the partner; ' +
                'a claims lint over user-facing text fails the build on prohibited language; a standing ' +
                'regulatory-boundary statement is served from the API.',
            status: 'implemented_tested', rl: 'rare', ri: 'critical',
            owner: 'Founder / Legal', treatment: 'mitigate',
            action: 'Legal review of all external-facing copy before any external demonstration.',
            blocks: true,
        },
        {
            ref: 'R-03', category: 'settlement', title: 'Duplicate settlement',
            description: 'An instruction is sent, the outcome is not learned, and a retry results in the beneficiary ' +
                'being paid twice. Usually unrecoverable.',
            il: 'likely', ii: 'major',
            controls: 'Deterministic idempotency keys derived from the transaction reference; a duplicate submission ' +
                'returns the original result; an unknown outcome is never auto-retried and raises a critical ' +
                'exception; the settlement reconciliation run counts submissions per transaction.',
            status: 'implemented_tested', rl: 'unlikely', ri: 'major',
            owner: 'Engineering / Treasury', treatment: 'mitigate',
            action: 'Confirm the real partner honours idempotency keys and document their semantics.',
            blocks: false,
        },
        {
            ref: 'R-04', category: 'custody', title: 'Inadvertent custody of customer funds',
            description: 'A future change introduces an account or flow in which EKORails holds customer money, ' +
                'triggering client-money obligations it is not authorised for.',
            il: 'unlikely', ii: 'critical',
            controls: 'The account category enumeration is a database CHECK constraint. Adding a custody account ' +
                'requires a visible schema migration, not a configuration change.',
            status: 'implemented_tested', rl: 'rare', ri: 'critical',
            owner: 'Engineering / Legal', treatment: 'avoid',
            action: 'Add a review gate on any migration touching ledger_account.',
            blocks: false,
        },
        {
            ref: 'R-05', category: 'partner_dependency', title: 'Single settlement partner concentration',
            description: 'One settlement partner is a single point of failure for the entire product. Correspondent ' +
                'relationships are withdrawn with little notice.',
            il: 'possible', ii: 'severe',
            controls: 'Adapters are provider-neutral and resolved by configuration, so a second partner is a ' +
                'configuration and adapter change rather than a rewrite.',
            status: 'implemented_untested', rl: 'possible', ri: 'severe',
            owner: 'Founder', treatment: 'mitigate',
            action: 'Identify a second settlement partner before the pilot ends. No partner is contracted today.',
            blocks: true,
        },
        {
            ref: 'R-06', category: 'cyber', title: 'Account takeover leading to fraudulent payment',
            description: 'A compromised customer credential is used to add a beneficiary and pay it.',
            il: 'likely', ii: 'major',
            controls: 'Mandatory MFA; step-up re-authentication before quote acceptance and settlement release; ' +
                'maker-checker on every payment; a new-beneficiary cooling-off rule; device and network ' +
                'signals feeding the compliance engine; session invalidation on password change.',
            status: 'implemented_tested', rl: 'unlikely', ri: 'major',
            owner: 'Engineering / Security', treatment: 'mitigate',
            action: 'Add hardware security key support and out-of-band beneficiary confirmation.',
            blocks: false,
        },
        {
            ref: 'R-07', category: 'cyber', title: 'Malicious insider altering records',
            description: 'A member of staff with legitimate access alters a compliance decision, a ledger entry or the ' +
                'audit trail to conceal an action.',
            il: 'unlikely', ii: 'critical',
            controls: 'The application database role holds no UPDATE or DELETE privilege on audit, ledger-entry or ' +
                'compliance-decision tables; append-only triggers refuse mutation even for the table owner; ' +
                'the audit trail is hash-chained and verifiable in SQL.',
            status: 'implemented_tested', rl: 'rare', ri: 'critical',
            owner: 'Engineering / Security', treatment: 'mitigate',
            action: 'Separate the database administrator role from the application team, and ship audit records ' +
                'to write-once external storage. Neither is done today.',
            blocks: false,
        },
        {
            ref: 'R-08', category: 'data_protection', title: 'Exposure of personal data',
            description: 'Identity documents, ownership registers and screening payloads contain significant personal ' +
                'data about identifiable individuals.',
            il: 'possible', ii: 'major',
            controls: 'Field-level AES-256-GCM encryption for identification and account numbers; hashed network ' +
                'identifiers; a redaction layer on every log and audit write; role-based masking in reports; ' +
                'audited document access with a stated reason for external roles.',
            status: 'implemented_tested', rl: 'unlikely', ri: 'major',
            owner: 'Engineering / Privacy', treatment: 'mitigate',
            action: 'Complete the privacy impact assessment and the cross-border transfer assessment (FD-008), ' +
                'and connect a managed key store instead of a derived key.',
            blocks: true,
        },
        {
            ref: 'R-09', category: 'accounting', title: 'Ledger and transaction state diverging',
            description: 'A transaction reaches a state with accounting consequences without its journal being posted.',
            il: 'unlikely', ii: 'major',
            controls: 'State transitions and journal postings occur in one database transaction; the ' +
                'transaction-to-ledger reconciliation checks required journals per state daily; the service ' +
                'refuses to start if the trial balance does not net to zero.',
            status: 'implemented_tested', rl: 'rare', ri: 'major',
            owner: 'Engineering / Finance', treatment: 'mitigate',
            action: 'None outstanding.',
            blocks: false,
        },
        {
            ref: 'R-10', category: 'fx', title: 'Unhedged currency exposure',
            description: 'An obligation is converted without the matching liquidity being positioned, leaving EKORails ' +
                'exposed to rate movement.',
            il: 'possible', ii: 'moderate',
            controls: 'Conversion and positioning post through an FX clearing account that must return to zero; the ' +
                'currency-position reconciliation reports any residual balance as a break.',
            status: 'implemented_tested', rl: 'unlikely', ri: 'moderate',
            owner: 'Treasury', treatment: 'mitigate',
            action: 'Agree an exposure limit and an escalation path with the FX partner once contracted.',
            blocks: false,
        },
        {
            ref: 'R-11', category: 'operational', title: 'Alert fatigue in compliance review',
            description: 'Every transaction currently requires manual review because the corridor is a placeholder. ' +
                'At volume this trains analysts to clear alerts without reading them.',
            il: 'likely', ii: 'major',
            controls: 'Rules carry an explicit false-positive assessment; the compliance report tracks trigger rates ' +
                'and decision times per rule so drift is visible.',
            status: 'implemented_untested', rl: 'possible', ri: 'major',
            owner: 'Compliance', treatment: 'mitigate',
            action: 'Resolve FD-002 so genuinely clean transactions can auto-clear, and review trigger rates ' +
                'weekly during the pilot.',
            blocks: false,
        },
        {
            ref: 'R-12', category: 'cyber', title: 'Document-borne malware',
            description: 'A customer uploads a document containing active content or malware, which reaches a ' +
                'compliance analyst\'s machine.',
            il: 'possible', ii: 'major',
            controls: 'Strict file-type allowlist; magic-byte verification against the declared type; refusal of ' +
                'PDFs containing JavaScript, launch actions or embedded files; content hashing.',
            status: 'implemented_untested', rl: 'possible', ri: 'major',
            owner: 'Engineering / Security', treatment: 'mitigate',
            action: 'CONNECT A REAL ANTIVIRUS SERVICE. The current checks are structural only and are explicitly ' +
                'not antivirus. This is a named gap.',
            blocks: true,
        },
        {
            ref: 'R-13', category: 'operational', title: 'Single-instance operational limits',
            description: 'Rate limiting is in-process and the background worker is single-process. Neither is safe ' +
                'across multiple instances.',
            il: 'almost_certain', ii: 'moderate',
            controls: 'Documented; the job table supports a distributed lock but no shared store is deployed.',
            status: 'documented_only', rl: 'likely', ri: 'moderate',
            owner: 'Engineering', treatment: 'mitigate',
            action: 'Deploy a shared cache for rate limiting and a distributed lock for the worker before scale-out.',
            blocks: false,
        },
        {
            ref: 'R-14', category: 'operational', title: 'Backup restoration has never been tested',
            description: 'Backups that have not been restored are not backups. No restoration has been performed for ' +
                'this system.',
            il: 'possible', ii: 'critical',
            controls: 'A restoration test procedure is written and a test exists; it has not been run against real infrastructure.',
            status: 'documented_only', rl: 'possible', ri: 'critical',
            owner: 'Engineering', treatment: 'mitigate',
            action: 'Perform and evidence a full restoration test, including transaction-history verification. Release gate EKORAILS_GATE_DR_TESTED depends on it.',
            blocks: true,
        },
        {
            ref: 'R-15', category: 'reputational', title: 'Unsupported claims in external material',
            description: 'Marketing or pitch material describes capabilities or regulatory status the system does not have.',
            il: 'likely', ii: 'severe',
            controls: 'A claims lint runs in CI over user-facing strings in this repository.',
            status: 'implemented_tested', rl: 'possible', ri: 'severe',
            owner: 'Founder', treatment: 'mitigate',
            action: 'The lint cannot police a slide deck. Apply the same word list to all external material by ' +
                'review before publication.',
            blocks: false,
        },
        {
            ref: 'R-16', category: 'concentration', title: 'Key-person dependency',
            description: 'A single founder currently holds the product, compliance and technical knowledge of this system.',
            il: 'almost_certain', ii: 'major',
            controls: 'The Founder Learning Center, the decision log, the build journal and extensive in-code ' +
                'documentation exist specifically to reduce this.',
            status: 'implemented_untested', rl: 'likely', ri: 'major',
            owner: 'Founder', treatment: 'mitigate',
            action: 'Appoint a named compliance officer and a second engineer before the pilot begins.',
            blocks: true,
        },
    ];
    let count = 0;
    for (const r of risks) {
        const result = await db.query(`INSERT INTO risk_register_entry (
         risk_ref, category, title, description, inherent_likelihood, inherent_impact,
         existing_controls, control_status, residual_likelihood, residual_impact,
         owner, treatment, further_action, blocks_pilot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (risk_ref) DO NOTHING`, [
            r.ref, r.category, r.title, r.description, r.il, r.ii, r.controls,
            r.status, r.rl, r.ri, r.owner, r.treatment, r.action, r.blocks,
        ]);
        count += result.rowCount ?? 0;
    }
    return count;
}
export async function seedBuildJournal(db) {
    const entries = [
        {
            milestone: 'Phase 0 — Source-of-truth review',
            date: '2026-08-20',
            built: 'A complete traceability review of the 22 facts the CBN filing was supposed to control, a ' +
                'code-enforced regulatory boundary, a data classification, a risk register and nine founder ' +
                'decisions.',
            changed: 'Established the placeholder regime: because the filing was unavailable, no regulatory or ' +
                'commercial fact has been invented anywhere in the codebase.',
            test: 'Read docs/00-source-of-truth-review.md. Call GET /api/system/regulatory-boundary and confirm ' +
                'every unresolved fact is named as unresolved. Run `npm run lint:claims`.',
            simulated: 'Nothing yet — this milestone produced analysis, not running software.',
            limitations: 'The controlling document is genuinely absent. Thirteen of twenty-two controlled facts are ' +
                'fully unresolved.',
            open: 'FD-001 through FD-009, all awaiting approval.',
            risks: 'R-01 (operating outside approved scope) and R-02 (appearing to perform a licensed activity).',
            questions: 'Can you attach the final CBN Regulatory Sandbox application to this repository? Until then ' +
                'no transaction can auto-clear compliance and the pilot cannot start.',
        },
        {
            milestone: 'Phase 1 — Foundations',
            date: '2026-08-20',
            built: 'PostgreSQL schema across eleven migrations: fixed-precision money domains, append-only ' +
                'guards, a deferred constraint trigger enforcing per-currency journal balance, a hash-chained ' +
                'audit trail with SQL-side verification, row-level security with FORCE on every ' +
                'customer-data table, and least-privilege grants. Authentication with scrypt, AES-256-GCM ' +
                'field encryption and RFC 6238 TOTP with a replay guard. Nine roles with explicit denials.',
            changed: 'Integrity moved from the application layer into the database. An application-level ' +
                'administrator now has no SQL privilege with which to alter an audit, ledger or compliance record.',
            test: './scripts/db-reset.sh then npm test. See audit.immutability, ledger.immutability and ' +
                'isolation tests specifically.',
            simulated: 'None. This layer is real.',
            limitations: 'No external identity provider is connected. Rate limiting is in-process and unsafe across ' +
                'instances (R-13).',
            open: 'FD-010 (framework choice) recorded for technical due diligence.',
            risks: 'R-07 (insider record alteration) reduced to rare by database-level controls.',
            questions: 'Do you want an external identity provider (OIDC) before the pilot, or is built-in ' +
                'authentication with mandatory MFA acceptable for a controlled participant group?',
        },
        {
            milestone: 'Phases 2 to 5 — Onboarding, transactions, settlement, reconciliation and reporting',
            date: '2026-08-20',
            built: 'KYB onboarding with beneficial ownership and screening; a 22-rule compliance engine writing ' +
                'reproducible immutable evaluations; beneficiaries with automatic approval invalidation on ' +
                'material change; a double-entry ledger with FX clearing; an auditable FX quotation engine; ' +
                'a 22-state settlement machine where every edge is declared and guarded; partner simulators ' +
                'covering eleven failure scenarios with idempotency; six reconciliation run types; exception ' +
                'management with four-eyes closure; eight reports exportable as CSV, XLSX and PDF; and the ' +
                'Founder Learning Center.',
            changed: 'The system now runs a complete transaction lifecycle end to end, including its failure modes.',
            test: 'npm run seed, then sign in as each demonstration user. Use the guided demonstration in the ' +
                'Founder Learning Center. Inject a failure scenario through the administration console and ' +
                'watch the ledger, the exception queue and the reconciliation run respond.',
            simulated: 'Every partner. Funding, FX execution, settlement and the beneficiary credit are all ' +
                'simulated. Screening uses a clearly labelled fictional list. Email and SMS have no ' +
                'transport configured and say so in the delivery record.',
            limitations: 'No document blob store and no antivirus service (R-12). No statement file ingestion. ' +
                'Settlement finality is out of scope by design.',
            open: 'All nine founder decisions remain unapproved.',
            risks: 'R-11 (alert fatigue) is new and follows directly from the corridor placeholder: every ' +
                'transaction currently requires manual review.',
            questions: 'Review the twenty-two compliance rules in the Learning Center. Are any missing for your ' +
                'corridor, and are any so noisy they would be cleared without being read?',
        },
    ];
    let count = 0;
    for (const e of entries) {
        const existing = await db.query('SELECT 1 FROM build_journal_entry WHERE milestone = $1', [e.milestone]);
        if (existing.rows.length > 0)
            continue;
        await db.query(`INSERT INTO build_journal_entry (
         milestone, entry_date, what_was_built, what_changed, how_to_test, still_simulated,
         known_limitations, open_decisions, new_risks, questions_for_founder
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [e.milestone, e.date, e.built, e.changed, e.test, e.simulated, e.limitations, e.open, e.risks, e.questions]);
        count += 1;
    }
    return count;
}
//# sourceMappingURL=learning.js.map