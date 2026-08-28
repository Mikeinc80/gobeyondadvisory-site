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
