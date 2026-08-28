variable "name_suffix" {
  description = "Suffix applied to every resource name, e.g. aksplat-dev-uks."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group that holds the network resources."
  type        = string
}

variable "vnet_address_space" {
  description = "CIDR for the virtual network."
  type        = string

  validation {
    condition     = can(cidrhost(var.vnet_address_space, 0))
    error_message = "vnet_address_space must be a valid CIDR block, e.g. 10.10.0.0/16."
  }
}

variable "subnet_prefixes" {
  description = "CIDR per subnet. All four must sit inside vnet_address_space."
  type = object({
    aks_system        = string
    aks_user          = string
    ingress           = string
    private_endpoints = string
  })
}

variable "allowed_ingress_source_prefixes" {
  description = <<-DESC
    Source CIDRs permitted to reach the ingress subnet on 80/443. Defaults to the
    Internet for a public endpoint; set to corporate or Front Door prefixes to
    restrict it.
  DESC
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_private_endpoints" {
  description = "Create the private DNS zones used by ACR and Key Vault private endpoints."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to every resource in this module."
  type        = map(string)
}
