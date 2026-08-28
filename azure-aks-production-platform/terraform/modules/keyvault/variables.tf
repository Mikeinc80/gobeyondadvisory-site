variable "vault_name" {
  description = "Globally unique Key Vault name (3-24 chars, alphanumeric and hyphens)."
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$", var.vault_name))
    error_message = "vault_name must be 3-24 characters, start with a letter and contain only letters, digits and hyphens."
  }
}

variable "resource_group_name" {
  description = "Resource group for the vault."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "sku_name" {
  description = "Key Vault SKU: standard, or premium for HSM-backed keys."
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["standard", "premium"], var.sku_name)
    error_message = "sku_name must be standard or premium."
  }
}

variable "soft_delete_retention_days" {
  description = "Days a deleted secret remains recoverable (7-90)."
  type        = number
  default     = 7

  validation {
    condition     = var.soft_delete_retention_days >= 7 && var.soft_delete_retention_days <= 90
    error_message = "soft_delete_retention_days must be between 7 and 90."
  }
}

variable "purge_protection_enabled" {
  description = "Block permanent deletion during the soft-delete window. Cannot be disabled once enabled."
  type        = bool
  default     = false
}

variable "public_network_access_enabled" {
  description = "Allow the public endpoint. Even when true, network_acls default to Deny."
  type        = bool
  default     = true
}

variable "allowed_ip_rules" {
  description = "Public IPv4 addresses or CIDRs allowed through the vault firewall (e.g. a CI egress IP)."
  type        = list(string)
  default     = []
}

variable "allowed_subnet_ids" {
  description = "Subnet IDs allowed through the vault firewall via service endpoints."
  type        = list(string)
  default     = []
}

variable "enable_private_endpoint" {
  description = "Create a private endpoint for the vault."
  type        = bool
  default     = false
}

variable "private_endpoint_subnet_id" {
  description = "Subnet for the private endpoint. Required when enable_private_endpoint is true."
  type        = string
  default     = null
}

variable "private_dns_zone_id" {
  description = "privatelink.vaultcore.azure.net zone ID. Required when enable_private_endpoint is true."
  type        = string
  default     = null
}

variable "secret_reader_principal_ids" {
  description = "Principal object IDs granted Key Vault Secrets User (read-only)."
  type        = list(string)
  default     = []
}

variable "secret_officer_principal_ids" {
  description = "Principal object IDs granted Key Vault Secrets Officer (read/write)."
  type        = list(string)
  default     = []
}

variable "log_analytics_workspace_id" {
  description = "Workspace for vault audit logs. Null disables the diagnostic setting."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to every resource in this module."
  type        = map(string)
}
