# 18. Deploying to Netlify

Two Netlify sites already exist on your account, created and configured but **not yet deployed**.
Linking them to GitHub is the last step, and it is the one that needs you: the Netlify connector
available to me can create sites, set variables and enable forms, but it cannot authorise GitHub, and
this build environment blocks outbound connections to `api.netlify.com`, so files cannot be uploaded
from it either. A Git-linked site solves both problems at once — Netlify clones the repository and
builds it on its own servers.

---

## What is already done

| | EKORails.com | EkoInfrastructure.com |
| --- | --- | --- |
| Netlify project | `ekorails-preview` | `ekoinfrastructure-preview` |
| Site ID | `024ee377-fe79-4997-a757-fdc74734ec86` | `c4f5e25d-4519-4805-b5ca-c0361c3f555e` |
| Dashboard | app.netlify.com/projects/ekorails-preview | app.netlify.com/projects/ekoinfrastructure-preview |
| URL once deployed | `ekorails-preview.netlify.app` | `ekoinfrastructure-preview.netlify.app` |
| Netlify Forms | Enabled | Enabled |
| `PREVIEW_PASSWORD` | Set (secret) | Set (secret) |
| Deployed | **No — this is the step below** | **No** |

**Team:** Gobeyond Advisory (`mike-ayjl8`), plan `nf_team_dev` (Starter).

## Step 1 — link each site to GitHub

For each of the two projects:

1. Open the project in Netlify → **Project configuration** → **Build & deploy** → **Continuous
   deployment** → **Link repository**.
2. Authorise GitHub if prompted, and pick `Mikeinc80/gobeyondadvisory-site`.
3. Set the build settings — these differ per site and are the only settings that do:

   | Setting | ekorails-preview | ekoinfrastructure-preview |
   | --- | --- | --- |
   | Branch to deploy | `claude/ekorails-ekoinfra-rebuild-s8kpzx` | `claude/ekorails-ekoinfra-rebuild-s8kpzx` |
   | Base directory | *(leave blank)* | *(leave blank)* |
   | Build command | `python3 build.py ekorails` | `python3 build.py ekoinfrastructure` |
   | Publish directory | `dist/ekorails` | `dist/ekoinfrastructure` |

4. Deploy. The build takes well under a minute — it is a dependency-free Python script.

Switch the deploy branch to `main` once the work is merged.

**Why the build settings are not in `netlify.toml`.** Two sites are built from one repository, and
`netlify.toml` overrides the UI rather than the other way round — a publish directory in the root
config would fight whichever site it did not belong to. The root `netlify.toml` therefore carries only
the Python version and the preview gate.

**Why the redirects and headers still work.** `build.py` writes `_headers` and `_redirects` into each
publish directory. Netlify reads those from the published folder, so all 35 EKORails and 32 Eko
Infrastructure redirects, the security headers and the per-page Content-Security-Policy apply
identically however the site is deployed.

## Step 2 — check the access gate

Both sites carry unresolved `[CONFIRM WITH EKORAILS]` placeholders and a sandbox-status statement that
has not yet been evidenced, so neither should be publicly readable yet.

Netlify's built-in password protection is a Pro feature and this team is on Starter, so the repository
includes `netlify/edge-functions/preview-gate.ts`, which does the same job with HTTP basic auth on the
free tier. It activates automatically because `PREVIEW_PASSWORD` is set on both sites.

- **Username:** anything (it is ignored)
- **Password:** `Corridor-2026-Review`

After the first deploy, confirm it works:

```bash
curl -sI https://ekorails-preview.netlify.app/ | head -1        # expect 401
curl -sI -u x:Corridor-2026-Review https://ekorails-preview.netlify.app/ | head -1   # expect 200
```

If the first command returns 200, the gate is not running — check that `PREVIEW_PASSWORD` is set on
that site and that the edge function deployed.

**To make a site public:** delete the `PREVIEW_PASSWORD` variable. The gate opens when the variable is
absent; there is no password committed to the repository. Delete `netlify/edge-functions/preview-gate.ts`
entirely before pointing real domains at a site.

## Step 3 — domains (when you are ready to launch)

Not before the launch blockers in `docs/16-prelaunch-review-checklist.md` are cleared.

1. Add `ekorails.com` and `www.ekorails.com` to `ekorails-preview`, then `ekoinfrastructure.com` and
   `www.ekoinfrastructure.com` to `ekoinfrastructure-preview`.
2. **Add the legacy domains as aliases on the same sites** — `eco-rails.com`, `www.eco-rails.com`,
   `eco-rail.com`, `www.eco-rail.com` on the first; `eco-settlement.com`, `www.eco-settlement.com` on
   the second. The 301 rules in `_redirects` only fire for domains the site actually answers for.
3. Point DNS at Netlify, enable HTTPS on every domain and alias, and force HTTPS.
4. Rename the projects (`ekorails-preview` → `ekorails`) so the internal URLs stop saying "preview".
5. Work through `docs/15-deployment-checklist.md` — email authentication (SPF, DKIM, DMARC) is the item
   most often skipped, and without it the confirmation emails to bank compliance contacts get
   quarantined.

## Fallback: drag-and-drop, without GitHub

If you would rather not link GitHub, Netlify accepts a folder or zip dropped onto
`app.netlify.com/drop`, or onto an existing project's Deploys tab.

**Read this before using it:** a drag-and-drop deploy contains only the published folder. The edge
function lives at the repository root and will not travel with it, so **a site deployed this way is
publicly readable by anyone with the URL.** Use it only if you accept that, or set the site to public
deliberately.

The two folders to drop are `dist/ekorails` and `dist/ekoinfrastructure`, rebuildable at any time with
`python3 build.py`.
