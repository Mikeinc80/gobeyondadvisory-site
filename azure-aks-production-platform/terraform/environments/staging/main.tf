# Staging environment.
#
# Production's shape at a fraction of its size: same SKUs, same zonal spread,
# same private-endpoint posture, smaller nodes and shorter retention. The point
# is that a change which works here has been exercised against the same
# constraints it will meet in production.

module "platform" {
  source = "../../modules/platform"

  environment    = "staging"
  location       = var.location
  location_short = var.location_short
  owner          = var.owner
  repository_url = var.repository_url
  criticality    = "medium"

  kubernetes_version = var.kubernetes_version

  vnet_address_space = "10.20.0.0/16"
  subnet_prefixes = {
    aks_system        = "10.20.0.0/22"
    aks_user          = "10.20.4.0/22"
    ingress           = "10.20.8.0/24"
    private_endpoints = "10.20.9.0/24"
  }

  availability_zones = ["1", "2", "3"]

  # Standard tier buys the API-server SLA. Staging carries it so that
  # control-plane behaviour matches production during load tests.
  aks_sku_tier = "Standard"

  system_node_pool = {
    vm_size         = "Standard_D2ds_v5"
    min_count       = 1
    max_count       = 3
    os_disk_size_gb = 64
  }

  user_node_pool = {
    vm_size         = "Standard_D4ds_v5"
    min_count       = 2
    max_count       = 6
    os_disk_size_gb = 128
  }

  # Premium ACR + private endpoints mirror production so that any DNS or
  # firewall mistake surfaces here rather than during a production release.
  acr_sku                  = "Premium"
  enable_private_endpoints = true

  log_retention_in_days  = 30
  log_daily_quota_gb     = 5
  enable_managed_grafana = true

  api_server_authorized_ip_ranges = var.api_server_authorized_ip_ranges
  allowed_ingress_source_prefixes = var.allowed_ingress_source_prefixes
  keyvault_allowed_ip_rules       = var.keyvault_allowed_ip_rules

  admin_group_object_ids       = var.admin_group_object_ids
  ci_principal_ids             = var.ci_principal_ids
  secret_officer_principal_ids = var.secret_officer_principal_ids
  alert_email_receivers        = var.alert_email_receivers
}
