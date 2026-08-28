variable "name_suffix" {
  description = "Suffix applied to every resource name, e.g. aksplat-dev-uks."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group for the observability resources."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "retention_in_days" {
  description = "Log Analytics retention. 30 days is included in the SKU; longer is billed."
  type        = number
  default     = 30

  validation {
    condition     = var.retention_in_days >= 30 && var.retention_in_days <= 730
    error_message = "retention_in_days must be between 30 and 730."
  }
}

variable "daily_quota_gb" {
  description = "Daily ingestion cap in GB. -1 disables the cap."
  type        = number
  default     = -1
}

variable "enable_managed_prometheus" {
  description = "Create an Azure Monitor workspace for managed Prometheus metrics."
  type        = bool
  default     = true
}

variable "enable_managed_grafana" {
  description = "Create an Azure Managed Grafana instance. Requires enable_managed_prometheus."
  type        = bool
  default     = false

  validation {
    condition     = var.enable_managed_grafana == false || var.enable_managed_prometheus
    error_message = "enable_managed_grafana requires enable_managed_prometheus to be true."
  }
}

variable "grafana_zone_redundant" {
  description = "Zone-redundant Grafana. Costs more; appropriate for production only."
  type        = bool
  default     = false
}

variable "metrics_reader_scope" {
  description = "Scope at which Grafana is granted Monitoring Data Reader, usually the resource group ID."
  type        = string
}

variable "action_group_short_name" {
  description = "Action group short name, 12 characters or fewer (shown in SMS/e-mail subjects)."
  type        = string
  default     = "aksplat"

  validation {
    condition     = length(var.action_group_short_name) <= 12
    error_message = "action_group_short_name must be 12 characters or fewer."
  }
}

variable "alert_email_receivers" {
  description = "Map of receiver name to e-mail address for alert notifications."
  type        = map(string)
  default     = {}
}

variable "alert_webhook_receivers" {
  description = <<-DESC
    Map of receiver name to webhook URL. Webhook URLs usually embed a token, so
    pass them at apply time from a secret store - never in a committed tfvars file.
  DESC
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "tags" {
  description = "Tags applied to every resource in this module."
  type        = map(string)
}
