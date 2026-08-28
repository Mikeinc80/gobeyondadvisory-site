output "cluster_id" {
  description = "Resource ID of the AKS cluster."
  value       = azurerm_kubernetes_cluster.this.id
}

output "cluster_name" {
  description = "Cluster name, used by `az aks get-credentials`."
  value       = azurerm_kubernetes_cluster.this.name
}

output "node_resource_group" {
  description = "AKS-managed resource group holding node infrastructure."
  value       = azurerm_kubernetes_cluster.this.node_resource_group
}

output "oidc_issuer_url" {
  description = "OIDC issuer used by workload identity federation."
  value       = azurerm_kubernetes_cluster.this.oidc_issuer_url
}

output "kubelet_identity_object_id" {
  description = "Object ID of the kubelet identity; grant this AcrPull."
  value       = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}

output "cluster_identity_principal_id" {
  description = "Principal ID of the cluster's user-assigned identity."
  value       = azurerm_user_assigned_identity.cluster.principal_id
}

output "workload_identity_client_ids" {
  description = "Client IDs per workload identity, for the Helm serviceAccount annotation."
  value       = { for k, v in azurerm_user_assigned_identity.workload : k => v.client_id }
}

output "workload_identity_principal_ids" {
  description = "Principal IDs per workload identity, for Key Vault role assignments."
  value       = { for k, v in azurerm_user_assigned_identity.workload : k => v.principal_id }
}
