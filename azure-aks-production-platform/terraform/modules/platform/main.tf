# Composition root for one environment.
#
# Each environment under terraform/environments/ is a thin wrapper around this
# module: it supplies a backend, a provider and its own sizing, and nothing else.
# That way an architectural change lands in one place instead of being copied
# three times and drifting.

resource "azurerm_resource_group" "this" {
  name     = "rg-${local.name_suffix}"
  location = var.location
  tags     = local.tags
}

module "networking" {
  source = "../networking"

  name_suffix                     = local.name_suffix
  location                        = var.location
  resource_group_name             = azurerm_resource_group.this.name
  vnet_address_space              = var.vnet_address_space
  subnet_prefixes                 = var.subnet_prefixes
  allowed_ingress_source_prefixes = var.allowed_ingress_source_prefixes
  enable_private_endpoints        = var.enable_private_endpoints
  tags                            = local.tags
}

module "monitoring" {
  source = "../monitoring"

  name_suffix               = local.name_suffix
  location                  = var.location
  resource_group_name       = azurerm_resource_group.this.name
  retention_in_days         = var.log_retention_in_days
  daily_quota_gb            = var.log_daily_quota_gb
  enable_managed_prometheus = var.enable_managed_prometheus
  enable_managed_grafana    = var.enable_managed_grafana
  grafana_zone_redundant    = var.environment == "production"
  metrics_reader_scope      = azurerm_resource_group.this.id
  action_group_short_name   = "plat${local.env_short}"
  alert_email_receivers     = var.alert_email_receivers
  alert_webhook_receivers   = var.alert_webhook_receivers
  tags                      = local.tags
}

module "aks" {
  source = "../aks"

  name_suffix         = local.name_suffix
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  tenant_id           = data.azurerm_client_config.current.tenant_id

  kubernetes_version = var.kubernetes_version
  sku_tier           = var.aks_sku_tier

  vnet_id          = module.networking.vnet_id
  system_subnet_id = module.networking.aks_system_subnet_id
  user_subnet_id   = module.networking.aks_user_subnet_id

  availability_zones              = var.availability_zones
  pod_cidr                        = var.pod_cidr
  service_cidr                    = var.service_cidr
  dns_service_ip                  = var.dns_service_ip
  api_server_authorized_ip_ranges = var.api_server_authorized_ip_ranges
  admin_group_object_ids          = var.admin_group_object_ids

  system_node_pool = var.system_node_pool
  user_node_pool   = var.user_node_pool

  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  monitor_workspace_id       = module.monitoring.monitor_workspace_id
  automatic_upgrade_channel  = var.automatic_upgrade_channel
  host_encryption_enabled    = var.host_encryption_enabled
  disk_encryption_set_id     = var.disk_encryption_set_id
  private_cluster_enabled    = var.private_cluster_enabled

  workload_identities = local.workload_identities

  tags = local.tags
}

# Binds the Prometheus Data Collection Rule to the cluster. Declared here rather
# than in the monitoring module because it needs an ID from each of them, and a
# module should not reach backwards into its caller for one.
resource "azurerm_monitor_data_collection_rule_association" "prometheus" {
  count = var.enable_managed_prometheus ? 1 : 0

  # The name is the association's own identifier on the target resource; a
  # descriptive one makes it obvious in the portal what created it.
  name                    = "dcra-prom-${local.name_suffix}"
  target_resource_id      = module.aks.cluster_id
  data_collection_rule_id = module.monitoring.prometheus_data_collection_rule_id
  description             = "Sends cluster Prometheus metrics to the Azure Monitor workspace."
}

module "acr" {
  source = "../acr"

  registry_name                 = local.registry_name
  resource_group_name           = azurerm_resource_group.this.name
  location                      = var.location
  sku                           = var.acr_sku
  zone_redundant                = var.environment == "production" && var.acr_sku == "Premium"
  enable_private_endpoint       = var.enable_private_endpoints
  public_network_access_enabled = !var.enable_private_endpoints
  private_endpoint_subnet_id    = module.networking.private_endpoints_subnet_id
  private_dns_zone_id           = module.networking.acr_private_dns_zone_id

  # The kubelet identity pulls images; the CI federated identity pushes them.
  georeplication_locations = var.acr_georeplication_locations

  pull_principal_ids = [module.aks.kubelet_identity_object_id]
  push_principal_ids = var.ci_principal_ids

  tags = local.tags
}

module "keyvault" {
  source = "../keyvault"

  vault_name          = local.vault_name
  resource_group_name = azurerm_resource_group.this.name
  location            = var.location

  purge_protection_enabled   = var.environment == "production"
  soft_delete_retention_days = var.environment == "production" ? 90 : 7

  enable_private_endpoint       = var.enable_private_endpoints
  public_network_access_enabled = !var.enable_private_endpoints
  private_endpoint_subnet_id    = module.networking.private_endpoints_subnet_id
  private_dns_zone_id           = module.networking.keyvault_private_dns_zone_id
  allowed_ip_rules              = var.keyvault_allowed_ip_rules

  # Read-only for every workload identity; write access is held by humans in the
  # platform-admin group, not by the pipeline.
  secret_reader_principal_ids  = values(module.aks.workload_identity_principal_ids)
  secret_officer_principal_ids = var.secret_officer_principal_ids

  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id

  tags = local.tags
}

module "alerts" {
  source = "../alerts"

  name_suffix                = local.name_suffix
  location                   = var.location
  resource_group_name        = azurerm_resource_group.this.name
  cluster_id                 = module.aks.cluster_id
  log_analytics_workspace_id = module.monitoring.log_analytics_workspace_id
  action_group_id            = module.monitoring.action_group_id
  watched_namespaces         = var.application_namespaces
  thresholds                 = var.alert_thresholds
  tags                       = local.tags
}
