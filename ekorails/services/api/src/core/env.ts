/**
 * Environment mode and the release gates on live money movement.
 *
 * The single most important rule in this file: the environment mode is read from the
 * process environment at startup and is then frozen. There is no API route, no admin
 * screen, no database row and no feature flag that can change it. A user interface
 * cannot activate live mode because the user interface is not consulted.
 *
 * PRODUCTION additionally requires nine independent release gates to be explicitly
 * true in the process environment. All nine default to false. Nothing in this codebase
 * sets any of them. Booting PRODUCTION with any gate unmet throws and the process exits.
 */

export type EnvironmentMode = 'DEMO' | 'SANDBOX' | 'CONTROLLED_PILOT' | 'PRODUCTION';

export const ENVIRONMENT_BANNER = 'SANDBOX ENVIRONMENT. NO LIVE FUNDS.';

/**
 * Every gate that must be independently satisfied before this software may move real
 * money. Each maps to a real-world artefact a reviewer can ask to see. None of them is
 * a checkbox someone can tick inside the product.
 */
export const RELEASE_GATES = [
  {
    key: 'EKORAILS_GATE_REGULATORY_APPROVAL',
    description: 'Written regulatory approval to operate the pilot has been received and filed.',
    evidence: 'Approval letter reference and date, attached to the pilot readiness report.',
  },
  {
    key: 'EKORAILS_GATE_LICENCE_VERIFIED',
    description: 'Every licensed activity in the flow is performed by a partner whose licence has been independently verified.',
    evidence: 'Licence register check per partner, dated within 90 days.',
  },
  {
    key: 'EKORAILS_GATE_PARTNER_CONTRACTS',
    description: 'Executed contracts are in place with every partner in the settlement chain.',
    evidence: 'Signed agreements, including settlement finality and liability terms.',
  },
  {
    key: 'EKORAILS_GATE_SECURITY_REVIEW',
    description: 'Independent security review and penetration test completed, with all critical and high findings closed.',
    evidence: 'Test report, remediation evidence, retest confirmation.',
  },
  {
    key: 'EKORAILS_GATE_PRIVACY_REVIEW',
    description: 'Privacy impact assessment completed and cross-border transfer basis documented.',
    evidence: 'Signed PIA and transfer assessment.',
  },
  {
    key: 'EKORAILS_GATE_OPERATIONAL_CONTROLS',
    description: 'Operating procedures, four-eyes controls and segregation of duties are live and staffed.',
    evidence: 'Procedures signed off; named role holders; access review completed.',
  },
  {
    key: 'EKORAILS_GATE_DR_TESTED',
    description: 'Backup restoration and disaster recovery have been tested end to end, not merely configured.',
    evidence: 'Restoration test record showing recovered transaction history verified against a known baseline.',
  },
  {
    key: 'EKORAILS_GATE_RECONCILIATION_SIGNOFF',
    description: 'Daily reconciliation has run clean against real partner statements for an agreed observation period.',
    evidence: 'Reconciliation sign-off sheets for the observation period.',
  },
  {
    key: 'EKORAILS_GATE_BOARD_APPROVAL',
    description: 'Internal governance approval to commence live money movement.',
    evidence: 'Board or equivalent minute.',
  },
] as const;

export type ReleaseGateKey = (typeof RELEASE_GATES)[number]['key'];

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

export interface EnvironmentDescriptor {
  readonly mode: EnvironmentMode;
  /** True only when real money may move. False in every mode this build supports. */
  readonly liveFundsEnabled: boolean;
  /** Settlement is simulated unless live funds are enabled. */
  readonly settlementIsSimulated: boolean;
  readonly banner: string;
  readonly gates: ReadonlyArray<{ key: string; met: boolean; description: string; evidence: string }>;
  readonly unmetGates: readonly string[];
}

function parseMode(raw: string | undefined): EnvironmentMode {
  const value = (raw ?? 'DEMO').trim().toUpperCase();
  if (value === 'DEMO' || value === 'SANDBOX' || value === 'CONTROLLED_PILOT' || value === 'PRODUCTION') {
    return value;
  }
  if (value === 'TEST') return 'DEMO';
  throw new EnvironmentError(
    `Unknown EKORAILS_ENV_MODE "${raw}". Valid values: DEMO, SANDBOX, CONTROLLED_PILOT, PRODUCTION.`,
  );
}

function gateIsMet(key: string, source: NodeJS.ProcessEnv): boolean {
  // Deliberately strict: only the exact string 'true' counts. '1', 'yes' and 'TRUE'
  // do not, so a gate cannot be met by accident or by a sloppy deployment script.
  return source[key] === 'true';
}

export function describeEnvironment(source: NodeJS.ProcessEnv = process.env): EnvironmentDescriptor {
  const mode = parseMode(source['EKORAILS_ENV_MODE']);

  const gates = RELEASE_GATES.map((g) => ({
    key: g.key,
    description: g.description,
    evidence: g.evidence,
    met: gateIsMet(g.key, source),
  }));
  const unmetGates = gates.filter((g) => !g.met).map((g) => g.key);

  // Live funds require BOTH production mode and every gate. There is no other route.
  const liveFundsEnabled = mode === 'PRODUCTION' && unmetGates.length === 0;

  if (mode === 'PRODUCTION' && unmetGates.length > 0) {
    throw new EnvironmentError(
      `Refusing to start in PRODUCTION: ${unmetGates.length} release gate(s) are not met.\n` +
      unmetGates.map((k) => `  - ${k}: ${RELEASE_GATES.find((g) => g.key === k)!.description}`).join('\n') +
      `\n\nProduction money movement stays disabled until every gate is satisfied. ` +
      `This check exists so that the absence of an approval is a startup failure, not a silent risk.`,
    );
  }

  if (mode === 'CONTROLLED_PILOT') {
    // A controlled pilot still moves no money in this build: it exercises the same
    // simulators against approved test participants. Stated explicitly so nobody
    // reads "CONTROLLED_PILOT" as "live".
    if (source['EKORAILS_PILOT_AUTHORISATION_REF'] === undefined) {
      throw new EnvironmentError(
        'Refusing to start in CONTROLLED_PILOT without EKORAILS_PILOT_AUTHORISATION_REF. ' +
        'A controlled pilot requires a recorded written authorisation reference.',
      );
    }
  }

  return {
    mode,
    liveFundsEnabled,
    settlementIsSimulated: !liveFundsEnabled,
    banner: ENVIRONMENT_BANNER,
    gates,
    unmetGates,
  };
}

let cached: EnvironmentDescriptor | null = null;

/** The frozen environment for this process. Computed once, never re-read. */
export function environment(): EnvironmentDescriptor {
  if (cached === null) {
    cached = Object.freeze(describeEnvironment());
  }
  return cached;
}

/**
 * Called by any code path that would move real value. In this build it always throws,
 * because `liveFundsEnabled` is false in every supported configuration. It is placed at
 * the boundary rather than relied upon implicitly, so a future live adapter has to pass
 * through it.
 */
export function assertLiveMoneyPermitted(operation: string): void {
  const env = environment();
  if (!env.liveFundsEnabled) {
    throw new EnvironmentError(
      `LIVE_FUNDS_DISABLED: "${operation}" would move real money. ` +
      `Environment is ${env.mode}; ${env.unmetGates.length} release gate(s) unmet. ` +
      `This build settles through simulators only.`,
    );
  }
}

/** For tests and the /system/environment endpoint. Never used to make decisions. */
export function environmentSummary(): Record<string, unknown> {
  const env = environment();
  return {
    mode: env.mode,
    banner: env.banner,
    live_funds_enabled: env.liveFundsEnabled,
    settlement_is_simulated: env.settlementIsSimulated,
    release_gates_total: env.gates.length,
    release_gates_met: env.gates.filter((g) => g.met).length,
    unmet_release_gates: env.unmetGates,
    mode_is_immutable_at_runtime: true,
    note:
      'The environment mode is process configuration. It cannot be changed through the API, ' +
      'the user interface, a feature flag or a database row.',
  };
}
