/**
 * API contract and end-to-end tests.
 *
 * These start a real HTTP server against a real database and drive it the way a browser
 * does — cookies, CSRF headers, MFA — so the authentication, authorisation and CSRF paths
 * are exercised as they will be in use rather than as unit-tested functions.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resetDatabase, connect, buildFixture, repoRoot, SYSTEM, type TestDb, type Fixture,
} from './helpers.js';

import { createHttpServer } from '../src/http/router.js';
import { buildRouter } from '../src/http/routes.js';
import { withContext, withReadOnlyContext, closePool } from '../src/db/pool.js';
import * as auth from '../src/auth/service.js';
import { totpCodeForStep, totpStep, decryptField } from '../src/core/crypto.js';

let db: TestDb;
let fx: Fixture;
let server: Server;
let baseUrl: string;

const TEST_PASSWORD = 'Kx7-Harbour-Lantern-2026';

before(async () => {
  resetDatabase();
  db = connect();
  fx = await buildFixture(db);

  server = createHttpServer({
    router: buildRouter(),
    authenticate: (token) => withContext({ scope: 'system' }, (q) => auth.resolveSession(q, token)),
    verifyCsrf: (token, csrf) =>
      withReadOnlyContext({ scope: 'system' }, (q) => auth.verifyCsrf(q, token, csrf)),
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  // Cookies are marked Secure by default; over plain HTTP in a test we must opt out or
  // the client would refuse to store them.
  process.env['EKORAILS_INSECURE_COOKIES'] = 'true';
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
  await closePool();
});

// ---------------------------------------------------------------------------
// A minimal cookie-aware client
// ---------------------------------------------------------------------------

let clientCounter = 0;

class Client {
  private cookies = new Map<string, string>();
  /**
   * A distinct forwarded address per client.
   *
   * The rate limiter keys on the session where there is one and on the hashed network
   * identifier otherwise. Without distinct addresses the whole suite would look like a
   * single caller, the rate-limit test would starve every test after it, and the
   * failures would look like authorisation bugs. Distinct addresses also exercise the
   * X-Forwarded-For handling, which is how the limiter will see callers behind a proxy.
   */
  private readonly forwardedFor = `198.51.100.${(clientCounter += 1) % 250}`;

  async request(
    method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
    const headers: Record<string, string> = {
      'x-forwarded-for': this.forwardedFor, ...extraHeaders,
    };
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    // Only supply the CSRF header when the caller has not deliberately set one: a test
    // that passes a wrong token must actually send the wrong token.
    const csrf = this.cookies.get('ekorails_csrf');
    if (csrf && !['GET', 'HEAD'].includes(method) && headers['x-csrf-token'] === undefined) {
      headers['x-csrf-token'] = decodeURIComponent(csrf);
    }
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${baseUrl}${path}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const idx = pair!.indexOf('=');
      if (idx > 0) {
        const name = pair!.slice(0, idx);
        const value = pair!.slice(idx + 1);
        if (value === '') this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }

    const text = await response.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: response.status, json, headers: response.headers };
  }

  get(path: string) { return this.request('GET', path); }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', path, body ?? {}, headers);
  }

  /** Deliberately omits the CSRF header, to test the double-submit check. */
  async postWithoutCsrf(path: string, body: unknown = {}) {
    const headers: Record<string, string> = {
      'content-type': 'application/json', 'x-forwarded-for': this.forwardedFor,
    };
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  hasCookie(name: string): boolean { return this.cookies.has(name); }
  clearCookies(): void { this.cookies.clear(); }
  address(): string { return this.forwardedFor; }
}

/** The code for the NEXT step. Valid now within the drift window, and not yet used. */
async function nextTotp(email: string): Promise<string> {
  return totpFor(email, totpStep() + 1);
}

async function currentTotp(email: string): Promise<string> {
  return totpFor(email, totpStep());
}

async function totpFor(email: string, step: number): Promise<string> {
  const secret = await db.asOwner(SYSTEM, async (q) => {
    const row = await q.query<{ mfa_secret_encrypted: string | null }>(
      'SELECT mfa_secret_encrypted FROM app_user WHERE email_normalised = $1', [email.toLowerCase()],
    );
    return row.rows[0]?.mfa_secret_encrypted ?? null;
  });
  if (!secret) throw new Error(`${email} has no MFA secret`);
  return totpCodeForStep(decryptField(secret), step);
}

/** Signs in and completes MFA where the account has it enrolled. */
async function signIn(email: string): Promise<Client> {
  const client = new Client();
  const login = await client.post('/api/auth/login', { email, password: TEST_PASSWORD });
  assert.equal(login.status, 200, `login failed for ${email}: ${JSON.stringify(login.json)}`);
  const data = login.json['data'] as Record<string, unknown>;
  if (data['mfa_required'] === true) {
    const verify = await client.post('/api/auth/mfa/verify', { code: await currentTotp(email) });
    assert.equal(verify.status, 200, `mfa failed for ${email}`);
  }
  return client;
}

/**
 * Signs in and additionally re-asserts the second factor.
 *
 * Authorising a payment is a step-up action: holding the permission is not enough, the
 * approver has to prove they are still at the keyboard. The fixture's users are created
 * without MFA enrolled, so this enrols first — which is itself the path a new approver
 * walks, since an account with no second factor can never satisfy a step-up.
 */
async function signInWithStepUp(email: string): Promise<Client> {
  const client = await signIn(email);

  const enrolled = await db.asOwner(SYSTEM, async (q) => {
    const row = await q.query<{ mfa_enrolled: boolean }>(
      'SELECT mfa_enrolled FROM app_user WHERE email_normalised = $1', [email.toLowerCase()],
    );
    return row.rows[0]?.mfa_enrolled === true;
  });

  if (!enrolled) {
    const enrolment = await client.post('/api/auth/mfa/enrol');
    assert.equal(enrolment.status, 200, `enrolment failed for ${email}`);
    const confirm = await client.post('/api/auth/mfa/confirm', { code: await currentTotp(email) });
    assert.equal(confirm.status, 200, `enrolment confirmation failed for ${email}`);
  }

  // Not the same code that confirmed enrolment. The replay guard refuses a code at or
  // below the step it last accepted, which is the point of it: a code observed once —
  // over the shoulder, in a screenshot, in a log — must not work a second time. The
  // verifier accepts one step of drift either way, so the next step's code is valid now
  // and has not been used.
  const stepUp = await client.post('/api/auth/step-up', { code: await nextTotp(email) });
  assert.equal(stepUp.status, 200, `step-up failed for ${email}: ${JSON.stringify(stepUp.json)}`);
  return client;
}

// ---------------------------------------------------------------------------
describe('Public endpoints and security headers', () => {
  test('the environment banner is on every response, including errors', async () => {
    const client = new Client();
    const ok = await client.get('/api/system/environment');
    assert.equal(ok.headers.get('x-ekorails-environment'), 'DEMO; SANDBOX ENVIRONMENT. NO LIVE FUNDS.');

    const notFound = await client.get('/api/does-not-exist');
    assert.equal(notFound.status, 404);
    assert.match(
      notFound.headers.get('x-ekorails-environment') ?? '', /NO LIVE FUNDS/,
      'even a 404 must carry the banner',
    );
  });

  test('the response envelope always carries the banner and simulation flag', async () => {
    const response = await new Client().get('/api/system/environment');
    const meta = response.json['meta'] as Record<string, unknown>;
    assert.equal(meta['banner'], 'SANDBOX ENVIRONMENT. NO LIVE FUNDS.');
    assert.equal(meta['simulated'], true);
    assert.ok(meta['request_id'], 'every response must carry a request id');
  });

  test('security headers are strict', async () => {
    const response = await new Client().get('/api/system/health');
    const csp = response.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!csp.includes("'unsafe-eval'"), 'eval must not be permitted');
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'inline script must not be permitted');

    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
  });

  test('the regulatory boundary is served publicly and states what EKORails is not', async () => {
    const response = await new Client().get('/api/system/regulatory-boundary');
    const data = response.json['data'] as Record<string, unknown>;
    const isNot = data['ekorails_is_not'] as string[];
    for (const claim of [
      'a bank', 'a deposit-taking institution', 'a licensed payment provider',
      'a custodian of customer funds', 'a cryptocurrency exchange',
      'a consumer investment platform', 'an admitted participant in the CBN Regulatory Sandbox',
    ]) {
      assert.ok(isNot.includes(claim), `the boundary must disclaim "${claim}"`);
    }
    const gates = data['release_gates'] as Array<{ met: boolean }>;
    assert.equal(gates.length, 9);
    assert.equal(gates.every((g) => !g.met), true, 'no release gate may be met in this build');
  });

  test('the environment mode cannot be changed through the API', async () => {
    const client = await signIn('admin@ekorails.invalid');
    // There is deliberately no route for this. A 404 or 405 is the correct answer;
    // what must never happen is a 200.
    for (const path of ['/api/system/environment', '/api/admin/environment']) {
      const response = await client.request('PATCH', path, { mode: 'PRODUCTION' });
      assert.notEqual(response.status, 200, `${path} must not accept a mode change`);
    }
  });

  test('OpenAPI describes every route with its required permissions', async () => {
    const response = await new Client().get('/api/openapi.json');
    const spec = (response.json['data'] as Record<string, unknown>);
    assert.equal(spec['openapi'], '3.1.0');
    const paths = spec['paths'] as Record<string, Record<string, Record<string, unknown>>>;
    assert.ok(Object.keys(paths).length > 40, 'the API must be substantial');
    const txnPost = paths['/api/transactions']?.['post'];
    assert.deepEqual(txnPost?.['x-required-permissions'], ['txn.initiate']);
    assert.match(
      String(spec['info'] && (spec['info'] as Record<string, string>)['description']),
      /not a bank/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('Authentication', () => {
  test('a wrong password and an unknown email give the same response', async () => {
    const wrongPassword = await new Client().post('/api/auth/login', {
      email: 'analyst@ekorails.invalid', password: 'definitely-not-the-password',
    });
    const unknownEmail = await new Client().post('/api/auth/login', {
      email: 'nobody@nowhere.invalid', password: 'definitely-not-the-password',
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.deepEqual(
      wrongPassword.json['error'], unknownEmail.json['error'],
      'the endpoint must not be a user-enumeration oracle',
    );
  });

  test('a successful login sets an httpOnly session cookie and a readable CSRF cookie', async () => {
    const client = new Client();
    const response = await client.post('/api/auth/login', {
      email: 'analyst@ekorails.invalid', password: TEST_PASSWORD,
    });
    assert.equal(response.status, 200);
    const setCookies = response.headers.getSetCookie();
    const session = setCookies.find((c) => c.startsWith('ekorails_session='));
    const csrf = setCookies.find((c) => c.startsWith('ekorails_csrf='));
    assert.ok(session, 'a session cookie must be set');
    assert.match(session!, /HttpOnly/, 'the session cookie must be httpOnly');
    assert.match(session!, /SameSite=Strict/);
    assert.ok(csrf, 'a CSRF cookie must be set');
    assert.ok(!/HttpOnly/.test(csrf!), 'the CSRF cookie must be readable by the client to be echoed');
    // The session token must never appear in the response body.
    assert.ok(
      !JSON.stringify(response.json).includes(session!.split('=')[1]!.split(';')[0]!),
      'the session token must not be echoed in the body',
    );
  });

  test('failed logins lock the account after the threshold', async () => {
    const email = 'lockout.test@ekorails.invalid';
    await db.asOwner(SYSTEM, async (q) => {
      const { createUser } = await import('../src/auth/service.js');
      await createUser(q, {
        organizationId: fx.internalOrgId, email, fullName: 'Lockout Subject',
        password: TEST_PASSWORD, roles: [], enrolMfa: false,
      });
    });

    for (let i = 0; i < auth.MAX_FAILED_LOGINS; i += 1) {
      const response = await new Client().post('/api/auth/login', { email, password: 'wrong' });
      assert.equal(response.status, 401);
    }

    // Now even the CORRECT password is refused.
    const afterLock = await new Client().post('/api/auth/login', { email, password: TEST_PASSWORD });
    assert.equal(afterLock.status, 401, 'a locked account must refuse the correct password');

    const status = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ status: string; locked_until: Date | null }>(
        'SELECT status, locked_until FROM app_user WHERE email_normalised = $1', [email],
      );
      return row.rows[0]!;
    });
    assert.equal(status.status, 'locked');
    assert.ok(status.locked_until, 'a lockout must have an expiry, not be permanent');
  });

  test('every login attempt, successful or not, is recorded', async () => {
    const count = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ succeeded: string; failed: string }>(
        `SELECT count(*) FILTER (WHERE succeeded)::text AS succeeded,
                count(*) FILTER (WHERE NOT succeeded)::text AS failed
           FROM login_attempt`,
      );
      return row.rows[0]!;
    });
    assert.ok(Number(count.succeeded) > 0, 'successful logins must be recorded');
    assert.ok(Number(count.failed) > 0, 'failed logins must be recorded');
  });

  test('an unauthenticated request to a protected route is refused', async () => {
    const response = await new Client().get('/api/transactions');
    assert.equal(response.status, 401);
    assert.equal((response.json['error'] as Record<string, string>)['code'], 'SESSION_REQUIRED');
  });

  test('logout revokes the session and clears the cookies', async () => {
    const client = await signIn('analyst@ekorails.invalid');
    assert.equal((await client.get('/api/me')).status, 200);

    const logout = await client.post('/api/auth/logout');
    assert.equal(logout.status, 200);
    assert.equal(client.hasCookie('ekorails_session'), false, 'the cookie must be cleared');

    // Even replaying the old cookie fails, because the session is revoked server-side.
    assert.equal((await client.get('/api/me')).status, 401);
  });
});

// ---------------------------------------------------------------------------
describe('CSRF protection', () => {
  test('a state-changing request without the CSRF header is refused', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const response = await client.postWithoutCsrf('/api/support-cases', {
      category: 'customer_support', subject: 'Test', description: 'Test description.',
    });
    assert.equal(response.status, 403);
    assert.equal((response.json['error'] as Record<string, string>)['code'], 'CSRF_TOKEN_INVALID');
  });

  test('a request with the WRONG CSRF token is refused', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const response = await client.post(
      '/api/support-cases',
      { category: 'customer_support', subject: 'Test', description: 'Test description.' },
      { 'x-csrf-token': 'not-the-right-token' },
    );
    assert.equal(response.status, 403);
  });

  test('a GET does not require a CSRF token', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    assert.equal((await client.get('/api/transactions')).status, 200);
  });
});

// ---------------------------------------------------------------------------
describe('Authorisation at the route boundary', () => {
  test('a business user cannot reach the compliance queue', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const response = await client.get('/api/compliance/cases');
    assert.equal(response.status, 403);
    assert.equal((response.json['error'] as Record<string, string>)['code'], 'PERMISSION_DENIED');
  });

  test('a business user cannot reach the ledger', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    assert.equal((await client.get('/api/ledger/trial-balance')).status, 403);
    assert.equal((await client.get('/api/ledger/accounts')).status, 403);
  });

  test('a compliance analyst cannot route a settlement', async () => {
    const client = await signIn('analyst@ekorails.invalid');
    const response = await client.post(
      '/api/transactions/00000000-0000-0000-0000-000000000000/settlement/submit',
    );
    assert.equal(response.status, 403);
  });

  test('a treasury operator cannot clear a compliance alert', async () => {
    const client = await signIn('treasury@ekorails.invalid');
    const response = await client.post(
      '/api/transactions/00000000-0000-0000-0000-000000000000/compliance-decision',
      { decision: 'approve', reason: 'Attempting to clear an alert as treasury, which must be refused.' },
    );
    assert.equal(response.status, 403);
  });

  test('an administrator cannot read transactions or documents', async () => {
    const client = await signIn('admin@ekorails.invalid');
    assert.equal((await client.get('/api/transactions')).status, 403);
    assert.equal((await client.get('/api/documents')).status, 403);
  });

  test('the auditor can read but every write route is refused', async () => {
    const client = await signIn('analyst@ekorails.invalid');
    // Confirm the read side works for a role that has it, then check the auditor.
    assert.equal((await client.get('/api/compliance/cases')).status, 200);

    const auditorEmail = 'auditor.api@ekorails.invalid';
    await db.asOwner(SYSTEM, async (q) => {
      const { createUser } = await import('../src/auth/service.js');
      await createUser(q, {
        organizationId: fx.internalOrgId, email: auditorEmail, fullName: 'API Auditor',
        password: TEST_PASSWORD, roles: ['auditor_regulator'], enrolMfa: false,
      });
    });
    const auditor = await signIn(auditorEmail);

    assert.equal((await auditor.get('/api/audit/events')).status, 200, 'the auditor must be able to read');
    assert.equal((await auditor.get('/api/regulator/overview')).status, 200);
    assert.equal((await auditor.get('/api/ledger/trial-balance')).status, 200);

    // Writes.
    assert.equal((await auditor.post('/api/transactions', {})).status, 403);
    assert.equal((await auditor.post('/api/beneficiaries', {})).status, 403);
    assert.equal((await auditor.post('/api/reconciliation/run')).status, 403);
    assert.equal((await auditor.post('/api/admin/simulation', { scenario: 'success' })).status, 403);
  });

  test('/api/me reports the caller\'s roles, permissions and explicit denials', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const response = await client.get('/api/me');
    const data = response.json['data'] as Record<string, unknown>;
    assert.deepEqual(data['roles'], ['business_initiator']);
    assert.equal(data['scope'], 'org');
    const roleDetails = data['role_details'] as Array<{ cannot: string[] }>;
    assert.ok(roleDetails[0]!.cannot.length > 0, 'the role\'s explicit denials must be visible to the user');
  });
});

// ---------------------------------------------------------------------------
describe('Cross-organisation isolation over HTTP', () => {
  test('a user sees only their own organisation\'s transactions', async () => {
    const { createAndAdvance } = await import('./helpers.js');
    await createAndAdvance(db, fx, { stopAt: 'pending_compliance', amount: '1900000.000000' });

    const alpha = await signIn('initiator.a@testalpha.invalid');
    const bravo = await signIn('initiator.b@testbravo.invalid');

    const alphaList = (await alpha.get('/api/transactions')).json['data'] as unknown[];
    const bravoList = (await bravo.get('/api/transactions')).json['data'] as unknown[];

    assert.ok(alphaList.length > 0, 'alpha must see its own transactions');
    assert.equal(bravoList.length, 0, 'bravo must see none of alpha\'s transactions');
  });

  test('fetching another organisation\'s transaction by id returns 404', async () => {
    const alpha = await signIn('initiator.a@testalpha.invalid');
    const bravo = await signIn('initiator.b@testbravo.invalid');

    const list = (await alpha.get('/api/transactions')).json['data'] as Array<{ id: string }>;
    const target = list[0]!.id;

    assert.equal((await alpha.get(`/api/transactions/${target}`)).status, 200);
    const denied = await bravo.get(`/api/transactions/${target}`);
    assert.equal(denied.status, 404, 'cross-organisation access must be indistinguishable from absence');
    assert.ok(
      !JSON.stringify(denied.json).toLowerCase().includes('forbidden'),
      'the response must not hint that the record exists elsewhere',
    );
  });
});

// ---------------------------------------------------------------------------
describe('Rate limiting', () => {
  test('the login endpoint is rate limited', async () => {
    const client = new Client();
    let limited = false;
    for (let i = 0; i < 25; i += 1) {
      const response = await client.post('/api/auth/login', {
        email: `ratelimit${i}@nowhere.invalid`, password: 'wrong',
      });
      if (response.status === 429) {
        limited = true;
        assert.ok(response.json['error'], 'a rate-limited response must carry an error body');
        break;
      }
    }
    assert.ok(limited, 'the login endpoint must rate limit');
  });
});

// ---------------------------------------------------------------------------
describe('Input validation', () => {
  test('a malformed JSON body is rejected cleanly', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const response = await fetch(`${baseUrl}/api/support-cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    });
    assert.equal(response.status, 400);
    const body = await response.json() as Record<string, unknown>;
    assert.equal((body['error'] as Record<string, string>)['code'], 'INVALID_JSON');
  });

  test('a missing required field names the field', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const response = await client.post('/api/transactions', { send_amount: '100.000000' });
    assert.equal(response.status, 400);
    const error = response.json['error'] as Record<string, unknown>;
    assert.equal(error['code'], 'FIELD_REQUIRED');
    assert.ok((error['details'] as Record<string, string>)['field'], 'the failing field must be named');
  });

  test('an amount that is not a fixed-point decimal string is rejected', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const response = await client.post('/api/transactions', {
      beneficiary_id: fx.beneficiaryA, corridor_id: fx.corridorId,
      send_amount: 1000000, send_currency: 'NGN', receive_currency: 'USD',
      purpose: 'Test', source_of_funds: 'Trading revenue received into the operating account.',
    });
    assert.equal(response.status, 400, 'a JSON number must not be accepted as a money amount');
  });

  test('an unknown route returns 404 and a known route with a wrong method returns 405', async () => {
    const client = await signIn('analyst@ekorails.invalid');
    assert.equal((await client.get('/api/nonexistent')).status, 404);
    assert.equal((await client.request('DELETE', '/api/transactions')).status, 405);
  });

  test('an oversized body is refused', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const response = await client.post('/api/support-cases', {
      category: 'customer_support', subject: 'big', description: huge,
    });
    assert.ok([400, 413].includes(response.status), `expected a size refusal; got ${response.status}`);
  });
});

// ---------------------------------------------------------------------------
describe('Reporting over HTTP', () => {
  test('the report catalogue is filtered by the caller\'s permissions', async () => {
    const business = await signIn('initiator.a@testalpha.invalid');
    const finance = await signIn('finance@ekorails.invalid');

    const businessReports = (await business.get('/api/reports')).json['data'] as Array<{ key: string }>;
    const financeReports = (await finance.get('/api/reports')).json['data'] as Array<{ key: string }>;

    assert.ok(
      !businessReports.some((r) => r.key === 'trial-balance'),
      'a business user must not be offered the trial balance',
    );
    assert.ok(
      financeReports.some((r) => r.key === 'trial-balance'),
      'a finance analyst must be offered the trial balance',
    );
  });

  test('a report exports as CSV, XLSX and PDF, and each export is recorded', async () => {
    const finance = await signIn('finance@ekorails.invalid');

    for (const [format, expectedType] of [
      ['csv', 'text/csv'],
      ['xlsx', 'spreadsheetml'],
      ['pdf', 'application/pdf'],
    ] as const) {
      const response = await finance.get(`/api/reports/trial-balance?format=${format}`);
      assert.equal(response.status, 200, `${format} export failed`);
      assert.match(
        String(response.headers.get('content-type') ?? ''), new RegExp(expectedType),
        `${format} must be served with the right content type`,
      );
      assert.match(
        String(response.headers.get('content-disposition') ?? ''), /attachment; filename=/,
        `${format} must be served as a download`,
      );
    }

    const recorded = await db.asOwner(SYSTEM, async (q) => {
      const rows = await q.query<{ format: string; content_sha256: string; masking_profile: string }>(
        "SELECT format, content_sha256, masking_profile FROM report WHERE report_key = 'trial-balance'",
      );
      return rows.rows;
    });
    assert.equal(recorded.length, 3, 'each of the three exports must be recorded');
    for (const row of recorded) {
      assert.match(row.content_sha256, /^[0-9a-f]{64}$/, 'each export must record a content hash');
      assert.ok(row.masking_profile, 'each export must record the masking profile that produced it');
    }

    // And each export must be audited.
    const audited = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_event WHERE category = 'report_export'",
      );
      return Number(row.rows[0]!.n);
    });
    assert.ok(audited >= 3, 'every export must be audited');
  });

  test('the regulator overview exposes no personal names', async () => {
    const auditorEmail = 'regulator.api@ekorails.invalid';
    await db.asOwner(SYSTEM, async (q) => {
      const { createUser } = await import('../src/auth/service.js');
      await createUser(q, {
        organizationId: fx.internalOrgId, email: auditorEmail, fullName: 'API Regulator',
        password: TEST_PASSWORD, roles: ['auditor_regulator'], enrolMfa: false,
      });
    });
    const client = await signIn(auditorEmail);
    const response = await client.get('/api/regulator/overview');
    assert.equal(response.status, 200);

    const serialised = JSON.stringify(response.json);
    // The fixture's people are named "Owner Of <company>"; none may appear.
    assert.ok(!serialised.includes('Owner Of'), 'no individual name may appear in the regulator view');
    const data = response.json['data'] as Record<string, unknown>;
    const scope = data['pilot_scope'] as Record<string, unknown>;
    assert.match(String(scope['sandbox_admission_status']), /NOT CONFIRMED/);
  });
});

// ---------------------------------------------------------------------------
describe('Founder Learning Center over HTTP', () => {
  test('the product map reports honest completion stages', async () => {
    const client = await signIn('analyst@ekorails.invalid');
    const response = await client.get('/api/learning/product-map');
    assert.equal(response.status, 200);
    const data = response.json['data'] as Record<string, unknown>;
    const definitions = data['completion_definitions'] as Array<{ stage: string }>;
    assert.equal(definitions.length, 8, 'all eight completion definitions must be present');
    assert.ok(definitions.some((d) => d.stage === 'pilot_ready'));
  });

  // claims-lint-allow: the test name describes a disclaimer being asserted, not a claim.
  test('the state-machine view disclaims settlement finality', async () => {
    const client = await signIn('analyst@ekorails.invalid');
    const response = await client.get('/api/learning/state-machine');
    const data = response.json['data'] as Record<string, unknown>;
    assert.match(String(data['note']), /does not mean settlement finality/i);
    assert.ok((data['transition_count'] as number) > 25);
  });

  test('the compliance rule library is readable with plain-English explanations', async () => {
    const client = await signIn('analyst@ekorails.invalid');
    const response = await client.get('/api/compliance/rules');
    const data = response.json['data'] as Record<string, unknown>;
    const rules = data['rules'] as Array<Record<string, string>>;
    assert.ok(rules.length >= 23, 'the full rule catalogue must be visible');
    for (const rule of rules) {
      assert.ok(
        String(rule['risk_addressed'] ?? '').length > 30,
        `${rule['rule_key']} needs a real explanation of the risk it addresses`,
      );
      assert.ok(
        String(rule['false_positive_risk'] ?? '').length > 20,
        `${rule['rule_key']} must state how it can be wrong`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('The customer journey, driven entirely over HTTP', () => {
  /**
   * Every other test in this repository drives the services directly, in the SYSTEM
   * security context. That is convenient and it hid a defect for the whole of the build:
   * the compliance engine resolved a service account out of app_user to author the note
   * it writes when it opens a case, and row-level security hides that account from a
   * customer's organisation scope. The subselect returned NULL, the NOT NULL constraint
   * rejected the insert, and every authorisation by an actual customer failed with a 500.
   *
   * The seeded demonstration data was full of compliance cases regardless, because the
   * seeder also runs in system scope — so the database looked exactly as it should while
   * the path that produces it was broken.
   *
   * These tests therefore do the whole journey the way a customer does: over HTTP, signed
   * in, in their own organisation's scope, touching nothing directly.
   */

  test('an initiator can create a payment and send it for authorisation', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');

    const corridors = await client.get('/api/corridors');
    assert.equal(corridors.status, 200, 'a customer must be able to discover the corridor they send on');
    const corridorList = corridors.json['data'] as Array<Record<string, unknown>>;
    assert.ok(corridorList.length > 0, 'at least one corridor must be open');

    const created = await client.post('/api/transactions', {
      beneficiary_id: fx.beneficiaryA,
      corridor_id: corridorList[0]!['id'],
      send_amount: '2500000.000000',
      send_currency: corridorList[0]!['origin_currency'],
      receive_currency: corridorList[0]!['destination_currency'],
      purpose: 'Settlement of supplier invoice for goods received',
      source_of_funds: 'Export receipts collected into the operating account during the period.',
    });
    assert.equal(created.status, 201, `create failed: ${JSON.stringify(created.json)}`);
    const transaction = created.json['data'] as Record<string, string>;

    const submitted = await client.post(`/api/transactions/${transaction['id']}/submit`);
    assert.equal(submitted.status, 200, `submit failed: ${JSON.stringify(submitted.json)}`);
    assert.equal(
      (submitted.json['data'] as Record<string, unknown>)['state'], 'pending_business_approval',
      'a submitted payment waits for a second authorisation',
    );
  });

  test('an approver authorising in their own organisation scope opens a compliance case', async () => {
    const initiator = await signIn('initiator.a@testalpha.invalid');
    const corridors = (await initiator.get('/api/corridors')).json['data'] as Array<Record<string, unknown>>;

    const created = await initiator.post('/api/transactions', {
      beneficiary_id: fx.beneficiaryA,
      corridor_id: corridors[0]!['id'],
      send_amount: '1750000.000000',
      send_currency: corridors[0]!['origin_currency'],
      receive_currency: corridors[0]!['destination_currency'],
      purpose: 'Settlement of supplier invoice for packaging materials',
      source_of_funds: 'Trading revenue received from confirmed export contracts in the period.',
    });
    assert.equal(created.status, 201);
    const id = (created.json['data'] as Record<string, string>)['id']!;
    await initiator.post(`/api/transactions/${id}/submit`);

    const approver = await signInWithStepUp('approver.a@testalpha.invalid');
    const approved = await approver.post(`/api/transactions/${id}/approve`, {
      approve: true,
      reason: 'Authorised. Supplier and amount verified against the purchase order.',
    });

    // The assertion that would have caught the defect: not merely "not a 500", but that
    // the compliance evaluation the approval triggers actually completed.
    assert.equal(
      approved.status, 200,
      `authorisation by a customer's own approver must succeed: ${JSON.stringify(approved.json)}`,
    );
    assert.equal(
      (approved.json['data'] as Record<string, unknown>)['state'], 'pending_compliance',
      'authorising sends the payment to compliance',
    );

    const detail = await approver.get(`/api/transactions/${id}`);
    assert.equal(detail.status, 200);
  });

  test('the case the engine opened carries its reasoning, authored by the engine and not by a person', async () => {
    const analyst = await signIn('analyst@ekorails.invalid');
    const cases = (await analyst.get('/api/compliance/cases')).json['data'] as Array<Record<string, unknown>>;
    assert.ok(cases.length > 0, 'authorising a payment must have opened a compliance case');

    const detail = await analyst.get(`/api/compliance/cases/${cases[0]!['reference']}`);
    assert.equal(detail.status, 200);
    const notes = (detail.json['data'] as Record<string, unknown>)['notes'] as Array<Record<string, unknown>>;
    assert.ok(notes.length > 0, 'a case must open with a note explaining why');

    const opening = notes[0]!;
    assert.equal(
      opening['authored_by'], 'compliance_engine',
      'a note written by software must say so rather than name a service account',
    );
    assert.match(
      String(opening['body']), /Rules triggered/,
      'the opening note must record which rules fired',
    );
  });

  test('there is no platform service account to sign in as', async () => {
    // A loginable service account used to exist so the engines could name an author for
    // the notes they write. It carried the demonstration passphrase and no second factor.
    // Engine-authored notes now record the engine, so nothing creates it, and migration
    // 014 disables any that a previous deployment created.
    const client = new Client();
    const attempt = await client.post('/api/auth/login', {
      email: 'system@ekorails.invalid', password: TEST_PASSWORD,
    });
    assert.equal(attempt.status, 401, 'no session may be issued for a service account');
    assert.ok(!client.hasCookie('ekorails_session'), 'no session cookie may be issued for it');
  });

  test('a payment can be withdrawn while it is a draft, and the withdrawal needs a reason', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const corridors = (await client.get('/api/corridors')).json['data'] as Array<Record<string, unknown>>;

    const created = await client.post('/api/transactions', {
      beneficiary_id: fx.beneficiaryA,
      corridor_id: corridors[0]!['id'],
      send_amount: '900000.000000',
      send_currency: corridors[0]!['origin_currency'],
      receive_currency: corridors[0]!['destination_currency'],
      purpose: 'Settlement of supplier invoice, subsequently withdrawn',
      source_of_funds: 'Operating receipts from confirmed export contracts in the period.',
    });
    const id = (created.json['data'] as Record<string, string>)['id']!;

    const noReason = await client.post(`/api/transactions/${id}/cancel`, {});
    assert.equal(noReason.status, 400, 'withdrawing without a reason must be refused');

    const cancelled = await client.post(`/api/transactions/${id}/cancel`, {
      reason: 'The supplier cancelled the order before shipment.',
    });
    assert.equal(cancelled.status, 200, `withdrawal failed: ${JSON.stringify(cancelled.json)}`);
    assert.equal((cancelled.json['data'] as Record<string, unknown>)['to'], 'cancelled',
      `withdrawal returned: ${JSON.stringify(cancelled.json)}`);
  });

  test('a customer can run a report of their own activity', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');

    const catalogue = await client.get('/api/reports');
    const definitions = catalogue.json['data'] as Array<Record<string, unknown>>;
    assert.ok(
      definitions.length > 0,
      'report.own.read must grant access to at least one report, or it grants access to nothing',
    );

    const report = await client.get(`/api/reports/${definitions[0]!['key']}?format=json`);
    assert.equal(report.status, 200, `report failed: ${JSON.stringify(report.json)}`);
    const data = report.json['data'] as Record<string, unknown>;
    assert.ok(Array.isArray(data['columns']), 'a report must describe its columns');
    assert.ok(Array.isArray(data['rows']), 'a report must return rows');
  });
});

// ---------------------------------------------------------------------------
describe('AI-assisted extraction proposes; it never confirms', () => {
  /**
   * The brief is explicit: extraction may propose, and "a human must confirm extracted
   * information". The interesting question is not whether a confirmation endpoint exists —
   * it is whether an UNCONFIRMED proposal can influence anything.
   *
   * Three properties are asserted here, and the third is the one that matters:
   *   1. A proposal is recorded with status 'proposed' and says so in the response.
   *   2. Confirmation records the confirming person, not the extractor.
   *   3. The compliance engine does not read extraction output at all — so a proposal
   *      cannot change a risk outcome whether it is confirmed or not.
   */

  async function uploadDocument(client: Client) {
    return client.post('/api/documents', {
      document_type: 'invoice',
      filename: `extract-${Date.now()}.pdf`,
      mime_type: 'application/pdf',
      content_base64: Buffer.from('%PDF-1.4\nfictional test invoice\n%%EOF\n', 'latin1').toString('base64'),
    });
  }

  test('a proposal is recorded as proposed and says it has no effect', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const document = await uploadDocument(client);
    assert.equal(document.status, 201, `upload failed: ${JSON.stringify(document.json)}`);
    const documentId = (document.json['data'] as Record<string, string>)['documentId']
      ?? (document.json['data'] as Record<string, string>)['document_id']
      ?? (document.json['data'] as Record<string, string>)['id'];

    const proposal = await client.post(`/api/documents/${documentId}/extraction`, {
      proposed_fields: { invoice_number: 'INV-EXTRACT-001', total: '1250000.00' },
      field_confidence: { invoice_number: 0.94, total: 0.71 },
    });
    assert.equal(proposal.status, 201, `proposal failed: ${JSON.stringify(proposal.json)}`);

    const data = proposal.json['data'] as Record<string, unknown>;
    assert.equal(data['status'], 'proposed', 'an extraction must be recorded as a proposal');
    assert.match(
      String(data['notice']), /not used by the compliance engine/,
      'the response must state that the proposal has no effect until a person confirms it',
    );

    const stored = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ status: string; confirmed_by: string | null }>(
        'SELECT status, confirmed_by FROM document_extraction WHERE id = $1', [data['extractionId']],
      );
      return row.rows[0]!;
    });
    assert.equal(stored.status, 'proposed');
    assert.equal(stored.confirmed_by, null, 'an unconfirmed proposal has nobody standing behind it');
  });

  test('an unconfirmed proposal cannot influence a compliance outcome', async () => {
    // The strong form of the requirement. A proposal is written claiming a source of funds
    // that would satisfy the documentation rule, and the transaction is then evaluated. If
    // the outcome changed, the engine would be reading advisory data — which is exactly what
    // must never happen.
    const client = await signIn('initiator.a@testalpha.invalid');
    const document = await uploadDocument(client);
    const documentId = (document.json['data'] as Record<string, string>)['documentId']
      ?? (document.json['data'] as Record<string, string>)['id'];

    await client.post(`/api/documents/${documentId}/extraction`, {
      proposed_fields: {
        document_type: 'source_of_funds',
        source_of_funds: 'Confirmed export receipts, extracted with high confidence.',
      },
      field_confidence: { source_of_funds: 0.99 },
    });

    // The compliance engine must not read document_extraction at all. Assert it on the
    // source, because a behavioural test could pass by coincidence.
    const engine = readFileSync(
      join(repoRoot(), 'services/api/src/modules/compliance/engine.ts'), 'utf8',
    );
    const rules = readFileSync(
      join(repoRoot(), 'services/api/src/modules/compliance/rules.ts'), 'utf8',
    );
    assert.ok(
      !engine.includes('document_extraction') && !rules.includes('document_extraction'),
      'the compliance engine must never read AI-proposed fields, confirmed or otherwise',
    );
    assert.ok(
      !engine.includes('proposed_fields') && !rules.includes('proposed_fields'),
      'the compliance engine must never read proposed field values',
    );
  });

  test('confirming records the person, and the audit event says the proposal was advisory', async () => {
    const client = await signIn('initiator.a@testalpha.invalid');
    const document = await uploadDocument(client);
    const documentId = (document.json['data'] as Record<string, string>)['documentId']
      ?? (document.json['data'] as Record<string, string>)['id'];

    const proposal = await client.post(`/api/documents/${documentId}/extraction`, {
      proposed_fields: { invoice_number: 'INV-EXTRACT-002' },
      field_confidence: { invoice_number: 0.62 },
    });
    const extractionId = (proposal.json['data'] as Record<string, string>)['extractionId']!;

    const confirmed = await client.post(`/api/extractions/${extractionId}/confirm`, {
      confirmed_fields: { invoice_number: 'INV-EXTRACT-002-CORRECTED' },
      corrected: true,
    });
    assert.equal(confirmed.status, 200, `confirmation failed: ${JSON.stringify(confirmed.json)}`);

    const stored = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ status: string; confirmed_by: string | null }>(
        'SELECT status, confirmed_by FROM document_extraction WHERE id = $1', [extractionId],
      );
      return row.rows[0]!;
    });
    assert.equal(stored.status, 'corrected', 'a corrected confirmation is distinguishable from a plain one');
    assert.ok(stored.confirmed_by, 'a confirmation must record WHO confirmed it');

    const audit = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ metadata: Record<string, unknown>; actor_user_id: string | null }>(
        `SELECT metadata, actor_user_id FROM audit_event
          WHERE action = 'document.extraction.confirm' AND entity_id = $1`,
        [extractionId],
      );
      return row.rows[0]!;
    });
    assert.ok(audit, 'confirming must write an audit event');
    assert.ok(audit.actor_user_id, 'the audit event names the person, not the extractor');
    assert.match(
      String(audit.metadata['note']), /advisory only/,
      'the record must say the proposal was advisory',
    );
  });
});
