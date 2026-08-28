output "log_analytics_workspace_id" {
  description = "Resource ID of the Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.this.id
}

output "log_analytics_workspace_name" {
  description = "Name of the Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.this.name
}

output "monitor_workspace_id" {
  description = "Azure Monitor (managed Prometheus) workspace ID; null when disabled."
  value       = var.enable_managed_prometheus ? azurerm_monitor_workspace.this[0].id : null
}

output "grafana_endpoint" {
  description = "Managed Grafana URL; null when disabled."
  value       = var.enable_managed_grafana ? azurerm_dashboard_grafana.this[0].endpoint : null
}

output "action_group_id" {
  description = "Action group every alert rule notifies."
  value       = azurerm_monitor_action_group.this.id
}

output "prometheus_data_collection_rule_id" {
  description = "DCR that routes Prometheus metrics to the Azure Monitor workspace; null when disabled."
  value       = var.enable_managed_prometheus ? azurerm_monitor_data_collection_rule.prometheus[0].id : null
}

output "prometheus_data_collection_endpoint_id" {
  description = "DCE used by the Prometheus DCR; null when disabled."
  value       = var.enable_managed_prometheus ? azurerm_monitor_data_collection_endpoint.prometheus[0].id : null
}
