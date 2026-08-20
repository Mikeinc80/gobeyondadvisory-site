# infra/terraform

**A skeleton, not a deployment.** This system has never been deployed anywhere but a
developer machine and this repository's CI, and nothing here has been applied.

Two things have to be decided before this becomes real, and neither is a technical decision:

- **Which region.** Founder decision FD-008 is open. No region has been selected, and no
  claim of data residency in any jurisdiction is made anywhere in this software. African
  ownership is not African data residency; residency follows a deployment region and a
  completed transfer assessment.
- **Whether a deployment is appropriate at all.** Live funds require nine release gates,
  none of which is met. Deploying this to a production environment today would produce a
  system that refuses to start.

## What the files are

| File | What it holds |
|---|---|
| `variables.tf` | Every input, with the ones that are unresolved marked as such |
| `main.tf` | Network, database, service and secrets, provider-agnostic in structure |
| `outputs.tf` | What a deployment would emit |

They are written to be read rather than applied. There is no provider block, no backend
configuration and no state, because committing those would imply a decision that has not
been made.

## What a real deployment needs beyond this

Listed because a Terraform skeleton that omits them looks more finished than it is.

1. **A managed key store.** Field encryption currently derives its key from process
   configuration on the same host as the data. An attacker with the host has both. This is
   gap 2 in `docs/12-threat-model.md` and it must close before live money.
2. **A managed object store** for document bytes. Documents are metadata-tracked and
   encrypted; there is no blob store connected.
3. **A virus-scanning service.** Document checks today are structural and are not scanning.
4. **Backups, encrypted, off-site, and restored.** The restore procedure in
   `docs/17-disaster-recovery-plan.md` has never been executed.
5. **A second region**, once FD-008 resolves.
6. **Observability.** No metrics, tracing or uptime monitoring is deployed, which is why no
   availability figure is claimed anywhere.
7. **Upstream protection.** No CDN or WAF; volumetric denial of service is gap 6.
8. **Network isolation.** The database should not be reachable from the internet, and the
   backup credential should live only where the backup job runs.

## Roles

Whatever the deployment, the database must be provisioned with the three roles in
`scripts/provision-roles.sh`:

- `ekorails_owner` — owns the schema, runs migrations. Not a superuser, no `BYPASSRLS`.
- `ekorails_app` — what the service connects as. No `UPDATE`/`DELETE` on the audit, ledger,
  decision or transition tables.
- `ekorails_backup` — `SELECT` and `BYPASSRLS`, used only by `pg_dump`. It exists because
  `FORCE` row-level security silently empties a dump taken as the owner, which is a backup
  that appears to succeed and restores nothing.

The script asserts that posture and fails with `PRIVILEGE_POSTURE_VIOLATION` rather than
proceeding if the owner or app role is a superuser or holds `BYPASSRLS`, `CREATEROLE` or
`CREATEDB`.
