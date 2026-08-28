output "metric_alert_ids" {
  description = "Resource IDs of the metric alert rules."
  value = [
    azurerm_monitor_metric_alert.node_cpu.id,
    azurerm_monitor_metric_alert.node_memory.id,
    azurerm_monitor_metric_alert.node_disk.id,
    azurerm_monitor_metric_alert.nodes_not_ready.id,
  ]
}

output "log_alert_ids" {
  description = "Resource IDs of the scheduled-query alert rules."
  value = [
    azurerm_monitor_scheduled_query_rules_alert_v2.pod_restart_spike.id,
    azurerm_monitor_scheduled_query_rules_alert_v2.unavailable_replicas.id,
    azurerm_monitor_scheduled_query_rules_alert_v2.failed_deployment.id,
  ]
}
