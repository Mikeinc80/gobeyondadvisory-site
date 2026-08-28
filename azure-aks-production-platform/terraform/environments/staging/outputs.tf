output "resource_group_name" {
  description = "Resource group holding the environment."
  value       = module.platform.resource_group_name
}

output "cluster_name" {
  description = "AKS cluster name."
  value       = module.platform.cluster_name
}

output "acr_login_server" {
  description = "Registry login server."
  value       = module.platform.acr_login_server
}

output "acr_name" {
  description = "Registry name."
  value       = module.platform.acr_name
}

output "key_vault_name" {
  description = "Key Vault name."
  value       = module.platform.key_vault_name
}

output "tenant_id" {
  description = "Tenant ID for the SecretProviderClass."
  value       = module.platform.tenant_id
}

output "workload_identity_client_ids" {
  description = "Workload identity client ID per namespace."
  value       = module.platform.workload_identity_client_ids
}

output "log_analytics_workspace_name" {
  description = "Log Analytics workspace name."
  value       = module.platform.log_analytics_workspace_name
}
