output "vnet_id" {
  description = "Resource ID of the virtual network."
  value       = azurerm_virtual_network.this.id
}

output "vnet_name" {
  description = "Name of the virtual network."
  value       = azurerm_virtual_network.this.name
}

output "aks_system_subnet_id" {
  description = "Subnet ID for the AKS system node pool."
  value       = azurerm_subnet.aks_system.id
}

output "aks_user_subnet_id" {
  description = "Subnet ID for the AKS user (workload) node pool."
  value       = azurerm_subnet.aks_user.id
}

output "ingress_subnet_id" {
  description = "Subnet ID reserved for the ingress data path."
  value       = azurerm_subnet.ingress.id
}

output "private_endpoints_subnet_id" {
  description = "Subnet ID for ACR and Key Vault private endpoints."
  value       = azurerm_subnet.private_endpoints.id
}

output "acr_private_dns_zone_id" {
  description = "Private DNS zone ID for ACR; null when private endpoints are disabled."
  value       = var.enable_private_endpoints ? azurerm_private_dns_zone.acr[0].id : null
}

output "keyvault_private_dns_zone_id" {
  description = "Private DNS zone ID for Key Vault; null when private endpoints are disabled."
  value       = var.enable_private_endpoints ? azurerm_private_dns_zone.keyvault[0].id : null
}
