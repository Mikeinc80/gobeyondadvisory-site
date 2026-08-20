/**
 * Preview access gate.
 *
 * These sites carry unresolved regulatory placeholders and a sandbox-status
 * statement that has not yet been evidenced, so the preview deploys must not be
 * readable by anyone who happens on the URL. Netlify's built-in password
 * protection is a paid feature; this edge function provides the same outcome
 * with HTTP basic auth on the free tier.
 *
 * The password is read from the PREVIEW_PASSWORD environment variable. If that
 * variable is unset the gate opens, so removing the variable is how you make a
 * site public — there is no password baked into the repository.
 *
 * Delete this file (and the variable) before pointing real domains at a site.
 */

const REALM = 'Basic realm="EKORails preview", charset="UTF-8"';

/** Length-independent comparison, so a wrong guess leaks nothing by timing. */
function matches(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const expected = Deno.env.get("PREVIEW_PASSWORD");
  if (!expected) return context.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const supplied = decoded.slice(decoded.indexOf(":") + 1);
      if (matches(supplied, expected)) return context.next();
    } catch {
      /* malformed credentials fall through to the challenge below */
    }
  }

  return new Response(
    "This preview is not public.\n\n" +
      "EKORails LTD — preview build. Access is limited while the site carries\n" +
      "unresolved placeholders and an unevidenced regulatory status statement.\n",
    {
      status: 401,
      headers: {
        "WWW-Authenticate": REALM,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
};

export const config = { path: "/*" };
