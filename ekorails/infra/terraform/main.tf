# Structure only. There is no provider block and no backend, because committing either
# would imply a deployment decision that has not been made.
#
# Resource names are prefixed with the environment mode so a SANDBOX and a CONTROLLED_PILOT
# deployment cannot share anything by accident — including, and especially, a database.

locals {
  name_prefix = "ekorails-${lower(var.environment_mode)}"

  # A pilot or production deployment must have every gate met. This is a second, earlier
  # refusal than the application's own: the application refuses to START with a gate unmet,
  # and this refuses to PLAN. Finding out at apply time is better than finding out at
  # start-up in front of a supervisor.
  gates_met = alltrue(values(var.release_gates))
}

resource "null_resource" "release_gate_check" {
  lifecycle {
    precondition {
      condition = (
        contains(["DEMO", "SANDBOX"], var.environment_mode) || local.gates_met
      )
      error_message = <<-EOT
        Refusing to plan a ${var.environment_mode} deployment with unmet release gates.

        Each gate requires named evidence — regulatory approval, licence verification,
        partner contracts, an independent security review, a privacy assessment, rehearsed
        operational controls, a tested restore, reconciliation sign-off and a board
        decision. See docs/A-founder-decisions.md and docs/25-pilot-readiness-report.md.
      EOT
    }
  }
}

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------
# The database must not be reachable from the internet. The service reaches it over a
# private subnet; nothing else does, except the backup job.

# resource "..." "network" { }
# resource "..." "private_subnet" { }
# resource "..." "database_security_group" { }

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
# Provisioned with the three roles from scripts/provision-roles.sh. The service connects as
# ekorails_app, which is not a superuser, has no BYPASSRLS, and holds no UPDATE or DELETE
# grant on the audit, ledger, decision or transition tables.
#
# Backups must be taken as ekorails_backup. FORCE row-level security applies to the table
# owner too, so a dump taken as the owner silently produces a schema with no rows.

# resource "..." "database" {
#   engine_version          = "16"
#   backup_retention_period = var.database_backup_retention_days
#   storage_encrypted       = true
#   publicly_accessible     = false
#   deletion_protection     = var.environment_mode != "DEMO"
# }

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------
# NOT CONNECTED. The field-encryption key currently derives from process configuration on
# the application host. Until this is wired, an attacker with the host has both the
# ciphertext and the key.

# resource "..." "master_key" { }

# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------
# The container refuses to start unless migrations are applied, the ledger balances and the
# audit chain verifies. A health check must therefore allow for a start-up that legitimately
# fails, and must not restart-loop past a failure that means the data is wrong.

# resource "..." "service" { }

# ---------------------------------------------------------------------------
# NOT PRESENT, and named so the absence is visible
# ---------------------------------------------------------------------------
#   - object storage for document bytes
#   - a virus-scanning service
#   - metrics, tracing and uptime monitoring
#   - a CDN or WAF
#   - a second region
