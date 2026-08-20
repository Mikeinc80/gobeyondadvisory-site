# Inputs.
#
# Variables with no default are unresolved decisions rather than omissions, and each says
# which decision it is waiting on.

variable "region" {
  type        = string
  description = <<-EOT
    Deployment region.

    UNRESOLVED — founder decision FD-008. No region has been selected, and no claim of data
    residency in any jurisdiction is made anywhere in this software. Selecting one requires
    a completed cross-border transfer assessment, not a preference.
  EOT
  # Deliberately no default. A default here would be a residency decision made by accident.
}

variable "environment_mode" {
  type        = string
  description = "DEMO, SANDBOX, CONTROLLED_PILOT or PRODUCTION."
  default     = "SANDBOX"

  validation {
    condition     = contains(["DEMO", "SANDBOX", "CONTROLLED_PILOT", "PRODUCTION"], var.environment_mode)
    error_message = "Unknown mode. The application refuses an unrecognised mode rather than defaulting, and so does this."
  }
}

variable "database_instance_class" {
  type        = string
  description = "Database instance size."
  default     = "small"
}

variable "database_backup_retention_days" {
  type        = number
  description = <<-EOT
    Backup retention in days.

    35 days covers operational recovery. The COMPLIANCE retention period is a separate and
    longer obligation, and it is UNRESOLVED — founder decision FD-005.
  EOT
  default     = 35
}

variable "master_key_secret_arn" {
  type        = string
  description = <<-EOT
    Reference to the field-encryption key in a managed key store.

    NOT IN USE. The key is currently derived from process configuration on the same host as
    the data, which means host compromise yields both. This variable exists so the gap is
    visible in the infrastructure rather than only in the threat model. See gap 2 in
    docs/12-threat-model.md.
  EOT
  default     = null
}

variable "release_gates" {
  type        = map(bool)
  description = <<-EOT
    The nine release gates.

    Every one is false and each requires named evidence. Setting one here without the
    evidence behind it is not a configuration change; it is a false statement about the
    state of the business.
  EOT
  default = {
    regulatory_approval    = false
    licence_verified       = false
    partner_contracts      = false
    security_review        = false
    privacy_review         = false
    operational_controls   = false
    dr_tested              = false
    reconciliation_signoff = false
    board_approval         = false
  }
}
