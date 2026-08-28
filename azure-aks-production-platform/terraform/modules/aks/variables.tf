variable "name_suffix" {
  description = "Suffix applied to every resource name, e.g. aksplat-dev-uks."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group for the cluster."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "tenant_id" {
  description = "Entra ID tenant backing cluster authentication."
  type        = string
}

variable "kubernetes_version" {
  description = "Minor version to pin, e.g. 1.31. Patch versions follow the upgrade channel."
  type        = string
}

variable "sku_tier" {
  description = <<-DESC
    Control-plane tier. "Free" has no API-server SLA and suits dev; "Standard"
    carries the 99.95% SLA and should be used for anything customer-facing.
  DESC
  type        = string
  default     = "Free"

  validation {
    condition     = contains(["Free", "Standard", "Premium"], var.sku_tier)
    error_message = "sku_tier must be Free, Standard or Premium."
  }
}

variable "vnet_id" {
  description = "VNet the cluster identity is granted Network Contributor on."
  type        = string
}

variable "system_subnet_id" {
  description = "Subnet for the system node pool."
  type        = string
}

variable "user_subnet_id" {
  description = "Subnet for the user node pool."
  type        = string
}

variable "availability_zones" {
  description = "Zones to spread nodes across. Empty means the region has no zones."
  type        = list(string)
  default     = ["1", "2", "3"]
}

variable "pod_cidr" {
  description = "Overlay CIDR for pod IPs. Must not overlap the VNet or service CIDR."
  type        = string
  default     = "192.168.0.0/16"
}

variable "service_cidr" {
  description = "CIDR for ClusterIP services. Must not overlap the VNet or pod CIDR."
  type        = string
  default     = "172.16.0.0/16"
}

variable "dns_service_ip" {
  description = "CoreDNS ClusterIP. Must sit inside service_cidr."
  type        = string
  default     = "172.16.0.10"
}

variable "outbound_type" {
  description = <<-DESC
    Egress path. "loadBalancer" is the default; "userDefinedRouting" sends
    traffic through an Azure Firewall or NVA and is the production posture.
  DESC
  type        = string
  default     = "loadBalancer"

  validation {
    condition     = contains(["loadBalancer", "userDefinedRouting", "managedNATGateway", "userAssignedNATGateway"], var.outbound_type)
    error_message = "outbound_type must be loadBalancer, userDefinedRouting, managedNATGateway or userAssignedNATGateway."
  }
}

variable "api_server_authorized_ip_ranges" {
  description = "CIDRs allowed to reach the API server. Empty leaves it open to the Internet."
  type        = list(string)
  default     = []
}

variable "admin_group_object_ids" {
  description = "Entra ID group object IDs mapped to cluster-admin."
  type        = list(string)
  default     = []
}

variable "system_node_pool" {
  description = "Sizing for the system (control-plane add-ons) node pool."
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

variable "user_node_pool" {
  description = "Sizing for the user (application) node pool."
  type = object({
    vm_size         = string
    min_count       = number
    max_count       = number
    os_disk_size_gb = number
  })
  default = {
    vm_size         = "Standard_D4ds_v5"
    min_count       = 1
    max_count       = 5
    os_disk_size_gb = 128
  }
}

variable "log_analytics_workspace_id" {
  description = "Workspace for Container Insights and control-plane diagnostics."
  type        = string
}

variable "monitor_workspace_id" {
  description = "Azure Monitor workspace for managed Prometheus. Null disables metric scraping."
  type        = string
  default     = null
}

variable "control_plane_log_categories" {
  description = <<-DESC
    Control-plane log categories to ship. kube-audit is high volume and therefore
    expensive; kube-audit-admin records mutating calls only and is the sensible
    default outside of an investigation.
  DESC
  type        = list(string)
  default = [
    "kube-apiserver",
    "kube-controller-manager",
    "kube-scheduler",
    "cluster-autoscaler",
    "kube-audit-admin",
    "guard",
  ]
}

variable "host_encryption_enabled" {
  description = <<-DESC
    Encrypt node temp disks and caches at the host. Requires the EncryptionAtHost
    feature to be registered on the subscription:
      az feature register --namespace Microsoft.Compute --name EncryptionAtHost
  DESC
  type        = bool
  default     = true
}

variable "disk_encryption_set_id" {
  description = <<-DESC
    Disk encryption set for customer-managed keys on node disks. Null uses
    platform-managed keys, which is sufficient unless key custody is a
    compliance requirement.
  DESC
  type        = string
  default     = null
}

variable "private_cluster_enabled" {
  description = <<-DESC
    Place the API server on a private endpoint. Requires a self-hosted runner or
    private agent pool for CI, since GitHub-hosted runners cannot reach it.
  DESC
  type        = bool
  default     = false
}

variable "azure_policy_enabled" {
  description = "Enable the Azure Policy (Gatekeeper) add-on."
  type        = bool
  default     = true
}

variable "automatic_upgrade_channel" {
  description = "Kubernetes auto-upgrade channel: patch, stable, rapid, node-image or none."
  type        = string
  default     = "patch"

  validation {
    condition     = contains(["patch", "stable", "rapid", "node-image", "none"], var.automatic_upgrade_channel)
    error_message = "automatic_upgrade_channel must be patch, stable, rapid, node-image or none."
  }
}

variable "maintenance_day" {
  description = "Day of the week for the auto-upgrade maintenance window."
  type        = string
  default     = "Sunday"
}

variable "maintenance_start_time" {
  description = "UTC start time (HH:MM) of the 4-hour maintenance window."
  type        = string
  default     = "02:00"
}

variable "workload_identities" {
  description = <<-DESC
    Workload identities to create, keyed by a short name. Each is federated to a
    single namespace/service-account pair, so the binding cannot be reused by a
    pod in another namespace.
  DESC
  type = map(object({
    namespace       = string
    service_account = string
  }))
  default = {}
}

variable "tags" {
  description = "Tags applied to every resource in this module."
  type        = map(string)
}
