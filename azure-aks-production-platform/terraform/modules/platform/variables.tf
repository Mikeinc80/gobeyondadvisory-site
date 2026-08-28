variable "environment" {
  description = "Environment name; drives naming, sizing and the hardening defaults."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be dev, staging or production."
  }
}

variable "location" {
  description = "Azure region, e.g. uksouth."
  type        = string
}

variable "location_short" {
  description = "Short region code used in resource names, e.g. uks for uksouth."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2,4}[0-9]?$", var.location_short))
    error_message = "location_short must be 2-4 lowercase letters with an optional trailing digit."
  }
}

# --- Ownership and tagging ---------------------------------------------------

variable "owner" {
  description = "Team or individual accountable for the environment; lands in the Owner tag."
  type        = string
}

variable "cost_centre" {
  description = "Cost centre used for chargeback reporting."
  type        = string
  default     = "platform-engineering"
}

variable "criticality" {
  description = "Business criticality tier, used to prioritise incidents."
  type        = string
  default     = "low"
}

variable "repository_url" {
  description = "Repository that owns this infrastructure; recorded in the Repository tag."
  type        = string
}

variable "additional_tags" {
  description = "Extra tags merged over the standard tag set."
  type        = map(string)
  default     = {}
}

# --- Networking --------------------------------------------------------------

variable "vnet_address_space" {
  description = "CIDR for the virtual network. Must not overlap other environments if they will ever be peered."
  type        = string
}

variable "subnet_prefixes" {
  description = "CIDR per subnet."
  type = object({
    aks_system        = string
    aks_user          = string
    ingress           = string
    private_endpoints = string
  })
}

variable "pod_cidr" {
  description = "Overlay CIDR for pod IPs."
  type        = string
  default     = "192.168.0.0/16"
}

variable "service_cidr" {
  description = "CIDR for ClusterIP services."
  type        = string
  default     = "172.16.0.0/16"
}

variable "dns_service_ip" {
  description = "CoreDNS ClusterIP, inside service_cidr."
  type        = string
  default     = "172.16.0.10"
}

variable "allowed_ingress_source_prefixes" {
  description = "Source CIDRs permitted to reach the ingress subnet."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "api_server_authorized_ip_ranges" {
  description = "CIDRs allowed to reach the Kubernetes API server. Empty leaves it open."
  type        = list(string)
  default     = []
}

variable "enable_private_endpoints" {
  description = "Route ACR and Key Vault over private endpoints. Requires the Premium ACR SKU."
  type        = bool
  default     = false
}

# --- Cluster -----------------------------------------------------------------

variable "kubernetes_version" {
  description = "Kubernetes minor version, e.g. 1.31."
  type        = string
}

variable "aks_sku_tier" {
  description = "AKS control-plane tier: Free for dev, Standard for anything with an SLA."
  type        = string
  default     = "Free"
}

variable "availability_zones" {
  description = "Availability zones for node pools."
  type        = list(string)
  default     = ["1", "2", "3"]
}

variable "system_node_pool" {
  description = "Sizing for the system node pool."
  type = object({
    vm_size         = string
    min_count       = number
    max_count       = number
    os_disk_size_gb = number
  })
}

variable "user_node_pool" {
  description = "Sizing for the application node pool."
  type = object({
    vm_size         = string
    min_count       = number
    max_count       = number
    os_disk_size_gb = number
  })
}

variable "automatic_upgrade_channel" {
  description = "AKS auto-upgrade channel."
  type        = string
  default     = "patch"
}

variable "host_encryption_enabled" {
  description = "Encrypt node temp disks and caches at the host. Requires the EncryptionAtHost subscription feature."
  type        = bool
  default     = true
}

variable "disk_encryption_set_id" {
  description = "Disk encryption set for customer-managed keys on node disks; null uses platform-managed keys."
  type        = string
  default     = null
}

variable "private_cluster_enabled" {
  description = "Put the API server on a private endpoint. Requires self-hosted CI runners."
  type        = bool
  default     = false
}

variable "acr_georeplication_locations" {
  description = "Extra regions to geo-replicate the registry to. Premium only; each replica is billed separately."
  type        = list(string)
  default     = []
}

variable "admin_group_object_ids" {
  description = "Entra ID group object IDs granted cluster-admin."
  type        = list(string)
  default     = []
}

variable "application_namespaces" {
  description = "Namespaces the platform provisions a workload identity for."
  type        = list(string)
  default     = ["dev", "staging", "production"]
}

variable "application_service_account" {
  description = "Service account name the Helm chart creates in each namespace."
  type        = string
  default     = "platform-api"
}

# --- Registry, secrets, observability ----------------------------------------

variable "acr_sku" {
  description = "ACR SKU. Premium unlocks private endpoints, retention and content trust."
  type        = string
  default     = "Standard"
}

variable "ci_principal_ids" {
  description = "Principal object IDs of CI identities granted AcrPush."
  type        = list(string)
  default     = []
}

variable "secret_officer_principal_ids" {
  description = "Principal object IDs granted read/write on Key Vault secrets (humans, not pipelines)."
  type        = list(string)
  default     = []
}

variable "keyvault_allowed_ip_rules" {
  description = "Public IPs allowed through the Key Vault firewall."
  type        = list(string)
  default     = []
}

variable "log_retention_in_days" {
  description = "Log Analytics retention in days."
  type        = number
  default     = 30
}

variable "log_daily_quota_gb" {
  description = "Daily Log Analytics ingestion cap in GB; -1 for no cap."
  type        = number
  default     = -1
}

variable "enable_managed_prometheus" {
  description = "Provision an Azure Monitor workspace and enable Prometheus scraping."
  type        = bool
  default     = true
}

variable "enable_managed_grafana" {
  description = "Provision Azure Managed Grafana."
  type        = bool
  default     = false
}

variable "alert_email_receivers" {
  description = "Alert e-mail receivers, keyed by receiver name."
  type        = map(string)
  default     = {}
}

variable "alert_webhook_receivers" {
  description = "Alert webhook receivers keyed by name. Pass at apply time; never commit."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "alert_thresholds" {
  description = "Alert thresholds; tune per environment."
  type = object({
    node_cpu_percent     = number
    node_memory_percent  = number
    node_disk_percent    = number
    pod_restarts_15m     = number
    unavailable_replicas = number
    failed_events_15m    = number
  })
  default = {
    node_cpu_percent     = 80
    node_memory_percent  = 80
    node_disk_percent    = 80
    pod_restarts_15m     = 3
    unavailable_replicas = 0
    failed_events_15m    = 5
  }
}
