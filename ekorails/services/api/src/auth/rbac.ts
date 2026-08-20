/**
 * Role-based access control.
 *
 * The nine roles from the specification, with their permissions expressed as data. The
 * same structure is seeded into the `role` / `permission` / `role_permission` tables so
 * an auditor can read the effective matrix out of the database and diff it against
 * docs/08-role-permission-matrix.md without trusting this file.
 *
 * Two ideas do the heavy lifting:
 *
 *  - Permissions are additive, but SEPARATIONS are subtractive and win. A user who
 *    somehow holds both Compliance Analyst and Treasury Operator still cannot clear a
 *    compliance alert on a transaction they routed, because the separation rule is
 *    evaluated against the action's context, not against the permission set.
 *
 *  - "Cannot" statements from the brief are encoded explicitly rather than left as the
 *    absence of a permission. An absent permission is an oversight waiting to happen;
 *    an explicit denial is a control.
 */

export const PERMISSIONS = {
  // Organisation and onboarding
  'org.profile.read': { domain: 'organisation', sensitive: false, description: 'View own organisation profile' },
  'org.profile.write': { domain: 'organisation', sensitive: false, description: 'Create and edit own organisation profile' },
  'org.kyb.submit': { domain: 'organisation', sensitive: false, description: 'Submit KYB information for review' },
  'org.users.manage': { domain: 'organisation', sensitive: true, description: 'Add and remove authorised users within own organisation' },
  'org.read.any': { domain: 'organisation', sensitive: true, description: 'View any organisation' },
  'org.suspend': { domain: 'organisation', sensitive: true, description: 'Suspend an organisation or user' },

  // Beneficiaries
  'beneficiary.read': { domain: 'beneficiary', sensitive: false, description: 'View own beneficiaries' },
  'beneficiary.write': { domain: 'beneficiary', sensitive: false, description: 'Add and edit own beneficiaries' },
  'beneficiary.review': { domain: 'beneficiary', sensitive: true, description: 'Approve or reject a beneficiary' },

  // Documents
  'document.upload': { domain: 'document', sensitive: false, description: 'Upload documents' },
  'document.read': { domain: 'document', sensitive: false, description: 'View and download own documents' },
  'document.read.any': { domain: 'document', sensitive: true, description: 'View documents across organisations' },
  'document.extraction.confirm': { domain: 'document', sensitive: false, description: 'Confirm AI-proposed document fields' },

  // Transactions
  'txn.read': { domain: 'transaction', sensitive: false, description: 'View own transactions' },
  'txn.read.any': { domain: 'transaction', sensitive: true, description: 'View transactions across organisations' },
  'txn.initiate': { domain: 'transaction', sensitive: false, description: 'Initiate a transaction' },
  'txn.approve': { domain: 'transaction', sensitive: true, description: 'Provide business dual authorisation' },
  'txn.cancel': { domain: 'transaction', sensitive: false, description: 'Cancel own transaction before funding' },
  'txn.suspend': { domain: 'transaction', sensitive: true, description: 'Suspend a transaction pending investigation' },

  // FX and treasury
  'fx.quote.request': { domain: 'fx', sensitive: false, description: 'Request an FX quote' },
  'fx.quote.accept': { domain: 'fx', sensitive: true, description: 'Accept an FX quote on behalf of the customer' },
  'fx.quote.issue': { domain: 'fx', sensitive: true, description: 'Issue or reject an FX quote as treasury' },
  'treasury.funding.review': { domain: 'treasury', sensitive: true, description: 'Review funding status' },
  'treasury.settlement.route': { domain: 'treasury', sensitive: true, description: 'Route a settlement to a partner' },
  'treasury.liquidity.read': { domain: 'treasury', sensitive: false, description: 'Monitor liquidity positions' },
  'treasury.exception.read': { domain: 'treasury', sensitive: false, description: 'Review settlement exceptions' },

  // Compliance
  'compliance.case.read': { domain: 'compliance', sensitive: true, description: 'View compliance cases' },
  'compliance.kyb.review': { domain: 'compliance', sensitive: true, description: 'Review a KYB case' },
  'compliance.screening.review': { domain: 'compliance', sensitive: true, description: 'Review sanctions, PEP and adverse-media results' },
  'compliance.alert.clear': { domain: 'compliance', sensitive: true, description: 'Clear or escalate an alert with a written reason' },
  'compliance.information.request': { domain: 'compliance', sensitive: false, description: 'Request additional information from a customer' },
  'compliance.case.escalate': { domain: 'compliance', sensitive: true, description: 'Escalate a case to a manager' },
  'compliance.highrisk.approve': { domain: 'compliance', sensitive: true, description: 'Approve a high-risk case' },
  'compliance.rules.configure': { domain: 'compliance', sensitive: true, description: 'Propose risk-rule changes within authorised limits' },
  'compliance.decision.review': { domain: 'compliance', sensitive: true, description: 'Review an analyst decision' },
  'compliance.report.file': { domain: 'compliance', sensitive: true, description: 'File or export a regulatory report' },

  // Ledger and finance
  'ledger.read': { domain: 'ledger', sensitive: true, description: 'View ledger accounts and balances' },
  'ledger.post.adjustment': { domain: 'ledger', sensitive: true, description: 'Post a reconciliation adjustment or reversal' },
  'recon.run': { domain: 'finance', sensitive: true, description: 'Run reconciliation' },
  'recon.break.investigate': { domain: 'finance', sensitive: true, description: 'Investigate a reconciliation break' },
  'recon.break.approve': { domain: 'finance', sensitive: true, description: 'Approve the closure of a reconciliation break' },

  // Reporting
  'report.own.read': { domain: 'reporting', sensitive: false, description: 'View and export own organisation reports' },
  'report.operational.read': { domain: 'reporting', sensitive: false, description: 'View operational reports' },
  'report.compliance.read': { domain: 'reporting', sensitive: true, description: 'View compliance reports' },
  'report.financial.read': { domain: 'reporting', sensitive: true, description: 'View financial reports' },
  'report.pilot.read': { domain: 'reporting', sensitive: false, description: 'View pilot reports' },

  // Cases
  'case.support.raise': { domain: 'cases', sensitive: false, description: 'Raise a support case' },
  'case.support.manage': { domain: 'cases', sensitive: false, description: 'Own and progress support cases' },

  // Audit and oversight
  'audit.read': { domain: 'audit', sensitive: true, description: 'Read the audit trail' },
  'audit.export': { domain: 'audit', sensitive: true, description: 'Export the audit trail' },
  'controls.read': { domain: 'audit', sensitive: false, description: 'View system controls and their status' },
  'pii.unmask': { domain: 'audit', sensitive: true, description: 'View unmasked personal data where specifically authorised' },

  // Administration
  'admin.users.manage': { domain: 'administration', sensitive: true, description: 'Manage users across the platform' },
  'admin.roles.manage': { domain: 'administration', sensitive: true, description: 'Manage roles and permissions' },
  'admin.config.propose': { domain: 'administration', sensitive: true, description: 'Propose system configuration changes' },
  'admin.config.approve': { domain: 'administration', sensitive: true, description: 'Approve system configuration changes' },
  'admin.integration.manage': { domain: 'administration', sensitive: true, description: 'Manage integration and adapter settings' },
  'admin.simulation.control': { domain: 'administration', sensitive: true, description: 'Control partner simulator scenarios' },

  // Break glass
  'breakglass.request': { domain: 'break_glass', sensitive: true, description: 'Request emergency access' },
  'breakglass.approve': { domain: 'break_glass', sensitive: true, description: 'Approve an emergency access request' },
  'breakglass.use': { domain: 'break_glass', sensitive: true, description: 'Exercise approved emergency access' },

  // Learning centre
  'learning.read': { domain: 'learning', sensitive: false, description: 'Use the Founder Learning Center' },
  'learning.decision.approve': { domain: 'learning', sensitive: true, description: 'Approve a founder decision in the decision log' },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export type RoleCode =
  | 'business_initiator'
  | 'business_approver'
  | 'compliance_analyst'
  | 'compliance_manager'
  | 'treasury_operator'
  | 'finance_analyst'
  | 'auditor_regulator'
  | 'system_administrator'
  | 'super_administrator';

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  realm: 'business' | 'backoffice' | 'external' | 'platform';
  requiresStepUp: boolean;
  isBreakGlass: boolean;
  permissions: readonly Permission[];
  /** Statements from the brief that must hold regardless of permission arithmetic. */
  explicitDenials: readonly string[];
}

export const ROLES: Record<RoleCode, RoleDefinition> = {
  business_initiator: {
    code: 'business_initiator',
    name: 'Business Initiator',
    description: 'Manages the business profile and initiates transactions on its behalf.',
    realm: 'business',
    requiresStepUp: false,
    isBreakGlass: false,
    permissions: [
      'org.profile.read', 'org.profile.write', 'org.kyb.submit', 'org.users.manage',
      'beneficiary.read', 'beneficiary.write',
      'document.upload', 'document.read', 'document.extraction.confirm',
      'txn.read', 'txn.initiate', 'txn.cancel',
      'fx.quote.request',
      'report.own.read',
      'case.support.raise',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot approve a compliance review of its own organisation.',
      'Cannot create, edit or delete a ledger entry.',
      'Cannot override a transaction limit.',
      'Cannot read any data belonging to another organisation.',
      'Cannot provide the dual authorisation for a transaction it initiated.',
    ],
  },
  business_approver: {
    code: 'business_approver',
    name: 'Business Approver',
    description: 'Provides the second authorisation on transactions initiated by colleagues.',
    realm: 'business',
    requiresStepUp: true,
    isBreakGlass: false,
    permissions: [
      'org.profile.read',
      'beneficiary.read',
      'document.read',
      'txn.read', 'txn.approve',
      'fx.quote.request', 'fx.quote.accept',
      'report.own.read',
      'case.support.raise',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot approve a transaction it initiated itself.',
      'Cannot clear a compliance alert.',
      'Cannot read any data belonging to another organisation.',
    ],
  },
  compliance_analyst: {
    code: 'compliance_analyst',
    name: 'Compliance Analyst',
    description: 'Reviews KYB cases, screening results and transaction alerts.',
    realm: 'backoffice',
    requiresStepUp: false,
    isBreakGlass: false,
    permissions: [
      'org.read.any', 'document.read.any', 'txn.read.any',
      'beneficiary.review',
      'compliance.case.read', 'compliance.kyb.review', 'compliance.screening.review',
      'compliance.alert.clear', 'compliance.information.request', 'compliance.case.escalate',
      'txn.suspend',
      'report.compliance.read', 'report.operational.read', 'report.pilot.read',
      'case.support.manage',
      'audit.read',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot approve a high-risk case; that requires a Compliance Manager.',
      'Cannot approve its own escalation.',
      'Cannot change a risk rule.',
      'Cannot route a settlement or accept an FX quote.',
    ],
  },
  compliance_manager: {
    code: 'compliance_manager',
    name: 'Compliance Manager',
    description: 'Approves high-risk cases, reviews analyst decisions and files regulatory reports.',
    realm: 'backoffice',
    requiresStepUp: true,
    isBreakGlass: false,
    permissions: [
      'org.read.any', 'org.suspend', 'document.read.any', 'txn.read.any',
      'beneficiary.review',
      'compliance.case.read', 'compliance.kyb.review', 'compliance.screening.review',
      'compliance.alert.clear', 'compliance.information.request', 'compliance.case.escalate',
      'compliance.highrisk.approve', 'compliance.rules.configure', 'compliance.decision.review',
      'compliance.report.file',
      'txn.suspend',
      'report.compliance.read', 'report.operational.read', 'report.pilot.read', 'report.financial.read',
      'case.support.manage',
      'audit.read', 'audit.export', 'pii.unmask',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot review its own analyst decision.',
      'Cannot post a ledger entry.',
      'Cannot set a risk threshold outside the range authorised by configuration.',
    ],
  },
  treasury_operator: {
    code: 'treasury_operator',
    name: 'Treasury and Settlement Operator',
    description: 'Manages funding, FX quotes, settlement routing and liquidity.',
    realm: 'backoffice',
    requiresStepUp: true,
    isBreakGlass: false,
    permissions: [
      'org.read.any', 'txn.read.any',
      'fx.quote.issue',
      'treasury.funding.review', 'treasury.settlement.route',
      'treasury.liquidity.read', 'treasury.exception.read',
      'ledger.read',
      'recon.run',
      'report.operational.read', 'report.financial.read', 'report.pilot.read',
      'case.support.manage',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot clear a compliance alert without compliance authorisation.',
      'Cannot approve a KYB case.',
      'Cannot release a settlement for a transaction whose compliance review is outstanding.',
      'Cannot post an unrestricted ledger entry; only reconciliation adjustments, and only with finance approval.',
    ],
  },
  finance_analyst: {
    code: 'finance_analyst',
    name: 'Finance and Reconciliation Analyst',
    description: 'Owns the ledger, daily reconciliation and financial reporting.',
    realm: 'backoffice',
    requiresStepUp: false,
    isBreakGlass: false,
    permissions: [
      'txn.read.any',
      'ledger.read', 'ledger.post.adjustment',
      'recon.run', 'recon.break.investigate', 'recon.break.approve',
      'treasury.liquidity.read', 'treasury.exception.read',
      'report.financial.read', 'report.operational.read', 'report.pilot.read',
      'case.support.manage',
      'audit.read',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot clear a compliance alert.',
      'Cannot route a settlement.',
      'Cannot approve the closure of a break it investigated itself.',
      'Cannot delete or edit a journal; corrections are made by reversal.',
    ],
  },
  auditor_regulator: {
    code: 'auditor_regulator',
    name: 'Auditor or Regulator',
    description: 'Read-only oversight across transactions, decisions, ledger, audit and controls.',
    realm: 'external',
    requiresStepUp: false,
    isBreakGlass: false,
    permissions: [
      'org.read.any', 'txn.read.any',
      'compliance.case.read',
      'ledger.read',
      'audit.read', 'audit.export', 'controls.read',
      'report.operational.read', 'report.compliance.read', 'report.financial.read', 'report.pilot.read',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot write anything, anywhere. Every route is read-only for this role.',
      'Sees personal data masked unless a specific unmasking authorisation is recorded.',
      'Cannot download a customer document without an access reason, which is audited.',
    ],
  },
  system_administrator: {
    code: 'system_administrator',
    name: 'System Administrator',
    description: 'Manages users, roles, configuration and integrations.',
    realm: 'platform',
    requiresStepUp: true,
    isBreakGlass: false,
    permissions: [
      'admin.users.manage', 'admin.roles.manage',
      'admin.config.propose', 'admin.integration.manage', 'admin.simulation.control',
      'controls.read', 'audit.read',
      'breakglass.request',
      'learning.read',
    ],
    explicitDenials: [
      'Cannot edit transaction history.',
      'Cannot edit or delete a compliance decision.',
      'Cannot edit or delete a ledger record.',
      'Cannot edit or delete an audit record. The database role has no privilege to do so.',
      'Cannot approve its own configuration change.',
      'Cannot read customer documents or personal data.',
    ],
  },
  super_administrator: {
    code: 'super_administrator',
    name: 'Super Administrator',
    description: 'Emergency access only. Time-limited, separately approved, fully audited.',
    realm: 'platform',
    requiresStepUp: true,
    isBreakGlass: true,
    permissions: [
      'admin.users.manage', 'admin.roles.manage',
      'admin.config.propose', 'admin.config.approve', 'admin.integration.manage',
      'org.suspend', 'controls.read', 'audit.read', 'audit.export',
      'breakglass.request', 'breakglass.approve', 'breakglass.use',
      'learning.read', 'learning.decision.approve',
    ],
    explicitDenials: [
      'Has no standing access. Every session requires an approved, time-limited break-glass grant.',
      'Cannot edit transaction history, compliance decisions, ledger records or audit records.',
      'Cannot approve its own break-glass request.',
    ],
  },
};

/**
 * Separation-of-duties rules. Evaluated against the action AND its context, so they
 * catch the case a permission set cannot: the right role doing the wrong thing to a
 * record it is already involved in.
 */
export interface SeparationContext {
  userId: string;
  /** Users already involved in this record, by the capacity in which they acted. */
  involvedAs?: {
    initiator?: string | null;
    analyst?: string | null;
    investigator?: string | null;
    proposer?: string | null;
    requester?: string | null;
    router?: string | null;
  };
}

export interface SeparationRule {
  code: string;
  action: string;
  description: string;
  violated: (ctx: SeparationContext) => boolean;
}

export const SEPARATION_RULES: readonly SeparationRule[] = [
  {
    code: 'SOD_TXN_SELF_APPROVAL',
    action: 'txn.approve',
    description: 'A user cannot provide the dual authorisation for a transaction they initiated.',
    violated: (c) => c.involvedAs?.initiator === c.userId,
  },
  {
    code: 'SOD_COMPLIANCE_SELF_REVIEW',
    action: 'compliance.decision.review',
    description: 'A manager cannot review their own analyst decision.',
    violated: (c) => c.involvedAs?.analyst === c.userId,
  },
  {
    code: 'SOD_BREAK_SELF_APPROVAL',
    action: 'recon.break.approve',
    description: 'A break cannot be approved for closure by the person who investigated it.',
    violated: (c) => c.involvedAs?.investigator === c.userId,
  },
  {
    code: 'SOD_CONFIG_SELF_APPROVAL',
    action: 'admin.config.approve',
    description: 'A configuration change cannot be approved by the person who proposed it.',
    violated: (c) => c.involvedAs?.proposer === c.userId,
  },
  {
    code: 'SOD_BREAKGLASS_SELF_APPROVAL',
    action: 'breakglass.approve',
    description: 'An emergency access request cannot be approved by the requester.',
    violated: (c) => c.involvedAs?.requester === c.userId,
  },
  {
    code: 'SOD_TREASURY_COMPLIANCE',
    action: 'compliance.alert.clear',
    description: 'A treasury operator who routed a settlement cannot then clear its compliance alert.',
    violated: (c) => c.involvedAs?.router === c.userId,
  },
];

export function permissionsForRoles(roleCodes: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const code of roleCodes) {
    const role = ROLES[code as RoleCode];
    if (!role) continue;
    for (const p of role.permissions) out.add(p);
  }
  return out;
}

export function realmsForRoles(roleCodes: readonly string[]): Set<RoleDefinition['realm']> {
  const out = new Set<RoleDefinition['realm']>();
  for (const code of roleCodes) {
    const role = ROLES[code as RoleCode];
    if (role) out.add(role.realm);
  }
  return out;
}

/**
 * A user whose roles are all business-realm is confined to their own organisation
 * (database scope 'org'). Anyone holding a back-office, external or platform role
 * reads across organisations (scope 'global'), subject to per-route permissions.
 */
export function databaseScopeForRoles(roleCodes: readonly string[]): 'org' | 'global' {
  const realms = realmsForRoles(roleCodes);
  const crossOrg: Array<RoleDefinition['realm']> = ['backoffice', 'external', 'platform'];
  return crossOrg.some((r) => realms.has(r)) ? 'global' : 'org';
}

/** True where any of the user's roles demands re-authentication for sensitive actions. */
export function requiresStepUp(roleCodes: readonly string[]): boolean {
  return roleCodes.some((c) => ROLES[c as RoleCode]?.requiresStepUp === true);
}

export function isReadOnlyRole(roleCodes: readonly string[]): boolean {
  return roleCodes.length > 0 && roleCodes.every((c) => ROLES[c as RoleCode]?.realm === 'external');
}

/** The masking profile that applies to a set of roles. Lower is more restrictive. */
export type MaskingProfile = 'full' | 'operational' | 'masked';

export function maskingProfileForRoles(roleCodes: readonly string[]): MaskingProfile {
  const perms = permissionsForRoles(roleCodes);
  if (perms.has('pii.unmask')) return 'full';
  if (roleCodes.some((c) => ROLES[c as RoleCode]?.realm === 'external')) return 'masked';
  if (roleCodes.some((c) => ROLES[c as RoleCode]?.realm === 'platform')) return 'masked';
  return 'operational';
}
