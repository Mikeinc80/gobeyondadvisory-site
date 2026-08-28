output "resource_group_name" {
  description = "Resource group holding the environment."
  value       = azurerm_resource_group.this.name
}

output "cluster_name" {
  description = "AKS cluster name for `az aks get-credentials`."
  value       = module.aks.cluster_name
}

output "acr_login_server" {
  description = "Registry login server used by the CD workflow."
  value       = module.acr.login_server
}

output "acr_name" {
  description = "Registry name used by `az acr login`."
  value       = module.acr.name
}

output "key_vault_name" {
  description = "Key Vault name referenced by the SecretProviderClass."
  value       = module.keyvault.name
}

output "tenant_id" {
  description = "Tenant ID referenced by the SecretProviderClass."
  value       = module.keyvault.tenant_id
}

output "oidc_issuer_url" {
  description = "Cluster OIDC issuer, for federating additional identities."
  value       = module.aks.oidc_issuer_url
}

output "workload_identity_client_ids" {
  description = <<-DESC
    Client ID per namespace, for the serviceAccount annotation
    azure.workload.identity/client-id in the Helm values.
  DESC
  value       = module.aks.workload_identity_client_ids
}

output "log_analytics_workspace_name" {
  description = "Workspace to query in Azure Monitor Logs."
  value       = module.monitoring.log_analytics_workspace_name
}

output "grafana_endpoint" {
  description = "Managed Grafana URL; null when Grafana is disabled."
  value       = module.monitoring.grafana_endpoint
}
