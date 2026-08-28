variable "location" {
  description = "Azure region."
  type        = string
  default     = "uksouth"
}

variable "location_short" {
  description = "Short region code used in resource names."
  type        = string
  default     = "uks"
}

variable "kubernetes_version" {
  description = "Kubernetes minor version."
  type        = string
  default     = "1.31"
}

variable "owner" {
  description = "Team accountable for this environment."
  type        = string
}

variable "repository_url" {
  description = "Repository that owns this infrastructure."
  type        = string
}

variable "admin_group_object_ids" {
  description = "Entra ID group object IDs granted cluster-admin."
  type        = list(string)
  default     = []
}

variable "ci_principal_ids" {
  description = "Principal object IDs of CI identities granted AcrPush."
  type        = list(string)
  default     = []
}

variable "secret_officer_principal_ids" {
  description = "Principal object IDs granted read/write on Key Vault secrets."
  type        = list(string)
  default     = []
}

variable "alert_email_receivers" {
  description = "Alert e-mail receivers keyed by receiver name."
  type        = map(string)
  default     = {}
}

variable "api_server_authorized_ip_ranges" {
  description = "CIDRs allowed to reach the Kubernetes API server (CI egress and admin networks)."
  type        = list(string)
  default     = []
}

variable "allowed_ingress_source_prefixes" {
  description = "Source CIDRs permitted to reach the ingress subnet."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "keyvault_allowed_ip_rules" {
  description = "Public IPs allowed through the Key Vault firewall."
  type        = list(string)
  default     = []
}

variable "alert_webhook_receivers" {
  description = <<-DESC
    Webhook receivers (PagerDuty, Opsgenie) keyed by name. The URL embeds a
    routing key, so pass it as TF_VAR_alert_webhook_receivers from a secret
    store rather than committing it to a tfvars file.
  DESC
  type        = map(string)
  default     = {}
  sensitive   = true
}
