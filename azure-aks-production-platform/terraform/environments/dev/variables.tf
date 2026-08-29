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

# --- Cost controls for short-lived validation runs ----------------------------
#
# Dev sizing is already minimal, but a throwaway validation cluster can be
# smaller still. These exist so a validation run is a tfvars change rather than
# an edit to the environment definition.

variable "system_node_pool" {
  description = "System node pool sizing. The default is the smallest pool that reliably runs the AKS add-ons."
  type = object({
    vm_size         = string
    min_count       = number
    max_count       = number
    os_disk_size_gb = number
  })
  default = {
    vm_size         = "Standard_D2ds_v5"
    min_count       = 1
    max_count       = 2
    os_disk_size_gb = 64
  }
}

variable "user_node_pool" {
  description = "Application node pool sizing. Set max_count = 1 for a short validation run."
  type = object({
    vm_size         = string
    min_count       = number
    max_count       = number
    os_disk_size_gb = number
  })
  default = {
    vm_size         = "Standard_D2ds_v5"
    min_count       = 1
    max_count       = 3
    os_disk_size_gb = 64
  }
}

variable "enable_managed_prometheus" {
  description = <<-DESC
    Provision the Azure Monitor workspace and the Prometheus collection rule.
    Set false to skip metric ingestion charges on a run that only needs to prove
    the infrastructure and deployment path.
  DESC
  type        = bool
  default     = true
}
