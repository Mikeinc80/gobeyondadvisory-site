#!/usr/bin/env bash
# Provisions the three database roles this system uses.
#
# Run once per cluster, as a superuser. Deliberately separate from the migrations: role
# creation is a cluster-level operation, and giving the schema owner CREATEROLE so that a
# migration could do it would be a real privilege escalation for no benefit.
#
#   ekorails_owner   Owns the schema. Runs migrations and seeding. NOT a superuser and NOT
#                    BYPASSRLS, so the append-only triggers and FORCE row-level security
#                    apply to it too.
#   ekorails_app     The application. Holds no UPDATE or DELETE on audit, ledger-entry or
#                    compliance-decision tables, and is subject to row-level security.
#   ekorails_backup  Read-only, BYPASSRLS. Exists ONLY because FORCE ROW LEVEL SECURITY
#                    applies to the table owner, which makes pg_dump as the owner fail
#                    outright. Without this role, backups fail — see mandatory test 20,
#                    which asserts both that the owner-run dump fails and that the
#                    backup-role dump succeeds and restores intact.
#
# SQL is written to a temporary file and applied with psql -f rather than -c. Passing SQL
# through `su postgres -c "psql -c \"...\""` puts it through two shell parsers, and the
# second one expands $$ (the dollar-quoting delimiter) into the shell's process id.
set -euo pipefail

OWNER_PW="${EKORAILS_DB_OWNER_PASSWORD:-ekorails_owner_dev}"
APP_PW="${EKORAILS_DB_PASSWORD:-ekorails_app_dev}"
BACKUP_PW="${EKORAILS_DB_BACKUP_PASSWORD:-ekorails_backup_dev}"
MODE="${EKORAILS_ENV_MODE:-DEMO}"

# Development defaults are usable only in the environments that are meant to be disposable.
case "$MODE" in
  DEMO|SANDBOX|TEST) ;;
  *)
    if [[ -z "${EKORAILS_DB_OWNER_PASSWORD:-}" || -z "${EKORAILS_DB_PASSWORD:-}" || -z "${EKORAILS_DB_BACKUP_PASSWORD:-}" ]]; then
      echo "REFUSED: development default passwords cannot be used with EKORAILS_ENV_MODE=$MODE." >&2
      echo "Supply EKORAILS_DB_OWNER_PASSWORD, EKORAILS_DB_PASSWORD and" >&2
      echo "EKORAILS_DB_BACKUP_PASSWORD from the secrets manager." >&2
      exit 2
    fi
    ;;
esac

SQL_FILE="$(mktemp /tmp/ekorails-provision-XXXXXX.sql)"
trap 'rm -f "$SQL_FILE"' EXIT
chmod 644 "$SQL_FILE"

cat > "$SQL_FILE" <<SQL
DO \$provision\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ekorails_owner') THEN
    CREATE ROLE ekorails_owner LOGIN PASSWORD '${OWNER_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ekorails_app') THEN
    CREATE ROLE ekorails_app LOGIN PASSWORD '${APP_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ekorails_backup') THEN
    CREATE ROLE ekorails_backup LOGIN BYPASSRLS PASSWORD '${BACKUP_PW}';
  END IF;
END
\$provision\$;

-- Assert the privilege posture rather than assuming it. A superuser or BYPASSRLS
-- application role would silently defeat every isolation control in this system, and
-- would do so without any visible error.
DO \$posture\$
DECLARE offenders TEXT;
BEGIN
  SELECT string_agg(rolname, ', ') INTO offenders
    FROM pg_roles
   WHERE rolname IN ('ekorails_owner', 'ekorails_app')
     AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb);
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'PRIVILEGE_POSTURE_VIOLATION: % must be neither superuser, BYPASSRLS, CREATEROLE nor CREATEDB. '
      'One of these attributes has been granted, which defeats the isolation controls.', offenders;
  END IF;
END
\$posture\$;

COMMENT ON ROLE ekorails_backup IS
  'Read-only backup role with BYPASSRLS. Required because FORCE ROW LEVEL SECURITY applies '
  'to the table owner, which makes pg_dump as the owner fail. Holds SELECT only: it cannot '
  'write and it cannot alter the schema. Its use is a named item in the access review.';
COMMENT ON ROLE ekorails_app IS
  'The application role. No UPDATE or DELETE on audit, ledger-entry or compliance-decision '
  'tables. Subject to row-level security. Never a superuser, never BYPASSRLS.';
COMMENT ON ROLE ekorails_owner IS
  'Schema owner. Runs migrations and seeding only. Subject to the append-only triggers and '
  'to FORCE row-level security like any other role.';
SQL

echo "==> Provisioning database roles"

# Three ways to reach a cluster as a superuser, in order of preference.
#
# The TCP path is first because it is the only one that works against a managed database
# or a containerised Postgres: `su postgres` needs a local unix socket and a local account,
# and neither exists in either case. Relying on it alone would mean this script runs on a
# developer laptop and nowhere the system would actually be deployed.
if [[ -n "${EKORAILS_DB_SUPERUSER:-}" ]]; then
  PGHOST="${EKORAILS_DB_HOST:-127.0.0.1}" \
  PGPORT="${EKORAILS_DB_PORT:-5432}" \
  psql -v ON_ERROR_STOP=1 -q \
       --username "$EKORAILS_DB_SUPERUSER" \
       --dbname "${EKORAILS_DB_SUPERUSER_DB:-postgres}" \
       -f "$SQL_FILE"
elif [[ "$(id -un)" == "postgres" ]]; then
  psql -v ON_ERROR_STOP=1 -q -f "$SQL_FILE"
elif command -v su >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
  su postgres -c "psql -v ON_ERROR_STOP=1 -q -f '$SQL_FILE'"
else
  echo "REFUSED: no way to reach the cluster as a superuser." >&2
  echo "Set EKORAILS_DB_SUPERUSER (and PGPASSWORD) to connect over TCP." >&2
  exit 2
fi

echo "    ekorails_owner   schema owner; not superuser, not BYPASSRLS"
echo "    ekorails_app     application; least privilege, subject to row-level security"
echo "    ekorails_backup  read-only, BYPASSRLS (required for pg_dump under FORCE RLS)"
echo "==> Roles provisioned and privilege posture verified."
