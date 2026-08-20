#!/usr/bin/env bash
# Drop and rebuild the EKORails database from migrations.
#
# Refuses to run unless the environment mode is DEMO, SANDBOX or TEST. There is no
# code path by which this script can touch a CONTROLLED_PILOT or PRODUCTION database.
set -euo pipefail

MODE="${EKORAILS_ENV_MODE:-DEMO}"
case "$MODE" in
  DEMO|SANDBOX|TEST) ;;
  *) echo "REFUSED: db-reset.sh will not run with EKORAILS_ENV_MODE=$MODE" >&2; exit 2 ;;
esac

DB="${EKORAILS_DB_NAME:-ekorails}"
OWNER="${EKORAILS_DB_OWNER:-ekorails_owner}"
OWNER_PW="${EKORAILS_DB_OWNER_PASSWORD:-ekorails_owner_dev}"
HOST="${EKORAILS_DB_HOST:-127.0.0.1}"
PORT="${EKORAILS_DB_PORT:-5432}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Roles are a cluster-level concern and are provisioned separately.
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/provision-roles.sh" >/dev/null

echo "==> Rebuilding '$DB' (mode=$MODE)"

su postgres -c "psql -q -v ON_ERROR_STOP=1 \
  -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid<>pg_backend_pid();\" \
  -c \"DROP DATABASE IF EXISTS $DB;\" \
  -c \"CREATE DATABASE $DB OWNER $OWNER;\"" >/dev/null

su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB \
  -c \"GRANT CONNECT ON DATABASE $DB TO ekorails_app;\" \
  -c \"GRANT CONNECT ON DATABASE $DB TO ekorails_backup;\"" >/dev/null

for f in "$ROOT"/db/migrations/*.sql; do
  name="$(basename "$f")"
  printf '    %-28s' "$name"
  if PGPASSWORD="$OWNER_PW" psql -q -h "$HOST" -p "$PORT" -U "$OWNER" -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>/tmp/ekorails-mig.err; then
    sum="$(sha256sum "$f" | cut -c1-64)"
    PGPASSWORD="$OWNER_PW" psql -q -h "$HOST" -p "$PORT" -U "$OWNER" -d "$DB" \
      -c "INSERT INTO schema_migration(version, checksum) VALUES ('$name', '$sum') ON CONFLICT DO NOTHING;" >/dev/null
    echo "ok"
  else
    echo "FAILED"; cat /tmp/ekorails-mig.err >&2; exit 1
  fi
done

echo "==> Migrations applied."
