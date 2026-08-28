variable "registry_name" {
  description = "Globally unique ACR name (alphanumeric only, 5-50 chars)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{5,50}$", var.registry_name))
    error_message = "registry_name must be 5-50 lowercase alphanumeric characters."
  }
}

variable "resource_group_name" {
  description = "Resource group for the registry."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "sku" {
  description = "ACR SKU. Premium is required for private endpoints, geo-replication and retention policies."
  type        = string
  default     = "Standard"

  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.sku)
    error_message = "sku must be one of Basic, Standard or Premium."
  }
}

variable "public_network_access_enabled" {
  description = "Allow access over the public endpoint. Only honoured on Premium."
  type        = bool
  default     = true
}

variable "zone_redundant" {
  description = "Enable zone redundancy. Premium only."
  type        = bool
  default     = false
}

variable "untagged_manifest_retention_days" {
  description = "Days to keep untagged manifests before ACR deletes them. Premium only."
  type        = number
  default     = 14
}

variable "georeplication_locations" {
  description = <<-DESC
    Additional regions to replicate the registry to. Premium only. Each replica
    is billed as a full registry, so this is a production-only cost.
  DESC
  type        = list(string)
  default     = []
}

variable "enable_private_endpoint" {
  description = "Create a private endpoint for the registry. Requires Premium."
  type        = bool
  default     = false
}

variable "private_endpoint_subnet_id" {
  description = "Subnet for the private endpoint. Required when enable_private_endpoint is true."
  type        = string
  default     = null
}

variable "private_dns_zone_id" {
  description = "privatelink.azurecr.io zone ID. Required when enable_private_endpoint is true."
  type        = string
  default     = null
}

variable "pull_principal_ids" {
  description = "Principal object IDs granted AcrPull, typically the AKS kubelet identity."
  type        = list(string)
  default     = []
}

variable "push_principal_ids" {
  description = "Principal object IDs granted AcrPush, typically the CI federated identity."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to every resource in this module."
  type        = map(string)
}
