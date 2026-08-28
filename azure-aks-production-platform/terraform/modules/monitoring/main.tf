# Log Analytics + managed Prometheus/Grafana.
#
# Container Insights writes cluster and container logs here; the Azure Monitor
# workspace holds the Prometheus time series. Keeping both in this module means
# retention and cost live in one place instead of being spread across the AKS
# module.

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${var.name_suffix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags

  sku               = "PerGB2018"
  retention_in_days = var.retention_in_days

  # Cap on daily ingestion so a log storm cannot generate an unbounded bill.
  # -1 means no cap; set a real value in production.
  daily_quota_gb = var.daily_quota_gb

  # Query access follows Azure RBAC rather than workspace-local permissions.
  local_authentication_enabled = false
}

# Azure Monitor workspace: the managed-Prometheus metrics store.
resource "azurerm_monitor_workspace" "this" {
  count = var.enable_managed_prometheus ? 1 : 0

  name                = "amw-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

# Managed Grafana. Its system-assigned identity is granted Monitoring Reader on
# the subscription scope by the caller, so dashboards can query both the
# Prometheus workspace and Azure Monitor metrics.
resource "azurerm_dashboard_grafana" "this" {
  count = var.enable_managed_grafana ? 1 : 0

  name                = "graf-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  grafana_major_version             = 11
  api_key_enabled                   = false
  deterministic_outbound_ip_enabled = false
  public_network_access_enabled     = true
  zone_redundancy_enabled           = var.grafana_zone_redundant

  identity {
    type = "SystemAssigned"
  }

  azure_monitor_workspace_integrations {
    resource_id = azurerm_monitor_workspace.this[0].id
  }
}

# Grafana needs read access to the metrics it renders.
resource "azurerm_role_assignment" "grafana_monitoring_reader" {
  count = var.enable_managed_grafana ? 1 : 0

  scope                = var.metrics_reader_scope
  role_definition_name = "Monitoring Data Reader"
  principal_id         = azurerm_dashboard_grafana.this[0].identity[0].principal_id
}

# Action group: the single fan-out point every alert in the alerts module targets.
# Routing changes (add PagerDuty, swap the on-call address) then happen here once.
resource "azurerm_monitor_action_group" "this" {
  name                = "ag-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  short_name          = var.action_group_short_name
  tags                = var.tags

  dynamic "email_receiver" {
    for_each = var.alert_email_receivers
    content {
      name          = email_receiver.key
      email_address = email_receiver.value
      # Sends the full alert payload rather than the trimmed legacy schema.
      use_common_alert_schema = true
    }
  }

  # Webhook receivers (PagerDuty, Opsgenie, Teams) take their URL from a variable
  # so the endpoint - which is itself a credential - is never committed here.
  # Iterating over the keys (which are not secret) keeps the URL itself marked
  # sensitive, so it stays redacted in plan output and CI logs.
  dynamic "webhook_receiver" {
    for_each = nonsensitive(toset(keys(var.alert_webhook_receivers)))
    content {
      name                    = webhook_receiver.value
      service_uri             = var.alert_webhook_receivers[webhook_receiver.value]
      use_common_alert_schema = true
    }
  }
}

# --- Managed Prometheus collection --------------------------------------------
#
# Creating an Azure Monitor workspace and enabling `monitor_metrics` on the
# cluster is not sufficient on its own: metrics only flow once a Data Collection
# Rule routes the Prometheus stream to the workspace and that rule is associated
# with the cluster. Without these three resources the workspace stays empty,
# which is a confusing failure because nothing reports an error.
#
# The association itself lives in the platform module, where the cluster ID is
# available.

resource "azurerm_monitor_data_collection_endpoint" "prometheus" {
  count = var.enable_managed_prometheus ? 1 : 0

  name                = "dce-${var.name_suffix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  kind                = "Linux"
  tags                = var.tags
}

resource "azurerm_monitor_data_collection_rule" "prometheus" {
  count = var.enable_managed_prometheus ? 1 : 0

  name                        = "dcr-prom-${var.name_suffix}"
  resource_group_name         = var.resource_group_name
  location                    = var.location
  kind                        = "Linux"
  data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.prometheus[0].id
  description                 = "Routes cluster Prometheus metrics to the Azure Monitor workspace."
  tags                        = var.tags

  destinations {
    monitor_account {
      monitor_account_id = azurerm_monitor_workspace.this[0].id
      name               = "MonitoringAccount"
    }
  }

  data_sources {
    prometheus_forwarder {
      name    = "PrometheusDataSource"
      streams = ["Microsoft-PrometheusMetrics"]
    }
  }

  data_flow {
    streams      = ["Microsoft-PrometheusMetrics"]
    destinations = ["MonitoringAccount"]
  }
}
